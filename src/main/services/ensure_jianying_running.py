#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Iterable

try:
    import winreg  # type: ignore
except ImportError:
    winreg = None


APP_CHOICES = ("auto", "jianying", "capcut")

MAC_APP_CANDIDATES = {
    "jianying": [
        "/Applications/JianyingPro.app",
        "/Applications/剪映专业版.app",
        "/Applications/VideoFusion-macOS.app",
        str(Path.home() / "Applications" / "JianyingPro.app"),
        str(Path.home() / "Applications" / "剪映专业版.app"),
        str(Path.home() / "Applications" / "VideoFusion-macOS.app"),
        "/Applications/JianyingPro.app/Contents/MacOS/JianyingPro",
        "/Applications/VideoFusion-macOS.app/Contents/MacOS/VideoFusion-macOS",
    ],
    "capcut": [
        "/Applications/CapCut.app",
        str(Path.home() / "Applications" / "CapCut.app"),
        "/Applications/CapCut.app/Contents/MacOS/CapCut",
    ],
}

WINDOWS_EXE_CANDIDATES = {
    "jianying": [
        r"C:\Program Files\JianyingPro\JianyingPro.exe",
        r"C:\Program Files (x86)\JianyingPro\JianyingPro.exe",
        r"D:\JianyingPro\JianyingPro.exe",
        r"D:\JianyingPro_high\JianyingPro.exe",
    ],
    "capcut": [
        r"C:\Program Files\CapCut\CapCut.exe",
        r"C:\Program Files (x86)\CapCut\CapCut.exe",
        r"D:\CapCut\CapCut.exe",
    ],
}

WINDOWS_EXE_NAMES = {
    "jianying": ["JianyingPro.exe"],
    "capcut": ["CapCut.exe"],
}


def _expand_path(path: str) -> str:
    return os.path.abspath(os.path.expanduser((path or "").strip().strip('"')))


def _normalize_app_choice(app: str) -> str:
    value = (app or "auto").strip().lower()
    return value if value in APP_CHOICES else "auto"


def _candidate_apps(app: str) -> list[str]:
    normalized = _normalize_app_choice(app)
    if normalized == "auto":
        return ["jianying", "capcut"]
    return [normalized]


def _windows_exe_names(app: str) -> list[str]:
    names: list[str] = []
    for candidate_app in _candidate_apps(app):
        names.extend(WINDOWS_EXE_NAMES[candidate_app])
    return _unique(names)


def _mac_app_candidates(app: str) -> list[str]:
    candidates: list[str] = []
    for candidate_app in _candidate_apps(app):
        candidates.extend(MAC_APP_CANDIDATES[candidate_app])
    return _unique(candidates)


def _windows_exe_candidates(app: str) -> list[str]:
    candidates: list[str] = []
    for candidate_app in _candidate_apps(app):
        candidates.extend(WINDOWS_EXE_CANDIDATES[candidate_app])
    return _unique(candidates)


def _normalize_existing_dir(path: str) -> str:
    resolved = _expand_path(path)
    return resolved if os.path.isdir(resolved) else ""


def _normalize_existing_file(path: str, app: str = "auto") -> str:
    resolved = _expand_path(path)
    if sys.platform == "darwin":
        if os.path.isdir(resolved) and resolved.endswith(".app"):
            return resolved
        return resolved if os.path.isfile(resolved) else ""

    if not os.path.isfile(resolved):
        return ""
    allowed = {name.lower() for name in _windows_exe_names(app)}
    if os.path.basename(resolved).lower() not in allowed:
        return ""
    return resolved


def _unique(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        if item and item not in seen:
            result.append(item)
            seen.add(item)
    return result


def _run_command(command: list[str], timeout: float = 10.0) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore",
        timeout=timeout,
        check=False,
    )


def _macos_app_name(executable: str = "", app: str = "auto") -> str:
    explicit = str(os.environ.get("JY_CLIENT_MAC_APP_NAME", "") or "").strip()
    if explicit:
        return explicit
    candidate = executable or detect_jianying_executable(app=app)
    if candidate:
        name = os.path.basename(candidate.rstrip("/"))
        if name.endswith(".app"):
            return name[:-4]
        if name:
            return name
    return "CapCut" if _normalize_app_choice(app) == "capcut" else "JianyingPro"


