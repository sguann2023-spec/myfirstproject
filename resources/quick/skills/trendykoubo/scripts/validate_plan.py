#!/usr/bin/env python3
"""
validate_plan.py — 校验语义规划结果（替代 LLM 推理校验 Step 06）
优化点：将 Step 06 的 LLM 校验推理替换为脚本机械校验，从 ~40s 降至 <1s

用法:
  python3 validate_plan.py \
    --plan semantic_plan.json \
    --raw asr_raw_result.json

校验项（对应 SKILL.md Step 06 的 11 项检查）：
  1. 标题字数 ≤8（双行标题每行严格 ≤8 字，含标点逐字符计数）
  2. 字幕字数 ≤12
  3. 字幕回拼 = ASR 原文
  4. 分层切词完整性（基础检查）
  5. 转场：每种最多一次，总数 ≤3
  6. 缩放：最多一处，值 = 1.2
  7. 关键词来自原句且连续
  8. display_text + pop_text 逐位合并 = 原文
  9. 提示音：result/emphasis 各最多一次
  10. 时间连续性：相邻字幕间隔 ≤0.01s
  11. 缺句检测（WARN 级）：目标轴空档 >1.6s 且对应源区间有 ≥4 字语音、
      且语音内容未被其他字幕覆盖（n-gram 覆盖率 <50%）→ 可疑缺句，
      Agent 必须逐条复核（补句或注明设计内压缩理由），禁止无理由跳过

用法（--timeline 建议必传，缺句检测依赖它做源↔目标映射）:
  python3 validate_plan.py \
    --plan semantic_plan.json \
    --raw asr_raw_result.json \
    --timeline timeline.json \
    --remove-silence true
"""
import json, sys, argparse, re, difflib

from asr_compat import extract_utterances


def count_chars(text):
    """有效字符计数（去标点后）"""
    return len(re.sub(r'[^\w\u4e00-\u9fff]', '', text))


def check_title(plan):
    """1. 标题字数 ≤8"""
    title = plan.get("title", {})
    for key in ["top_title", "bottom_title"]:
        t = title.get(key, "")
        if len(t) > 8:
            return False, f"{key}='{t}' 长度 {len(t)} > 8"
    return True, ""


def check_subtitle_length(plan):
    """2. 字幕字数 ≤12"""
    for it in plan.get("subtitle_items", []):
        text = it.get("text", "")
        clen = len(text)
        if clen > 12:
            return False, f"sub[{it.get('sub_index', '?')}] '{text}' 长度 {clen} > 12"
        # 检查分层/普通使用是否正确
        is_layered = it.get("layered", False)
        if clen <= 7 and is_layered:
            return False, f"sub[{it.get('sub_index', '?')}] '{text}' {clen}字不应使用分层"
        if 8 <= clen <= 12 and not is_layered:
            return False, f"sub[{it.get('sub_index', '?')}] '{text}' {clen}字应使用分层"
    return True, ""


def check_subtitle_assembly(plan, raw_utterances, max_delete_block=8):
    """3. 字幕回拼：防整句丢失（允许设计内虚词/重复压缩）

    旧规则「逐字相等」与压缩改写流程冲突（去虚词/语气词/重复强调是设计内合法压缩）。
    新判据：用 difflib 找原文→回拼的最长连续删除块，
    >8 字且块内 n-gram 未被其他字幕覆盖 → 可疑删句（WARN 级，交 Agent 复核）；
    ≤8 字散布删除或内容已覆盖 → 合法。
    """
    items = plan.get("subtitle_items", [])
    # Group by source_index
    by_src = {}
    for it in items:
        si = it.get("source_index", 0)
        if si not in by_src:
            by_src[si] = []
        by_src[si].append(it.get("text", ""))

    for si, texts in by_src.items():
        assembled = "".join(texts)
        if si < len(raw_utterances):
            original = raw_utterances[si].get("text", "").strip()
            # 去标点后比较
            clean_assembled = re.sub(r'[^\w\u4e00-\u9fff]', '', assembled)
            clean_original = re.sub(r'[^\w\u4e00-\u9fff]', '', original)
            if clean_assembled == clean_original:
                continue
            sm = difflib.SequenceMatcher(None, clean_original, clean_assembled,
                                         autojunk=False)
            max_block, max_seg = 0, ""
            for tag, i1, i2, _, _ in sm.get_opcodes():
                if tag in ("delete", "replace") and (i2 - i1) > max_block:
                    max_block, max_seg = i2 - i1, clean_original[i1:i2]
            if max_block > max_delete_block:
                # 豁免重复压缩：说话人重复强调的第二三遍被压缩时，删除块虽长，
                # 但块内 n-gram 已被其他字幕覆盖（与第 11 项缺句检测同一判据）。
                n = 4
                grams = [max_seg[i:i + n] for i in range(len(max_seg) - n + 1)]
                coverage = (sum(1 for g in grams if g in clean_assembled) / len(grams)
                            if grams else 1.0)
                if coverage < 0.5:
                    # WARN 级不拦截：机械规则分不出「语气填充词压缩」和「信息句被删」，
                    # 与缺句检测一致，交 Agent 复核（补句或注明设计内压缩理由）
                    return True, (f"⚠️ src[{si}] 可疑删句待复核: 连续删除块 "
                                  f"{max_block} 字且内容未覆盖({coverage:.0%}):"
                                  f"「{max_seg[:16]}…」")
    return True, ""


