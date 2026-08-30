#!/usr/bin/env python3
"""
verify_workflow.py — 步骤 6c：workflow 组装结果脚本自动检测
（替代「人工读取 query_script 回包 + LLM 推理核对」：回包通常 >500KB，
超出上下文硬限制且人工核对易漏判。workflow.json 由 build_workflow.py
确定性生成，execute_workflow 返回 success 即视为已应用，因此对
workflow.json 与 plan/timeline 做机械化逐项核对即为充分校验。）

用法:
  python3 verify_workflow.py \
    --workflow workflow.json \
    --plan semantic_plan.json \
    --timeline timeline.json \
    [--output verify_report.json]

检测项（全部机械对比，无 LLM 推理）:
  1. 标题层：文案与 plan 一致，start=0，end=min(5.0, timeline_duration)
  2. video_main：段数/源区间/目标起点与 timeline 一致，完整覆盖
     [0, timeline_duration]，无缺口
  3. 文字层数量与规划一致：普通双语 2 层/条、分层上下 4 层/条、
     标题与弹出层单独计数；出现未知轨道即报错
  4. 关键词挖空弹出层存在，且文案/起止时间与 plan.keyword_pop_* 一致
  5. 转场与 plan 一致，且只使用 向右/向左/竖向模糊 三种固定类型
  6. 缩放关键帧：scale_x + scale_y 成对，峰值 = plan.zoom.scale，
     时间均落在时间轴内
  7. 提示音预设数量/类型/触发时间与 plan.tone_presets 一致
  8. BGM：恰好 1 段，从 0 覆盖到时间轴末尾

退出码: 0 = 全部通过; 1 = 任一检测失败或输入错误。
报告 JSON 的 summary 字段可直接用于最终回复中的「校验结果」。
"""
import argparse
import json
import sys
from collections import defaultdict

EPS = 0.02
ALLOWED_TRANSITIONS = {"向右", "向左", "竖向模糊"}
TITLE_TRACKS = ("text_title_top", "text_title_bottom")
SUBTITLE_TRACKS = (
    "yimei_normal_cn", "yimei_normal_en",
    "yimei_layered_top", "yimei_layered_bottom",
    "yimei_layered_top_en", "yimei_layered_bottom_en",
)
POP_TRACK_NORMAL = "yimei_normal_cn_keyword_pop"
POP_TRACKS_LAYERED = ("yimei_layered_top_keyword_pop",
                      "yimei_layered_bottom_keyword_pop")
KNOWN_ACTION_TYPES = {"add_video", "add_text", "add_video_keyframe",
                      "add_preset", "add_audio"}


def approx(a, b, eps=EPS):
    try:
        return abs(float(a) - float(b)) <= eps
    except (TypeError, ValueError):
        return False


def load_json(path, name):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"❌ 无法读取 {name}: {path} ({e})", file=sys.stderr)
        sys.exit(1)


class Reporter:
    def __init__(self):
        self.checks = []

    def add(self, item, passed, detail=""):
        self.checks.append({"item": item, "passed": bool(passed),
                            "detail": detail})

    @property
    def valid(self):
        return all(c["passed"] for c in self.checks)


def find_layers(layers, start):
    return [l for l in layers if approx(l.get("start"), start)]