def _macos_process_names(executable: str = "", app: str = "auto") -> list[str]:
    explicit = str(os.environ.get("JY_CLIENT_MAC_PROCESS_NAME", "") or "").strip()
    names = [explicit] if explicit else []
    names.append(_macos_app_name(executable, app=app))
    if _normalize_app_choice(app) in {"auto", "jianying"}:
        names.extend(["JianyingPro", "剪映专业版", "VideoFusion-macOS"])
    if _normalize_app_choice(app) in {"auto", "capcut"}:
        names.append("CapCut")
    return _unique(names)


def _macos_jianying_pids(executable: str = "", app: str = "auto") -> list[int]:
    current_pid = os.getpid()
    parent_pid = os.getppid()
    pids: list[int] = []

    for name in _macos_process_names(executable, app=app):
        for matcher in ("-x", "-f"):
            try:
                result = _run_command(["pgrep", matcher, name], timeout=5)
            except Exception:
                continue
            if result.returncode != 0:
                continue
            for line in result.stdout.splitlines():
                try:
                    pid = int(line.strip())
                except Exception:
                    continue
                if pid in (current_pid, parent_pid) or pid in pids:
                    continue
                pids.append(pid)

    return pids


def _detect_from_running_process(app: str = "auto") -> str:
    if sys.platform != "win32":
        return ""

    for exe_name in _windows_exe_names(app):
        command = (
            f"Get-CimInstance Win32_Process -Filter \"Name = '{exe_name}'\" "
            "| Where-Object { $_.ExecutablePath } "
            "| Select-Object -First 1 -ExpandProperty ExecutablePath"
        )
        try:
            result = _run_command(["powershell", "-NoProfile", "-Command", command], timeout=10)
        except Exception:
            continue

        for line in result.stdout.splitlines():
            normalized = _normalize_existing_file(line, app=app)
            if normalized:
                return normalized
    return ""


def _jianying_exe_paths_under(root: str, app: str = "auto", max_depth: int = 3) -> list[str]:
    resolved_root = _normalize_existing_dir(root)
    if not resolved_root:
        return []

    root_depth = resolved_root.rstrip("\\/").count(os.sep)
    matches: list[str] = []
    target_names = set(_windows_exe_names(app))
    try:
        for current, dirs, files in os.walk(resolved_root):
            for exe_name in target_names:
                if exe_name in files:
                    matches.append(os.path.join(current, exe_name))
            depth = current.rstrip("\\/").count(os.sep) - root_depth
            if depth >= max_depth:
                dirs[:] = []
    except Exception:
        return []

    matches.sort(key=lambda item: os.path.getmtime(item), reverse=True)
    return matches


def _detect_from_registry(app: str = "auto") -> str:
    if sys.platform != "win32" or winreg is None:
        return ""

    registry_roots = [
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    ]

    for root, subkey in registry_roots:
        try:
            with winreg.OpenKey(root, subkey) as uninstall_root:
                child_count = winreg.QueryInfoKey(uninstall_root)[0]
                for index in range(child_count):
                    try:
                        child_name = winreg.EnumKey(uninstall_root, index)
                        with winreg.OpenKey(uninstall_root, child_name) as item_key:
                            try:
                                display_name = str(winreg.QueryValueEx(item_key, "DisplayName")[0])
                            except OSError:
                                continue

                            lowered = display_name.lower()
                            app_matches = (
                                ("剪映" in display_name or "jianying" in lowered)
                                if _normalize_app_choice(app) == "jianying"
                                else ("capcut" in lowered)
                                if _normalize_app_choice(app) == "capcut"
                                else ("剪映" in display_name or "jianying" in lowered or "capcut" in lowered)
                            )
                            if not app_matches:
                                continue
                            if "assistant" in lowered or "小助手" in display_name:
                                continue

                            for value_name in ("DisplayIcon", "InstallLocation", "UninstallString"):
                                try:
                                    value = str(winreg.QueryValueEx(item_key, value_name)[0])
                                except OSError:
                                    continue

                                candidate = value.split(",", 1)[0].strip().strip('"')
                                candidates = [candidate]
                                if value_name == "InstallLocation":
                                    for exe_name in _windows_exe_names(app):
                                        candidates.append(os.path.join(candidate, exe_name))
                                if os.path.basename(candidate).lower() in {"uninst.exe", "uninstall.exe"}:
                                    candidates.extend(
                                        _jianying_exe_paths_under(os.path.dirname(candidate), app=app, max_depth=2)
                                    )

                                for raw_candidate in candidates:
                                    normalized = _normalize_existing_file(raw_candidate, app=app)
                                    if normalized:
                                        return normalized
                    except OSError:
                        continue
        except OSError:
            continue

    return ""


