#!/usr/bin/env bash
# Cross-build HairA2CDemo.exe with mingw-w64 (used on this Linux box).
# On Windows, prefer: cmake -B build && cmake --build build --config Release
set -euo pipefail
cd "$(dirname "$0")"

CXX=${CXX:-x86_64-w64-mingw32-g++-posix}
if ! command -v "$CXX" >/dev/null 2>&1; then
    CXX=x86_64-w64-mingw32-g++
fi

"$CXX" -std=c++17 -O2 -Wall -finput-charset=UTF-8 \
    src/main.cpp src/d3d.cpp src/scene.cpp src/render.cpp src/geometry.cpp \
    -o artifacts/HairA2CDemo.exe \
    -ld3d11 -ldxgi -ld2d1 -ldwrite -ldxguid -lwindowscodecs -municode

echo "built artifacts/HairA2CDemo.exe"
