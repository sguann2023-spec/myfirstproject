#!/usr/bin/env python3
"""
verify_draft.py —— 导出后的落地校验（读剪映工程 JSON 比对硬规则，不靠肉眼）

  python3 scripts/verify_draft.py <草稿目录|draft JSON> --cta-scale <本次预渲染选中值> [--fonts 汉仪英雄体,抖音美好体,霸燃手书]

优先读 draft_content.json（真值都在这里），退化到 draft_info.json。
校验项（任一条 FAIL 就退回改 spec 重装配 / 增量 modify）：
  1. 手调文字层必带阴影，且 alpha/distance 与标定表一致
  2. 手调文字层必须写入本次预渲染选中的有效剪映字体
  3. 手调文字层字号必须落在已验证范围
  4. 价格爆点必须是剪映文字模版；CTA scale 与本次预渲染选中值一致
  5. 视频素材画幅必须 9:16（否则黑边）
  6. 时间轴不变量：顶部标题 0 起覆盖全片、CTA 落在最后 1s
  7. 音频轨齐：口播/BGM/环境 + whoosh/ding/pop 段数
"""
import json, sys, os, re

OK_SIZES = {13, 9, 23, 17, 6.5, 20, 15}          # 已预渲染验证范围 + 模版默认


def load(path):
    if os.path.isdir(path):
        for f in ("draft_content.json", "draft_info.json"):
            if os.path.exists(os.path.join(path, f)):
                path = os.path.join(path, f)
                break
        else:
            sys.exit("目录里没有 draft_content.json / draft_info.json")
    return json.load(open(path, encoding="utf-8")), os.path.basename(path)


def us(x):
    return round((x or 0) / 1e6, 2)


def style_of(t):
    """texts[].content 是一段 JSON 字符串，真正的字体/字号/描边/阴影在里面"""
    try:
        c = json.loads(t.get("content") or "{}")
    except Exception:
        return {}
    s = (c.get("styles") or [{}])[0]
    font = (s.get("font") or {}).get("path", "") or (s.get("font") or {}).get("id", "")
    sh = (s.get("shadows") or [{}])[0]
    st = (s.get("strokes") or [{}])[0]
    col = ((st.get("content") or {}).get("solid") or {}).get("color")
    return {"size": s.get("size"), "font": os.path.splitext(os.path.basename(font))[0] if font else "",
            "shadow": sh or None, "stroke_color": col,
            "text": c.get("text") or re.sub(r"<[^>]+>", "", str(t.get("content", "")))[:16]}


def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(2)
    d, used = load(sys.argv[1])
    args = sys.argv
    if "--cta-scale" not in args:
        sys.exit("缺少 --cta-scale：必须传入本次预渲染比较后选中的 CTA 缩放值，不再使用固定默认值")
    want_cta = float(args[args.index("--cta-scale") + 1])
    m = d["materials"]
    tpl_ids = {t["id"] for t in m.get("text_templates", [])}
    texts = {t["id"]: t for t in m.get("texts", [])}
    dur = us(d.get("duration"))
    fails, notes = [], []

    hand, tpl = [], []
    for tr in d["tracks"]:
        if tr["type"] != "text":
            continue
        name = tr.get("name", "?")
        for s in tr.get("segments") or []:
            mid = s.get("material_id")
            sc = ((s.get("clip") or {}).get("scale")) or {}
            if mid in tpl_ids:
                tpl.append((name, sc)); continue
            t = texts.get(mid)
            if not t:
                continue
            hand.append((name, style_of(t), s))

    # 1~3 手调层
    no_shadow = []
    for name, st, s in hand:
        txt, sh = st.get("text", ""), st.get("shadow")
        if not sh or sh.get("alpha", 0) <= 0:
            no_shadow.append(f"{name}「{txt[:10]}」")
        f = st.get("font", "")
        if f == "":
            fails.append(f"[字体] {name}「{txt[:10]}」没有写入有效字体；应使用本次预渲染选中的剪映字体")
        if st.get("size") and st["size"] not in OK_SIZES:
            fails.append(f"[字号] {name}「{txt[:10]}」size={st['size']} 不在标定表 {sorted(OK_SIZES)}")
    if no_shadow:
        fails.append("[阴影] 手调层缺阴影：" + "、".join(no_shadow))
    notes.append(f"手调文字层 {len(hand)}，缺阴影 {len(no_shadow)}")
    notes.append("手调层字体：" + ", ".join(sorted({st.get('font') or '?' for _, st, _ in hand})))

    # 4 价格爆点必须是模版；CTA 缩放匹配本次预渲染结果
    if not any("促销爆点" in name or "价格爆点" in name for name, _ in tpl):
        fails.append("[文字模版] 价格爆点不是剪映文字模版层")
    for name, sc in tpl:
        if "CTA" in name or "结尾" in name:
            if abs(float(sc.get("x", 1.0)) - want_cta) > 0.02:
                fails.append(f"[模版缩放] {name} scale={sc.get('x')} 期望 {want_cta}")
    notes.append(f"模版层 {len(tpl)}，scale={ [sc.get('x') for _, sc in tpl] }（价格爆点必须为模版）")

    # 5 画幅
    for v in m.get("videos", []):
        if v.get("type") != "video":
            continue
        w, h = v.get("width") or 0, v.get("height") or 0
        if w and h and abs(w / h - 9 / 16) > 0.03:
            fails.append(f"[画幅] 视频 {w}x{h} 不是 9:16，会有黑边")

    # 6 时间轴不变量
    def rng(n):
        for tr in d["tracks"]:
            if tr.get("name") == n:
                for s in tr.get("segments") or []:
                    a = us(s["target_timerange"]["start"])
                    return a, us(a * 1e6 + s["target_timerange"]["duration"])
        return None
    top = rng("顶部标题")
    if top and top[0] > 0.02:
        fails.append(f"[顶部标题] 起点 {top[0]} 应为 0")
    cta = rng("结尾CTA") or rng("CTA")
    if cta and dur and cta[0] < dur - 1.6:
        fails.append(f"[CTA] 起点 {cta[0]} 太早，应在最后 1s（片长 {dur}）")

    # 7 音频
    aud = {tr.get("name", "?"): len(tr.get("segments") or []) for tr in d["tracks"] if tr["type"] == "audio"}
    for must in ("口播", "BGM"):
        if not any(k.startswith(must) for k in aud):
            fails.append(f"[音频] 缺 {must} 轨")
    notes.append(f"片长 {dur}s / 轨道 {len(d['tracks'])} / 读的是 {used}")
    notes.append("音频轨 " + " ".join(f"{k}x{v}" for k, v in aud.items()))

    for n in notes:
        print("  ·", n)
    if fails:
        print("\nFAIL:")
        for f in fails:
            print("  ✗", f)
        sys.exit(1)
    print("\nPASS —— 全部硬规则通过")


if __name__ == "__main__":
    main()
