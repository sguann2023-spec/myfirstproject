#!/usr/bin/env python3
"""Upload template media referenced by an index.json file to Alibaba Cloud OSS."""

from __future__ import annotations

import argparse
import base64
import hashlib
import mimetypes
import os
from email.utils import formatdate
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
import json
import hmac


DEFAULT_BUCKET = "oss-hangzhou-mp4"
DEFAULT_ENDPOINT = "oss-cn-hangzhou.aliyuncs.com"
DEFAULT_PREFIX = "example/client_video_template/assets"
DEFAULT_PUBLIC_ENDPOINT = "https://player.install-ai-guider.top"


def config(args):
    access_key_id = os.environ.get("ACCESS_KEY_ID") or os.environ.get("MP4_OSS_ACCESS_KEY_ID")
    access_key_secret = os.environ.get("ACCESS_KEY_SECRET") or os.environ.get("MP4_OSS_ACCESS_KEY_SECRET")
    if not access_key_id or not access_key_secret:
        raise RuntimeError("请设置 MP4_OSS_ACCESS_KEY_ID 和 MP4_OSS_ACCESS_KEY_SECRET")
    return access_key_id, access_key_secret


def object_info(path: Path, model_dir: str, prefix: str):
    digest = hashlib.md5(path.read_bytes()).hexdigest()
    filename = f"{path.stem}-{digest}{path.suffix.lower()}"
    object_name = f"{prefix.strip('/')}/{model_dir.strip('/')}/{digest[:2]}/{digest[2:4]}/{filename}"
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return object_name, content_type


def sign_headers(bucket: str, secret: str, object_name: str, content_type: str):
    date = formatdate(usegmt=True)
    resource = f"/{bucket}/{object_name}"
    string_to_sign = f"PUT\n\n{content_type}\n{date}\n{resource}"
    digest = hmac.new(secret.encode(), string_to_sign.encode(), hashlib.sha1).digest()
    return {
        "Date": date,
        "Content-Type": content_type,
        "Authorization": f"OSS {{access_key_id}}:{base64.b64encode(digest).decode()}" ,
    }


def upload(path: Path, object_name: str, content_type: str, args, access_key_id: str, access_key_secret: str):
    endpoint = args.endpoint.replace("https://", "").replace("http://", "").strip("/")
    url = f"https://{args.bucket}.{endpoint}/{quote(object_name, safe='/-_.~')}"
    headers = sign_headers(args.bucket, access_key_secret, object_name, content_type)
    headers["Authorization"] = headers["Authorization"].format(access_key_id=access_key_id)
    request = Request(url, data=path.read_bytes(), method="PUT", headers=headers)
    try:
        with urlopen(request, timeout=600) as response:
            if response.status not in (200, 201):
                raise RuntimeError(f"上传失败 {response.status}: {object_name}")
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"上传失败 {error.code}: {object_name}\n{body}") from error
    except URLError as error:
        raise RuntimeError(f"上传失败 {object_name}: {error}") from error


def main():
    parser = argparse.ArgumentParser(description="批量上传视频模板图片/视频到阿里云 OSS")
    parser.add_argument("--index", required=True, type=Path, help="index.json 路径")
    parser.add_argument("--model-dir", default="wan3", help="模型目录，默认 wan3")
    parser.add_argument("--prefix", default=DEFAULT_PREFIX)
    parser.add_argument("--bucket", default=os.environ.get("MP4_OSS_BUCKET_NAME", DEFAULT_BUCKET))
    parser.add_argument("--endpoint", default=os.environ.get("MP4_OSS_ENDPOINT", DEFAULT_ENDPOINT))
    parser.add_argument("--public-endpoint", default=os.environ.get("MP4_OSS_PUBLIC_ENDPOINT", DEFAULT_PUBLIC_ENDPOINT))
    parser.add_argument("--video-only", action="store_true", help="只处理 content_type=video 的数据")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    payload = json.loads(args.index.read_text(encoding="utf-8"))
    files = []
    seen = set()
    for item in payload.get("items", []):
        if args.video_only and item.get("content_type") != "video":
            continue
        entries = list(item.get("files", []))
        entries.extend(item.get("media", []))
        entries.extend(item.get("references", []))
        for entry in entries:
            local_file = entry.get("local_file")
            if not local_file:
                continue
            path = Path(local_file)
            if not path.exists():
                raise FileNotFoundError(path)
            if path.resolve() in seen:
                continue
            seen.add(path.resolve())
            object_name, content_type = object_info(path, args.model_dir, args.prefix)
            public_url = f"{args.public_endpoint.rstrip('/')}/{object_name}"
            files.append((path, object_name, content_type, public_url))

    print(f"待上传文件: {len(files)}")
    for path, object_name, content_type, public_url in files:
        print(f"{path} -> {object_name} [{content_type}]\n  {public_url}")
    if args.dry_run:
        return

    access_key_id, access_key_secret = config(args)
    for index, (path, object_name, content_type, _) in enumerate(files, 1):
        upload(path, object_name, content_type, args, access_key_id, access_key_secret)
        print(f"[{index}/{len(files)}] uploaded {object_name}")


if __name__ == "__main__":
    main()
