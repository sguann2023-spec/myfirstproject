#!/usr/bin/env python3
"""Probe GitHub proxy nodes, update app-upgrade-config.json, and optionally publish it.

Usage:
    python3 refresh_app-upgrade-config.py
    python3 refresh_app-upgrade-config.py --dry-run
    python3 refresh_app-upgrade-config.py --publish

Workflow:
1. Fetch proxy candidates from https://github.akams.cn/ plus built-in fallback nodes
2. Verify real access to latest.yml and ZIP range downloads
3. Run stricter 1MB / deep-range validation on the top candidates
4. Update app-upgrade-config.json with the best 5 proxies
5. Optionally publish via publish_app-upgrade-config.py
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_SOURCE_URL = "https://github.akams.cn/"
DEFAULT_REPO = "sun-guannan/CapCutMaker"
DEFAULT_LIMIT = 5
DEFAULT_INITIAL_HEAD_RANGE = "0-262143"
DEFAULT_INITIAL_DEEP_RANGE = "629145600-629407743"
DEFAULT_STRICT_HEAD_RANGE = "0-1048575"
DEFAULT_STRICT_DEEP_RANGE = "629145600-630194175"
DEFAULT_CONNECT_TIMEOUT_SECONDS = 10
DEFAULT_INITIAL_MAX_TIME_SECONDS = 25
DEFAULT_STRICT_MAX_TIME_SECONDS = 45
DEFAULT_TOP_CANDIDATES = 8
DEFAULT_USER_AGENT = "CapCutHelper/1.0"

FALLBACK_PROXY_PREFIXES = [
    "https://gh.acmsz.top/",
    "https://gh.ddlc.top/",
    "https://githubdog.com/",
    "https://gh.monlor.com/",
    "https://gh.meali.top/",
    "https://ghproxy.imciel.com/",
    "https://ghproxy.felicity.land/",
    "https://gitproxy.mrhjx.cn/",
    "https://github.nswrz.cn/",
    "https://github.dpik.top/",
]


@dataclass(frozen=True)
class RangeProbeResult:
    ok: bool
    http_code: str | None
    bytes_downloaded: int
    speed_download: int
    elapsed_ms: int
    error: str | None = None


@dataclass(frozen=True)
class CandidateProbeResult:
    prefix: str
    yml_ok: bool
    yml_elapsed_ms: int
    yml_error: str | None
    head_result: RangeProbeResult
    deep_result: RangeProbeResult

    @property
    def all_ok(self) -> bool:
        return self.yml_ok and self.head_result.ok and self.deep_result.ok


def parse_args() -> argparse.Namespace:
    base_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(
        description="Probe GitHub proxy nodes, update app-upgrade-config.json, and optionally publish it."
    )
    parser.add_argument(
        "--config",
        default=str(base_dir / "app-upgrade-config.json"),
        help="Path to the local app-upgrade-config.json file",
    )
    parser.add_argument(
        "--source-url",
        default=DEFAULT_SOURCE_URL,
        help="Proxy node source page, defaults to https://github.akams.cn/",
    )
    parser.add_argument(
        "--repo",
        default=DEFAULT_REPO,
        help="GitHub repository in owner/name format, defaults to sun-guannan/CapCutMaker",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_LIMIT,
        help="Number of proxy prefixes to keep, defaults to 5",
    )
    parser.add_argument(
        "--candidate",
        action="append",
        default=[],
        help="Additional proxy prefix to include in probing (can be passed multiple times)",
    )
    parser.add_argument(
        "--publish",
        action="store_true",
        help="Publish the updated config after probing",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Probe and print the selected proxies without writing or publishing",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print detailed probe results",
    )
    return parser.parse_args()


def normalize_prefix(prefix: str) -> str:
    cleaned = prefix.strip()
    if not cleaned:
        raise ValueError("Proxy prefix cannot be empty")
    if not cleaned.startswith(("http://", "https://")):
        cleaned = f"https://{cleaned}"
    return f"{cleaned.rstrip('/')}/"


def unique_preserve_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


def fetch_text(url: str, timeout: int = 30) -> str:
    request = Request(url, headers={"User-Agent": DEFAULT_USER_AGENT})
    with urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def extract_candidate_prefixes(source_url: str) -> list[str]:
    try:
        content = fetch_text(source_url)
    except (HTTPError, URLError) as error:
        raise RuntimeError(f"Failed to fetch proxy source page {source_url}: {error}") from error

    domains = re.findall(r"\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b", content.lower())
    prefixes: list[str] = []

    for domain in domains:
        if domain in {"github.com", "raw.githubusercontent.com"}:
            continue
        first_label = domain.split(".", 1)[0]
        if first_label.startswith(("gh", "github", "gitproxy")):
            prefixes.append(normalize_prefix(domain))

    return unique_preserve_order(prefixes)


def build_latest_yml_target(repo: str) -> str:
    return f"https://github.com/{repo}/releases/latest/download/latest.yml"


def build_proxied_url(prefix: str, target_url: str) -> str:
    return f"{normalize_prefix(prefix)}{target_url}"


def run_curl(command: list[str]) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(command, check=False, capture_output=True)


def probe_latest_yml(prefix: str, target_url: str) -> tuple[bool, int, str | None, str | None]:
    started_at = time.perf_counter()
    command = [
        "curl",
        "-L",
        "--connect-timeout",
        str(DEFAULT_CONNECT_TIMEOUT_SECONDS),
        "--max-time",
        str(DEFAULT_INITIAL_MAX_TIME_SECONDS),
        "--silent",
        "--show-error",
        "--range",
        "0-511",
        build_proxied_url(prefix, target_url),
    ]
    completed = run_curl(command)
    elapsed_ms = int((time.perf_counter() - started_at) * 1000)

    if completed.returncode != 0:
        error = (completed.stderr or completed.stdout).decode("utf-8", errors="replace").strip()
        return False, elapsed_ms, None, error[:200]

    text = completed.stdout.decode("utf-8", errors="replace")
    ok = "version:" in text and "path:" in text
    error = None if ok else "latest.yml missing version/path fields"
    return ok, elapsed_ms, text, error


def resolve_latest_yml_text(candidate_prefixes: list[str], target_url: str) -> str:
    for prefix in candidate_prefixes:
        ok, _, text, _ = probe_latest_yml(prefix, target_url)
        if ok and text is not None:
            return text
    raise RuntimeError("Failed to fetch a valid latest.yml from all candidate proxies")


def parse_latest_yml_path(latest_yml_text: str) -> str:
    for line in latest_yml_text.splitlines():
        if line.startswith("path:"):
            value = line.split(":", 1)[1].strip()
            if value:
                return value
    raise RuntimeError("Failed to parse 'path' from latest.yml")


def probe_range(
    prefix: str,
    target_url: str,
    byte_range: str,
    max_time_seconds: int,
    min_bytes: int = 131072,
) -> RangeProbeResult:
    started_at = time.perf_counter()
    command = [
        "curl",
        "-L",
        "--connect-timeout",
        str(DEFAULT_CONNECT_TIMEOUT_SECONDS),
        "--max-time",
        str(max_time_seconds),
        "--silent",
        "--show-error",
        "--range",
        byte_range,
        "-o",
        "/dev/null",
        "--write-out",
        "%{http_code}\t%{size_download}\t%{speed_download}\t%{content_type}",
        build_proxied_url(prefix, target_url),
    ]
    completed = run_curl(command)
    elapsed_ms = int((time.perf_counter() - started_at) * 1000)
    output = completed.stdout.decode("utf-8", errors="replace").strip()
    error_output = completed.stderr.decode("utf-8", errors="replace").strip()

    if output:
        parts = output.split("\t", 3)
    else:
        parts = []

    http_code = parts[0] if len(parts) > 0 and parts[0] else None
    bytes_downloaded = int(float(parts[1])) if len(parts) > 1 and parts[1] else 0
    speed_download = int(float(parts[2])) if len(parts) > 2 and parts[2] else 0
    content_type = parts[3] if len(parts) > 3 else ""

    ok = (
        completed.returncode == 0
        and http_code in {"200", "206"}
        and bytes_downloaded >= min_bytes
        and "text/html" not in content_type.lower()
    )
    error = None
    if not ok:
        details = error_output or output or "unknown curl error"
        error = details[:200]

    return RangeProbeResult(
        ok=ok,
        http_code=http_code,
        bytes_downloaded=bytes_downloaded,
        speed_download=speed_download,
        elapsed_ms=elapsed_ms,
        error=error,
    )


def probe_candidate(
    prefix: str,
    latest_yml_target: str,
    zip_target: str,
    head_range: str,
    deep_range: str,
    max_time_seconds: int,
    min_bytes: int,
) -> CandidateProbeResult:
    yml_ok, yml_elapsed_ms, _, yml_error = probe_latest_yml(prefix, latest_yml_target)
    head_result = probe_range(prefix, zip_target, head_range, max_time_seconds, min_bytes=min_bytes)
    deep_result = probe_range(prefix, zip_target, deep_range, max_time_seconds, min_bytes=min_bytes)
    return CandidateProbeResult(
        prefix=prefix,
        yml_ok=yml_ok,
        yml_elapsed_ms=yml_elapsed_ms,
        yml_error=yml_error,
        head_result=head_result,
        deep_result=deep_result,
    )


def candidate_sort_key(result: CandidateProbeResult) -> tuple[int, int, int, int]:
    return (
        0 if result.all_ok else 1,
        result.deep_result.elapsed_ms,
        result.head_result.elapsed_ms,
        result.yml_elapsed_ms,
    )


def load_config(config_path: Path) -> dict[str, Any]:
    with config_path.open("r", encoding="utf-8") as file:
        data = json.load(file)
    if not isinstance(data, dict):
        raise ValueError("app-upgrade-config.json must be a JSON object")
    if "versions" not in data or not isinstance(data["versions"], dict):
        raise ValueError("app-upgrade-config.json must contain a 'versions' object")
    return data


def update_config_file(config_path: Path, selected_prefixes: list[str], dry_run: bool) -> dict[str, Any]:
    data = load_config(config_path)
    data["lastUpdated"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    data["githubProxyPrefixes"] = selected_prefixes

    if not dry_run:
        with config_path.open("w", encoding="utf-8") as file:
            json.dump(data, file, ensure_ascii=False, indent=2)
            file.write("\n")

    return data


def load_publish_module(script_path: Path) -> Any:
    spec = importlib.util.spec_from_file_location("publish_app_upgrade_config", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load publish script from {script_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def print_result_table(title: str, results: list[CandidateProbeResult]) -> None:
    print(title)
    for result in results:
        status = "OK" if result.all_ok else "FAIL"
        print(
            f"- {status} {result.prefix} | "
            f"yml={result.yml_elapsed_ms}ms | "
            f"head={result.head_result.http_code or '-'} {result.head_result.elapsed_ms}ms | "
            f"deep={result.deep_result.http_code or '-'} {result.deep_result.elapsed_ms}ms"
        )
        if result.yml_error:
            print(f"  yml_error: {result.yml_error}")
        if result.head_result.error:
            print(f"  head_error: {result.head_result.error}")
        if result.deep_result.error:
            print(f"  deep_error: {result.deep_result.error}")


def main() -> int:
    args = parse_args()
    config_path = Path(args.config).resolve()
    publish_script_path = Path(__file__).resolve().with_name("publish_app-upgrade-config.py")

    try:
        current_config = load_config(config_path)
        current_prefixes = [
            normalize_prefix(prefix)
            for prefix in current_config.get("githubProxyPrefixes", [])
            if isinstance(prefix, str) and prefix.strip()
        ]

        scraped_prefixes = extract_candidate_prefixes(args.source_url)
        extra_prefixes = [normalize_prefix(prefix) for prefix in args.candidate]
        all_candidates = unique_preserve_order(
            current_prefixes + extra_prefixes + scraped_prefixes + FALLBACK_PROXY_PREFIXES
        )

        if len(all_candidates) < args.limit:
            raise RuntimeError(f"Only found {len(all_candidates)} proxy candidates, need at least {args.limit}")

        latest_yml_target = build_latest_yml_target(args.repo)
        latest_yml_text = resolve_latest_yml_text(all_candidates, latest_yml_target)
        zip_path = parse_latest_yml_path(latest_yml_text)
        zip_target = f"https://github.com/{args.repo}/releases/latest/download/{zip_path}"

        initial_results = [
            probe_candidate(
                prefix=prefix,
                latest_yml_target=latest_yml_target,
                zip_target=zip_target,
                head_range=DEFAULT_INITIAL_HEAD_RANGE,
                deep_range=DEFAULT_INITIAL_DEEP_RANGE,
                max_time_seconds=DEFAULT_INITIAL_MAX_TIME_SECONDS,
                min_bytes=131072,
            )
            for prefix in all_candidates
        ]
        initial_results.sort(key=candidate_sort_key)

        strict_candidates = [
            result.prefix
            for result in initial_results[: max(args.limit, min(DEFAULT_TOP_CANDIDATES, len(initial_results)))]
        ]
        strict_results = [
            probe_candidate(
                prefix=prefix,
                latest_yml_target=latest_yml_target,
                zip_target=zip_target,
                head_range=DEFAULT_STRICT_HEAD_RANGE,
                deep_range=DEFAULT_STRICT_DEEP_RANGE,
                max_time_seconds=DEFAULT_STRICT_MAX_TIME_SECONDS,
                min_bytes=262144,
            )
            for prefix in strict_candidates
        ]
        strict_results.sort(key=candidate_sort_key)

        successful_results = [result for result in strict_results if result.all_ok]
        if len(successful_results) < args.limit:
            raise RuntimeError(
                f"Only {len(successful_results)} proxies passed strict validation, need {args.limit}."
            )

        selected_prefixes = [result.prefix for result in successful_results[: args.limit]]
        updated_config = update_config_file(config_path, selected_prefixes, dry_run=args.dry_run)

        if args.verbose or args.dry_run:
            print_result_table("Initial probe results:", initial_results[:10])
            print_result_table("Strict probe results:", strict_results)

        print("Selected proxy prefixes:")
        for prefix in selected_prefixes:
            print(f"- {prefix}")

        if args.dry_run:
            print("Dry run enabled, skipped writing config and publishing.")
            return 0

        print(f"Updated config: {config_path}")
        print(f"Updated lastUpdated: {updated_config['lastUpdated']}")

        if args.publish:
            publish_module = load_publish_module(publish_script_path)
            print("Publishing updated config...")
            publish_module.publish_config(
                config_path=config_path,
                object_name=publish_module.DEFAULT_OBJECT_NAME,
                dry_run=False,
            )

        return 0
    except Exception as error:  # pragma: no cover - CLI error path
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