def _detect_from_known_app_dirs(app: str = "auto") -> str:
    if sys.platform != "win32":
        return ""

    roots: list[str] = []
    if _normalize_app_choice(app) in {"auto", "jianying"}:
        roots.extend([
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "JianyingPro", "Apps"),
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "JianyingPro"),
            os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "JianyingPro"),
            os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), "JianyingPro"),
        ])
    if _normalize_app_choice(app) in {"auto", "capcut"}:
        roots.extend([
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "CapCut", "Apps"),
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "CapCut"),
            os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "CapCut"),
            os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), "CapCut"),
        ])
    for root in roots:
        for candidate in _jianying_exe_paths_under(root, app=app, max_depth=3):
            normalized = _normalize_existing_file(candidate, app=app)
            if normalized:
                return normalized
    return ""


def detect_jianying_executable(app: str = "auto") -> str:
    candidates = [
        os.environ.get("JY_CLIENT_JIANYING_EXE", ""),
        os.environ.get("CLOUD_RENDER_JIANYING_EXE", ""),
        os.environ.get("JIANYING_EXE", ""),
        os.environ.get("JIANYING_PATH", ""),
        os.environ.get("CAPCUT_EXE", ""),
        os.environ.get("CAPCUT_PATH", ""),
    ]

    if sys.platform == "darwin":
        candidates.extend(_mac_app_candidates(app))
    elif sys.platform == "win32":
        candidates.extend(
            [
                _detect_from_running_process(app=app),
                _detect_from_registry(app=app),
                _detect_from_known_app_dirs(app=app),
                os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "JianyingPro", "JianyingPro.exe"),
                os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "CapCut", "CapCut.exe"),
                *_windows_exe_candidates(app),
            ]
        )

    for candidate in candidates:
        normalized = _normalize_existing_file(candidate, app=app)
        if normalized:
            return normalized
    return ""


def is_jianying_running(executable: str = "", app: str = "auto") -> bool:
    if sys.platform == "darwin":
        return bool(_macos_jianying_pids(executable, app=app))

    if sys.platform != "win32":
        return False

    try:
        for exe_name in _windows_exe_names(app):
            result = _run_command(["tasklist", "/FI", f"IMAGENAME eq {exe_name}"], timeout=10)
            if exe_name in result.stdout:
                return True
        return False
    except Exception:
        return False


def _macos_activate_app(executable: str, app: str = "auto") -> None:
    if executable:
        if os.path.isdir(executable) and executable.endswith(".app"):
            subprocess.run(["open", executable], check=False, timeout=20)
        else:
            subprocess.Popen(
                [executable],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL,
            )
        subprocess.run(
            ["osascript", "-e", f'tell application "{_macos_app_name(executable, app=app)}" to activate'],
            check=False,
            timeout=10,
        )
        return

    subprocess.run(["open", "-a", _macos_app_name(executable, app=app)], check=False, timeout=20)
    subprocess.run(
        ["osascript", "-e", f'tell application "{_macos_app_name(executable, app=app)}" to activate'],
        check=False,
        timeout=10,
    )


def _macos_wait_window_ready(timeout: int, executable: str = "", app: str = "auto") -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        for process_name in _macos_process_names(executable, app=app):
            script = (
                'tell application "System Events"\n'
                f'  if exists process "{process_name}" then\n'
                f'    tell process "{process_name}"\n'
                '      set frontmost to true\n'
                '      if (count of windows) > 0 then return "ready"\n'
                '    end tell\n'
                '  end if\n'
                'end tell'
            )
            try:
                result = _run_command(["osascript", "-e", script], timeout=5)
                if result.returncode == 0 and "ready" in result.stdout:
                    return True
            except Exception:
                continue
        time.sleep(0.5)
    return False


