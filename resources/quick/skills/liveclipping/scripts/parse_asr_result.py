#!/usr/bin/env python3
"""
解析字幕识别任务返回的 JSON 结果，提取精简字幕列表，并按时间分片落盘。

用法:
    # 从 JSON 文件解析
    python scripts/parse_asr_result.py --file result.json

    # 从 URL 下载并解析
    python scripts/parse_asr_result.py --url https://xxx/result.json

    # 输出为 JSON 格式（便于程序处理）
    python scripts/parse_asr_result.py --file result.json --format json

    # 输出为可读文本格式
    python scripts/parse_asr_result.py --file result.json --format text

    # 只输出指定时间范围内的字幕
    python scripts/parse_asr_result.py --file result.json --start 60 --end 180

    # 将字幕按约 10 分钟分片输出到目录
    python scripts/parse_asr_result.py --file result.json --split-duration 600 --output-dir out/
"""

import argparse
import json
import sys
import urllib.request
from contextlib import redirect_stdout
from pathlib import Path


def load_json_from_file(file_path: str) -> dict:
    """从文件加载 JSON"""
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def load_json_from_url(url: str) -> dict:
    """从 URL 下载并加载 JSON"""
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.loads(response.read().decode('utf-8'))


def extract_segments(data: dict, start_sec: float = None, end_sec: float = None) -> list:
    """
    从 JSON 数据中提取精简字幕列表。

    返回格式: [{"index": 1, "text": "...", "start": 0.37, "end": 1.77}, ...]
    """
    if 'result' not in data or 'segments' not in data['result']:
        raise ValueError("JSON 结构不符合预期，缺少 result.segments")

    segments = data['result']['segments']
    result = []

    for i, seg in enumerate(segments, 1):
        start_ms = seg.get('start', 0)
        end_ms = seg.get('end', 0)
        start_s = start_ms / 1000.0
        end_s = end_ms / 1000.0

        if start_sec is not None and end_s < start_sec:
            continue
        if end_sec is not None and start_s > end_sec:
            continue

        result.append({
            'index': i,
            'text': seg.get('text', ''),
            'start': round(start_s, 2),
            'end': round(end_s, 2),
        })

    return result


