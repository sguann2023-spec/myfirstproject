#!/usr/bin/env python3
"""Package or tombstone a quick skill, upload assets to OSS, then publish a new manifest.

Usage:
    python3 publish_quick_skill_manifest.py "直播切片"
    python3 publish_quick_skill_manifest.py "liveclipping"
    python3 publish_quick_skill_manifest.py "liveclipping" --version 1.0.1
    python3 publish_quick_skill_manifest.py "liveclipping" --min-app-version 1.6.7
    python3 publish_quick_skill_manifest.py "liveclipping" --delete --tombstone-version 2.0.0
    python3 publish_quick_skill_manifest.py "liveclipping" --version 1.0.1 --dry-run
    python3 publish_quick_skill_manifest.py --manifest-only
    python3 publish_quick_skill_manifest.py --manifest-only --dry-run

Workflow:
1. Read the target quick skill version from `manifest.json`, or override it with `--version`
2. Zip the quick skill directory with the skill folder kept as the archive root
3. Upload the zip to `skills/quick/<skill>/<version_with_underscores>/<skill>.zip`
4. Rewrite `manifest.json` with a fresh `updatedAt` and computed `downloadUrl`
5. Upload the manifest to `skills/quick/manifest.json`
"""

from __future__ import annotations

import argparse
import base64
import fnmatch
import hashlib
import hmac
import json
import mimetypes
import os
import shutil
import sys
import tempfile
import uuid
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import formatdate
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen


EXCLUDE_DIRS = {"__pycache__", "node_modules"}
EXCLUDE_GLOBS = {"*.pyc"}
EXCLUDE_FILES = {".DS_Store"}
ROOT_EXCLUDE_DIRS = {"evals"}


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
    default_root = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="Publish a quick skill to OSS and update manifest.json")
    parser.add_argument(
        "skill_name",
        nargs="?",
        help="Quick skill display name or directory name, for example: 直播切片 or liveclipping",
    )
    parser.add_argument(
        "--skills-root",
        default=str(default_root),
        help="Root directory containing quick skill folders and manifest.json",
    )
    parser.add_argument(
        "--manifest",
        default=None,
        help="Path to manifest.json, defaults to <skills-root>/manifest.json",
    )
    parser.add_argument(
        "--version",
        default=None,
        help="Publish version to write into manifest.json, for example: 1.0.1",
    )
    parser.add_argument(
        "--min-app-version",
        default=None,
        help="Optional minAppVersion to write into manifest.json, for example: 1.6.7",
    )
    parser.add_argument(
        "--delete",
        action="store_true",
        help="Mark the quick skill as deleted and publish a tombstone instead of uploading a zip",
    )
    parser.add_argument(
        "--tombstone-version",
        default=None,
        help="Tombstone version to write when --delete is used, for example: 2.0.0",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build files and print upload targets without uploading anything",
    )
    parser.add_argument(
        "--manifest-only",
        action="store_true",
        help="Upload the local manifest.json only, without packaging or uploading any skill zip",
    )
    return parser.parse_args()


def now_iso8601() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def now_aliyun_timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def version_to_path(version: str) -> str:
    return version.replace(".", "_")


def build_download_url(
    config: OssConfig,
    skill_name: str,
    version: str,
    manifest_data: dict[str, Any] | None = None,
) -> str:
    public_endpoint = config.public_endpoint.rstrip("/")
    skill_slug = build_skill_slug(skill_name, manifest_data)
    return f"{public_endpoint}/skills/quick/{skill_slug}/{version_to_path(version)}/{skill_slug}.zip"


def build_manifest_url(config: OssConfig) -> str:
    public_endpoint = config.public_endpoint.rstrip("/")
    return f"{public_endpoint}/skills/quick/manifest.json"


def should_exclude(rel_path: Path) -> bool:
    parts = rel_path.parts
    if any(part in EXCLUDE_DIRS for part in parts):
        return True
    if len(parts) > 1 and parts[1] in ROOT_EXCLUDE_DIRS:
        return True
    name = rel_path.name
    if name in EXCLUDE_FILES:
        return True
    return any(fnmatch.fnmatch(name, pattern) for pattern in EXCLUDE_GLOBS)


def load_manifest(manifest_path: Path) -> dict[str, Any]:
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found: {manifest_path}")
    with manifest_path.open("r", encoding="utf-8") as file:
        return json.load(file)


def ensure_skill_version(manifest: dict[str, Any], skill_name: str, *, allow_deleted: bool = False) -> str:
    skill_meta = ensure_skill_entry(manifest, skill_name)
    version = skill_meta.get("version")
    if not isinstance(version, str) or not version.strip():
        raise ValueError(f"Quick skill '{skill_name}' is missing a valid version in manifest.json")
    if not allow_deleted and skill_meta.get("deleted") is True:
        raise ValueError(f"Quick skill '{skill_name}' is marked as deleted and cannot be published")
    return version.strip()


