#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
align_subtitles.py — 用 ASR 词级时间戳修正字幕时间偏移（v2）

背景：
  LLM 分句/改写（≤12 字压缩）后，字幕时间按字符比例平摊，与实际语音偏差
  0.5~2s。本脚本用 ASR 逐词时间戳（毫秒、原始视频时间）+ timeline 源→时间轴
  分段映射，把每条字幕重新锚定到实际语音位置。

  v2 针对 LLM 改写的三种形态：
  a. 丢字/插字（「跟着别人屁股后面一步一步走」→「跟着别人一步步走」）
     → 变长滑动窗口（n-1 ~ n+8）模糊匹配
  b. 语序重排（语音「也想给这位电磁弹射之父献束花马伟明这三个字」被拆成乱序
     三条字幕）→ 两阶段：先单调前向匹配，失败条目做全局回捞（排除已占用区间，
     按时间就近加权）

匹配结果的时间天然按字符位置有序（= 语音顺序），条目显示顺序若与 item 顺序
不同属正常——字幕跟随语音才是对的。

用法：
  python3 align_subtitles.py --asr asr_raw_result.json --timeline timeline.json \
      --plan semantic_plan.json [--dry-run] [--threshold 0.5]

  --asr 兼容纯识别句列表与字幕识别工具响应信封两种格式（asr_compat 模块）。

