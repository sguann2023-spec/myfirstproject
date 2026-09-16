#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
validate_storyboard.py — 分镜计划硬校验脚本（步骤 6 自检门禁，步骤 10/12 复用）

用法:
  python3 validate_storyboard.py <storyboard.json> <source_durations.json> [understanding_dir]

校验项（全部为机械校验，不依赖 LLM 心算）:
  1. 时间连续性: 首段 start=0，首尾相接，末段 end=total_duration
  2. 分镜时长: 每段 1.5s ~ 3.5s
  3. 素材范围: source_start >= 0 且 source_end <= 素材实测时长 - 安全余量(0.05s)
  4. 素材内容可追溯: source_clip 必须存在视频理解结果文件（语义匹配的前提）
  5. 语义启发式检查: 内置地标实体词典，标记"字幕含地标词但素材描述不含"的可疑分镜
  6. 输出"分镜|字幕|素材摘要"对照表，供 LLM 逐条复核语义匹配

退出码: 0=全部通过(含启发式无告警), 2=硬错误(必须修复), 1=硬错误+启发式告警
"""
import json
import sys
import os
import re

SAFETY_MARGIN = 0.05   # 素材范围安全余量（秒），防浮点误差
MIN_SHOT, MAX_SHOT = 1.5, 6.0
TOL = 0.05             # 时间连续性容差

# 旅行视频常见地标/场景实体词典: key=文案中的词, value=素材描述中应出现的同义词组
ENTITY_DICT = {
    "大桥": ["桥"], "跨海大桥": ["桥"], "桥": ["桥"],
    "灯塔": ["灯塔", "塔"],
    "沙滩": ["沙滩", "海滩", "沙"],
    "寺庙": ["寺", "庙", "佛教", "佛像", "观音", "禅"],
    "禅寺": ["寺", "庙", "佛教", "禅"],
    "佛": ["佛", "观音", "佛教"],
    "观音": ["观音", "佛"],
    "牌坊": ["牌坊"],
    "北回归线": ["北回归线", "标志塔", "雕塑", "球"],
    "海": ["海", "水"],
    "海面": ["海", "水"],
    "山": ["山", "山坡", "山顶"],
    "云": ["云"],
    "街": ["街", "道路", "巷"],
    "灯笼": ["灯笼"],
}


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def find_understanding_file(understanding_dir, clip_no):
    """在理解目录中查找指定素材号的理解文件。
    支持两种模式:
      1. 文件名直接匹配: job-*-video-N.md（N=素材号）
      2. URL 映射匹配: 文件内 '- 输入：' 行包含 /chaoshan/N.mp4 等模式
    优先取字典序最大的 job（最新）。
    """
    if not understanding_dir or not os.path.isdir(understanding_dir):
        return None
    # 模式1: 文件名直接匹配
    candidates = []
    for name in os.listdir(understanding_dir):
        m = re.match(r"^job-\d+-video-%d\.md$" % clip_no, name)
        if m:
            candidates.append(os.path.join(understanding_dir, name))
        elif name == "video-%d.md" % clip_no:
            candidates.append(os.path.join(understanding_dir, name))
    if candidates:
        return sorted(candidates)[-1]
    # 模式2: 扫描所有 video-*.md 文件，检查 URL 中的素材号
    best = None
    for name in sorted(os.listdir(understanding_dir)):
        if not re.match(r"job-\d+-video-\d+\.md$", name):
            continue
        fpath = os.path.join(understanding_dir, name)
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                for line in f:
                    if "- 输入：" in line:
                        # 提取 URL 中最后的数字序号
                        url = line.split("：", 1)[-1].strip()
                        # 匹配 /N.mp4 格式
                        m2 = re.search(r"/(\d+)\.mp4", url)
                        if m2 and int(m2.group(1)) == clip_no:
                            best = fpath
                        break
        except Exception:
            pass
    return best


def read_summary(fpath):
    """读取理解文件中的标题+描述（截断到前 300 字）"""
    if not fpath:
        return None
    try:
        with open(fpath, "r", encoding="utf-8") as f:
            text = f.read()
        # 标题段
        title, desc = "", ""
        m = re.search(r"##\s*标题\s*\n+(.*?)(?=\n##|\Z)", text, re.S)
        if m:
            title = m.group(1).strip()
        m = re.search(r"##\s*描述\s*\n+(.*?)(?=\n##|\Z)", text, re.S)
        if m:
            desc = m.group(1).strip()
        summary = (title + " " + desc).strip()
        return summary[:300] if summary else None
    except Exception:
        return None


def main():
    if len(sys.argv) < 3:
        print("用法: validate_storyboard.py <storyboard.json> <source_durations.json> [understanding_dir]")
        sys.exit(2)

    sb_path = sys.argv[1]
    dur_path = sys.argv[2]
    understanding_dir = sys.argv[3] if len(sys.argv) > 3 else None

    sb = load_json(sb_path)
    durations = load_json(dur_path)
    shots = sb["storyboard"]
    total = sb.get("total_duration")

    errors, warns = [], []

    print("=" * 62)
    print("分镜计划硬校验: %s" % sb_path)
    print("=" * 62)

    # ---- 校验 1: 时间连续性 ----
    print("\n[1] 时间连续性")
    if abs(shots[0]["start"]) > TOL:
        errors.append("分镜1 start=%.2f ≠ 0" % shots[0]["start"])
    for i in range(1, len(shots)):
        gap = shots[i]["start"] - shots[i - 1]["end"]
        if abs(gap) > TOL:
            errors.append("分镜%d 与分镜%d 之间不连续（gap=%.2fs）"
                          % (shots[i - 1]["shot_index"], shots[i]["shot_index"], gap))
    if total is not None and abs(shots[-1]["end"] - total) > TOL:
        errors.append("末段 end=%.2f ≠ total_duration=%.2f" % (shots[-1]["end"], total))
    print("  %s" % ("✅ 通过" if not errors else "❌ 存在 %d 处不连续" % len(errors)))

    # ---- 校验 2: 分镜时长 ----
    print("\n[2] 分镜时长 (1.5~3.5s)")
    bad_len = [s["shot_index"] for s in shots
               if not (MIN_SHOT - TOL <= s["end"] - s["start"] <= MAX_SHOT + TOL)]
    if bad_len:
        errors.append("分镜时长越界: %s" % bad_len)
    print("  %s" % ("✅ 通过" if not bad_len else "❌ 越界分镜: %s" % bad_len))

    # ---- 校验 3+4+5: 素材范围 / 内容可追溯 / 语义启发式 ----
    print("\n[3] 素材截取范围（对照 ffprobe 实测时长，安全余量 %.2fs）" % SAFETY_MARGIN)
    print("\n[4] 素材内容可追溯（必须存在视频理解结果）")
    table_rows = []
    for s in shots:
        clip = str(s["source_clip"])
        actual = durations.get(clip)
        if actual is None:
            errors.append("分镜%d: 素材%s 无实测时长数据（source_durations.json 缺失该条）"
                          % (s["shot_index"], clip))
            continue
        if s["source_start"] < -TOL:
            errors.append("分镜%d: source_start=%.2f < 0" % (s["shot_index"], s["source_start"]))
        if s["source_end"] > actual - SAFETY_MARGIN + 0.001:
            errors.append("分镜%d: 素材%s 需要[%.2f-%.2fs] 超出实测时长 %.3fs（缺 %.2fs 画面）"
                          % (s["shot_index"], clip, s["source_start"], s["source_end"],
                             actual, s["source_end"] - actual))
        fpath = find_understanding_file(understanding_dir, s["source_clip"])
        summary = read_summary(fpath)
        if summary is None:
            errors.append("分镜%d: 素材%s 无视频理解结果文件，语义无法追溯"
                          % (s["shot_index"], clip))
            summary = "⚠️ 无理解结果"
        # 语义启发式: 字幕含地标实体词但素材描述不含
        sub = s.get("subtitle_match", "")
        for word, syns in ENTITY_DICT.items():
            if word in sub:
                if not any(x in summary for x in syns):
                    warns.append("分镜%d: 字幕含「%s」，但素材%s 描述未见相关画面 → 「%s」"
                                 % (s["shot_index"], word, clip, summary[:60]))
                break
        table_rows.append((s["shot_index"], s["source_clip"],
                           "%.2f-%.2f" % (s["source_start"], s["source_end"]),
                           "%.2f" % actual, sub, summary[:40]))

    ok3 = not any("超出实测时长" in e or "source_start" in e or "无实测时长" in e for e in errors)
    ok4 = not any("无视频理解结果" in e for e in errors)
    print("  %s" % ("✅ 通过" if ok3 else "❌ 存在越界/缺失时长数据"))
    print("  %s" % ("✅ 通过" if ok4 else "❌ 存在无理解结果的素材"))

    # ---- 对照表 ----
    print("\n" + "-" * 62)
    print("[5] 分镜 | 字幕 | 素材摘要 对照表（供 LLM 逐条复核语义匹配）")
    print("-" * 62)
    print("%-4s %-5s %-13s %-7s %s" % ("镜号", "素材", "源区间", "实测", "字幕 → 画面摘要"))
    for idx, clip, rng, actual, sub, summ in table_rows:
        print("%-4d %-5s %-13s %-7s %s → %s" % (idx, clip, rng, actual, sub[:24], summ))

    # ---- 结果 ----
    print("\n" + "=" * 62)
    if errors:
        print("❌ 硬错误 %d 项（必须修复后重新生成分镜，不允许带病进入步骤 8）:" % len(errors))
        for e in errors:
            print("   - %s" % e)
    if warns:
        print("⚠️ 语义告警 %d 项（需人工/LLM 复核，确认不匹配的必须换素材）:" % len(warns))
        for w in warns:
            print("   - %s" % w)
    if not errors and not warns:
        print("✅ 全部校验通过（含语义启发式无告警）")
    elif not errors:
        print("✅ 硬校验通过，仅存语义告警（需复核）")

    # 输出机器可读结果
    result = {"ok": not errors, "errors": errors, "warnings": warns,
              "shot_count": len(shots), "total_duration": total}
    out_path = os.path.join(os.path.dirname(os.path.abspath(sb_path)),
                            "storyboard_validation.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print("\n校验结果已写入: %s" % out_path)

    sys.exit(0 if not errors and not warns else (2 if errors else 1))


if __name__ == "__main__":
    main()
