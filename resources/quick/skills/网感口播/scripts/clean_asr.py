#!/usr/bin/env python3
"""
第5.2步：ASR 分句清洗（机械化部分）

功能：
  1. 读取 ASR 原始识别结果 (asr_raw_result.json)
  2. 去除所有标点符号
  3. 去除已知气口/语气词（哈哈、嗯、啊等纯语气片段）
  4. 检测并标记完全重复的句子
  5. 输出清洗后的结果 (asr_cleaned_sentences.json)

用法：
  python3 scripts/clean_asr.py [--input INPUT_FILE] [--output OUTPUT_FILE]

输入格式 (asr_raw_result.json)：
  [
    {
      "text": "原始识别文本",
      "start_time": 860,     # 毫秒
      "end_time": 6980,      # 毫秒
      "words": [
        {"text": "字", "start_time": 860, "end_time": 1060},
        ...
      ]
    },
    ...
  ]

输出格式 (asr_cleaned_sentences.json)：
  [
    {
      "source_index": 0,
      "start_time": 860,
      "end_time": 6980,
      "original": "原始文本",
      "cleaned": "清洗后文本（无标点、无气口）",
      "is_filler": false,       # 是否为纯语气词片段
      "is_duplicate": false     # 是否与前面句子完全重复
    },
    ...
  ]

注意：
  - 本脚本只处理机械化的清洗规则
  - 以下任务仍需 LLM 完成：
    - 按语义完整性拆分长句（每句≤12字）
    - 修正 ASR 识别错别字
    - 判断需要重录的片段
  - LLM 只需读取本脚本输出，在此基础上做上述调整即可
"""

import json
import re
import argparse
import sys
import os

# ===== 配置 =====

# 中文标点符号（全部去除）
PUNCTUATION_PATTERN = re.compile(
    r'[，。！？、；：""''「」『』【】（）〈〉《》\u3000'
    r',\.!\?;:\'\"\(\)\[\]\{\}<>~\～\·\…\·]'
)

# 纯气口/语气词片段（整句匹配时标记为 filler）
# 这些是独立成句时无意义的纯语气词
FILLER_PATTERNS = [
    r'^哈哈+$',
    r'^呵呵+$',
    r'^嘿嘿+$',
    r'^嗯+$',
    r'^啊+$',
    r'^哦+$',
    r'^呃+$',
    r'^呃+$',
    r'^哎+$',
    r'^唉+$',
    r'^唔+$',
    r'^嗯嗯+$',
    r'^啊啊啊+$',
    r'^哈哈哈+$',
    r'^对对对+$',   # 重复语气
    r'^是是是+$',   # 重复语气
]

# 句末语气词（仅当出现在句尾时去除，不是整句删除）
TRAILING_FILLERS = [
    '哈哈', '呵呵', '嘿嘿', '嗯', '啊', '哦', '呃', '哎', '唉', '唔'
]


def remove_punctuation(text: str) -> str:
    """去除所有标点符号，替换为空格（保留词间分隔）"""
    # 先将标点替换为空格，再合并连续空格
    result = PUNCTUATION_PATTERN.sub(' ', text)
    # 合并连续空格
    result = re.sub(r'\s+', ' ', result).strip()
    return result


def is_filler_sentence(text: str) -> bool:
    """判断是否为纯语气词片段（整句无实际语义）"""
    cleaned = text.strip()
    for pattern in FILLER_PATTERNS:
        if re.match(pattern, cleaned):
            return True
    return False


def remove_trailing_fillers(text: str) -> str:
    """去除句末的语气词"""
    result = text.strip()
    for filler in TRAILING_FILLERS:
        if result.endswith(filler) and len(result) > len(filler):
            result = result[:-len(filler)].strip()
    return result


def detect_duplicates(sentences: list) -> list:
    """检测完全重复的句子，标记 is_duplicate"""
    seen = set()
    for s in sentences:
        cleaned = s['cleaned']
        if cleaned in seen:
            s['is_duplicate'] = True
        else:
            seen.add(cleaned)
            s['is_duplicate'] = False
    return sentences


def clean_asr(input_path: str, output_path: str) -> dict:
    """主清洗流程"""
    
    # 读取 ASR 原始结果
    with open(input_path, 'r', encoding='utf-8') as f:
        raw_data = json.load(f)
    
    results = []
    
    for idx, utterance in enumerate(raw_data):
        original = utterance['text']
        start_time = utterance['start_time']  # 毫秒
        end_time = utterance['end_time']      # 毫秒
        
        # 1. 判断是否为纯气口
        filler = is_filler_sentence(original.strip())
        
        # 2. 去标点
        no_punct = remove_punctuation(original)
        
        # 3. 去句末语气词
        cleaned = remove_trailing_fillers(no_punct)
        
        # 如果去完语气词后为空，标记为 filler
        if not cleaned.strip():
            filler = True
            cleaned = no_punct  # 保留去标点后的结果
        
        results.append({
            'source_index': idx,
            'start_time': start_time,
            'end_time': end_time,
            'original': original,
            'cleaned': cleaned,
            'is_filler': filler,
            'is_duplicate': False  # 稍后检测
        })
    
    # 4. 检测重复
    results = detect_duplicates(results)
    
    # 保存结果
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    
    # 输出统计
    total = len(results)
    fillers = sum(1 for r in results if r['is_filler'])
    duplicates = sum(1 for r in results if r['is_duplicate'])
    valid = total - fillers - duplicates
    
    stats = {
        'total': total,
        'fillers_removed': fillers,
        'duplicates_marked': duplicates,
        'valid_sentences': valid,
        'input_file': input_path,
        'output_file': output_path
    }
    
    return stats


def main():
    parser = argparse.ArgumentParser(description='ASR 分句清洗（机械化部分）')
    parser.add_argument('--input', '-i', default='asr_raw_result.json',
                        help='输入文件路径 (默认: asr_raw_result.json)')
    parser.add_argument('--output', '-o', default='asr_cleaned_sentences.json',
                        help='输出文件路径 (默认: asr_cleaned_sentences.json)')
    args = parser.parse_args()
    
    if not os.path.exists(args.input):
        print(f"错误：输入文件不存在: {args.input}", file=sys.stderr)
        sys.exit(1)
    
    stats = clean_asr(args.input, args.output)
    
    print(f"✅ ASR 清洗完成")
    print(f"   总语句数: {stats['total']}")
    print(f"   气口移除: {stats['fillers_removed']}")
    print(f"   重复标记: {stats['duplicates_marked']}")
    print(f"   有效语句: {stats['valid_sentences']}")
    print(f"   输出文件: {stats['output_file']}")
    
    # 输出每条语句的清洗结果摘要
    with open(args.output, 'r', encoding='utf-8') as f:
        results = json.load(f)
    
    print(f"\n=== 清洗结果摘要 ===")
    for r in results:
        status = ""
        if r['is_filler']:
            status = " [气口]"
        elif r['is_duplicate']:
            status = " [重复]"
        
        start_s = r['start_time'] / 1000
        end_s = r['end_time'] / 1000
        print(f"  [{r['source_index']}] {start_s:.2f}s-{end_s:.2f}s{status}")
        print(f"    原文: {r['original']}")
        print(f"    清洗: {r['cleaned']}")


if __name__ == '__main__':
    main()