def ensure_skill_entry(manifest: dict[str, Any], skill_name: str) -> dict[str, Any]:
    skills = manifest.get("skills")
    if not isinstance(skills, dict):
        raise ValueError("manifest.json is missing a valid 'skills' object")
    skill_meta = skills.get(skill_name)
    if not isinstance(skill_meta, dict):
        raise KeyError(f"Quick skill '{skill_name}' not found in manifest.json")
    return skill_meta


def resolve_skill_key_and_entry(manifest: dict[str, Any], skill_name: str) -> tuple[str, dict[str, Any]]:
    skills = manifest.get("skills")
    if not isinstance(skills, dict):
        raise ValueError("manifest.json is missing a valid 'skills' object")

    direct_entry = skills.get(skill_name)
    if isinstance(direct_entry, dict):
        return skill_name, direct_entry

    normalized_input = skill_name.strip().lower()
    for manifest_skill_name, skill_meta in skills.items():
        if not isinstance(skill_meta, dict):
            continue
        folder_name = str(skill_meta.get("folderName") or "").strip().lower()
        if folder_name and folder_name == normalized_input:
            return str(manifest_skill_name), skill_meta

    raise KeyError(f"Quick skill '{skill_name}' not found in manifest.json")


def build_skill_slug(skill_name: str, manifest_data: dict[str, Any] | None = None) -> str:
    if manifest_data:
        skills = manifest_data.get("skills")
        if isinstance(skills, dict):
            skill_meta = skills.get(skill_name)
            if isinstance(skill_meta, dict):
                package_slug = str(skill_meta.get("packageSlug") or "").strip()
                if package_slug:
                    return package_slug
                action = str(skill_meta.get("action") or "").strip()
                if action.startswith("bootstrap-"):
                    return action[len("bootstrap-") :]

    normalized = "".join(ch if ch.isascii() and (ch.isalnum() or ch in "-_.") else "-" for ch in skill_name)
    normalized = "-".join(part for part in normalized.split("-") if part)
    if not normalized:
        raise ValueError(f"Quick skill '{skill_name}' is missing a valid ASCII package slug")
    return normalized.lower()


def resolve_publish_version(manifest: dict[str, Any], skill_name: str, override_version: str | None) -> str:
    current_version = ensure_skill_version(manifest, skill_name, allow_deleted=True)
    if override_version is None:
        return current_version

    version = override_version.strip()
    if not version:
        raise ValueError("--version cannot be empty")
    return version


def resolve_min_app_version(
    manifest: dict[str, Any],
    skill_name: str,
    override_min_app_version: str | None,
) -> str | None:
    skill_meta = ensure_skill_entry(manifest, skill_name)
    if override_min_app_version is None:
        value = skill_meta.get("minAppVersion")
        return value.strip() if isinstance(value, str) and value.strip() else None

    min_app_version = override_min_app_version.strip()
    if not min_app_version:
        raise ValueError("--min-app-version cannot be empty")
    return min_app_version


def resolve_tombstone_version(
    manifest: dict[str, Any],
    skill_name: str,
    override_tombstone_version: str | None,
    version_override: str | None,
) -> str:
    if override_tombstone_version is not None:
        tombstone_version = override_tombstone_version.strip()
        if not tombstone_version:
            raise ValueError("--tombstone-version cannot be empty")
        return tombstone_version

    if version_override is not None:
        return version_override.strip()

    skill_meta = ensure_skill_entry(manifest, skill_name)
    existing_tombstone = skill_meta.get("tombstoneVersion")
    if isinstance(existing_tombstone, str) and existing_tombstone.strip():
        return existing_tombstone.strip()

    existing_version = skill_meta.get("version")
    if isinstance(existing_version, str) and existing_version.strip():
        return existing_version.strip()

    return now_iso8601()


def make_zip_archive(skill_path: Path, output_dir: Path) -> Path:
    if not skill_path.exists():
        raise FileNotFoundError(f"Quick skill folder not found: {skill_path}")
    if not skill_path.is_dir():
        raise NotADirectoryError(f"Quick skill path is not a directory: {skill_path}")
    if not (skill_path / "SKILL.md").exists():
        raise FileNotFoundError(f"SKILL.md not found in: {skill_path}")

    zip_path = output_dir / f"{skill_path.name}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for file_path in sorted(skill_path.rglob("*")):
            if not file_path.is_file():
                continue
            archive_name = file_path.relative_to(skill_path.parent)
            if should_exclude(archive_name):
                continue
            archive.write(file_path, archive_name)
    return zip_path