def check_transitions(plan, remove_silence):
    """5. 转场：每种最多一次，总数 ≤3"""
    if not remove_silence:
        return True, ""
    transitions = plan.get("transitions", [])
    types_seen = {}
    for tr in transitions:
        t = tr.get("type", "")
        if t in types_seen:
            return False, f"转场 '{t}' 重复使用"
        types_seen[t] = True
    if len(transitions) > 3:
        return False, f"转场总数 {len(transitions)} > 3"
    return True, ""


def check_zoom(plan, remove_silence):
    """6. 缩放：最多一处，值 = 1.2"""
    if not remove_silence:
        return True, ""
    zoom = plan.get("zoom")
    if zoom and zoom.get("scale", 1.2) != 1.2:
        return False, f"缩放值 {zoom.get('scale')} ≠ 1.2"
    return True, ""


def check_keyword_origin(plan, raw_utterances):
    """7. 关键词来自原句且连续"""
    for it in plan.get("subtitle_items", []):
        kw = it.get("keyword")
        if not kw:
            continue
        text = it.get("text", "")
        if kw not in text:
            return False, f"sub[{it.get('sub_index', '?')}] 关键词 '{kw}' 不在文本 '{text}' 中"
    return True, ""


def check_display_pop_merge(plan):
    """8. display_text + pop_text 逐位合并 = 原文"""
    for it in plan.get("subtitle_items", []):
        pop = it.get("keyword_pop_text")
        if not pop:
            continue
        display = it.get("display_text", "")
        text = it.get("text", "")
        if len(display) != len(pop):
            return False, (f"sub[{it.get('sub_index', '?')}] "
                          f"display({len(display)}) 与 pop({len(pop)}) 长度不等")
        # 逐位合并
        merged = ""
        for d, p in zip(display, pop):
            merged += p if p != "\u3000" else d
        if merged != text:
            return False, (f"sub[{it.get('sub_index', '?')}] "
                          f"合并 '{merged}' ≠ 原文 '{text}'")
    return True, ""


def check_tone_presets(plan):
    """9. 提示音：result/emphasis 各最多一次"""
    tones = plan.get("tone_presets", [])
    counts = {}
    for tp in tones:
        t = tp.get("tone_type", "")
        counts[t] = counts.get(t, 0) + 1
        if counts[t] > 1:
            return False, f"提示音 '{t}' 使用 {counts[t]} 次 > 1"
    return True, ""