def main():
    ap = argparse.ArgumentParser(description="workflow 组装自动校验")
    ap.add_argument("--workflow", required=True)
    ap.add_argument("--plan", required=True)
    ap.add_argument("--timeline", required=True)
    ap.add_argument("--output", default=None)
    args = ap.parse_args()

    wf = load_json(args.workflow, "workflow.json")
    plan = load_json(args.plan, "semantic_plan.json")
    tl = load_json(args.timeline, "timeline.json")

    actions = wf.get("script", [])
    duration = plan.get("timeline_duration") or tl.get("total_target_duration")
    items = plan.get("subtitle_items", [])
    rep = Reporter()

    videos = [a["params"] for a in actions if a["action_type"] == "add_video"]
    texts = [a["params"] for a in actions if a["action_type"] == "add_text"]
    keyframes = [a["params"] for a in actions
                 if a["action_type"] == "add_video_keyframe"]
    presets = [a["params"] for a in actions
               if a["action_type"] == "add_preset"]
    audios = [a["params"] for a in actions if a["action_type"] == "add_audio"]

    by_track = defaultdict(list)
    for t in texts:
        by_track[t.get("track_name") or ""].append(t)

    # ── 0. 动作类型白名单 ────────────────────────────────
    unknown = sorted({a["action_type"] for a in actions} - KNOWN_ACTION_TYPES)
    rep.add("动作类型白名单", not unknown,
            f"未知动作类型: {', '.join(unknown)}" if unknown else "")

    # ── 1. 标题层 ────────────────────────────────────────
    title = plan.get("title", {}) or {}
    expected_titles = []
    if title.get("top_title"):
        expected_titles.append(("text_title_top", title["top_title"]))
    if title.get("bottom_title"):
        expected_titles.append(("text_title_bottom", title["bottom_title"]))
    title_end = min(5.0, duration)
    problems = []
    if not expected_titles:
        problems.append("plan 缺少标题（top_title/bottom_title 均为空）")
    for track, txt in expected_titles:
        layers = by_track.get(track, [])
        if len(layers) != 1:
            problems.append(f"{track} 层数 {len(layers)} ≠ 1")
            continue
        l = layers[0]
        if l.get("text") != txt:
            problems.append(f"{track} 文案 “{l.get('text')}” ≠ plan “{txt}”")
        if not (approx(l.get("start"), 0.0) and approx(l.get("end"), title_end)):
            problems.append(
                f"{track} 时间 {l.get('start')}-{l.get('end')} ≠ 0-{title_end}")
    for track in TITLE_TRACKS:
        if track not in dict(expected_titles) and by_track.get(track):
            problems.append(f"{track} 出现 plan 之外的标题层")
    rep.add("标题层", not problems, "；".join(problems))

    # ── 2. video_main 覆盖 ──────────────────────────────
    segs = tl.get("segments", [])
    problems = []
    if len(videos) != len(segs):
        problems.append(f"video_main 段数 {len(videos)} ≠ timeline {len(segs)}")
    else:
        vs = sorted(videos, key=lambda v: v.get("target_start", 0))
        for i, (v, s) in enumerate(zip(vs, segs)):
            src = s.get("source_video", {})
            tgt = s.get("target_timeline", {})
            if not (approx(v.get("start"), src.get("start"))
                    and approx(v.get("end"), src.get("end"))):
                problems.append(
                    f"段{i} 源区间 {v.get('start')}-{v.get('end')} "
                    f"≠ {src.get('start')}-{src.get('end')}")
            if not approx(v.get("target_start"), tgt.get("start")):
                problems.append(
                    f"段{i} 目标起点 {v.get('target_start')} ≠ {tgt.get('start')}")
            actual_end = (v.get("target_start", 0)
                          + (v.get("end", 0) - v.get("start", 0)))
            if not approx(actual_end, tgt.get("end"), eps=0.05):
                problems.append(
                    f"段{i} 目标终点 {actual_end:.3f} ≠ {tgt.get('end')}")
        if vs:
            if not approx(vs[0].get("target_start"), 0.0):
                problems.append(f"首段目标起点 {vs[0].get('target_start')} ≠ 0")
            last_end = (vs[-1].get("target_start", 0)
                        + (vs[-1].get("end", 0) - vs[-1].get("start", 0)))
            if not approx(last_end, duration, eps=0.05):
                problems.append(f"末段目标终点 {last_end:.3f} ≠ 时间轴 {duration}")
    rep.add("video_main 覆盖完整时间轴", not problems, "；".join(problems))

    # ── 3+4. 文字层数量与内容、关键词弹出 ─────────────────
    expected_total = len(expected_titles)
    n_subtitle_layers = 0
    n_pop_layers = 0
    problems = []
    pop_problems = []
    for it in items:
        s, e = it.get("start"), it.get("end")
        text = it.get("text", "")
        display = it.get("display_text") or text
        en = it.get("en", "")
        layered = it.get("layered", False)
        has_pop = bool(it.get("keyword_pop_text"))

        def one(track, start=s):
            found = find_layers(by_track.get(track, []), start)
            return found[0] if len(found) >= 1 else None, len(found)

        if layered:
            n_subtitle_layers += 4
            top, n_top = one("yimei_layered_top")
            bottom, n_bottom = one("yimei_layered_bottom")
            if n_top != 1 or n_bottom != 1:
                problems.append(
                    f"字幕{it.get('sub_index')} 分层中文层数 "
                    f"top={n_top}/bottom={n_bottom} ≠ 1/1")
            elif top.get("text", "") + bottom.get("text", "") != display:
                problems.append(
                    f"字幕{it.get('sub_index')} top+bottom 拼接 ≠ display_text")
            for t_en in ("yimei_layered_top_en", "yimei_layered_bottom_en"):
                l, n = one(t_en)
                if n != 1:
                    problems.append(f"字幕{it.get('sub_index')} {t_en} 层数 {n} ≠ 1")
                elif l.get("text", "") != en:
                    problems.append(
                        f"字幕{it.get('sub_index')} {t_en} 文案与 plan 不一致")
        else:
            n_subtitle_layers += 2
            cn, n_cn = one("yimei_normal_cn")
            if n_cn != 1:
                problems.append(f"字幕{it.get('sub_index')} 中文层数 {n_cn} ≠ 1")
            elif cn.get("text", "") != display:
                problems.append(
                    f"字幕{it.get('sub_index')} 中文文案 “{cn.get('text')}” "
                    f"≠ display_text “{display}”")
            en_l, n_en = one("yimei_normal_en")
            if n_en != 1:
                problems.append(f"字幕{it.get('sub_index')} 英文层数 {n_en} ≠ 1")
            elif en_l.get("text", "") != en:
                problems.append(f"字幕{it.get('sub_index')} 英文文案与 plan 不一致")

        if has_pop:
            n_pop_layers += 1
            # 与 build_workflow.py 一致的 clamp 规则
            ps, pe = it.get("keyword_pop_start"), it.get("keyword_pop_end")
            if ps is None or pe is None:
                ps, pe = s, e
            else:
                if ps >= e:
                    ps = s
                if pe > e:
                    pe = e
            kw = it.get("keyword", "")
            if layered:
                # build_workflow 对分层字幕按行重构弹出文案
                # （kpos/mid 定位，而非直接转录 plan.keyword_pop_text），
                # 因此校验：轨道侧别 + 行内偏移 + 关键词内容 + 时间
                mid = len(text) // 2
                kpos = text.find(kw) if kw else -1
                exp_track = ("yimei_layered_top_keyword_pop"
                             if 0 <= kpos < mid
                             else "yimei_layered_bottom_keyword_pop")
                exp_lead = "\u3000" * (kpos if kpos < mid else kpos - mid)
                cands = find_layers(by_track.get(exp_track, []), ps)
                if len(cands) != 1:
                    pop_problems.append(
                        f"字幕{it.get('sub_index')} {exp_track} 弹出层数 "
                        f"{len(cands)} ≠ 1")
                else:
                    l = cands[0]
                    t_text = l.get("text", "")
                    if not t_text.startswith(exp_lead):
                        pop_problems.append(
                            f"字幕{it.get('sub_index')} 弹出层行内偏移错误")
                    if t_text.replace("\u3000", "") != kw:
                        pop_problems.append(
                            f"字幕{it.get('sub_index')} 弹出关键词 "
                            f"“{t_text.replace(chr(0x3000), '')}” ≠ “{kw}”")
                    if not approx(l.get("end"), pe):
                        pop_problems.append(
                            f"字幕{it.get('sub_index')} 弹出结束 "
                            f"{l.get('end')} ≠ {pe}")
                # 另一侧轨道不应出现该条的弹出层
                other = (set(POP_TRACKS_LAYERED) - {exp_track}).pop()
                if find_layers(by_track.get(other, []), ps):
                    pop_problems.append(
                        f"字幕{it.get('sub_index')} 在错误轨道 {other} 出现弹出层")
            else:
                cands = find_layers(by_track.get(POP_TRACK_NORMAL, []), ps)
                if len(cands) != 1:
                    pop_problems.append(
                        f"字幕{it.get('sub_index')} 弹出层数 {len(cands)} ≠ 1")
                else:
                    l = cands[0]
                    if l.get("text", "") != it["keyword_pop_text"]:
                        pop_problems.append(
                            f"字幕{it.get('sub_index')} 弹出文案与 plan 不一致")
                    if not approx(l.get("end"), pe):
                        pop_problems.append(
                            f"字幕{it.get('sub_index')} 弹出结束 "
                            f"{l.get('end')} ≠ {pe}")

        # 显示层（普通 2 / 分层 4）+ 弹出层（有挖空时 1）
        expected_total += (4 if layered else 2) + (1 if has_pop else 0)

    # 弹出层总数核对
    actual_pop = sum(len(by_track.get(t, []))
                     for t in list(POP_TRACKS_LAYERED) + [POP_TRACK_NORMAL])
    if actual_pop != n_pop_layers:
        pop_problems.append(f"弹出层总数 {actual_pop} ≠ plan 预期 {n_pop_layers}")
    count_detail = list(problems)
    if len(texts) != expected_total:
        count_detail.append(f"实际 {len(texts)} 层 ≠ 预期 {expected_total} 层")
    rep.add("文字层数量与规划一致", not count_detail, "；".join(count_detail))
    rep.add("关键词弹出层存在且内容正确", not pop_problems,
            "；".join(pop_problems))

    # 未知轨道检测
    known_tracks = (set(TITLE_TRACKS) | set(SUBTITLE_TRACKS)
                    | set(POP_TRACKS_LAYERED) | {POP_TRACK_NORMAL})
    stray = sorted(set(by_track) - known_tracks)
    rep.add("无未知文字轨道", not stray,
            f"未知轨道: {', '.join(stray)}" if stray else "")

    # ── 5. 转场 ─────────────────────────────────────────
    plan_tr = {tr.get("seg_index"): tr for tr in plan.get("transitions", [])}
    problems = []
    if len(videos) == len(segs):
        vs = sorted(videos, key=lambda v: v.get("target_start", 0))
        for i, v in enumerate(vs):
            t = v.get("transition")
            if i in plan_tr:
                exp = plan_tr[i]
                if t != exp.get("type"):
                    problems.append(f"段{i} 转场 “{t}” ≠ plan “{exp.get('type')}”")
                elif not approx(v.get("transition_duration", 0),
                                exp.get("duration", 0.6)):
                    problems.append(f"段{i} 转场时长与 plan 不一致")
            elif t:
                problems.append(f"段{i} 出现 plan 之外的转场 “{t}”")
            if t and t not in ALLOWED_TRANSITIONS:
                problems.append(f"段{i} 转场 “{t}” 不在固定类型内")
    used_types = [tr.get("type") for tr in plan.get("transitions", [])]
    if len(set(used_types)) != len(used_types) or len(used_types) > 3:
        problems.append("plan 转场违反「每种最多一次、总数 ≤3」")
    rep.add("转场与规划一致", not problems, "；".join(problems))

    # ── 6. 缩放关键帧 ───────────────────────────────────
    zoom = plan.get("zoom") or {}
    has_zoom = zoom.get("trigger_sub_index") is not None
    problems = []
    kf_groups = 0
    if has_zoom:
        scale = float(zoom.get("scale", 1.2))
        if len(keyframes) != 2:
            problems.append(f"关键帧动作数 {len(keyframes)} ≠ 2（scale_x + scale_y）")
        else:
            kf_groups = 1
            seen = set()
            for k in keyframes:
                pt = set(k.get("property_types", []))
                if pt == {"scale_x"} or pt == {"scale_y"}:
                    seen.add(tuple(pt)[0])
                else:
                    problems.append(f"关键帧属性异常: {sorted(pt)}")
                try:
                    peak = max(float(v) for v in k.get("values", []))
                except ValueError:
                    problems.append("关键帧 values 非数值")
                    continue
                if not approx(peak, scale):
                    problems.append(f"关键帧峰值 {peak} ≠ plan 缩放 {scale}")
                times = k.get("times", [])
                if not times or any(t < -EPS or t > duration + EPS for t in times):
                    problems.append("关键帧时间超出时间轴")
            if seen != {"scale_x", "scale_y"}:
                problems.append(f"缺少 scale_x 或 scale_y 组: {sorted(seen)}")
    elif keyframes:
        problems.append(f"plan 无缩放，但出现 {len(keyframes)} 个关键帧动作")
    rep.add("缩放关键帧", not problems, "；".join(problems))

    # ── 7. 提示音 ───────────────────────────────────────
    tps = plan.get("tone_presets", [])
    problems = []
    if len(presets) != len(tps):
        problems.append(f"提示音数 {len(presets)} ≠ plan {len(tps)}")
    for tp in tps:
        ti = tp.get("trigger_sub_index")
        exp_track = f"preset_tone_{tp.get('tone_type')}"
        exp_start = items[ti]["start"] if (
            isinstance(ti, int) and 0 <= ti < len(items)) else None
        matched = [p for p in presets if p.get("track_name") == exp_track]
        if not matched:
            problems.append(f"缺少 {exp_track}")
        elif exp_start is not None and not any(
                approx(p.get("target_start"), exp_start) for p in matched):
            problems.append(f"{exp_track} 触发时间与字幕{ti}起点不一致")
    rep.add("提示音预设", not problems, "；".join(problems))

    # ── 8. BGM ──────────────────────────────────────────
    problems = []
    if len(audios) != 1:
        problems.append(f"BGM 数 {len(audios)} ≠ 1")
    else:
        a = audios[0]
        if not approx(a.get("target_start"), 0.0):
            problems.append(f"BGM 起点 {a.get('target_start')} ≠ 0")
        if float(a.get("end", 0)) < duration - 0.05:
            problems.append(f"BGM 终点 {a.get('end')} 未覆盖时间轴 {duration}")
        if not a.get("audio_url"):
            problems.append("BGM audio_url 为空")
    rep.add("BGM 覆盖到时间轴末尾", not problems, "；".join(problems))

    # ── 汇总 ────────────────────────────────────────────
    summary = {
        "video_main_segments": len(videos),
        "text_layers_total": len(texts),
        "title_layers": len(expected_titles),
        "subtitle_layers": n_subtitle_layers,
        "keyword_pop_layers": n_pop_layers,
        "scale_keyframe_groups": kf_groups,
        "tone_presets": len(presets),
        "bgm": len(audios),
        "summary_line": (
            f"video_main {len(videos)} 段、文字层 {len(texts)} 个、"
            f"关键词弹出 {n_pop_layers} 个、缩放关键帧 {kf_groups} 组、"
            f"提示音 {len(presets)} 个、BGM {len(audios)} 段"),
    }
    report = {"valid": rep.valid, "checks": rep.checks, "summary": summary}

    print("=== workflow 自动检测结果 ===")
    for c in rep.checks:
        mark = "✅" if c["passed"] else "❌"
        detail = f" — {c['detail']}" if c["detail"] and not c["passed"] else ""
        print(f"  {mark} {c['item']}{detail}")
    print(f"  汇总: {summary['summary_line']}")
    if rep.valid:
        print("✅ 校验完成: 全部通过")
    else:
        failed = [c["item"] for c in rep.checks if not c["passed"]]
        print(f"❌ 校验失败: {', '.join(failed)}")

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"报告已写入: {args.output}")

    sys.exit(0 if rep.valid else 1)


if __name__ == "__main__":
    main()
