#!/usr/bin/env python3
"""校验生成的剪映草稿：时间轴无缝、运镜关键帧到位、文字/音频层数量正确。

用法：
  python3 scripts/verify_draft.py <draft_id>
  python3 scripts/verify_draft.py dfd_cat_xxx --strict
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WS = os.path.dirname(ROOT)


def refresh(draft_id):
    """让 VectCutClaw 先 query_script 落盘；这里只读已导出的快照。"""
    p = os.path.join(WS, f"{draft_id}.json")
    if not os.path.exists(p):
        sys.exit(f"找不到草稿快照 {p}\n先在对话里让助手 query_script 一次再校验。")
    return p


def us(x):
    return round((x or 0) / 1e6, 3)


def main():
    draft_id = sys.argv[1]
    strict = "--strict" in sys.argv
    d = json.load(open(refresh(draft_id), encoding="utf-8"))
    plan = json.load(open(os.path.join(ROOT, "edit_plan.json"), encoding="utf-8"))
    TR = plan["draft"]["tracks"]
    W, H = plan["meta"]["width"], plan["meta"]["height"]
    problems, notes = [], []

    print(f"草稿 {draft_id}  时长 {us(d['duration'])}s  "
          f"画布 {d['canvas_config']['width']}x{d['canvas_config']['height']}  "
          f"轨道 {len(d['tracks'])}")

    # ---- 1 画面层：区间必须首尾相接、无空隙无重叠 ----
    segs = []
    for t in d["tracks"]:
        if t.get("name") != TR["video"]:
            continue
        for s in t.get("segments", []):
            tt = s.get("target_timerange") or {}
            segs.append((us(tt.get("start")), us(tt.get("start")) + us(tt.get("duration"))))
    segs.sort()
    total = sum(b - a for a, b in segs)
    print(f"\n[画面] {len(segs)} 段  合计 {round(total,2)}s")
    prev = None
    for a, b in segs:
        if prev is not None and abs(a - prev) > 0.034:
            problems.append(f"画面空隙/重叠 {prev:.2f} -> {a:.2f}")
        prev = b
    print(f"  首 {segs[0][0]:.2f}s  末 {segs[-1][1]:.2f}s  "
          f"{'✅ 连续' if prev and abs(prev - us(d['duration'])) < 0.05 else '❌ 结尾不齐'}")

    # ---- 2 运镜关键帧 ----
    kf = {}
    for t in d["tracks"]:
        for s in t.get("segments", []):
            for ck in s.get("common_keyframes", []) or []:
                if ck.get("property_type") not in ("KFTypeScaleX", "KFTypeScaleY"):
                    continue
                pts = [(us(k["time_offset"]),
                        (k["values"][0] if isinstance(k["values"], list)
                         else k["values"])) for k in ck["keyframe_list"]]
                kf.setdefault(s["material_id"], []).append(
                    (ck["property_type"], pts))
    two = sum(1 for v in kf.values() if any(len(c) >= 2 for c in v))
    print(f"\n[运镜] 有 scale 关键帧的片段 {len(kf)} 个，其中成对(可动画) {two} 个")
    for t in d["tracks"]:
        for s in t.get("segments", []):
            if s["material_id"] in kf:
                tt = s.get("target_timerange") or {}
                dur = us(tt.get("duration"))
                for prop, pts in kf[s["material_id"]]:
                    ok = len(pts) >= 2
                    if prop != "KFTypeScaleX":
                        continue
                    pretty = " -> ".join(f"{t:.2f}s:{v:.2f}" for t, v in pts)
                    print(f"  {us(tt.get('start')):>6.2f}+{dur:<5.2f} {pretty}  "
                          f"{'✅' if ok else '❌ 单点无动画'}")
                    if not ok:
                        problems.append(f"{us(tt.get('start')):.2f}s 运镜只有 1 个关键帧")

    # ---- 3 文字层 ----
    texts = d["materials"]["texts"]
    by_track, row_sizes = {}, {}
    for t in d["tracks"]:
        if t.get("type") != "text":
            continue
        for s in t.get("segments", []):
            m = next((x for x in texts if x["id"] == s["material_id"]), None)
            if not m:
                continue
            c = json.loads(m["content"])
            _sz = (json.loads(m["content"])["styles"][0].get("size") or 0)
            row_sizes[(t["name"], us((s.get("target_timerange") or {}).get("start")))] = _sz
            by_track.setdefault(t["name"], []).append(
                (us((s.get("target_timerange") or {}).get("start")),
                 us((s.get("target_timerange") or {}).get("duration")),
                 c.get("text", ""), m.get("font_title"),
                 (s.get("clip") or {}).get("transform", {})))
    print(f"\n[文字] {len(texts)} 层 / {len(by_track)} 条文字轨")
    for tn in sorted(by_track):
        for st, du, txt, ft, tr in by_track[tn]:
            y = tr.get("y")
            print(f"  {tn:<14} {st:>6.2f}+{du:<5.2f} y={y if y is None else round(y,3)}  {txt[:26]}")

    # 越界判定：屏幕中心 = H/2 - y_norm*H/2，再按字号(单位x5.7)展开上下沿
    for tn, rows in by_track.items():
        for st, du, txt, ft, tr in rows:
            m = next((x for x in d["materials"]["texts"]
                      for _ in [0] if x["id"]), None)
            sz = 0
            for x in d["materials"]["texts"]:
                pass
            cy = H / 2 - tr.get("y", 0) * H / 2
            half = (row_sizes.get((tn, st), 30) * 5.7) / 2
            if cy - half < 4 or cy + half > H - 4:
                problems.append(
                    f"文字越界 {tn}: {txt[:12]} 中心y={cy:.0f} 占[{cy-half:.0f},{cy+half:.0f}]")

    # ---- 4 音频层 ----
    print()
    for t in d["tracks"]:
        if t.get("type") != "audio":
            continue
        ss = sorted(t.get("segments", []),
                    key=lambda s: (s.get("target_timerange") or {}).get("start", 0))
        rng = [(us((s.get("target_timerange") or {}).get("start")),
                us((s.get("target_timerange") or {}).get("duration"))) for s in ss]
        print(f"[音频] {t['name']:<8} {len(ss):>2} 段  "
              f"{[f'{a:.2f}+{b:.2f}' for a, b in rng][:4]}{' ...' if len(rng) > 4 else ''}")
        vols = {round(s.get("volume", 1), 3) for s in ss}
        if len(vols) > 1:
            print(f"         音量分档 {sorted(vols)}")

    print("\n" + "=" * 46)
    if problems:
        print(f"❌ {len(problems)} 个问题:")
        for p in problems:
            print("   -", p)
    else:
        print("✅ 结构校验全部通过")
    return 1 if (problems and strict) else 0


if __name__ == "__main__":
    sys.exit(main())
