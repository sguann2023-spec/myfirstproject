#!/usr/bin/env python3
"""在工作区内创建独立商品项目，不生成媒体、不调用付费服务、不修改旧草稿。"""
import argparse
import json
from pathlib import Path
import shutil


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('project', help='新项目目录（必须不存在）')
    parser.add_argument('--product', required=True, help='本次真实商品名称')
    args = parser.parse_args()
    root = Path.cwd().resolve()
    target = Path(args.project).expanduser().resolve()
    if not target.is_relative_to(root):
        parser.error('项目必须位于当前工作区内；不允许隐式写入全局目录')
    if target.exists():
        parser.error('目标已存在，请使用新目录，避免覆盖旧项目')
    skill = Path(__file__).resolve().parents[1]
    plan = json.loads((skill / 'templates/edit_plan.template.json').read_text())
    plan['meta']['title'] = args.product + '_微缩英雄带货'
    plan['product']['name'] = args.product
    plan['global_text']['footer'] = args.product
    for folder in ['analysis', 'assets/source', 'assets/ai', 'assets/clips',
                   'assets/cards', 'assets/vo/proc', 'assets/audio', 'scripts']:
        (target / folder).mkdir(parents=True, exist_ok=True)
    (target / 'edit_plan.json').write_text(json.dumps(plan, ensure_ascii=False, indent=2) + '\n')
    for name in ['prep_clips.py', 'prep_vo.py', 'build_draft.py', 'verify_draft.py']:
        shutil.copy2(skill / 'scripts' / name, target / 'scripts' / name)
    (target / '剪辑逻辑.md').write_text(
        '# ' + args.product + '：微缩英雄带货\n\n'
        '## 固定风格\n微观钩子→反派/失败→英雄→爽点→实拍→商品→三连卖点→证据→CTA。\n\n'
        '## 本次商品与真实信息来源\n待读取用户素材填写，不得编造。\n\n'
        '## 素材盘点及未使用原因\n待填写。\n\n'
        '## 素材缺口与AI生成记录\n待填写模型、提示词、参考图、用途与质检。\n\n'
        '## 旁白、最终ASR与时间轴\n当前模板仅为时长预算，不得直接当成最终时间轴。\n\n'
        '## 原生可编辑层与验证结果\n待真实创建、查询、预览后填写；不以工具成功代替视觉质检。\n')
    print(json.dumps({'project': str(target), 'status': 'initialized_not_built',
                      'next': '读取本次素材→脚本与VO→最终ASR→生成缺口镜头→更新配置→预处理→草稿装配与质检'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
