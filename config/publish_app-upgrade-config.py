#!/usr/bin/env python3
"""Upload app-upgrade-config.json to OSS and refresh CDN.

Usage:
    python3 publish_app-upgrade-config.py
    python3 publish_app-upgrade-config.py --config ./app-upgrade-config.json
    python3 publish_app-upgrade-config.py --dry-run

Workflow:
1. Read and validate the local app-upgrade-config.json file
2. Upload it to `client/config/app-upgrade-config.json`
3. Refresh CDN cache for `https://player.install-ai-guider.top/client/config/app-upgrade-config.json`
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import mimetypes
import os
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import formatdate
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen


DEFAULT_OBJECT_NAME = "client/config/app-upgrade-config.json"


@dataclass(frozen=True)
class OssConfig:
    bucket_name: str
    access_key_id: str
    access_key_secret: str
    region: str
    endpoint: str
    public_endpoint: str


@dataclass(frozen=True)
class CdnConfig:
    access_key_id: str
    access_key_secret: str
    endpoint: str


def load_oss_config() -> OssConfig:
    return OssConfig(
        bucket_name=os.environ.get("MP4_OSS_BUCKET_NAME", "oss-hangzhou-mp4"),
        access_key_id=os.environ.get("ACCESS_KEY_ID", "") or os.environ.get("MP4_OSS_ACCESS_KEY_ID", ""),
        access_key_secret=os.environ.get("ACCESS_KEY_SECRET", "")
        or os.environ.get("MP4_OSS_ACCESS_KEY_SECRET", ""),
        region=os.environ.get("MP4_OSS_REGION", "cn-hangzhou"),
        endpoint=os.environ.get("MP4_OSS_ENDPOINT", "oss-cn-hangzhou.aliyuncs.com"),
        public_endpoint=os.environ.get("MP4_OSS_PUBLIC_ENDPOINT", "https://player.install-ai-guider.top"),
    )


def load_cdn_config() -> CdnConfig:
    return CdnConfig(
        access_key_id=os.environ.get("ACCESS_KEY_ID", "") or os.environ.get("MP4_OSS_ACCESS_KEY_ID", ""),
        access_key_secret=os.environ.get("ACCESS_KEY_SECRET", "")
        or os.environ.get("MP4_OSS_ACCESS_KEY_SECRET", ""),
        endpoint=os.environ.get("MP4_CDN_ENDPOINT", "https://cdn.aliyuncs.com"),
    )


def parse_args() -> argparse.Namespace:
    default_config = Path(__file__).resolve().with_name("app-upgrade-config.json")
    parser = argparse.ArgumentParser(description="Publish app-upgrade-config.json to OSS and refresh CDN")
    parser.add_argument(
        "--config",
        default=str(default_config),
        help="Path to the local app-upgrade-config.json file",
    )
    parser.add_argument(
        "--object-name",
        default=DEFAULT_OBJECT_NAME,
        help="OSS object name to upload, defaults to client/config/app-upgrade-config.json",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate the config file and print upload targets without uploading",
    )
    return parser.parse_args()


def now_aliyun_timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def percent_encode(value: str) -> str:
    return quote(value, safe="~")


def build_cdn_signature(parameters: dict[str, str], access_key_secret: str) -> str:
    canonicalized = "&".join(
        f"{percent_encode(key)}={percent_encode(value)}" for key, value in sorted(parameters.items())
    )
    string_to_sign = f"GET&%2F&{percent_encode(canonicalized)}"
    digest = hmac.new(
        f"{access_key_secret}&".encode("utf-8"),
        string_to_sign.encode("utf-8"),
        hashlib.sha1,
    ).digest()
    return base64.b64encode(digest).decode("utf-8")


def guess_content_type(file_path: Path) -> str:
    guessed, _ = mimetypes.guess_type(str(file_path))
    return guessed or "application/octet-stream"


def build_put_headers(
    config: OssConfig,
    object_name: str,
    content_type: str,
) -> dict[str, str]:
    date = formatdate(usegmt=True)
    canonical_resource = f"/{config.bucket_name}/{object_name}"
    string_to_sign = f"PUT\n\n{content_type}\n{date}\n{canonical_resource}"
    digest = hmac.new(
        config.access_key_secret.encode("utf-8"),
        string_to_sign.encode("utf-8"),
        hashlib.sha1,
    ).digest()
    signature = base64.b64encode(digest).decode("utf-8")
    return {
        "Date": date,
        "Content-Type": content_type,
        "Authorization": f"OSS {config.access_key_id}:{signature}",
    }


def upload_file_to_oss(local_path: Path, object_name: str, config: OssConfig) -> str:
    if not config.access_key_id or not config.access_key_secret:
        raise RuntimeError(
            "Missing OSS credentials. Set ACCESS_KEY_ID / ACCESS_KEY_SECRET or "
            "MP4_OSS_ACCESS_KEY_ID / MP4_OSS_ACCESS_KEY_SECRET."
        )

    endpoint_host = config.endpoint.replace("https://", "").replace("http://", "").strip("/")
    encoded_object_name = quote(object_name, safe="/-_.~")
    url = f"https://{config.bucket_name}.{endpoint_host}/{encoded_object_name}"
    content_type = guess_content_type(local_path)
    headers = build_put_headers(config, object_name, content_type)

    request = Request(url, data=local_path.read_bytes(), method="PUT", headers=headers)

    try:
        with urlopen(request, timeout=180) as response:
            status_code = getattr(response, "status", response.getcode())
            if status_code not in (200, 201):
                raise RuntimeError(f"OSS upload failed: status={status_code}, url={url}")
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"OSS upload failed: status={error.code}, object={object_name}, body={body}"
        ) from error
    except URLError as error:
        raise RuntimeError(f"OSS upload failed for {object_name}: {error}") from error

    public_endpoint = config.public_endpoint.rstrip("/")
    return f"{public_endpoint}/{object_name}"


def refresh_cdn_cache(object_urls: list[str], config: CdnConfig) -> dict[str, Any]:
    if not config.access_key_id or not config.access_key_secret:
        raise RuntimeError(
            "Missing CDN credentials. Set ACCESS_KEY_ID / ACCESS_KEY_SECRET or "
            "MP4_OSS_ACCESS_KEY_ID / MP4_OSS_ACCESS_KEY_SECRET."
        )

    normalized_urls: list[str] = []
    for object_url in object_urls:
        parsed = urlparse(object_url)
        if not parsed.scheme or not parsed.netloc:
            raise ValueError(f"Invalid CDN object URL: {object_url}")
        normalized_urls.append(object_url)

    endpoint = config.endpoint.rstrip("/")
    parameters = {
        "AccessKeyId": config.access_key_id,
        "Action": "RefreshObjectCaches",
        "Format": "JSON",
        "ObjectPath": "\n".join(normalized_urls),
        "ObjectType": "File",
        "SignatureMethod": "HMAC-SHA1",
        "SignatureNonce": str(uuid.uuid4()),
        "SignatureVersion": "1.0",
        "Timestamp": now_aliyun_timestamp(),
        "Version": "2018-05-10",
    }
    parameters["Signature"] = build_cdn_signature(parameters, config.access_key_secret)
    request_url = f"{endpoint}/?{urlencode(parameters)}"
    request = Request(request_url, method="GET")

    try:
        with urlopen(request, timeout=180) as response:
            status_code = getattr(response, "status", response.getcode())
            body = response.read().decode("utf-8", errors="replace")
            if status_code != 200:
                raise RuntimeError(f"CDN refresh failed: status={status_code}, body={body}")
            parsed_body = json.loads(body)
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"CDN refresh failed: status={error.code}, body={body}") from error
    except URLError as error:
        raise RuntimeError(f"CDN refresh failed: {error}") from error
    except json.JSONDecodeError as error:
        raise RuntimeError(f"CDN refresh returned invalid JSON: {error}") from error

    return parsed_body


def load_and_validate_config(config_path: Path) -> dict[str, Any]:
    if not config_path.exists():
        raise FileNotFoundError(f"Config file not found: {config_path}")

    with config_path.open("r", encoding="utf-8") as file:
        data = json.load(file)

    if not isinstance(data, dict):
        raise ValueError("app-upgrade-config.json must be a JSON object")
    if "versions" not in data or not isinstance(data["versions"], dict):
        raise ValueError("app-upgrade-config.json must contain a 'versions' object")

    github_proxy_prefixes = data.get("githubProxyPrefixes")
    if github_proxy_prefixes is not None and not isinstance(github_proxy_prefixes, list):
        raise ValueError("'githubProxyPrefixes' must be an array when provided")

    return data


def build_public_url(config: OssConfig, object_name: str) -> str:
    public_endpoint = config.public_endpoint.rstrip("/")
    return f"{public_endpoint}/{object_name}"


def publish_config(config_path: Path, object_name: str, dry_run: bool) -> None:
    oss_config = load_oss_config()
    cdn_config = load_cdn_config()
    load_and_validate_config(config_path)
    public_url = build_public_url(oss_config, object_name)

    print(f"Config path: {config_path}")
    print(f"OSS object: {object_name}")
    print(f"Public URL: {public_url}")

    if dry_run:
        print("Dry run enabled, skipping upload.")
        print(f"Would upload config to: {object_name}")
        print(f"Would refresh CDN cache for: {public_url}")
        return

    uploaded_url = upload_file_to_oss(config_path, object_name, oss_config)
    print(f"Uploaded config: {uploaded_url}")
    refresh_result = refresh_cdn_cache([public_url], cdn_config)
    print(f"Refreshed CDN cache: {refresh_result.get('RequestId', 'unknown-request-id')}")
    print("Publish completed successfully.")


def main() -> int:
    args = parse_args()
    config_path = Path(args.config).resolve()

    try:
        publish_config(
            config_path=config_path,
            object_name=args.object_name.strip(),
            dry_run=args.dry_run,
        )
        return 0
    except Exception as error:  # pragma: no cover - CLI error path
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
