#!/usr/bin/env python3
"""Minimal P6/P5 -> PNG converter (zlib only, no third-party deps)."""
import struct
import sys
import zlib


def read_pnm(path):
    with open(path, "rb") as f:
        data = f.read()
    idx = 0

    def token():
        nonlocal idx
        while data[idx] in b" \t\n\r":
            idx += 1
        start = idx
        while data[idx] not in b" \t\n\r":
            idx += 1
        return data[start:idx]

    magic = token()
    width = int(token())
    height = int(token())
    maxval = int(token())
    idx += 1  # single whitespace after maxval
    channels = 3 if magic == b"P6" else 1
    raw = data[idx:idx + width * height * channels]
    return width, height, channels, raw


def chunk(tag, payload):
    return (struct.pack(">I", len(payload)) + tag + payload +
            struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF))


def write_png(path, width, height, channels, raw):
    color_type = 2 if channels == 3 else 0
    ihdr = struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0)
    stride = width * channels
    lines = b"".join(b"\x00" + raw[y * stride:(y + 1) * stride]
                     for y in range(height))
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) +
           chunk(b"IDAT", zlib.compress(lines, 9)) +
           chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    for src in sys.argv[1:]:
        w, h, ch, raw = read_pnm(src)
        dst = src.rsplit(".", 1)[0] + ".png"
        write_png(dst, w, h, ch, raw)
        print(f"{src} -> {dst} ({w}x{h})")