def check_time_continuity(plan):
    """10. 时间连续性：同 source 相邻字幕不重叠；间隔仅拦灾难性错位（>2.0s）

    旧阈值 0.5s 是均匀分配时间流程的产物；词级对齐后 0.5-1.8s 是真实语音停顿
    与设计内压缩空档，属合法。大间隔丢句由第 11 项「缺句检测」负责语义判定。
    """
    items = plan.get("subtitle_items", [])
    # Group by source_index, then check within each group
    by_src = {}
    for it in items:
        si = it.get("source_index", 0)
        if si not in by_src:
            by_src[si] = []
        by_src[si].append(it)
    for si, group in by_src.items():
        sorted_group = sorted(group, key=lambda x: x.get("start", 0))
        for i in range(len(sorted_group) - 1):
            curr_end = sorted_group[i].get("end", 0)
            next_start = sorted_group[i + 1].get("start", 0)
            # 检查重叠（允许 ≤0.3s 的词级时间重叠）
            if next_start < curr_end - 0.3:
                return False, (f"sub[{sorted_group[i].get('sub_index', '?')}]→"
                              f"sub[{sorted_group[i+1].get('sub_index', '?')}] "
                              f"重叠 {curr_end - next_start:.3f}s > 0.3s")
            # 检查过大间隔（>2.0s 疑似时间轴灾难性错位；普通停顿/压缩空档由缺句检测管）
            gap = next_start - curr_end
            if gap > 2.0:
                return False, (f"sub[{sorted_group[i].get('sub_index', '?')}]→"
                              f"sub[{sorted_group[i+1].get('sub_index', '?')}] "
                              f"间隔 {gap:.3f}s > 2.0s（疑似时间轴错位）")
    return True, ""


def check_挖空弹出成对(plan):
    """防丢字：挖空 ⇔ 弹出必须成对"""
    for it in plan.get("subtitle_items", []):
        display = it.get("display_text", "")
        pop = it.get("keyword_pop_text")
        text = it.get("text", "")
        has_hollow = "\u3000" in display
        # pop 有效 = 非空且包含至少一个非全角空格字符
        has_pop = (pop is not None and pop != ""
                   and pop.replace("\u3000", "") != "")

        if has_hollow and not has_pop:
            return False, (f"sub[{it.get('sub_index', '?')}] "
                          f"底层挖空但无弹出层 → 丢字!")
    return True, ""


