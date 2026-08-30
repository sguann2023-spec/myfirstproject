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


MAC_APP_CANDIDATES = [
    "/Applications/JianyingPro.app",
    "/Applications/剪映专业版.app",
    "/Applications/VideoFusion-macOS.app",
    "/Applications/CapCut.app",
    str(Path.home() / "Applications" / "JianyingPro.app"),
    str(Path.home() / "Applications" / "剪映专业版.app"),
    str(Path.home() / "Applications" / "VideoFusion-macOS.app"),
    str(Path.home() / "Applications" / "CapCut.app"),
    "/Applications/JianyingPro.app/Contents/MacOS/JianyingPro",
    "/Applications/VideoFusion-macOS.app/Contents/MacOS/VideoFusion-macOS",
    "/Applications/CapCut.app/Contents/MacOS/CapCut",
]

WINDOWS_EXE_CANDIDATES = [
    r"C:\Program Files\JianyingPro\JianyingPro.exe",
    r"C:\Program Files (x86)\JianyingPro\JianyingPro.exe",
    r"D:\JianyingPro\JianyingPro.exe",
    r"D:\JianyingPro_high\JianyingPro.exe",
]


def _expand_path(path: str) -> str:
    return os.path.abspath(os.path.expanduser((path or "").strip().strip('"')))


def _normalize_existing_dir(path: str) -> str:
    resolved = _expand_path(path)
    return resolved if os.path.isdir(resolved) else ""


def _normalize_existing_file(path: str) -> str:
    resolved = _expand_path(path)
    if sys.platform == "darwin":
        if os.path.isdir(resolved) and resolved.endswith(".app"):
            return resolved
        return resolved if os.path.isfile(resolved) else ""

    if not os.path.isfile(resolved):
        return ""
    if os.path.basename(resolved).lower() != "jianyingpro.exe":
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


def _macos_app_name(executable: str = "") -> str:
    explicit = str(os.environ.get("JY_CLIENT_MAC_APP_NAME", "") or "").strip()
    if explicit:
        return explicit
    candidate = executable or detect_jianying_executable()
    if candidate:
        name = os.path.basename(candidate.rstrip("/"))
        if name.endswith(".app"):
            return name[:-4]
        if name:
            return name
    return "JianyingPro"


def _macos_process_names(executable: str = "") -> list[str]:
    explicit = str(os.environ.get("JY_CLIENT_MAC_PROCESS_NAME", "") or "").strip()
    names = [explicit] if explicit else []
    names.extend(
        [
            _macos_app_name(executable),
            "JianyingPro",
            "剪映专业版",
            "VideoFusion-macOS",
            "CapCut",
        ]
    )
    return _unique(names)


def _macos_jianying_pids(executable: str = "") -> list[int]:
    current_pid = os.getpid()
    parent_pid = os.getppid()
    pids: list[int] = []

    for name in _macos_process_names(executable):
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


def _detect_from_running_process() -> str:
    if sys.platform != "win32":
        return ""

    command = (
        "Get-CimInstance Win32_Process -Filter \"Name = 'JianyingPro.exe'\" "
        "| Where-Object { $_.ExecutablePath } "
        "| Select-Object -First 1 -ExpandProperty ExecutablePath"
    )
    try:
        result = _run_command(["powershell", "-NoProfile", "-Command", command], timeout=10)
    except Exception:
        return ""

    for line in result.stdout.splitlines():
        normalized = _normalize_existing_file(line)
        if normalized:
            return normalized
    return ""


def _jianying_exe_paths_under(root: str, max_depth: int = 3) -> list[str]:
    resolved_root = _normalize_existing_dir(root)
    if not resolved_root:
        return []

    root_depth = resolved_root.rstrip("\\/").count(os.sep)
    matches: list[str] = []
    try:
        for current, dirs, files in os.walk(resolved_root):
            if "JianyingPro.exe" in files:
                matches.append(os.path.join(current, "JianyingPro.exe"))
            depth = current.rstrip("\\/").count(os.sep) - root_depth
            if depth >= max_depth:
                dirs[:] = []
    except Exception:
        return []

    matches.sort(key=lambda item: os.path.getmtime(item), reverse=True)
    return matches


