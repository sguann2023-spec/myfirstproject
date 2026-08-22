#!/usr/bin/env python3
"""
第6步：整理时间轴

功能：
  1. 读取清洗后的 ASR 结果 (asr_cleaned_sentences.json)
  2. 读取 ASR 原始结果 (asr_raw_result.json) 获取词级时间戳
  3. 计算相邻语句间距，判断过渡方式（重叠转场 vs 中间点切割）
  4. 计算每段在源视频中的起止范围
  5. 计算连续的目标时间轴
  6. 将词级时间映射到目标时间轴
  7. 验证目标轴连续性
  8. 输出 timeline.json

用法：
  python3 scripts/build_timeline.py \
    --cleaned asr_cleaned_sentences.json \
    --raw asr_raw_result.json \
    --duration 45.4273 \
    [--output timeline.json] \
    [--video-pad 0] \
    [--overlap-threshold 0.6] \
    [--transition-duration 0.6]

规则（来自 SKILL.md）：
  - 主视频比文字前后各多 VIDEO_PAD 秒（默认 0s）
  - 相邻片段间距 ≥ OVERLAP_THRESHOLD 时重叠过渡（时长 TRANSITION_DURATION）
  - 相邻片段间距 < OVERLAP_THRESHOLD 时取中间点切割连贯拼接
  - 去气口后目标时间轴连续排列
"""

import json
import argparse
import sys
import os


def build_timeline(
    cleaned_path: str,
    raw_path: str,
    video_duration: float,
    output_path: str,
    video_pad: float = 0,
    overlap_threshold: float = 0.6,
    transition_duration: float = 0.6
) -> dict:
    """主时间轴计算"""
    
    # 读取清洗后的句子
    with open(cleaned_path, 'r', encoding='utf-8') as f:
        cleaned = json.load(f)
    
    # 读取原始 ASR（获取词级时间戳）
    with open(raw_path, 'r', encoding='utf-8') as f:
        raw_data = json.load(f)
    
    # 过滤掉气口和重复的语句
    valid_sentences = [s for s in cleaned if not s.get('is_filler', False) and not s.get('is_duplicate', False)]
    
    if not valid_sentences:
        print("错误：没有有效语句，无法构建时间轴", file=sys.stderr)
        sys.exit(1)
    
    # 构建 utterance 列表（秒为单位）
    utterances = []
    for s in valid_sentences:
        src_idx = s['source_index']
        # 从 raw_data 获取词级时间
        words = []
        if src_idx < len(raw_data):
            raw_u = raw_data[src_idx]
            words = [
                {
                    "text": w["text"],
                    "start": w["start_time"] / 1000.0,
                    "end": w["end_time"] / 1000.0
                }
                for w in raw_u.get("words", [])
            ]
        
        utterances.append({
            "source_index": src_idx,
            "start": s["start_time"] / 1000.0,  # 毫秒→秒
            "end": s["end_time"] / 1000.0,
            "cleaned_text": s["cleaned"],
            "words": words
        })
    
    # 计算相邻语句间距
    gaps = []
    for i in range(len(utterances) - 1):
        gap = utterances[i + 1]["start"] - utterances[i]["end"]
        gaps.append(gap)
    
    # 计算每段在源视频中的切割点
    cut_points = []
    for i in range(len(utterances) - 1):
        gap = gaps[i]
        if gap >= overlap_threshold:
            # 重叠过渡：当前段延伸到 utterance_end + video_pad
            cut_points.append(utterances[i]["end"] + video_pad)
        else:
            # 中间点切割
            mid = (utterances[i]["end"] + utterances[i + 1]["start"]) / 2.0
            cut_points.append(mid)
    
    # 构建每段的源视频范围
    segments_src = []
    for i in range(len(utterances)):
        # 起始点
        if i == 0:
            src_start = max(0.0, utterances[0]["start"] - video_pad)
        else:
            prev_gap = gaps[i - 1]
            if prev_gap >= overlap_threshold:
                # 重叠过渡：从当前 utterance_start - video_pad 开始
                src_start = utterances[i]["start"] - video_pad
            else:
                # 中间点切割：从切割点开始
                src_start = cut_points[i - 1]
        
        # 结束点
        if i == len(utterances) - 1:
            src_end = min(video_duration, utterances[i]["end"] + video_pad)
        else:
            cur_gap = gaps[i]
            if cur_gap >= overlap_threshold:
                # 重叠过渡：延伸到当前 utterance_end + video_pad
                src_end = utterances[i]["end"] + video_pad
            else:
                # 中间点切割：到切割点结束
                src_end = cut_points[i]
        
        segments_src.append({
            "start": round(src_start, 3),
            "end": round(src_end, 3)
        })
    
    # 构建目标时间轴（连续排列）
    timeline_segments = []
    target_cursor = 0.0
    
    for i, u in enumerate(utterances):
        src = segments_src[i]
        src_dur = src["end"] - src["start"]
        
        tgt_start = target_cursor
        tgt_end = tgt_start + src_dur
        
        # 文字层：视频比文字前后各多 video_pad
        text_start = tgt_start + video_pad
        text_end = tgt_end - video_pad
        
        # 词级时间映射到目标时间轴
        word_timings = []
        u_dur = u["end"] - u["start"]
        for w in u["words"]:
            if u_dur > 0:
                rel_s = (w["start"] - u["start"]) / u_dur
                rel_e = (w["end"] - u["start"]) / u_dur
            else:
                rel_s = rel_e = 0
            word_timings.append({
                "text": w["text"],
                "target_start": round(text_start + rel_s * (text_end - text_start), 3),
                "target_end": round(text_start + rel_e * (text_end - text_start), 3)
            })
        
        # 过渡方式
        transition = None
        if i < len(utterances) - 1:
            if gaps[i] >= overlap_threshold:
                transition = {"type": "overlap", "duration": transition_duration}
            else:
                transition = {"type": "midpoint_cut"}
        
        entry = {
            "source_index": u["source_index"],
            "source_video": src,
            "target_timeline": {"start": round(tgt_start, 3), "end": round(tgt_end, 3)},
            "text_timeline": {"start": round(text_start, 3), "end": round(text_end, 3)},
            "duration": round(src_dur, 3),
            "transition_to_next": transition,
            "word_timings": word_timings
        }
        timeline_segments.append(entry)
        target_cursor = tgt_end
    
    # 验证连续性
    continuity_ok = True
    for i in range(len(timeline_segments) - 1):
        end = timeline_segments[i]["target_timeline"]["end"]
        next_start = timeline_segments[i + 1]["target_timeline"]["start"]
        gap = next_start - end
        if abs(gap) > 0.01:  # 允许 10ms 误差
            print(f"⚠️ 连续性异常: [{i}]→[{i+1}] 目标轴间距 = {gap:.3f}s (应为0)")
            continuity_ok = False
    
    # 构建输出
    output = {
        "video_duration": video_duration,
        "total_target_duration": round(target_cursor, 3),
        "removed_silence": round(video_duration - target_cursor, 3),
        "segment_count": len(timeline_segments),
        "overlap_count": sum(1 for s in timeline_segments if (s.get("transition_to_next") or {}).get("type") == "overlap"),
        "midpoint_cut_count": sum(1 for s in timeline_segments if (s.get("transition_to_next") or {}).get("type") == "midpoint_cut"),
        "continuity_verified": continuity_ok,
        "segments": timeline_segments
    }
    
    # 保存
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    return output


