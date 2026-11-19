#!/usr/bin/env bash
# Encode captured clips and stills for the landing page.  bash encode.sh <media-out-dir>
set -euo pipefail
M="$1"; mkdir -p "$M"
cd "$(dirname "$0")"
enc() { # src filter maxwidth name
  ffmpeg -y -loglevel error -i "$1" -vf "$2,scale='min($3,iw)':-2:flags=lanczos" -c:v libx264 -preset slow -crf 25 \
    -pix_fmt yuv420p -movflags +faststart -an "$M/$4.mp4"
  ffmpeg -y -loglevel error -sseof -0.2 -i "$M/$4.mp4" -frames:v 1 -q:v 3 "$M/$4.jpg"
}
enc clip-orbit.mp4 "setpts=PTS/2.4" 1600 orbit
enc clip-cascade.mp4 "setpts=PTS/1.0" 1600 cascade
enc clip-blocked.mp4 "setpts=PTS/1.0" 1600 blocked
enc clip-rovo.mp4 "setpts=PTS/2.0" 600 rovo
for s in s1-hero:hero s3-rtu1:rtu1 s2-cascade:cascade-still s4-panel:panel s5-comment:comment s7-rovo:rovo-still s8-decisions:decisions; do
  src=${s%%:*}; dst=${s##*:}
  ffmpeg -y -loglevel error -i "$src.png" -vf "scale='min(1800,iw)':-2:flags=lanczos" -c:v libwebp -quality 86 "$M/$dst.webp"
done
ls -la "$M" | awk '{print $5, $9}'
for v in orbit cascade blocked rovo; do
  echo "$v $(ffprobe -v error -show_entries format=duration:stream=width,height -of csv=p=0 "$M/$v.mp4" | tr '\n' ' ')"
done