def _detect_from_registry() -> str:
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
                            if "剪映" not in display_name and "jianying" not in lowered:
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
                                    candidates.append(os.path.join(candidate, "JianyingPro.exe"))
                                if os.path.basename(candidate).lower() in {"uninst.exe", "uninstall.exe"}:
                                    candidates.extend(
                                        _jianying_exe_paths_under(os.path.dirname(candidate), max_depth=2)
                                    )

                                for raw_candidate in candidates:
                                    normalized = _normalize_existing_file(raw_candidate)
                                    if normalized:
                                        return normalized
                    except OSError:
                        continue
        except OSError:
            continue

    return ""


def _detect_from_known_app_dirs() -> str:
    if sys.platform != "win32":
        return ""

    roots = [
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "JianyingPro", "Apps"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "JianyingPro"),
        os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "JianyingPro"),
        os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), "JianyingPro"),
    ]
    for root in roots:
        for candidate in _jianying_exe_paths_under(root, max_depth=3):
            normalized = _normalize_existing_file(candidate)
            if normalized:
                return normalized
    return ""


def detect_jianying_executable() -> str:
    candidates = [
        os.environ.get("JY_CLIENT_JIANYING_EXE", ""),
        os.environ.get("CLOUD_RENDER_JIANYING_EXE", ""),
        os.environ.get("JIANYING_EXE", ""),
        os.environ.get("JIANYING_PATH", ""),
    ]

    if sys.platform == "darwin":
        candidates.extend(MAC_APP_CANDIDATES)
    elif sys.platform == "win32":
        candidates.extend(
            [
                _detect_from_running_process(),
                _detect_from_registry(),
                _detect_from_known_app_dirs(),
                os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "JianyingPro", "JianyingPro.exe"),
                *WINDOWS_EXE_CANDIDATES,
            ]
        )

    for candidate in candidates:
        normalized = _normalize_existing_file(candidate)
        if normalized:
            return normalized
    return ""


def is_jianying_running(executable: str = "") -> bool:
    if sys.platform == "darwin":
        return bool(_macos_jianying_pids(executable))

    if sys.platform != "win32":
        return False

    try:
        result = _run_command(["tasklist", "/FI", "IMAGENAME eq JianyingPro.exe"], timeout=10)
        return "JianyingPro.exe" in result.stdout
    except Exception:
        return False


def _macos_activate_app(executable: str) -> None:
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
            ["osascript", "-e", f'tell application "{_macos_app_name(executable)}" to activate'],
            check=False,
            timeout=10,
        )
        return

    subprocess.run(["open", "-a", _macos_app_name(executable)], check=False, timeout=20)
    subprocess.run(
        ["osascript", "-e", f'tell application "{_macos_app_name(executable)}" to activate'],
        check=False,
        timeout=10,
    )


def _macos_wait_window_ready(timeout: int, executable: str = "") -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        for process_name in _macos_process_names(executable):
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


def _macos_is_frontmost(executable: str = "") -> bool:
    frontmost_name = _macos_frontmost_app_name()
    if not frontmost_name:
        return False
    return frontmost_name in _macos_process_names(executable)


def _macos_wait_frontmost(timeout: int, executable: str = "") -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _macos_is_frontmost(executable):
            return True
        time.sleep(0.5)
    return _macos_is_frontmost(executable)


def _windows_wait_window_ready(timeout: int) -> bool:
    try:
        import uiautomation as uia  # type: ignore
    except Exception:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if is_jianying_running():
                return True
            time.sleep(0.5)
        return False

    def _window_ready(window: Any) -> bool:
        try:
            name = getattr(window, "Name", "") or ""
            class_name = getattr(window, "ClassName", "") or ""
            if name != "剪映专业版":
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


def wait_jianying_ready(timeout: int = 60, executable: str = "") -> bool:
    if sys.platform == "darwin":
        return _macos_wait_window_ready(timeout, executable)
    if sys.platform == "win32":
        return _windows_wait_window_ready(timeout)
    return False


