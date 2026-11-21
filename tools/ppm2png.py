#!/usr/bin/env python3
"""Convert binary PPM (P6) to PNG using only the Python standard library."""
import struct
import sys
import zlib


def read_ppm(path):
    with open(path, "rb") as f:
        data = f.read()
    # parse header: P6, optional comments, width, height, maxval
    tokens = []
    i = 0
    while len(tokens) < 4:
        while i < len(data) and data[i:i+1].isspace():
            i += 1
        if data[i:i+1] == b"#":
            while i < len(data) and data[i:i+1] != b"\n":
                i += 1
            continue
        j = i
        while j < len(data) and not data[j:j+1].isspace():
            j += 1
        tokens.append(data[i:j])
        i = j
    i += 1  # single whitespace after maxval
    magic, w, h, maxval = tokens[0], int(tokens[1]), int(tokens[2]), int(tokens[3])
    assert magic == b"P6" and maxval == 255
    return w, h, data[i:i + w * h * 3]


def write_png(path, w, h, rgb):
    def chunk(tag, payload):
        c = struct.pack(">I", len(payload)) + tag + payload
        return c + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + rgb[y * w * 3:(y + 1) * w * 3] for y in range(h))
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    w, h, rgb = read_ppm(src)
    write_png(dst, w, h, rgb)
    print(f"{src} -> {dst} ({w}x{h})")
