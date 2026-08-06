#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import mimetypes
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
DEFAULT_TEMPLATE_PATH = ROOT / "template.text"
DEFAULT_RESULTS_ROOT = ROOT / "out" / "image_template_samples"
DEFAULT_MANIFEST_PATH = Path(__file__).resolve().parent / "manifest.json"
DEFAULT_BUCKET = "oss-hangzhou-mp4"
DEFAULT_ENDPOINT = "oss-cn-hangzhou.aliyuncs.com"
DEFAULT_PREFIX = "example/client_image_template"

MODEL_PATTERNS = [
    ("gpt image 2", "gpt-image-2-all"),
    ("nano banana pro", "nano_banana_pro"),
    ("nano banana", "nano_banana_2"),
    ("seedreem 5.0", "seedream-5.0"),
    ("seedream 5.0", "seedream-5.0"),
    ("seedreem 4.5", "seedream-4.5"),
    ("seedream 4.5", "seedream-4.5"),
    ("seedreem 4.0", "seedream-4.0"),
    ("seedream 4.0", "seedream-4.0"),
    ("seedreem 3.0", "seedream-3.0"),
    ("seedream 3.0", "seedream-3.0"),
]


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
    parser = argparse.ArgumentParser(description="Publish image template covers and manifest to OSS")
    parser.add_argument("--template-file", default=str(DEFAULT_TEMPLATE_PATH))
    parser.add_argument("--results-root", default=str(DEFAULT_RESULTS_ROOT))
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


def normalize_prompt_content(content: str) -> str:
    normalized = content.strip()
    for label, _model in MODEL_PATTERNS:
        prefixes = [f"{label}模型：", f"{label} 模型：", f"{label}模型:", f"{label} 模型:"]
        lowered = normalized.lower()
        for prefix in prefixes:
            if lowered.startswith(prefix):
                return normalized[len(prefix):].strip()
    return normalized


def parse_entries(raw_text: str) -> list[dict[str, Any]]:
    source = str(raw_text or "")
    entries: list[dict[str, Any]] = []
    expected_index = 1
    cursor = 0
    while expected_index <= 200:
        marker = f"{expected_index}."
        start = source.find(marker, cursor)
        if start == -1:
            break
        next_marker = f"\n{expected_index + 1}."
        next_start = source.find(next_marker, start + len(marker))
        block = source[start : len(source) if next_start == -1 else next_start].strip()
        content = block[len(marker) :].strip()
        ratio = "1:1"
        ratio_marker = "比例"
        ratio_pos = content.rfind(ratio_marker)
        if ratio_pos != -1:
            tail = content[ratio_pos:]
            for candidate in ["21:9", "16:9", "9:16", "4:5", "5:4", "4:3", "3:4", "3:2", "2:3", "1:1"]:
                if candidate in tail:
                    ratio = candidate
                    break
        entries.append(
            {
                "index": expected_index,
                "ratio": ratio,
                "prompt": normalize_prompt_content(content),
            }
        )
        cursor = len(source) if next_start == -1 else next_start + 1
        expected_index += 1
    return entries


def load_latest_successes(results_root: Path) -> dict[int, dict[str, Any]]:
    latest: dict[int, dict[str, Any]] = {}
    for child in sorted(results_root.iterdir()):
        if not child.is_dir():
            continue
        results_path = child / "results.json"
        if not results_path.exists():
            continue
        data = json.loads(results_path.read_text(encoding="utf-8"))
        rows = data if isinstance(data, list) else data.get("taskResults") or data.get("results") or []
        for row in rows:
            if row.get("status") != "success" or not row.get("localPath"):
                continue
            latest[int(row["index"])] = {
                "index": int(row["index"]),
                "model": row.get("model", ""),
                "ratio": row.get("ratio", ""),
                "local_path": Path(row["localPath"]).resolve(),
            }
    return latest


def build_description(prompt: str) -> str:
    for raw_line in prompt.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith(("•", "◦")):
            continue
        if line.startswith("【") or line.startswith("1.") or line.startswith("2.") or line.startswith("3."):
            continue
        line = line.replace("seedreem", "seedream")
        if len(line) > 44:
            line = line[:44].rstrip("，。；;,:： ") + "..."
        elif not line.endswith(("。", "！", "？", ".", "!", "?")):
            line += "。"
        return line
    return "图片模板封面。"


def guess_content_type(path: Path) -> str:
    guessed, _ = mimetypes.guess_type(str(path))
    return guessed or "application/octet-stream"


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
    headers = build_put_headers(config, object_name, guess_content_type(local_path))
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


def build_manifest(entries: list[dict[str, Any]], successes: dict[int, dict[str, Any]], base_prefix: str) -> dict[str, Any]:
    templates: list[dict[str, Any]] = []
    normalized_prefix = base_prefix.strip("/")
    for entry in entries:
        success = successes.get(entry["index"])
        if not success:
            continue
        local_path = success["local_path"]
        object_name = f"{normalized_prefix}/covers/{local_path.name}"
        templates.append(
            {
                "id": f"client_image_template_{entry['index']:03d}",
                "index": entry["index"],
                "cover": object_name,
                "description": build_description(entry["prompt"]),
                "prompt": entry["prompt"],
                "model": success["model"],
                "ratio": success["ratio"] or entry["ratio"],
            }
        )
    return {
        "version": datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"),
        "updatedAt": now_iso8601(),
        "templateCount": len(templates),
        "templates": templates,
    }


def main() -> int:
    args = parse_args()
    template_path = Path(args.template_file).resolve()
    results_root = Path(args.results_root).resolve()
    manifest_path = Path(args.manifest).resolve()
    prefix = args.prefix.strip("/")
    config = load_oss_config(args)
    cdn_config = load_cdn_config()

    entries = parse_entries(template_path.read_text(encoding="utf-8"))
    successes = load_latest_successes(results_root)
    manifest = build_manifest(entries, successes, prefix)

    upload_plan = []
    for item in manifest["templates"]:
        success = successes[item["index"]]
        upload_plan.append((success["local_path"], item["cover"]))

    if args.dry_run:
        preview = {
            **manifest,
            "templates": [
                {
                    **item,
                    "cover": f"{config.public_base_url}/{item['cover']}",
                }
                for item in manifest["templates"][:3]
            ],
        }
        print(json.dumps(preview, ensure_ascii=False, indent=2))
        print(f"Would upload {len(upload_plan)} covers to {config.bucket_name}/{prefix}/covers/")
        print(f"Would upload manifest to {config.bucket_name}/{prefix}/manifest.json")
        print("Would refresh CDN cache for uploaded covers and manifest URL")
        return 0

    uploaded_urls: list[str] = []
    for local_path, object_name in upload_plan:
        uploaded_urls.append(upload_file_to_oss(local_path, object_name, config))

    for item in manifest["templates"]:
        item["cover"] = f"{config.public_base_url}/{item['cover']}"

    write_json(manifest_path, manifest)
    manifest_object_name = f"{prefix}/manifest.json"
    manifest_url = upload_file_to_oss(manifest_path, manifest_object_name, config)
    refresh_result = refresh_cdn_cache([*uploaded_urls, manifest_url], cdn_config)

    print(f"Uploaded {len(upload_plan)} covers")
    print(f"Manifest path: {manifest_path}")
    print(f"Manifest url: {manifest_url}")
    print(f"Refreshed CDN cache: {refresh_result.get('RequestId', 'unknown-request-id')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
