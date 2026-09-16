#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
plan_llm_io.py — Step 05a 打包 LLM 调用的双向工具

模式 1（--mode emit-input）：timeline.json → llm_input.json
  提取精简 segments（不带 word_timings，减小 prompt 体积、加快推理），
  供「单次打包 LLM 调用」直接填入 references/plan-prompt-template.md。

模式 2（--mode enrich）：llm_output.json + timeline.json → semantic_plan.json
  把 LLM 输出的最小语义字段（title / text / en / keyword / transitions /
  zoom / tone_presets）机械回填为完整 plan：
    - timeline_duration、sub_index、source_index
    - layered（字数 ≥8）
    - display_text / keyword_pop_text（逐位挖空）
    - start / end / keyword_pop_start / keyword_pop_end（词级初始值，
      最终精度由 align_subtitles.py 负责）

用法：
  python3 plan_llm_io.py --mode emit-input --timeline timeline.json \
      --output llm_input.json
  python3 plan_llm_io.py --mode enrich --llm-output llm_output.json \
      --timeline timeline.json --output semantic_plan.json
"""
import argparse
import json
import re
import sys

FS = "\u3000"  # 全角空格
LAYERED_MIN = 8      # ≥8 字上下分层
MAX_LEN = 12         # 单条字幕上限


def load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save(obj, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def seg_words(seg):
    """segment 的有效词列表（跳过空白/无效时间词）"""
    return [w for w in seg.get("word_timings", [])
            if w.get("text", "").strip()
            and w.get("target_start", -1) >= 0
            and w.get("target_end", -1) >= 0]


# ─────────────────────────────────────────────
# 模式 1：生成 LLM 输入
# ─────────────────────────────────────────────
def emit_input(timeline, out_path):
    segs = timeline.get("segments", [])
    items = []
    for seg in segs:
        # 文本从词流拼接，保证与 enrich/align 定位用的字符流同源
        text = "".join(w["text"] for w in seg_words(seg))
        text = re.sub(r"\s+", "", text)
        items.append({
            "source_index": seg["source_index"],
            "text": text,
            "target_start": seg["target_timeline"]["start"],
            "target_end": seg["target_timeline"]["end"],
        })
    payload = {
        "video_duration": timeline.get("video_duration"),
        "timeline_duration": timeline.get("total_target_duration"),
        "removed_silence": timeline.get("removed_silence"),
        "segments": items,
    }
    save(payload, out_path)
    chars = sum(len(i["text"]) for i in items)
    print(f"LLM 输入就绪: {len(items)} 段 / {chars} 字 → {out_path}")
    return payload


# ─────────────────────────────────────────────
# 模式 2：机械回填
# ─────────────────────────────────────────────
def find_in_segment(seg, key, start_offset=0):
    """在 segment 词流中从 start_offset 起查找 key。
    返回 (idx, start, end)：idx 为命中字符位置，start/end 为首/尾词的目标轴时间；
    失败返回 None。"""
    words = seg_words(seg)
    if not words:
        return None
    compact = "".join(w["text"] for w in words)
    compact = re.sub(r"\s+", "", compact)
    idx = compact.find(key, start_offset)
    if idx < 0:
        return None
    end_idx = idx + len(key) - 1
    # 字符位置 → 词位置映射
    pos = 0
    first_w = last_w = None
    for w in words:
        wl = len(re.sub(r"\s+", "", w["text"]))
        if wl == 0:
            continue
        if first_w is None and pos + wl > idx:
            first_w = w
        if pos + wl > end_idx:
            last_w = w
            break
        pos += wl
    if first_w is None or last_w is None:
        return None
    return idx, first_w["target_start"], last_w["target_end"]


def locate_text(seg, text):
    """在 segment 词流中顺序定位 text 首/尾字符的词级时间。
    返回 (start, end, hit_ratio)；失败返回 None。（兼容旧调用入口）"""
    key = re.sub(r"\s+", "", text)
    r = find_in_segment(seg, key)
    if r is None:
        return None
    return r[1], r[2], 1.0


def enrich(llm_out, timeline, out_path):
    segs = timeline.get("segments", [])
    items_in = llm_out.get("subtitle_items", [])
    problems, warns = [], []

    if not items_in:
        problems.append("subtitle_items 为空")
    if not llm_out.get("title", {}).get("top_title") or \
       not llm_out["title"].get("bottom_title"):
        problems.append("title 缺少 top_title/bottom_title")

    items_out = []
    seg_cursor = 0  # 单调消费：字幕按序属于后面的 segment
    seg_offsets = [0] * len(segs)  # 每段已消费字符偏移，防止重复片段误归属前段
    compact_cache = {}

    def seg_compact(si):
        if si not in compact_cache:
            ws = seg_words(segs[si])
            compact_cache[si] = re.sub(r"\s+", "", "".join(w["text"] for w in ws))
        return compact_cache[si]

    for i, it in enumerate(items_in):
        text = re.sub(r"\s+", "", it.get("text", ""))
        en = (it.get("en") or it.get("translation") or "").strip()
        kw = re.sub(r"\s+", "", it.get("keyword") or "")

        if not text:
            problems.append(f"[{i}] text 为空")
            continue
        if len(text) > MAX_LEN:
            warns.append(f"[{i}] 「{text}」{len(text)} 字 >{MAX_LEN} 上限，需 LLM 拆分")
        if not en:
            warns.append(f"[{i}] 「{text}」缺英文翻译")
        if kw and kw not in text:
            warns.append(f"[{i}] keyword「{kw}」不在 text 中，已忽略")
            kw = ""

        # 定位所属 segment + 词级初始时间（字符级单调消费：
        # 每段维护已消费偏移，重复片段不会被误归到更早的段）
        src, hit, matched_key = None, None, text
        c = seg_cursor
        while c < len(segs):
            hit = find_in_segment(segs[c], text, seg_offsets[c])
            if hit:
                src = c
                break
            c += 1
        if src is None:
            # 压缩改写兜底：用前缀 n-1..n-4 逐档尝试定位
            for trim in range(1, min(5, len(text))):
                pref = text[:-trim]
                c = seg_cursor
                while c < len(segs):
                    hit = find_in_segment(segs[c], pref, seg_offsets[c])
                    if hit:
                        src = c
                        matched_key = pref
                        break
                    c += 1
                if src is not None:
                    warns.append(f"[{i}] 「{text}」按前缀「{pref}」定位 seg{src}（疑似压缩改写）")
                    break
        if src is None:
            # 最后兜底：2 字前缀启发式（保留旧行为）
            c = seg_cursor
            while c < len(segs):
                if text[:2] in seg_compact(c) or \
                   (i == len(items_in) - 1 and c == len(segs) - 1):
                    src = c
                    warns.append(f"[{i}] 「{text}」词级定位失败，按 2 字前缀归属 seg{src}")
                    break
                c += 1
        if src is None:
            src = len(segs) - 1
            warns.append(f"[{i}] 「{text}」未定位到 segment，按末段处理")

        seg_cursor = src
        seg = segs[src]
        if hit:
            seg_offsets[src] = hit[0] + len(matched_key)
            start, end = round(hit[1], 2), round(hit[2], 2)
        else:
            tl = seg["target_timeline"]
            start, end = tl["start"], tl["end"]
            warns.append(f"[{i}] 「{text}」词级定位失败，用段范围初值")
        if end <= start:
            end = start + max(len(text) * 0.3, 0.5)

        # 挖空（弹出关键词取最后出现位置，与技能规则一致）
        if kw:
            kidx = text.rindex(kw)
            display = text[:kidx] + FS * len(kw) + text[kidx + len(kw):]
            pop = FS * kidx + kw + FS * (len(text) - kidx - len(kw))
            # keyword 初始时间：首字符词级定位，失败回退 start
            kloc = locate_text(seg, kw) or locate_text(seg, kw[0])
            pop_start = round(kloc[0], 2) if kloc else start
            pop_end = end
        else:
            display, pop = text, ""
            pop_start = pop_end = end

        items_out.append({
            "sub_index": len(items_out),
            "source_index": src,
            "text": text,
            "start": start,
            "end": round(end, 2),
            "layered": len(text) >= LAYERED_MIN,
            "en": en,
            "keyword": kw,
            "display_text": display,
            "keyword_pop_text": pop,
            "keyword_pop_start": round(pop_start, 2),
            "keyword_pop_end": round(pop_end, 2),
        })

    plan = {
        "title": llm_out.get("title", {}),
        "timeline_duration": timeline.get("total_target_duration"),
        "subtitle_items": items_out,
        "transitions": llm_out.get("transitions", []),
        "zoom": llm_out.get("zoom") or {},
        "tone_presets": llm_out.get("tone_presets", []),
    }

    # trigger_sub_index 越界检查
    n = len(items_out)
    for label, obj in (("zoom", plan["zoom"]),):
        ti = obj.get("trigger_sub_index") if isinstance(obj, dict) else None
        if ti is not None and not (0 <= ti < n):
            warns.append(f"zoom.trigger_sub_index={ti} 越界（共 {n} 条），已置空")
            obj["trigger_sub_index"] = None
    for j, tp in enumerate(plan["tone_presets"]):
        ti = tp.get("trigger_sub_index")
        if ti is not None and not (0 <= ti < n):
            warns.append(f"tone_presets[{j}].trigger_sub_index={ti} 越界，已移除")
    plan["tone_presets"] = [tp for tp in plan["tone_presets"]
                            if 0 <= (tp.get("trigger_sub_index") or 0) < n]

    save(plan, out_path)

    lay = sum(1 for x in items_out if x["layered"])
    kw_n = sum(1 for x in items_out if x["keyword_pop_text"])
    print(f"plan 回填完成: {len(items_out)} 条"
          f"（分层 {lay} / 单行 {len(items_out)-lay}，关键词弹出 {kw_n}）→ {out_path}")
    for w in warns:
        print(f"  ⚠️ {w}", file=sys.stderr)
    if problems:
        for p in problems:
            print(f"  ❌ {p}", file=sys.stderr)
        sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", required=True, choices=["emit-input", "enrich"])
    ap.add_argument("--timeline", required=True)
    ap.add_argument("--llm-output")
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    timeline = load(args.timeline)
    if args.mode == "emit-input":
        emit_input(timeline, args.output)
    else:
        if not args.llm_output:
            print("enrich 模式需要 --llm-output", file=sys.stderr)
            sys.exit(2)
        enrich(load(args.llm_output), timeline, args.output)


if __name__ == "__main__":
    main()
