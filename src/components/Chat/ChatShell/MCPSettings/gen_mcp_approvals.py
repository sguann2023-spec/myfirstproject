#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 / 更新 WorkBuddy 的 mcp-approvals.json

算法来源：WorkBuddy 客户端 ConnectorService.calculateConfigHash()
  - url 型:   sha256( url 的 origin )              # 协议+主机+端口，路径不参与
  - stdio 型: sha256( command|args排序|env的key排序 )  # env 只取键，不含值
  - 兜底:     sha256( JSON.stringify(entry) )

文件格式（扁平对象，值为毫秒时间戳）:
  { "<configHash>::<serverName>": 1789008840143 }

用法:
  python3 gen_mcp_approvals.py                # 预览（不写文件）
  python3 gen_mcp_approvals.py --write        # 写入并自动备份
  python3 gen_mcp_approvals.py --write --only vectcut
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
import time
from urllib.parse import urlparse

CONFIG_DIR = os.path.expanduser("~/.workbuddy")
MCP_JSON = os.path.join(CONFIG_DIR, "mcp.json")
APPROVALS = os.path.join(CONFIG_DIR, "mcp-approvals.json")


def calculate_config_hash(entry: dict) -> str:
    """完全复刻客户端的 calculateConfigHash。"""
    if entry.get("command"):
        args = sorted(str(a) for a in (entry.get("args") or []))
        env_keys = sorted((entry.get("env") or {}).keys())
        raw = f'{entry.get("command") or ""}|{",".join(args)}|{",".join(env_keys)}'
    elif entry.get("url"):
        try:
            o = urlparse(entry["url"])
            raw = f"{o.scheme}://{o.netloc}"
        except Exception:
            raw = entry["url"]
    else:
        raw = json.dumps(entry, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def build_approvals(mcp_json_path: str, only=None, timestamp=None):
    with open(mcp_json_path, "r", encoding="utf-8") as f:
        servers = (json.load(f).get("mcpServers") or {})

    ts = timestamp or int(time.time() * 1000)
    out, rows = {}, []
    for name, entry in servers.items():
        if only and name not in only:
            continue
        h = calculate_config_hash(entry)
        out[f"{h}::{name}"] = ts
        if entry.get("url"):
            o = urlparse(entry["url"])
            src = f"{o.scheme}://{o.netloc}"
        elif entry.get("command"):
            src = "stdio: " + os.path.basename(entry["command"])
        else:
            src = "raw json"
        rows.append((name, src, h))
    return out, rows


def entry_from_args(a) -> dict:
    """从命令行参数直接构造一条 MCP 配置。"""
    if a.url:
        entry = {"url": a.url}
    elif a.command:
        entry = {"command": a.command}
        if a.args:
            entry["args"] = a.args
        if a.env_key:
            entry["env"] = {k: "" for k in a.env_key}
    else:
        sys.exit("单条模式需要提供 --url 或 --command")
    return entry


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="真正写入（默认只预览）")
    ap.add_argument("--only", nargs="*", default=None, help="只处理指定服务器名")
    ap.add_argument("--mcp-json", default=MCP_JSON)
    ap.add_argument("--out", default=APPROVALS)
    ap.add_argument("--name", help="单条模式：服务器名，如 vectcut")
    ap.add_argument("--url", help="单条模式：远程地址，如 http://127.0.0.1:18845/api/v1/mcp")
    ap.add_argument("--command", help="单条模式：stdio 可执行文件路径")
    ap.add_argument("--args", nargs="*", help="单条模式：stdio 参数列表")
    ap.add_argument("--env-key", nargs="*", help="单条模式：stdio 环境变量名（只取键）")
    ap.add_argument("--ts", type=int, help="毫秒时间戳，默认取当前时间")
    args = ap.parse_args()

    if args.name:
        entry = entry_from_args(args)
        ts = args.ts or int(time.time() * 1000)
        h = calculate_config_hash(entry)
        if entry.get("url"):
            o = urlparse(entry["url"])
            src = f"{o.scheme}://{o.netloc}"
        else:
            src = "stdio: " + os.path.basename(entry["command"])
        print(f"name     : {args.name}")
        print(f"hash 源  : {src}")
        print(f"key      : {h}::{args.name}")
        result = {f"{h}::{args.name}": ts}
        print(json.dumps(result, indent=2, ensure_ascii=False))

        if not args.write:
            print("\n[预览模式] 未写入。加 --write 合并写入 mcp-approvals.json。")
            return
        existing = {}
        if os.path.exists(args.out):
            with open(args.out, "r", encoding="utf-8") as f:
                try:
                    existing = json.load(f)
                except json.JSONDecodeError:
                    sys.exit(f"{args.out} 不是合法 JSON，已中止")
        merged = dict(existing)
        merged.update(result)
        shutil.copy2(args.out, args.out + ".bak")
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(merged, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"\n已合并写入 {args.out}（原文件备份为 .bak）")
        print("注意：需完全退出并重启 WorkBuddy 才会生效。")
        return

    if not os.path.exists(args.mcp_json):
        sys.exit(f"找不到 {args.mcp_json}")

    new_entries, rows = build_approvals(args.mcp_json, args.only)

    print("=" * 78)
    for name, src, h in rows:
        print(f"{name}")
        print(f"  hash 源 : {src}")
        print(f"  key     : {h}::{name}")
    print("=" * 78)

    existing = {}
    if os.path.exists(args.out):
        with open(args.out, "r", encoding="utf-8") as f:
            try:
                existing = json.load(f)
            except json.JSONDecodeError:
                sys.exit(f"{args.out} 不是合法 JSON，已中止")

    merged = dict(existing)
    merged.update(new_entries)
    print(json.dumps(merged, indent=2, ensure_ascii=False))

    if not args.write:
        print("\n[预览模式] 未写入。加 --write 执行写入。")
        return

    shutil.copy2(args.out, args.out + ".bak") if os.path.exists(args.out) else None
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"\n已写入 {args.out}" + ("（原文件已备份为 .bak）" if os.path.exists(args.out + ".bak") else ""))
    print("注意：需完全退出并重启 WorkBuddy 才会生效（loadApprovals 每进程只加载一次）。")


if __name__ == "__main__":
    main()
