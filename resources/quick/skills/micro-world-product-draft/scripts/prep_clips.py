#!/usr/bin/env python3
"""把 edit_plan.json 里的每个视频镜头预裁成「标准 clip」。

为什么需要这一步（剪映草稿的关键坑）：
  add_video_keyframe 的时间语义是
      time_offset = (times - target_start) + source_start
  也就是说：源入点 in 越大，运镜关键帧就被整体往后推，甚至推出片段末尾而丢失。
  所以入出点必须在「裁切阶段」消化掉，让草稿里每个 clip 的 source_start = 0，
  运镜关键帧才精确可控。

标准 clip 约定（只动几何，不动创意）：
  - 1080x1920 / 30fps / yuv420p / H.264 CRF16 / 无音轨
  - 按 in 点裁切，长度 = dur * speed（变速仍交给剪映的 speed 属性，保持可编辑）
  - 不做运镜、不烧字幕、不调色 —— 这些全部留在草稿里做

用法：
  python3 scripts/prep_clips.py            # 生成 assets/clips/*.mp4
  python3 scripts/prep_clips.py --force    # 重新生成（默认跳过已存在的）
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLAN = json.load(open(os.path.join(ROOT, "edit_plan.json"), encoding="utf-8"))
OUT = os.path.join(ROOT, "assets", "clips")
W, H, FPS = PLAN["meta"]["width"], PLAN["meta"]["height"], PLAN["meta"]["fps"]
FORCE = "--force" in sys.argv


def path(p):
    return p if os.path.isabs(p) else os.path.normpath(os.path.join(ROOT, p))


def sh(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print("FAILED:", " ".join(cmd))
        print(r.stderr[-2000:])
        raise SystemExit(1)


def probe_dur(p):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", p], capture_output=True, text=True)
    return float(r.stdout.strip())


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {}
    for shot in PLAN["shots"]:
        if shot["type"] != "video":
            continue
        sid = shot["id"]
        dur = shot["dur"]
        speed = shot.get("speed", 1)
        need = dur * speed                      # 需要的源时长
        src = path(shot["src"])
        src_dur = probe_dur(src)
        in_pt = min(shot.get("in", 0), max(src_dur - need - 0.05, 0))
        if src_dur - in_pt < need:              # 源不够长就往前提入点
            in_pt = max(src_dur - need, 0)
        out = os.path.join(OUT, f"{sid}.mp4")
        got = probe_dur(out) if (os.path.exists(out) and not FORCE) else 0
        if got < need - 0.05:
            vf = [f"fps={FPS}"]
            crop = shot.get("crop")
            if crop:
                x, y, w, h = crop
                vf.append(f"crop=iw*{w}:ih*{h}:iw*{x}:ih*{y}")
            vf += [f"scale={W}:{H}:force_original_aspect_ratio=increase",
                   f"crop={W}:{H}", "format=yuv420p"]
            sh(["ffmpeg", "-v", "error", "-y",
                "-ss", f"{in_pt:.3f}", "-t", f"{need:.3f}", "-i", src,
                "-vf", ",".join(vf), "-an",
                "-c:v", "libx264", "-preset", "medium", "-crf", "16",
                "-r", str(FPS), out])
            got = probe_dur(out)
        manifest[sid] = {"clip": f"assets/clips/{sid}.mp4",
                         "src_in": round(in_pt, 3),
                         "clip_dur": round(got, 3),
                         "timeline_dur": dur, "speed": speed}
        flag = "OK " if got >= need - 0.05 else "SHORT"
        print(f"  [{flag}] {sid:<5} in={in_pt:5.2f} clip={got:5.2f}s "
              f"speed={speed} -> 时间轴 {dur}s")

    # BGM 循环版：剪映里音频轨不会自动 loop，源短于成片必须预先补齐
    aud = os.path.join(ROOT, "assets", "audio")
    bgm, looped = os.path.join(aud, "bgm_raw.wav"), os.path.join(aud, "bgm_loop.wav")
    src_d = probe_dur(bgm)
    total = sum(x["dur"] for x in PLAN["shots"])
    if src_d < total or not os.path.exists(looped):
        sh(["ffmpeg", "-v", "error", "-y", "-stream_loop",
            str(int(total // src_d) + 1), "-i", bgm,
            "-t", str(round(total + 0.2, 2)), looped])
        print(f"  BGM {src_d:.1f}s -> loop {probe_dur(looped):.1f}s  {looped}")
    plan_p = os.path.join(ROOT, "edit_plan.json")
    pl = json.load(open(plan_p, encoding="utf-8"))
    if pl["audio"].get("bgm_loop") != "assets/audio/bgm_loop.wav":
        pl["audio"]["bgm_loop"] = "assets/audio/bgm_loop.wav"
        json.dump(pl, open(plan_p, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2)
        print("  edit_plan.audio.bgm_loop -> assets/audio/bgm_loop.wav")

    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print("manifest ->", os.path.join(OUT, "manifest.json"))


if __name__ == "__main__":
    main()