def _macos_frontmost_app_name() -> str:
    try:
        result = _run_command(
            [
                "osascript",
                "-e",
                'tell application "System Events" to get name of first application process whose frontmost is true',
            ],
            timeout=5,
        )
    except Exception:
        return ""

    if result.returncode != 0:
        return ""
    return (result.stdout or "").strip()


def _macos_is_frontmost(executable: str = "", app: str = "auto") -> bool:
    frontmost_name = _macos_frontmost_app_name()
    if not frontmost_name:
        return False
    return frontmost_name in _macos_process_names(executable, app=app)


def _macos_wait_frontmost(timeout: int, executable: str = "", app: str = "auto") -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _macos_is_frontmost(executable, app=app):
            return True
        time.sleep(0.5)
    return _macos_is_frontmost(executable, app=app)


def _windows_wait_window_ready(timeout: int, app: str = "auto") -> bool:
    try:
        import uiautomation as uia  # type: ignore
    except Exception:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if is_jianying_running(app=app):
                return True
            time.sleep(0.5)
        return False

    def _window_ready(window: Any) -> bool:
        try:
            name = getattr(window, "Name", "") or ""
            class_name = getattr(window, "ClassName", "") or ""
            lowered_name = name.lower()
            if _normalize_app_choice(app) == "capcut":
                if "capcut" not in lowered_name:
                    return False
            elif _normalize_app_choice(app) == "jianying":
                if name != "剪映专业版":
                    return False
            else:
                if name != "剪映专业版" and "capcut" not in lowered_name:
                    return False
            lowered = class_name.lower()
            if "homepage" in lowered or "mainwindow" in lowered:
                return True

            try:
                draft_title = window.TextControl(
                    searchDepth=4,
                    Compare=lambda ctrl, depth: depth <= 4
                    and "homepagedrafttitle:" in str(ctrl.GetPropertyValue(30159) or "").lower(),
                )
                if draft_title.Exists(0.1):
                    return True
            except Exception:
                pass

            try:
                export_btn = window.TextControl(
                    searchDepth=3,
                    Compare=lambda ctrl, depth: depth <= 3
                    and "mainwindowtitlebarexportbtn" in str(ctrl.GetPropertyValue(30159) or "").lower(),
                )
                if export_btn.Exists(0.1):
                    return True
            except Exception:
                pass
        except Exception:
            return False
        return False

    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            for window in uia.GetRootControl().GetChildren():
                if _window_ready(window):
                    return True
        except Exception:
            pass
        time.sleep(0.5)
    return False


def wait_jianying_ready(timeout: int = 60, executable: str = "", app: str = "auto") -> bool:
    if sys.platform == "darwin":
        return _macos_wait_window_ready(timeout, executable, app=app)
    if sys.platform == "win32":
        return _windows_wait_window_ready(timeout, app=app)
    return False


def ensure_jianying_running(timeout: int = 60, app: str = "auto") -> dict[str, Any]:
    app = _normalize_app_choice(app)
    executable = detect_jianying_executable(app=app)

    if sys.platform not in {"darwin", "win32"}:
        return {
            "success": False,
            "code": "PLATFORM_NOT_SUPPORTED",
            "error": f"Unsupported platform: {sys.platform}",
            "platform": sys.platform,
            "jianying_exe": executable,
        }

    if is_jianying_running(executable, app=app):
        if sys.platform == "darwin":
            _macos_activate_app(executable, app=app)
            frontmost = _macos_wait_frontmost(timeout=min(timeout, 15), executable=executable, app=app)
            ready = wait_jianying_ready(timeout=3, executable=executable, app=app) if frontmost else False
            action = "activate_existing_process"
        else:
            frontmost = False
            ready = wait_jianying_ready(timeout=min(timeout, 15), executable=executable, app=app)
            action = "reuse_existing_process"
        return {
            "success": True,
            "running": True,
            "app": app,
            "frontmost": frontmost,
            "window_ready": ready,
            "platform": sys.platform,
            "action": action,
            "jianying_exe": executable,
        }

    if not executable:
        return {
            "success": False,
            "code": "JIANYING_NOT_INSTALLED",
            "error": "未检测到剪映安装路径",
            "platform": sys.platform,
            "jianying_exe": "",
        }

    try:
        if sys.platform == "darwin":
            _macos_activate_app(executable, app=app)
            action = "open_or_activate_app"
        else:
            subprocess.Popen([executable], shell=True)
            action = "spawn_executable"
    except Exception as exc:
        return {
            "success": False,
            "code": "JIANYING_START_FAILED",
            "error": str(exc),
            "platform": sys.platform,
            "jianying_exe": executable,
        }

    deadline = time.time() + timeout
    while time.time() < deadline:
        if is_jianying_running(executable, app=app):
            if sys.platform == "darwin":
                frontmost = _macos_wait_frontmost(timeout=3, executable=executable, app=app)
                ready = wait_jianying_ready(timeout=3, executable=executable, app=app) if frontmost else False
                success = frontmost
            else:
                frontmost = False
                ready = wait_jianying_ready(timeout=min(timeout, 20), executable=executable, app=app)
                success = True
            return {
                "success": True if sys.platform == "darwin" else success,
                "running": True,
                "app": app,
                "frontmost": frontmost,
                "window_ready": ready,
                "platform": sys.platform,
                "action": action,
                "jianying_exe": executable,
            }
        time.sleep(1)

    return {
        "success": False,
        "code": "JIANYING_START_TIMEOUT",
        "error": f"剪映启动超时（{timeout}秒）",
        "platform": sys.platform,
        "jianying_exe": executable,
    }


