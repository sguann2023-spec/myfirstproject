#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Iterable, Mapping


DRAFT_DIR_NAME = "com.lveditor.draft"
CONFIG_KEY_DRAFT = "currentCustomDraftPath="
CONFIG_KEY_PRESET = "customPresetPath="
SHARED_CLIENT_CONFIG = ".scm/config.json"
WINDOWS_APP_NAME = "JianyingAssistant"


def first_existing_path(paths: Iterable[Path]) -> Path | None:
    for path in paths:
        if path.is_dir():
            return path
    return None


def load_json_file(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def candidate_global_setting_paths(home: Path) -> list[Path]:
    return [
        home / "Movies" / "JianyingPro" / "User Data" / "Config" / "globalSetting",
        home
        / "Library"
        / "Containers"
        / "com.lemon.lvpro"
        / "Data"
        / "Documents"
        / "JianyingPro"
        / "User Data"
        / "Config"
        / "globalSetting",
    ]


def candidate_global_setting_paths_windows(env: Mapping[str, str]) -> list[Path]:
    local_app_data = env.get("LOCALAPPDATA", "")
    if not local_app_data:
        return []

    return [
        Path(local_app_data) / "JianyingPro" / "User Data" / "Config" / "globalSetting",
    ]


def candidate_default_draft_paths_macos(home: Path) -> list[Path]:
    return [
        home / "Movies" / "JianyingPro" / "User Data" / "Projects" / DRAFT_DIR_NAME,
        home
        / "Library"
        / "Containers"
        / "com.lemon.lvpro"
        / "Data"
        / "Documents"
        / "JianyingPro"
        / "User Data"
        / "Projects"
        / DRAFT_DIR_NAME,
    ]


def candidate_default_preset_paths_macos(home: Path) -> list[Path]:
    return [
        home / "Movies" / "JianyingPro" / "User Data" / "Presets",
        home
        / "Library"
        / "Containers"
        / "com.lemon.lvpro"
        / "Data"
        / "Movies"
        / "JianyingPro"
        / "User Data"
        / "Presets",
    ]


def extract_setting_value(config_text: str, key: str) -> str | None:
    for raw_line in config_text.splitlines():
        line = raw_line.strip()
        if not line.startswith(key):
            continue

        value = line[len(key) :].strip()
        if not value:
            continue

        first_quote = value.find('"')
        last_quote = value.rfind('"')
        if first_quote != -1 and last_quote > first_quote:
            value = value[first_quote + 1 : last_quote]

        # Native code replaces "\\\\" with "\\" before expanding the path.
        value = value.replace("\\\\", "\\").strip()
        if value:
            return value

    return None


def extract_custom_draft_path(config_text: str) -> str | None:
    return extract_setting_value(config_text, CONFIG_KEY_DRAFT)


def extract_custom_preset_path(config_text: str) -> str | None:
    return extract_setting_value(config_text, CONFIG_KEY_PRESET)


def expand_user_path(raw_value: str, home: Path) -> Path:
    if raw_value == "~":
        return home
    if raw_value.startswith("~/") or raw_value.startswith("~\\"):
        suffix = raw_value[2:].replace("\\", "/")
        return home / suffix
    return Path(raw_value)


def config_value_candidate_paths(raw_value: str, home: Path) -> list[Path]:
    expanded = expand_user_path(raw_value, home)
    if expanded.name == DRAFT_DIR_NAME:
        return [expanded]
    return [expanded / DRAFT_DIR_NAME, expanded]


def detect_draft_path_from_global_setting(config_paths: Iterable[Path], home: Path) -> Path | None:
    for config_path in config_paths:
        try:
            config_text = config_path.read_text(encoding="utf-8")
        except OSError:
            continue

        raw_value = extract_custom_draft_path(config_text)
        if not raw_value:
            continue

        detected = first_existing_path(config_value_candidate_paths(raw_value, home))
        if detected is not None:
            return detected

    return None


def detect_preset_path_from_global_setting(config_paths: Iterable[Path], home: Path) -> Path | None:
    for config_path in config_paths:
        try:
            config_text = config_path.read_text(encoding="utf-8")
        except OSError:
            continue

        raw_value = extract_custom_preset_path(config_text)
        if not raw_value:
            continue

        detected = first_existing_path([expand_user_path(raw_value, home)])
        if detected is not None:
            return detected

    return None


def shared_client_config_path(home: Path) -> Path:
    return home / SHARED_CLIENT_CONFIG


def candidate_default_draft_paths_windows(home: Path, env: Mapping[str, str]) -> list[Path]:
    local_app_data = env.get("LOCALAPPDATA", "")
    candidates: list[Path] = []
    if local_app_data:
        candidates.append(
            Path(local_app_data)
            / "JianyingPro"
            / "User Data"
            / "Projects"
            / DRAFT_DIR_NAME
        )

    candidates.extend([
        Path(r"D:\JianyingPro Drafts"),
        home / "Documents" / "JianyingPro Drafts",
    ])
    return candidates


def candidate_default_preset_paths_windows(env: Mapping[str, str]) -> list[Path]:
    local_app_data = env.get("LOCALAPPDATA", "")
    if not local_app_data:
        return []

    return [
        Path(local_app_data) / "JianyingPro" / "User Data" / "Presets",
    ]


def candidate_gui_storage_files(env: Mapping[str, str]) -> list[Path]:
    local_app_data = env.get("LOCALAPPDATA", "")
    if not local_app_data:
        return []

    storage_dir = (
        Path(local_app_data)
        / "cn.ai-tools.jyzhushou"
        / "EBWebView"
        / "Default"
        / "Local Storage"
        / "leveldb"
    )
    if not storage_dir.is_dir():
        return []

    try:
        files = [
            path
            for path in storage_dir.iterdir()
            if path.suffix.lower() in {".log", ".ldb"} and path.is_file()
        ]
    except OSError:
        return []

    return sorted(files, key=lambda item: item.stat().st_mtime, reverse=True)[:12]


def detect_draft_root_from_gui_storage(env: Mapping[str, str]) -> Path | None:
    for file_path in candidate_gui_storage_files(env):
        try:
            text = file_path.read_bytes().decode("utf-8", errors="ignore")
        except OSError:
            continue

        text = text.replace("\x00", " ")
        matches = [
            *re.findall(r'draft_path[^"]*"([^"]+)"', text, flags=re.IGNORECASE),
            *re.findall(r'"([A-Z]:\\[^"]*(?:Drafts|JianyingPro)[^"]*)"', text, flags=re.IGNORECASE),
        ]
        for match in matches:
            candidate = Path(match.replace("\\\\", "\\"))
            if candidate.is_dir():
                return candidate

    return None


def cli_config_path(platform_name: str, home: Path, env: Mapping[str, str]) -> Path:
    if platform_name == "win32":
        base_dir = env.get("APPDATA") or str(home)
        return Path(base_dir) / WINDOWS_APP_NAME / "config.json"
    return home / ".jianying-assistant" / "config.json"


def load_cli_draft_root(platform_name: str, home: Path, env: Mapping[str, str], shared_data: dict[str, Any]) -> str:
    config_path = cli_config_path(platform_name, home, env)
    config_data = load_json_file(config_path)
    draft_root = str(config_data.get("draft_root", "") or "")
    if not draft_root:
        draft_root = str(shared_data.get("draftPath", "") or "")
    return draft_root


def detect_windows_draft_path(home: Path, env: Mapping[str, str]) -> Path | None:
    # 优先从 globalSetting 配置文件读取自定义草稿路径
    from_config = detect_draft_path_from_global_setting(candidate_global_setting_paths_windows(env), home)
    if from_config is not None:
        return from_config

    shared_data = load_json_file(shared_client_config_path(home))
    cli_draft_root = load_cli_draft_root("win32", home, env, shared_data)

    candidates: list[Path] = []
    gui_storage_path = detect_draft_root_from_gui_storage(env)
    if gui_storage_path is not None:
        candidates.append(gui_storage_path)

    shared_draft_path = str(shared_data.get("draftPath", "") or "").strip()
    if shared_draft_path:
        candidates.append(expand_user_path(shared_draft_path, home))

    if cli_draft_root:
        candidates.append(expand_user_path(cli_draft_root, home))

    candidates.extend(candidate_default_draft_paths_windows(home, env))

    detected = first_existing_path(candidates)
    if detected is not None:
        return detected

    local_app_data = env.get("LOCALAPPDATA", "")
    if not local_app_data:
        return None

    return (
        Path(local_app_data)
        / "JianyingPro"
        / "User Data"
        / "Projects"
        / DRAFT_DIR_NAME
    )


def detect_jianying_preset_path(
    home: Path | None = None,
    *,
    platform_name: str | None = None,
    env: Mapping[str, str] | None = None,
) -> Path | None:
    home = (home or Path.home()).expanduser()
    platform_name = platform_name or sys.platform
    env = env or os.environ

    if platform_name == "win32":
        from_config = detect_preset_path_from_global_setting(candidate_global_setting_paths_windows(env), home)
        if from_config is not None:
            return from_config
        return first_existing_path(candidate_default_preset_paths_windows(env))

    from_config = detect_preset_path_from_global_setting(candidate_global_setting_paths(home), home)
    if from_config is not None:
        return from_config

    return first_existing_path(candidate_default_preset_paths_macos(home))


def detect_jianying_draft_path(
    home: Path | None = None,
    *,
    platform_name: str | None = None,
    env: Mapping[str, str] | None = None,
) -> Path | None:
    home = (home or Path.home()).expanduser()
    platform_name = platform_name or sys.platform
    env = env or os.environ

    custom = (
        env.get("JY_CLIENT_DRAFT_PATH")
        or env.get("JIANYING_DRAFT_ROOT")
        or env.get("JIANYING_PROJECT_ROOT")
    )
    if custom:
        return expand_user_path(custom, home)

    if platform_name == "win32":
        return detect_windows_draft_path(home, env)

    from_config = detect_draft_path_from_global_setting(candidate_global_setting_paths(home), home)
    if from_config is not None:
        return from_config

    return first_existing_path(candidate_default_draft_paths_macos(home))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Detect Jianying draft path with the same method as 剪映小助手's native detect_draft_paths."
    )
    parser.add_argument(
        "--home",
        type=Path,
        default=Path.home(),
        help="Override HOME for testing.",
    )
    parser.add_argument(
        "--platform",
        choices=["auto", "darwin", "win32"],
        default="auto",
        help="Override target platform for testing.",
    )
    parser.add_argument(
        "--target",
        choices=["draft", "preset", "both"],
        default="draft",
        help="Select which path to detect.",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Print candidate paths while detecting.",
    )
    args = parser.parse_args()

    home = args.home.expanduser()
    platform_name = sys.platform if args.platform == "auto" else args.platform
    if args.debug:
        print(f"platform: {platform_name}")
        if platform_name == "win32":
            print("preset globalSetting candidates:")
            for path in candidate_global_setting_paths_windows(os.environ):
                print(f"  - {path}")
            print("gui storage files:")
            for path in candidate_gui_storage_files(os.environ):
                print(f"  - {path}")
            print("default draft candidates:")
            for path in candidate_default_draft_paths_windows(home, os.environ):
                print(f"  - {path}")
            print("default preset candidates:")
            for path in candidate_default_preset_paths_windows(os.environ):
                print(f"  - {path}")
        else:
            print("globalSetting candidates:")
            for path in candidate_global_setting_paths(home):
                print(f"  - {path}")
            print("default draft candidates:")
            for path in candidate_default_draft_paths_macos(home):
                print(f"  - {path}")
            print("default preset candidates:")
            for path in candidate_default_preset_paths_macos(home):
                print(f"  - {path}")

    draft_path = detect_jianying_draft_path(home, platform_name=platform_name)
    preset_path = detect_jianying_preset_path(home, platform_name=platform_name)

    if args.target == "draft":
        if draft_path is None:
            return 1
        print(draft_path)
        return 0

    if args.target == "preset":
        if preset_path is None:
            return 1
        print(preset_path)
        return 0

    if draft_path is None and preset_path is None:
        return 1

    payload = {
        "draft_path": str(draft_path) if draft_path is not None else "",
        "preset_path": str(preset_path) if preset_path is not None else "",
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