def _win32_bring_to_frontmost(timeout: float = 5.0) -> bool:
    """Bring the Jianying window to the foreground on Windows."""
    try:
        import ctypes
        import ctypes.wintypes
    except ImportError:
        return False

    user32 = ctypes.windll.user32
    if not user32:
        return False

    # Try common window titles for Jianying (prioritize "JianyingPro" as it's the main window)
    window_titles = ["JianyingPro", "剪映专业版", "剪映"]
    hwnd = 0
    for title in window_titles:
        hwnd = user32.FindWindowW(None, title)
        if hwnd:
            break

    if not hwnd:
        # Fallback: enumerate top-level windows to find Jianying
        import ctypes.wintypes

        EnumWindows = user32.EnumWindows
        EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)
        GetWindowTextW = user32.GetWindowTextW
        GetWindowTextLengthW = user32.GetWindowTextLengthW
        IsWindowVisible = user32.IsWindowVisible

        found_hwnd = [0]

        def _enum_callback(hwnd_val, _lparam):
            if not IsWindowVisible(hwnd_val):
                return True
            length = GetWindowTextLengthW(hwnd_val)
            if length == 0:
                return True
            buf = ctypes.create_unicode_buffer(length + 1)
            GetWindowTextW(hwnd_val, buf, length + 1)
            title_text = buf.value
            if "剪映" in title_text or "jianying" in title_text.lower():
                found_hwnd[0] = hwnd_val
                return False  # stop enumeration
            return True

        EnumWindows(EnumWindowsProc(_enum_callback), 0)
        hwnd = found_hwnd[0]

    if not hwnd:
        return False

    SW_RESTORE = 9

    # Restore window if minimized
    user32.ShowWindow(hwnd, SW_RESTORE)
    time.sleep(0.1)

    # Windows restricts SetForegroundWindow to the foreground process.
    # Use the SendInput Alt-key trick to bypass this restriction:
    # simulating an Alt key press/release makes Windows think the user is interacting,
    # which allows SetForegroundWindow to succeed.
    INPUT_KEYBOARD = 1
    KEYEVENTF_KEYUP = 0x0002
    VK_MENU = 0x12  # Alt key

    class _KEYBDINPUT(ctypes.Structure):
        _fields_ = [
            ("wVk", ctypes.wintypes.WORD),
            ("wScan", ctypes.wintypes.WORD),
            ("dwFlags", ctypes.wintypes.DWORD),
            ("time", ctypes.wintypes.DWORD),
            ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
        ]

    class _MOUSEINPUT(ctypes.Structure):
        _fields_ = [
            ("dx", ctypes.c_long),
            ("dy", ctypes.c_long),
            ("mouseData", ctypes.wintypes.DWORD),
            ("dwFlags", ctypes.wintypes.DWORD),
            ("time", ctypes.wintypes.DWORD),
            ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
        ]

    class _HARDWAREINPUT(ctypes.Structure):
        _fields_ = [
            ("uMsg", ctypes.wintypes.DWORD),
            ("wParamLo", ctypes.wintypes.WORD),
            ("wParamHi", ctypes.wintypes.WORD),
        ]

    class _INPUTUNION(ctypes.Union):
        _fields_ = [("ki", _KEYBDINPUT), ("mi", _MOUSEINPUT), ("hi", _HARDWAREINPUT)]

    class _INPUT(ctypes.Structure):
        _fields_ = [("type", ctypes.wintypes.DWORD), ("union", _INPUTUNION)]

    # Press Alt
    inp_down = _INPUT()
    inp_down.type = INPUT_KEYBOARD
    inp_down.union.ki.wVk = VK_MENU
    inp_down.union.ki.dwFlags = 0
    user32.SendInput(1, ctypes.byref(inp_down), ctypes.sizeof(_INPUT))

    # Release Alt
    inp_up = _INPUT()
    inp_up.type = INPUT_KEYBOARD
    inp_up.union.ki.wVk = VK_MENU
    inp_up.union.ki.dwFlags = KEYEVENTF_KEYUP
    user32.SendInput(1, ctypes.byref(inp_up), ctypes.sizeof(_INPUT))

    time.sleep(0.1)

    # Now SetForegroundWindow should succeed
    user32.SetForegroundWindow(hwnd)
    user32.BringWindowToTop(hwnd)
    time.sleep(0.3)

    # Verify it's the foreground window
    deadline = time.time() + timeout
    while time.time() < deadline:
        if user32.GetForegroundWindow() == hwnd:
            return True
        # Retry with Alt trick
        inp_down2 = _INPUT()
        inp_down2.type = INPUT_KEYBOARD
        inp_down2.union.ki.wVk = VK_MENU
        inp_down2.union.ki.dwFlags = 0
        user32.SendInput(1, ctypes.byref(inp_down2), ctypes.sizeof(_INPUT))
        inp_up2 = _INPUT()
        inp_up2.type = INPUT_KEYBOARD
        inp_up2.union.ki.wVk = VK_MENU
        inp_up2.union.ki.dwFlags = KEYEVENTF_KEYUP
        user32.SendInput(1, ctypes.byref(inp_up2), ctypes.sizeof(_INPUT))
        time.sleep(0.1)
        user32.SetForegroundWindow(hwnd)
        time.sleep(0.3)

    return user32.GetForegroundWindow() == hwnd


