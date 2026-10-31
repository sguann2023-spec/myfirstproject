#!/usr/bin/env bash
# bake_sfx.sh —— 把混音电平烘进音频文件
#
# 为什么需要这个脚本：草稿里 add_audio / modify_audio 的 volume 参数【全链路不生效】
# （段音量被平台恒写为 ~1.02-1.12，传 0.3 返回 success 但 JSON 纹丝不动）。
# 所以混音只能做在文件上。目标实测电平（volumedetect mean）：
#   口播 -10.5 / BGM -17.6 / 品类环境声 -21.9        ← 这三条生成时梯度就合理，一般不用动
#   whoosh -21.6 / pop -24.8 / ding -29.0（peak -2.9 ~ -4.8）
set -euo pipefail
SRC="${1:?用法: bake_sfx.sh <素材目录> <输出目录>   (目录内需有 sfx_whoosh/sfx_pop/sfx_ding.wav)}"
OUT="${2:?缺少输出目录}"
mkdir -p "$OUT"

bake () {          # bake <文件> <增益dB>
  # 注意：bash 3.2 会先展开 local 的所有词再赋值，把 $f 写进同一行的 o= 会触发 set -u 报
  # "f: unbound variable"，所以必须分两行声明（见 references/pitfalls.md#16）。
  local f="$1" g="$2"
  local o="$OUT/$(basename "$f")"
  ffmpeg -y -loglevel error -i "$f" -af "volume=${g}dB,alimiter=limit=0.95" -ar 44100 -ac 2 "$o"
  printf '%-18s +%-5s ' "$(basename "$f")" "$g"
  ffmpeg -hide_banner -i "$o" -af volumedetect -f null - 2>&1 | grep -E "mean_volume|max_volume" | tr -d '\n'; echo
}
# ⚠ 下面的默认增益只是历史那批素材的标定值。seed-audio 每次出的原始电平差很多，
#   照搬会把 ding/pop 顶到 0dBFS 削顶。先对本目录里的原始文件跑一次 volumedetect，
#   再按 gain = 目标mean - 原始mean 反算后传进来（见 pitfalls.md#17）。
bake "$SRC/sfx_ding.wav"   14
bake "$SRC/sfx_pop.wav"     6
bake "$SRC/sfx_whoosh.wav"  5

# 视频：AI 片段自带的音轨是低频噪声，必须剥离（否则和口播糊在一起且改不动音量）
for v in "$SRC"/clip*.mp4; do
  [ -e "$v" ] || continue
  ffmpeg -y -loglevel error -i "$v" -an -c:v copy "$OUT/$(basename "${v%.mp4}")_mute.mp4"
  echo "已剥离音轨 -> $(basename "${v%.mp4}")_mute.mp4"
done