def stop_jianying(timeout: int = 20, app: str = "auto") -> dict[str, Any]:
    app = _normalize_app_choice(app)
    executable = detect_jianying_executable(app=app)
    if not is_jianying_running(executable, app=app):
        return {
            "success": True,
            "running": False,
            "app": app,
            "platform": sys.platform,
            "action": "already_stopped",
            "jianying_exe": executable,
        }

    try:
        if sys.platform == "darwin":
            pids = _macos_jianying_pids(executable, app=app)
            for pid in pids:
                try:
                    os.kill(pid, signal.SIGTERM)
                except OSError:
                    continue
        elif sys.platform == "win32":
            for exe_name in _windows_exe_names(app):
                subprocess.run(
                    ["taskkill", "/IM", exe_name, "/T"],
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
        else:
            return {
                "success": False,
                "code": "PLATFORM_NOT_SUPPORTED",
                "error": f"Unsupported platform: {sys.platform}",
                "platform": sys.platform,
                "jianying_exe": executable,
            }
    except Exception as exc:
        return {
            "success": False,
            "code": "JIANYING_STOP_FAILED",
            "error": str(exc),
            "platform": sys.platform,
            "jianying_exe": executable,
        }

    deadline = time.time() + timeout
    while time.time() < deadline:
        if not is_jianying_running(executable, app=app):
            return {
                "success": True,
                "running": False,
                "app": app,
                "platform": sys.platform,
                "action": "stopped",
                "jianying_exe": executable,
            }
        time.sleep(0.5)

    return {
        "success": False,
        "code": "JIANYING_STOP_TIMEOUT",
        "error": f"剪映关闭超时（{timeout}秒）",
        "platform": sys.platform,
        "jianying_exe": executable,
    }


def get_status(app: str = "auto") -> dict[str, Any]:
    app = _normalize_app_choice(app)
    executable = detect_jianying_executable(app=app)
    running = is_jianying_running(executable, app=app)
    frontmost = _macos_is_frontmost(executable, app=app) if running and sys.platform == "darwin" else False
    return {
        "success": True,
        "app": app,
        "platform": sys.platform,
        "running": running,
        "frontmost": frontmost,
        "window_ready": wait_jianying_ready(timeout=3, executable=executable, app=app) if running else False,
        "jianying_exe": executable,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Ensure Jianying/CapCut desktop app is running on macOS or Windows."
    )
    parser.add_argument(
        "command",
        choices=["status", "ensure", "stop"],
        nargs="?",
        default="ensure",
        help="Select the runtime action.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=60,
        help="How many seconds to wait for the app state to settle.",
    )
    parser.add_argument(
        "--app",
        choices=list(APP_CHOICES),
        default="auto",
        help="Choose which app to target: Jianying or CapCut.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print JSON only.",
    )
    args = parser.parse_args()

    if args.command == "status":
        result = get_status(app=args.app)
    elif args.command == "stop":
        result = stop_jianying(timeout=args.timeout, app=args.app)
    else:
        result = ensure_jianying_running(timeout=args.timeout, app=args.app)

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