def ensure_jianying_running(timeout: int = 60) -> dict[str, Any]:
    executable = detect_jianying_executable()

    if sys.platform not in {"darwin", "win32"}:
        return {
            "success": False,
            "code": "PLATFORM_NOT_SUPPORTED",
            "error": f"Unsupported platform: {sys.platform}",
            "platform": sys.platform,
            "jianying_exe": executable,
        }

    if is_jianying_running(executable):
        if sys.platform == "darwin":
            _macos_activate_app(executable)
            frontmost = _macos_wait_frontmost(timeout=min(timeout, 15), executable=executable)
            ready = wait_jianying_ready(timeout=3, executable=executable) if frontmost else False
            action = "activate_existing_process"
        else:
            frontmost = _win32_bring_to_frontmost(timeout=min(timeout, 5.0))
            ready = wait_jianying_ready(timeout=min(timeout, 15), executable=executable)
            action = "reuse_existing_process"
        return {
            "success": True,
            "running": True,
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
            _macos_activate_app(executable)
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
        if is_jianying_running(executable):
            if sys.platform == "darwin":
                frontmost = _macos_wait_frontmost(timeout=3, executable=executable)
                ready = wait_jianying_ready(timeout=3, executable=executable) if frontmost else False
                success = frontmost
            else:
                frontmost = False
                ready = wait_jianying_ready(timeout=min(timeout, 20), executable=executable)
                success = True
            return {
                "success": True if sys.platform == "darwin" else success,
                "running": True,
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


def stop_jianying(timeout: int = 20) -> dict[str, Any]:
    executable = detect_jianying_executable()
    if not is_jianying_running(executable):
        return {
            "success": True,
            "running": False,
            "platform": sys.platform,
            "action": "already_stopped",
            "jianying_exe": executable,
        }

    try:
        if sys.platform == "darwin":
            pids = _macos_jianying_pids(executable)
            for pid in pids:
                try:
                    os.kill(pid, signal.SIGTERM)
                except OSError:
                    continue
        elif sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/IM", "JianyingPro.exe", "/T"],
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
        if not is_jianying_running(executable):
            return {
                "success": True,
                "running": False,
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


def get_status() -> dict[str, Any]:
    executable = detect_jianying_executable()
    running = is_jianying_running(executable)
    frontmost = _macos_is_frontmost(executable) if running and sys.platform == "darwin" else False
    return {
        "success": True,
        "platform": sys.platform,
        "running": running,
        "frontmost": frontmost,
        "window_ready": wait_jianying_ready(timeout=3, executable=executable) if running else False,
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
        "--json",
        action="store_true",
        help="Print JSON only.",
    )
    args = parser.parse_args()

    if args.command == "status":
        result = get_status()
    elif args.command == "stop":
        result = stop_jianying(timeout=args.timeout)
    else:
        result = ensure_jianying_running(timeout=args.timeout)

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
