#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import formatdate
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST_PATH = Path(__file__).resolve().parent / "manifest.json"
DEFAULT_BUCKET = "oss-hangzhou-mp4"
DEFAULT_ENDPOINT = "oss-cn-hangzhou.aliyuncs.com"
DEFAULT_PREFIX = "example/client_video_template"


@dataclass(frozen=True)
class OssConfig:
    bucket_name: str
    endpoint: str
    access_key_id: str
    access_key_secret: str
    public_endpoint: str

    @property
    def public_base_url(self) -> str:
        endpoint = self.public_endpoint.rstrip("/")
        if endpoint:
            return endpoint
        endpoint_host = self.endpoint.replace("https://", "").replace("http://", "").strip("/")
        return f"https://{self.bucket_name}.{endpoint_host}"


@dataclass(frozen=True)
class CdnConfig:
    access_key_id: str
    access_key_secret: str
    endpoint: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Publish video template manifest to OSS")
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST_PATH))
    parser.add_argument("--bucket", default=os.environ.get("MP4_OSS_BUCKET_NAME", DEFAULT_BUCKET))
    parser.add_argument("--endpoint", default=os.environ.get("MP4_OSS_ENDPOINT", DEFAULT_ENDPOINT))
    parser.add_argument("--prefix", default=DEFAULT_PREFIX)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def load_oss_config(args: argparse.Namespace) -> OssConfig:
    access_key_id = os.environ.get("ACCESS_KEY_ID", "") or os.environ.get("MP4_OSS_ACCESS_KEY_ID", "")
    access_key_secret = os.environ.get("ACCESS_KEY_SECRET", "") or os.environ.get("MP4_OSS_ACCESS_KEY_SECRET", "")
    return OssConfig(
        bucket_name=args.bucket,
        endpoint=args.endpoint,
        access_key_id=access_key_id,
        access_key_secret=access_key_secret,
        public_endpoint=os.environ.get("MP4_OSS_PUBLIC_ENDPOINT", "https://player.install-ai-guider.top"),
    )


def load_cdn_config() -> CdnConfig:
    return CdnConfig(
        access_key_id=os.environ.get("ACCESS_KEY_ID", "") or os.environ.get("MP4_OSS_ACCESS_KEY_ID", ""),
        access_key_secret=os.environ.get("ACCESS_KEY_SECRET", "") or os.environ.get("MP4_OSS_ACCESS_KEY_SECRET", ""),
        endpoint=os.environ.get("MP4_CDN_ENDPOINT", "https://cdn.aliyuncs.com"),
    )


def now_iso8601() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def now_version() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")


def now_aliyun_timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


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


def build_put_headers(config: OssConfig, object_name: str, content_type: str) -> dict[str, str]:
    date = formatdate(usegmt=True)
    canonical_resource = f"/{config.bucket_name}/{object_name}"
    string_to_sign = f"PUT\n\n{content_type}\n{date}\n{canonical_resource}"
    digest = hmac.new(config.access_key_secret.encode("utf-8"), string_to_sign.encode("utf-8"), hashlib.sha1).digest()
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
    data = local_path.read_bytes()
    headers = build_put_headers(config, object_name, "application/json; charset=utf-8")
    request = Request(url, data=data, method="PUT", headers=headers)
    try:
        with urlopen(request, timeout=180) as response:
            status_code = getattr(response, "status", response.getcode())
            if status_code not in (200, 201):
                raise RuntimeError(f"OSS upload failed: status={status_code}, object={object_name}")
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OSS upload failed: status={error.code}, object={object_name}, body={body}") from error
    except URLError as error:
        raise RuntimeError(f"OSS upload failed for {object_name}: {error}") from error
    return f"{config.public_base_url}/{object_name}"


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
            return json.loads(body)
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"CDN refresh failed: status={error.code}, body={body}") from error
    except URLError as error:
        raise RuntimeError(f"CDN refresh failed: {error}") from error


def load_manifest(manifest_path: Path) -> dict[str, Any]:
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    templates = payload.get("templates")
    if not isinstance(templates, list):
      raise ValueError("manifest.json is missing a valid 'templates' array")
    payload["version"] = now_version()
    payload["updatedAt"] = now_iso8601()
    payload["templateCount"] = len(templates)
    return payload


def main() -> int:
    args = parse_args()
    manifest_path = Path(args.manifest).resolve()
    prefix = args.prefix.strip("/")
    config = load_oss_config(args)
    cdn_config = load_cdn_config()

    manifest = load_manifest(manifest_path)

    if args.dry_run:
        print(json.dumps(manifest, ensure_ascii=False, indent=2))
        print(f"Would upload manifest to {config.bucket_name}/{prefix}/manifest.json")
        print("Would refresh CDN cache for manifest URL")
        return 0

    write_json(manifest_path, manifest)
    manifest_object_name = f"{prefix}/manifest.json"
    manifest_url = upload_file_to_oss(manifest_path, manifest_object_name, config)
    refresh_result = refresh_cdn_cache([manifest_url], cdn_config)

    print(f"Manifest path: {manifest_path}")
    print(f"Manifest url: {manifest_url}")
    print(f"Refreshed CDN cache: {refresh_result.get('RequestId', 'unknown-request-id')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