def format_time(seconds: float) -> str:
    """将秒数格式化为 mm:ss.ms"""
    minutes = int(seconds // 60)
    secs = seconds % 60
    return f"{minutes:02d}:{secs:05.2f}"


def output_text(segments: list, content: str = None):
    """输出可读文本格式"""
    if content:
        print("=" * 60)
        print("【全文概览】")
        print(content[:500] + "..." if len(content) > 500 else content)
        print("=" * 60)
        print()

    print(f"【字幕列表】共 {len(segments)} 条")
    print("-" * 60)

    for seg in segments:
        time_range = f"{format_time(seg['start'])} - {format_time(seg['end'])}"
        print(f"#{seg['index']:03d}  {time_range}  {seg['text']}")


def output_json(segments: list, content: str = None):
    """输出 JSON 格式"""
    result = {
        'total_segments': len(segments),
        'segments': segments,
    }
    if content:
        result['content_preview'] = content[:500] if len(content) > 500 else content

    print(json.dumps(result, ensure_ascii=False, indent=2))


def is_task_success(data: dict) -> bool:
    """兼容不同字幕识别回包的成功状态"""
    if data.get("status") == "success" or data.get("success") is True:
        return True
    if data.get("error"):
        return False

    result = data.get("result", {})
    if isinstance(result, dict) and result.get("error"):
        return False
    if isinstance(result, dict) and "segments" in result:
        return True

    return data.get("message") == "处理完成" or data.get("progress") == 100


def format_timecode(seconds: float) -> str:
    """将秒数格式化为 hh:mm:ss.mmm"""
    if seconds < 0:
        seconds = 0
    total_ms = int(round(seconds * 1000))
    hours, rem = divmod(total_ms, 3600 * 1000)
    minutes, rem = divmod(rem, 60 * 1000)
    secs, ms = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{ms:03d}"


def split_segments_by_duration(segments: list, split_duration_sec: float) -> list:
    """按时长把字幕切成多个分片"""
    if split_duration_sec <= 0:
        raise ValueError("split_duration 必须大于 0")

    buckets = []
    current = []
    current_start = None
    bucket_start = None

    for seg in segments:
        seg_start = float(seg["start"])

        if bucket_start is None:
            bucket_start = seg_start
            current_start = seg_start

        if current and seg_start - bucket_start >= split_duration_sec:
            buckets.append({
                "start": current_start,
                "end": current[-1]["end"],
                "segments": current,
            })
            current = []
            bucket_start = seg_start
            current_start = seg_start

        current.append(seg)
        if current_start is None:
            current_start = seg_start

    if current:
        buckets.append({
            "start": current_start if current_start is not None else 0,
            "end": current[-1]["end"],
            "segments": current,
        })

    return buckets


def write_split_files(data: dict, segments: list, output_dir: str, split_duration_sec: float, source_name: str = None) -> list:
    """把字幕结果拆成多个文件写到目录"""
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    buckets = split_segments_by_duration(segments, split_duration_sec)
    created = []

    base_meta = {
        "status": data.get("status"),
        "success": data.get("success"),
        "error": data.get("error", ""),
        "message": data.get("message", ""),
        "mode": data.get("mode", ""),
        "progress": data.get("progress"),
        "effect_mode": data.get("result", {}).get("effect_mode"),
        "source": source_name,
    }

    for idx, bucket in enumerate(buckets, 1):
        part = {
            **base_meta,
            "part_index": idx,
            "part_total": len(buckets),
            "time_range": {
                "start": format_timecode(bucket["start"]),
                "end": format_timecode(bucket["end"]),
            },
            "result": {
                "content": "",
                "segments": bucket["segments"],
            },
        }
        if idx == 1 and data.get("result", {}).get("content"):
            part["result"]["content_preview"] = data["result"]["content"][:500]

        file_name = f"asr_part_{idx:03d}.json"
        file_path = out_dir / file_name
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(part, f, ensure_ascii=False, indent=2)
        created.append(str(file_path))

    return created


def main():
    parser = argparse.ArgumentParser(
        description='解析字幕识别任务返回的 JSON 结果',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
    python scripts/parse_asr_result.py --file result.json
    python scripts/parse_asr_result.py --url https://xxx/result.json --format json
    python scripts/parse_asr_result.py --file result.json --start 60 --end 180
        """
    )

    input_group = parser.add_mutually_exclusive_group(required=True)
    input_group.add_argument('--file', '-f', help='JSON 文件路径')
    input_group.add_argument('--url', '-u', help='JSON 文件 URL')

    parser.add_argument('--format', '-o', choices=['text', 'json'], default='text',
                        help='输出格式 (默认: text)')
    parser.add_argument('--start', type=float, help='只输出指定起始时间（秒）之后的字幕')
    parser.add_argument('--end', type=float, help='只输出指定结束时间（秒）之前的字幕')
    parser.add_argument('--output', '-O', help='输出到文件而不是标准输出')
    parser.add_argument('--split-duration', type=float, default=0,
                        help='按指定秒数拆分成多个分片文件（例如 600 表示约 10 分钟）')
    parser.add_argument('--output-dir', help='分片文件输出目录，配合 --split-duration 使用')

    args = parser.parse_args()

    try:
        if args.file:
            data = load_json_from_file(args.file)
        else:
            data = load_json_from_url(args.url)
    except Exception as e:
        print(f"错误: 无法加载 JSON - {e}", file=sys.stderr)
        sys.exit(1)

    if not is_task_success(data):
        error_msg = data.get('error') or data.get('result', {}).get('error') or '未知错误'
        print(f"错误: 任务未成功完成 - {error_msg}", file=sys.stderr)
        sys.exit(1)

    try:
        segments = extract_segments(data, args.start, args.end)
    except ValueError as e:
        print(f"错误: {e}", file=sys.stderr)
        sys.exit(1)

    content = data.get('result', {}).get('content', '')

    if args.split_duration:
        if not args.output_dir:
            print("错误: 使用 --split-duration 时必须同时提供 --output-dir", file=sys.stderr)
            sys.exit(1)
        try:
            created_files = write_split_files(
                data=data,
                segments=segments,
                output_dir=args.output_dir,
                split_duration_sec=args.split_duration,
                source_name=args.file or args.url,
            )
        except Exception as e:
            print(f"错误: 无法写入分片文件 - {e}", file=sys.stderr)
            sys.exit(1)

        print(f"已输出 {len(created_files)} 个分片文件")
        for path in created_files:
            print(path)
        return

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            with redirect_stdout(f):
                if args.format == 'json':
                    output_json(segments, content)
                else:
                    output_text(segments, content)
        print(f"已输出到文件: {args.output}")
    else:
        if args.format == 'json':
            output_json(segments, content)
        else:
            output_text(segments, content)


if __name__ == '__main__':
    main()
