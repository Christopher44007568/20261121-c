#!/usr/bin/env bash
# Warehouse 3D annotation demo launcher.
set -euo pipefail
cd "$(dirname "$0")"
export LD_LIBRARY_PATH="$PWD/.syslibs/root2/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export QT_QPA_PLATFORM="${QT_QPA_PLATFORM:-xcb}"
export FONTCONFIG_FILE="$PWD/app/fonts.conf"
exec .venv/bin/python -u app/main.py "$@"
