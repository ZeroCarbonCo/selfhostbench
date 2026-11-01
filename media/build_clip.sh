#!/bin/sh
# Rebuild the SelfHostBench 4K test clip (shb-clip-4k-hevc-v1.mkv) from Big Buck Bunny
# (c) 2008 Blender Foundation | peach.blender.org, CC BY 3.0.
# Source: https://download.blender.org/demo/movies/BBB/bbb_sunflower_2160p_30fps_normal.mp4.zip
# Usage: sh build_clip.sh DIR_CONTAINING_bbb_sunflower_2160p_30fps_normal.mp4 OUT_DIR
# Note: x265 output is not bit-identical across builds/CPUs; the published file's SHA-256 is what the script checks.
set -eu
docker run --rm --entrypoint /usr/lib/jellyfin-ffmpeg/ffmpeg \
  -v "$1":/in:ro -v "$2":/out jellyfin/jellyfin:12.4.20261026-211555 \
  -hide_banner -loglevel error -ss 60 -t 30 -i /in/bbb_sunflower_2160p_30fps_normal.mp4 \
  -map 0:v:0 -map 0:a:0 -c:v libx265 -preset medium -crf 20 -x265-params log-level=error -pix_fmt yuv420p \
  -c:a aac -b:a 128k -ac 2 \
  -metadata title='Big Buck Bunny excerpt (CC BY 3.0, Blender Foundation) - SelfHostBench test clip v1' \
  -y /out/shb-clip-4k-hevc-v1.mkv