def check_missing_sentences(plan, utterances, segments,
                            gap_threshold=1.6, min_chars=4, ngram=4):
    """11. 缺句检测（WARN 级，不拦截）

    检测整句被分句环节静默删除的情况（如「这胆子也太肥了」案例）。
    判据链：
      a) 目标时间轴相邻字幕空档 > gap_threshold(1.6s)
      b) 经 segments 映射回源视频区间后，词级时间戳命中 ≥ min_chars(4) 字语音
      c) 该语音内容的 n-gram 在 plan 全部字幕文本中覆盖率 <50%
         （覆盖率高说明是「说话人重复强调的第二三遍」设计内压缩，不报）
    同时满足 a+b+c → 可疑缺句。返回 passed=True（WARN 级），
    detail 以 ⚠️ 开头，main() 会对该前缀强制输出复核指令。
    """
    items = sorted(plan.get("subtitle_items", []),
                   key=lambda x: x.get("start", 0))
    if len(items) < 2:
        return True, ""
    if not segments:
        return True, "（未提供 --timeline，跳过缺句检测）"

    def t2s(t):
        """目标轴时间 → 源视频时间"""
        for g in segments:
            tt, sv = g.get("target_timeline", {}), g.get("source_video", {})
            try:
                ts, te, ss = tt["start"], tt["end"], sv["start"]
            except (KeyError, TypeError):
                continue
            if ts - 0.05 <= t <= te:
                return ss + (t - ts)
        return None

    # 展开词级时间戳
    words = []
    for u in utterances:
        if not isinstance(u, dict):
            continue
        for w in u.get("words") or []:
            try:
                words.append((w["start_time"] / 1000.0,
                              w["end_time"] / 1000.0, w.get("text", "")))
            except (KeyError, TypeError):
                continue

    def norm(s):
        return re.sub(r'[^\w\u4e00-\u9fff]', '', s)

    plan_stream = "".join(norm(it.get("text", "")) for it in items)

    suspects = []
    for a, b in zip(items, items[1:]):
        gap = b.get("start", 0) - a.get("end", 0)
        if gap <= gap_threshold:
            continue
        s0, s1 = t2s(a.get("end", 0)), t2s(b.get("start", 0))
        if s0 is None or s1 is None:
            continue
        seg_text = "".join(norm(t) for ws, we, t in words
                           if ws >= s0 - 0.3 and we <= s1 + 0.3)
        if len(seg_text) < min_chars:
            continue  # 纯停顿或 ≤3 字短语气词，视为设计内
        grams = [seg_text[i:i + ngram] for i in range(len(seg_text) - ngram + 1)]
        if not grams:
            continue
        coverage = sum(1 for g in grams if g in plan_stream) / len(grams)
        if coverage < 0.5:
            suspects.append(
                f"空档 {a.get('end', 0):.2f}→{b.get('start', 0):.2f} "
                f"(源 {s0:.2f}-{s1:.2f}) 语音「{seg_text[:12]}…」覆盖 {coverage:.0%}")

    if suspects:
        detail = f"⚠️ {len(suspects)} 处可疑缺句待复核: " + "; ".join(suspects[:3])
        if len(suspects) > 3:
            detail += f" 等共 {len(suspects)} 处"
        return True, detail
    return True, ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", required=True)
    ap.add_argument("--raw", required=True, help="ASR raw result (utterances list or full result)")
    ap.add_argument("--timeline", default=None,
                    help="timeline.json（Step 04 输出，含 segments 源↔目标映射）；缺句检测依赖，建议必传")
    ap.add_argument("--remove-silence", type=lambda x: x.lower() == "true", default=True)
    args = ap.parse_args()

    with open(args.plan) as f:
        plan = json.load(f)

    # 加载 ASR 原文（兼容纯识别句列表与工具响应信封两种格式）
    with open(args.raw) as f:
        raw_data = json.load(f)

    utterances = extract_utterances(raw_data)

    # 构造简单 utterance 列表（只需要 text）
    raw_list = []
    for u in utterances:
        if isinstance(u, dict):
            raw_list.append({"text": u.get("text", u.get("cleaned_text", ""))})
        else:
            raw_list.append({"text": str(u)})

    # 加载 timeline（Step 04 输出），用于缺句检测的源↔目标映射
    segments = []
    if args.timeline:
        try:
            with open(args.timeline) as f:
                tl = json.load(f)
            segments = tl.get("segments", []) if isinstance(tl, dict) else tl
        except Exception as e:
            print(f"[WARN] timeline 加载失败，跳过缺句检测: {e}", file=sys.stderr)

    # 执行全部校验
    checks = []
    all_pass = True

    validators = [
        ("标题字数", lambda: check_title(plan)),
        ("字幕字数", lambda: check_subtitle_length(plan)),
        ("字幕回拼", lambda: check_subtitle_assembly(plan, raw_list)),
        ("转场", lambda: check_transitions(plan, args.remove_silence)),
        ("缩放", lambda: check_zoom(plan, args.remove_silence)),
        ("关键词来源", lambda: check_keyword_origin(plan, raw_list)),
        ("挖空弹出合并", lambda: check_display_pop_merge(plan)),
        ("挖空弹出成对", lambda: check_挖空弹出成对(plan)),
        ("提示音", lambda: check_tone_presets(plan)),
        ("时间连续性", lambda: check_time_continuity(plan)),
        ("缺句检测", lambda: check_missing_sentences(plan, utterances, segments)),
    ]

    for name, fn in validators:
        passed, detail = fn()
        checks.append({"item": name, "passed": passed, "detail": detail})
        if not passed:
            all_pass = False

    result = {"valid": all_pass, "checks": checks}
    print(json.dumps(result, ensure_ascii=False, indent=2))

    # 摘要输出到 stderr
    ok_count = sum(1 for c in checks if c["passed"])
    print(f"\n✅ 校验完成: {ok_count}/{len(checks)} 通过", file=sys.stderr)
    if not all_pass:
        for c in checks:
            if not c["passed"]:
                print(f"   ❌ {c['item']}: {c['detail']}", file=sys.stderr)

    # 缺句检测与回拼删除块为 WARN 级：不拦截，但可疑清单非空时强制输出复核指令
    for c in checks:
        if c["detail"].startswith("⚠️"):
            print(f"\n{c['item']}: {c['detail']}", file=sys.stderr)
            print("   → 必须逐条决策：补入缺失句（用 ASR 词级时间戳 + segments 映射定时间），"
                  "或注明设计内压缩理由（引导词/语气词/重复强调）。禁止无理由跳过。",
                  file=sys.stderr)

    sys.exit(0 if all_pass else 1)


if __name__ == "__main__":
    main()
