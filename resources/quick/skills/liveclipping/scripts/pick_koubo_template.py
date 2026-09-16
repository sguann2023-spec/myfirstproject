#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pick_koubo_template.py — 第五步「套口播模板」的模板随机分配脚本。

用系统级均匀随机为每条切片分配一个口播模板（替代执行者的"伪随机"选择，
避免模板分布不均）。输出 JSON 供套模板时按 rank 对位使用。
"""

import argparse
import json
import random
import sys

KOUBO_TEMPLATES = [
    {"template_id": "koubo_39ff88a1b2c34d5e9f0a6b7c8d9e0123", "template_name": "带货/口播强调"},
    {"template_id": "koubo_1f9c8d7e6a2b4c0d9e8f123456789abc", "template_name": "高级感/知识内容"},
    {"template_id": "koubo_e7c1a9d4b6f24c8e91a3d5b7f0c2e6a8", "template_name": "双语/港风"},
    {"template_id": "koubo_25829735dad8416a8698f1263384892c", "template_name": "歌词/逐字强调"},
]


def main():
    parser = argparse.ArgumentParser(description="为每条切片随机分配口播模板")
    parser.add_argument("--count", type=int, required=True, help="切片数量")
    args = parser.parse_args()
    if args.count < 1:
        print(json.dumps({
            "status": "error",
            "error_code": "invalid_input",
            "message": f"count 必须 >= 1，当前为 {args.count}",
        }, ensure_ascii=False))
        sys.exit(1)
    result = {
        "status": "success",
        "count": args.count,
        "assignments": [
            {"rank": rank, **random.choice(KOUBO_TEMPLATES)}
            for rank in range(1, args.count + 1)
        ],
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