def write_manifest_file(manifest_data: dict[str, Any], manifest_path: Path) -> None:
    manifest_path.write_text(
        json.dumps(manifest_data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


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


def build_put_headers(config: OssConfig, object_name: str, content_type: str) -> dict[str, str]:
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

    data = local_path.read_bytes()
    request = Request(url, data=data, method="PUT", headers=headers)

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


def prepare_manifest_for_publish(
    manifest_data: dict[str, Any],
    skill_name: str,
    version: str,
    download_url: str,
    min_app_version: str | None,
) -> dict[str, Any]:
    skills = manifest_data["skills"]
    skill_meta = skills[skill_name]
    skill_meta["packageSlug"] = build_skill_slug(skill_name, manifest_data)
    skill_meta["version"] = version
    skill_meta["downloadUrl"] = download_url
    if min_app_version:
        skill_meta["minAppVersion"] = min_app_version
    else:
        skill_meta.pop("minAppVersion", None)
    skill_meta.pop("deleted", None)
    skill_meta.pop("tombstoneVersion", None)
    manifest_data["updatedAt"] = now_iso8601()
    return manifest_data


def prepare_manifest_for_deletion(
    manifest_data: dict[str, Any],
    skill_name: str,
    tombstone_version: str,
    min_app_version: str | None,
) -> dict[str, Any]:
    skills = manifest_data["skills"]
    skill_meta = skills[skill_name]
    skill_meta["deleted"] = True
    skill_meta["tombstoneVersion"] = tombstone_version
    if min_app_version:
        skill_meta["minAppVersion"] = min_app_version
    else:
        skill_meta.pop("minAppVersion", None)
    manifest_data["updatedAt"] = now_iso8601()
    return manifest_data


def publish_manifest_only(manifest_path: Path, dry_run: bool) -> None:
    oss_config = load_oss_config()
    cdn_config = load_cdn_config()
    manifest_object_name = "skills/quick/manifest.json"
    load_manifest(manifest_path)
    manifest_url = build_manifest_url(oss_config)

    print(f"Manifest path: {manifest_path}")

    if dry_run:
        print("Dry run enabled, skipping upload.")
        print(f"Would upload manifest to: {manifest_object_name}")
        print(f"Would refresh CDN cache for: {manifest_url}")
        return

    uploaded_manifest_url = upload_file_to_oss(manifest_path, manifest_object_name, oss_config)
    print(f"Uploaded manifest: {uploaded_manifest_url}")
    refresh_result = refresh_cdn_cache([manifest_url], cdn_config)
    print(f"Refreshed CDN cache: {refresh_result.get('RequestId', 'unknown-request-id')}")
    print("Publish completed successfully.")


def publish_skill(
    skill_name: str,
    skills_root: Path,
    manifest_path: Path,
    version_override: str | None,
    min_app_version_override: str | None,
    dry_run: bool,
) -> None:
    oss_config = load_oss_config()
    cdn_config = load_cdn_config()
    manifest_data = load_manifest(manifest_path)
    skill_key, skill_meta = resolve_skill_key_and_entry(manifest_data, skill_name)
    folder_name = str(skill_meta.get("folderName") or skill_key).strip() or skill_key
    version = resolve_publish_version(manifest_data, skill_key, version_override)
    min_app_version = resolve_min_app_version(manifest_data, skill_key, min_app_version_override)
    skill_path = skills_root / folder_name

    skill_slug = build_skill_slug(skill_key, manifest_data)
    zip_object_name = f"skills/quick/{skill_slug}/{version_to_path(version)}/{skill_slug}.zip"
    zip_download_url = build_download_url(oss_config, skill_key, version, manifest_data)
    manifest_object_name = "skills/quick/manifest.json"
    manifest_url = build_manifest_url(oss_config)

    print(f"Quick skill: {skill_key}")
    print(f"Folder name: {folder_name}")
    print(f"Version: {version}")
    print(f"Skill path: {skill_path}")
    print(f"Zip object: {zip_object_name}")

    with tempfile.TemporaryDirectory(prefix="publish-quick-skill-") as temp_dir:
        temp_root = Path(temp_dir)
        zip_path = make_zip_archive(skill_path, temp_root)
        print(f"Created zip: {zip_path}")

        updated_manifest = prepare_manifest_for_publish(
            manifest_data,
            skill_key,
            version,
            zip_download_url,
            min_app_version,
        )
        temp_manifest_path = temp_root / "manifest.json"
        write_manifest_file(updated_manifest, temp_manifest_path)
        print(f"Prepared manifest: {temp_manifest_path}")

        if dry_run:
            print("Dry run enabled, skipping upload.")
            print(f"Would upload zip to: {zip_object_name}")
            print(f"Would upload manifest to: {manifest_object_name}")
            print(f"Would set downloadUrl to: {zip_download_url}")
            if min_app_version:
                print(f"Would set minAppVersion to: {min_app_version}")
            print(f"Would refresh CDN cache for: {zip_download_url}")
            print(f"Would refresh CDN cache for: {manifest_url}")
            return

        uploaded_zip_url = upload_file_to_oss(zip_path, zip_object_name, oss_config)
        print(f"Uploaded zip: {uploaded_zip_url}")

        shutil.copyfile(temp_manifest_path, manifest_path)
        uploaded_manifest_url = upload_file_to_oss(manifest_path, manifest_object_name, oss_config)
        print(f"Uploaded manifest: {uploaded_manifest_url}")
        refresh_result = refresh_cdn_cache([zip_download_url, manifest_url], cdn_config)
        print(f"Refreshed CDN cache: {refresh_result.get('RequestId', 'unknown-request-id')}")

    print("Publish completed successfully.")


def publish_skill_deletion(
    skill_name: str,
    manifest_path: Path,
    version_override: str | None,
    tombstone_version_override: str | None,
    min_app_version_override: str | None,
    dry_run: bool,
) -> None:
    oss_config = load_oss_config()
    cdn_config = load_cdn_config()
    manifest_data = load_manifest(manifest_path)
    skill_key, _skill_meta = resolve_skill_key_and_entry(manifest_data, skill_name)
    tombstone_version = resolve_tombstone_version(
        manifest_data,
        skill_key,
        tombstone_version_override,
        version_override,
    )
    min_app_version = resolve_min_app_version(manifest_data, skill_key, min_app_version_override)
    manifest_object_name = "skills/quick/manifest.json"
    manifest_url = build_manifest_url(oss_config)

    print(f"Quick skill: {skill_key}")
    print(f"Tombstone version: {tombstone_version}")
    if min_app_version:
        print(f"Min app version: {min_app_version}")

    with tempfile.TemporaryDirectory(prefix="publish-quick-skill-delete-") as temp_dir:
        temp_root = Path(temp_dir)
        updated_manifest = prepare_manifest_for_deletion(
            manifest_data,
            skill_key,
            tombstone_version,
            min_app_version,
        )
        temp_manifest_path = temp_root / "manifest.json"
        write_manifest_file(updated_manifest, temp_manifest_path)
        print(f"Prepared manifest: {temp_manifest_path}")

        if dry_run:
            print("Dry run enabled, skipping upload.")
            print(f"Would upload manifest to: {manifest_object_name}")
            print(f"Would set deleted to: true")
            print(f"Would set tombstoneVersion to: {tombstone_version}")
            if min_app_version:
                print(f"Would set minAppVersion to: {min_app_version}")
            print(f"Would refresh CDN cache for: {manifest_url}")
            return

        shutil.copyfile(temp_manifest_path, manifest_path)
        uploaded_manifest_url = upload_file_to_oss(manifest_path, manifest_object_name, oss_config)
        print(f"Uploaded manifest: {uploaded_manifest_url}")
        refresh_result = refresh_cdn_cache([manifest_url], cdn_config)
        print(f"Refreshed CDN cache: {refresh_result.get('RequestId', 'unknown-request-id')}")

    print("Publish completed successfully.")


def main() -> int:
    args = parse_args()
    skills_root = Path(args.skills_root).resolve()
    manifest_path = Path(args.manifest).resolve() if args.manifest else skills_root / "manifest.json"

    try:
        if args.manifest_only:
            if args.skill_name:
                raise ValueError("skill_name cannot be used together with --manifest-only")
            if args.version:
                raise ValueError("--version cannot be used together with --manifest-only")
            if args.min_app_version:
                raise ValueError("--min-app-version cannot be used together with --manifest-only")
            if args.delete:
                raise ValueError("--delete cannot be used together with --manifest-only")
            if args.tombstone_version:
                raise ValueError("--tombstone-version cannot be used together with --manifest-only")
            publish_manifest_only(
                manifest_path=manifest_path,
                dry_run=args.dry_run,
            )
            return 0

        if not args.skill_name:
            raise ValueError("skill_name is required unless --manifest-only is used")

        if args.delete:
            publish_skill_deletion(
                skill_name=args.skill_name,
                manifest_path=manifest_path,
                version_override=args.version,
                tombstone_version_override=args.tombstone_version,
                min_app_version_override=args.min_app_version,
                dry_run=args.dry_run,
            )
            return 0

        publish_skill(
            skill_name=args.skill_name,
            skills_root=skills_root,
            manifest_path=manifest_path,
            version_override=args.version,
            min_app_version_override=args.min_app_version,
            dry_run=args.dry_run,
        )
        return 0
    except Exception as error:  # pragma: no cover - CLI error path
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