def main():
    parser = argparse.ArgumentParser(description='整理时间轴（第6步）')
    parser.add_argument('--cleaned', '-c', default='asr_cleaned_sentences.json',
                        help='清洗后的 ASR 文件路径')
    parser.add_argument('--raw', '-r', default='asr_raw_result.json',
                        help='ASR 原始结果文件路径（含词级时间戳）')
    parser.add_argument('--duration', '-d', type=float, required=True,
                        help='视频总时长（秒）')
    parser.add_argument('--output', '-o', default='timeline.json',
                        help='输出文件路径')
    parser.add_argument('--video-pad', type=float, default=0,
                        help='视频前后扩展时长（秒）')
    parser.add_argument('--overlap-threshold', type=float, default=0.6,
                        help='重叠转场间距阈值（秒）')
    parser.add_argument('--transition-duration', type=float, default=0.6,
                        help='转场时长（秒）')
    args = parser.parse_args()
    
    for path in [args.cleaned, args.raw]:
        if not os.path.exists(path):
            print(f"错误：文件不存在: {path}", file=sys.stderr)
            sys.exit(1)
    
    result = build_timeline(
        cleaned_path=args.cleaned,
        raw_path=args.raw,
        video_duration=args.duration,
        output_path=args.output,
        video_pad=args.video_pad,
        overlap_threshold=args.overlap_threshold,
        transition_duration=args.transition_duration
    )
    
    print(f"✅ 时间轴构建完成")
    print(f"   视频时长: {result['video_duration']:.3f}s")
    print(f"   目标时长: {result['total_target_duration']:.3f}s")
    print(f"   去除静音: {result['removed_silence']:.3f}s")
    print(f"   段落数: {result['segment_count']}")
    print(f"   重叠转场: {result['overlap_count']} 处")
    print(f"   中间点切割: {result['midpoint_cut_count']} 处")
    print(f"   连续性验证: {'✅ 通过' if result['continuity_verified'] else '❌ 异常'}")
    print(f"   输出文件: {args.output}")
    
    # 输出每段摘要
    print(f"\n=== 时间轴摘要 ===")
    for seg in result['segments']:
        trans = ""
        if seg['transition_to_next']:
            t = seg['transition_to_next']
            trans = f" → {t['type']}" + (f"({t['duration']}s)" if t['type'] == 'overlap' else "")
        
        print(f"  [{seg['source_index']}] "
              f"源:{seg['source_video']['start']:.3f}s→{seg['source_video']['end']:.3f}s "
              f"目标:{seg['target_timeline']['start']:.3f}s→{seg['target_timeline']['end']:.3f}s "
              f"文字:{seg['text_timeline']['start']:.3f}s→{seg['text_timeline']['end']:.3f}s"
              f"{trans}")


if __name__ == '__main__':
    main()
