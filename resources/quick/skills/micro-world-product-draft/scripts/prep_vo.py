#!/usr/bin/env python3
"""Voice-over 预处理：去首尾静音、压缩长停顿、整体提速、统一电平。

用法：
    python3 scripts/prep_vo.py
输入 assets/vo/*.mp3 -> 输出 assets/vo/proc/*.wav + assets/vo/durations.json

停顿检测交给 ffmpeg silencedetect（只看 >0.30s 的长停顿，避免把字与字之间切开）。
"""
import json
import os
import re
import subprocess
import wave

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IN_DIR = os.path.join(ROOT, "assets", "vo")
OUT_DIR = os.path.join(ROOT, "assets", "vo", "proc")
SR = 44100
TEMPO = 1.06          # 整体提速，保持音高
GAP_KEEP = 0.20       # 长停顿压缩后保留的静音
HEAD_KEEP = 0.04
TAIL_KEEP = 0.12
NOISE_DB = -45
MIN_SIL = 0.30


def probe_duration(path):
    return float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True, text=True, check=True).stdout.strip())


def silences(path):
    err = subprocess.run(
        ["ffmpeg", "-v", "info", "-i", path, "-af",
         f"silencedetect=noise={NOISE_DB}dB:d={MIN_SIL}", "-f", "null", "-"],
        capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r"silence_start:\s*(-?[0-9.]+)", err)]
    ends = [float(x) for x in re.findall(r"silence_end:\s*([0-9.]+)", err)]
    return list(zip(starts, ends)) if len(starts) == len(ends) else []


def decode(path):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def write_wav(path, data):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(data, -1, 1) * 32767).astype("<i2").tobytes())


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    report = {}
    for name in sorted(os.listdir(IN_DIR)):
        if not name.endswith(".mp3"):
            continue
        src = os.path.join(IN_DIR, name)
        dur = probe_duration(src)
        x = decode(src)
        sil = silences(src)

        # 需要保留/压缩的区间
        cuts = []  # (start, end, keep_seconds)
        for s, e in sil:
            if s <= 0.05:            # 开头静音
                cuts.append((0.0, min(e + 0.02, dur), HEAD_KEEP))
            elif e >= dur - 0.05:    # 结尾静音
                cuts.append((max(s - 0.02, 0), dur, TAIL_KEEP))
            elif e - s > GAP_KEEP + 0.08:
                cuts.append((s, e, GAP_KEEP))

        pieces = []
        cursor = 0.0
        for s, e, keep in cuts:
            if s > cursor:
                pieces.append(x[int(cursor * SR):int(s * SR)])
            if keep > 0:
                pieces.append(np.zeros(int(keep * SR), dtype=np.float32))
            cursor = max(cursor, e)
        if cursor < dur:
            pieces.append(x[int(cursor * SR):])

        y = np.concatenate(pieces) if pieces else x
        tmp = os.path.join(OUT_DIR, f"_{name}.wav")
        write_wav(tmp, y)
        out = os.path.join(OUT_DIR, name.replace(".mp3", ".wav"))
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", tmp,
             "-af", f"atempo={TEMPO},loudnorm=I=-16:TP=-1.5:LRA=9",
             "-ar", str(SR), "-ac", "1", out], check=True)
        os.remove(tmp)
        d = probe_duration(out)
        report[name.replace(".mp3", "")] = round(d, 3)
        print(f"{name:14s} {dur:5.2f}s -> {d:5.2f}s  pauses={[(round(a,2),round(b,2)) for a,b in sil]}")

    with open(os.path.join(ROOT, "assets", "vo", "durations.json"), "w") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print("VO total:", round(sum(report.values()), 2), "s")


if __name__ == "__main__":
    main()