输出：原地更新 plan 的 start/end/keyword_pop_start/keyword_pop_end。
"""
import argparse
import json
import re
import sys
from difflib import SequenceMatcher

from asr_compat import extract_utterances

PUNCT_RE = re.compile(r'[，。？！、；：“”‘’（）…—·~\s]')
MIN_DURATION = 0.16   # 最短显示时长(秒)，仅兜底
MAX_EXTRA = 8         # 变长窗口最多比查询多几个字（容忍 LLM 删字）
WINDOW_LIMIT = 400    # 单调搜索最大前向窗口（字符数）


def build_char_stream(utterances):
    chars, times = [], []
    for u in utterances:
        for w in u.get("words", []):
            s, e = w["start_time"] / 1000.0, w["end_time"] / 1000.0
            for ch in w["text"]:
                if ch.strip():
                    chars.append(ch)
                    times.append((s, e))
    return "".join(chars), times


def build_mappings(segments):
    def src2tgt(t):
        for s0, s1, t0, t1 in segments:
            if s0 <= t <= s1:
                return t0 + (t - s0) * (t1 - t0) / (s1 - s0)
        for s0, s1, t0, t1 in segments:
            if t < s0:
                return t0
        return segments[-1][3]

    def tgt2src(t):
        for s0, s1, t0, t1 in segments:
            if t0 <= t <= t1:
                return s0 + (t - t0) * (s1 - s0) / (t1 - t0)
        for s0, s1, t0, t1 in segments:
            if t < t0:
                return s0
        return segments[-1][1]

    return src2tgt, tgt2src


def clean_text(t):
    return PUNCT_RE.sub("", t or "")


def fuzzy_best(stream, query, j_from, j_to):
    """在 [j_from, j_to] 范围内做变长窗口模糊匹配。
    返回 (ratio, pos, span_len)"""
    n = len(query)
    hi = min(j_to, len(stream) - 1)
    best = (0.0, -1, n)
    for L in range(max(1, n - 1), n + MAX_EXTRA + 1):
        if j_from + L > len(stream):
            break
        for j in range(j_from, min(hi, len(stream) - L) + 1):
            r = SequenceMatcher(None, query, stream[j:j + L], autojunk=False).ratio()
            if r > best[0]:
                best = (r, j, L)
                if r > 0.97:
                    return best
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--asr", required=True)
    ap.add_argument("--timeline", required=True)
    ap.add_argument("--plan", required=True)
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    with open(args.asr) as f:
        utterances = extract_utterances(json.load(f))
    with open(args.timeline) as f:
        tl = json.load(f)
    with open(args.plan) as f:
        plan = json.load(f)

    stream, char_times = build_char_stream(utterances)
    segments = [(sg["source_video"]["start"], sg["source_video"]["end"],
                 sg["target_timeline"]["start"], sg["target_timeline"]["end"])
                for sg in tl["segments"]]
    src2tgt, tgt2src = build_mappings(segments)

    items = plan["subtitle_items"]
    queries = [clean_text(it.get("text")) for it in items]

    # ── 阶段 1：单调前向匹配 ──
    used_exact = []   # 精确匹配占用区间（高置信，全局回捞不可穿入）
    used_fuzzy = []   # 模糊匹配占用区间（长跨度可能包住其他条目的文字）
    results = {}  # idx -> (kind, pos, span)
    sf = 0
    for i, q in enumerate(queries):
        n = len(q)
        if n == 0:
            continue
        p = stream.find(q, sf)
        kind, pos, span = "exact", p, n
        if p < 0:
            r, fp, fl = fuzzy_best(stream, q, sf, sf + WINDOW_LIMIT)
            if r >= args.threshold:
                kind, pos, span = f"fuzzy", fp, fl
            else:
                pos = -1
        if pos >= 0:
            results[i] = (kind, pos, span)
            (used_exact if kind == "exact" else used_fuzzy).append((pos, pos + span))
            sf = pos + span  # 完整消耗实际语音跨度

    # ── 阶段 2：全局回捞（语序重排的条目）──
    unmatched = [i for i, q in enumerate(queries) if q and i not in results]
    for i in unmatched:
        q = queries[i]
        n = len(q)
        it = items[i]
        orig_mid_src = tgt2src((it["start"] + it["end"]) / 2)
        # 全局精确候选：选与原时间最近的
        cands = []
        p = stream.find(q)
        while p >= 0:
            cands.append((1.0, p, n))
            p = stream.find(q, p + 1)
        if not cands:
            r, fp, fl = fuzzy_best(stream, q, 0, len(stream) - 1)
            if r >= args.threshold:
                cands = [(r, fp, fl)]
        best = None
        for ratio, pos, span in cands:
            if pos + span > len(char_times):
                continue
            mid_src = (char_times[pos][0] + char_times[pos + span - 1][1]) / 2
            # 精确占用区间不可穿入；模糊占用区间只允许高置信候选穿入
            # （长模糊跨度可能包住被语序重排条目的文字，如
            #   「也想给这位[电磁弹射之父]献束花」包住了「电磁弹射之父」）
            if any(not (pos + span <= a or pos >= b) for a, b in used_exact):
                continue
            overlap_fuzzy = any(not (pos + span <= a or pos >= b) for a, b in used_fuzzy)
            if overlap_fuzzy and ratio < 0.9:
                continue
            penalty = min(abs(mid_src - orig_mid_src) / 8.0, 0.35)
            score = ratio - penalty
            if best is None or score > best[0]:
                best = (score, pos, span)
        if best:
            _, pos, span = best
            results[i] = ("global", pos, span)
            used_exact.append((pos, pos + span))
            used_exact.sort()

    # ── 时间计算（按字符位置排序，天然无重叠）──
    aligned = []  # (char_pos, idx, kind, span)
    for i, (kind, pos, span) in results.items():
        aligned.append((pos, i, kind, span))
    aligned.sort()

    stats = {"exact": 0, "fuzzy": 0, "global": 0, "nomatch": 0}
    rows = []
    # 先算原始时间备查
    for rank, (pos, i, kind, span) in enumerate(aligned):
        q = queries[i]
        ws = char_times[pos][0]
        we = char_times[pos + span - 1][1]
        new_s, new_e = src2tgt(ws), src2tgt(we)
        # 最短时长兜底：不越过下一条(按字符序)的起点
        if rank + 1 < len(aligned):
            nxt_pos = aligned[rank + 1][0]
            nxt_s = src2tgt(char_times[nxt_pos][0])
        else:
            nxt_s = plan.get("timeline_duration", 1e9)
        if new_e - new_s < MIN_DURATION:
            new_e = min(new_s + MIN_DURATION, nxt_s - 0.01)
        # keyword_pop_start：关键词首字词级时间
        it = items[i]
        kw = clean_text(it.get("keyword", ""))
        kps = None
        if kw and it.get("keyword_pop_text"):
            kpos = q.find(kw)
            if 0 <= kpos < span:
                kps = src2tgt(char_times[pos + kpos][0])
            elif new_e > new_s and kpos >= 0:
                kps = new_s + (kpos / len(q)) * (new_e - new_s)
        rows.append((i, kind, it["start"], it["end"], new_s, new_e, kps))

    # ── 重叠裁剪：长模糊跨度包住后继条目时，裁掉前者的尾部 ──
    # （cur 开始时间落在 prev 区间内 → prev 提前收尾，让位给更精确的锚点）
    trims = 0
    for r in range(len(rows)):
        for p in range(r):
            if rows[p][5] > rows[r][4] + 0.01:  # prev_end > cur_start
                new_end = max(rows[r][4] - 0.02, rows[p][4] + 0.05)  # 不低于自身起点
                rows[p] = rows[p][:5] + (new_end,) + (rows[p][6],)
                trims += 1
    if trims:
        print(f"  重叠裁剪: {trims} 处（长模糊跨度让位给精确锚点）")

    # ── 写回 ──
    for i, kind, old_s, old_e, new_s, new_e, kps in rows:
        it = items[i]
        it["start"], it["end"] = round(new_s, 3), round(new_e, 3)
        if it.get("keyword_pop_text"):
            k = min(max(kps if kps is not None else new_s, new_s), new_e)
            it["keyword_pop_start"] = round(k, 3)
            it["keyword_pop_end"] = round(new_e, 3)
        stats[kind if kind in stats else "fuzzy"] += 1
    stats["nomatch"] = sum(1 for q in queries if q) - len(rows)

    # ── 报告 ──
    devs = [abs(r[4] - r[2]) for r in rows]
    print(f"词级对齐: 字幕 {len(queries)} 条（有效 {sum(1 for q in queries if q)} 条）")
    print(f"  单调精确: {stats['exact']}  单调模糊: {stats['fuzzy']}  "
          f"全局回捞(语序重排): {stats['global']}  未匹配: {stats['nomatch']}")
    if devs:
        print(f"  起始时间修正量: 平均 {sum(devs)/len(devs):.2f}s  最大 {max(devs):.2f}s"
              f"  (>0.5s: {sum(1 for d in devs if d > 0.5)} 条, >1s: {sum(1 for d in devs if d > 1)} 条)")
    still = [i for i, q in enumerate(queries) if q and i not in results]
    if still:
        print("  未匹配（保持原时间）:")
        for i in still:
            print(f"    [{i}] {items[i]['start']:.2f}s 「{items[i]['text']}」")
    print("  修正量最大的 5 条:")
    for r in sorted(rows, key=lambda x: -abs(x[4] - x[2]))[:5]:
        print(f"    [{r[0]}] 「{items[r[0]]['text']}」 {r[2]:.2f}→{r[4]:.2f} (Δ={r[4]-r[2]:+.2f}s) [{r[1]}]")
    # 时间轴一致性
    bad = [(i, items[i]["start"], items[i]["end"]) for i in range(len(items))
           if items[i]["end"] <= items[i]["start"]]
    if bad:
        print(f"  ⚠️ 非法时长 {len(bad)} 条: {bad[:3]}")

    if args.dry_run:
        print("(dry-run，未写盘)")
        return
    with open(args.plan, "w") as f:
        json.dump(plan, f, ensure_ascii=False, indent=2)
    print(f"✅ 已更新 {args.plan}")


if __name__ == "__main__":
    main()
