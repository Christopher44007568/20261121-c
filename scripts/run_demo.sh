#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j"${JOBS:-4}"
./build/shadowdemo

if command -v ffmpeg >/dev/null 2>&1; then
    ffmpeg -y -v error -framerate 8 -i artifacts/frames/orbit/%02d.png \
        -vf "scale=960:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3" \
        -loop 0 artifacts/images/light_orbit.gif

    ffmpeg -y -v error -framerate 5 -i artifacts/frames/shadow_path/%02d.png \
        -vf "split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3" \
        -loop 0 artifacts/images/shadow_path.gif

    ffmpeg -y -v error -framerate 5 -i artifacts/frames/near_path/%02d.png \
        -vf "split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3" \
        -loop 0 artifacts/images/near_clip_path.gif

    ffmpeg -y -v error -framerate 1 -i artifacts/frames/orbit/%02d.png \
        -vf "scale=320:180:flags=lanczos,tile=4x3:padding=4:margin=4:color=0x111820" \
        -frames:v 1 artifacts/images/light_orbit_contact.png

    ffmpeg -y -v error -framerate 1 -i artifacts/frames/shadow_path/%02d.png \
        -vf "scale=320:180:flags=lanczos,tile=4x3:padding=4:margin=4:color=0x111820" \
        -frames:v 1 artifacts/images/shadow_path_contact.png

    ffmpeg -y -v error -framerate 1 -i artifacts/frames/near_path/%02d.png \
        -vf "scale=320:180:flags=lanczos,tile=4x3:padding=4:margin=4:color=0x111820" \
        -frames:v 1 artifacts/images/near_clip_path_contact.png
else
    echo "ffmpeg not found; PNG frames and the verification report are still available."
fi

