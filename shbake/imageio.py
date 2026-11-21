"""Minimal dependency-free image I/O: PPM (P6/P3) and 8-bit PNG (RGB/RGBA).

Only what the baker needs is supported: RGB(A) images with integer pixel
coordinates.  Values are normalized to linear [0,1] floats; PNG files are
assumed to store linear data (no sRGB transfer is applied), which matches the
procedural LDR test maps emitted by this package.
"""

import struct
import zlib


class Image:
    def __init__(self, width, height, pixels, channels=3):
        self.width = width
        self.height = height
        self.channels = channels
        self.pixels = pixels  # flat list of float [0,1], row-major, RGB(A)

    def rgb(self, col, row):
        i = (row * self.width + col) * self.channels
        px = self.pixels
        if self.channels == 4:
            a = px[i + 3]
            return (px[i] * a, px[i + 1] * a, px[i + 2] * a)
        return (px[i], px[i + 1], px[i + 2])


def load(path):
    lower = path.lower()
    if lower.endswith(".hdr") or lower.endswith(".rgbe"):
        return _load_hdr(path)
    if lower.endswith(".ppm") or lower.endswith(".pgm"):
        return _load_ppm(path)
    if lower.endswith(".png"):
        return _load_png(path)
    raise ValueError(f"unsupported image format: {path}")


# ---------------------------------------------------------------------------
# Radiance RGBE (.hdr), both flat and adaptive RLE scanlines
# ---------------------------------------------------------------------------

class _ByteReader:
    def __init__(self, data):
        self.data = data
        self.pos = 0

    def byte(self):
        v = self.data[self.pos]
        self.pos += 1
        return v

    def line(self):
        end = self.data.index(b"\n", self.pos)
        text = self.data[self.pos:end].decode("ascii")
        self.pos = end + 1
        return text


def _load_hdr(path):
    with open(path, "rb") as fh:
        data = fh.read()
    reader = _ByteReader(data)
    magic = reader.line()
    if magic not in ("#?RGBE", "#?XYZE"):
        raise ValueError("not a Radiance RGBE file")
    # Parse variable header until the empty terminator line, then resolution.
    while True:
        line = reader.line()
        if line == "":
            break
    res = reader.line().split()
    width = height = 0
    for i, token in enumerate(res):
        if token in ("+X", "-X"):
            width = int(res[i + 1])
        elif token in ("+Y", "-Y"):
            height = int(res[i + 1])
    pixels = [0.0] * (width * height * 3)
    for row in range(height):
        h0, h1, h2, h3 = (reader.byte(), reader.byte(),
                          reader.byte(), reader.byte())
        scan = bytearray(width * 4)
        if h0 == 2 and h1 == 2:
            # Adaptive RLE scanline.
            if (h2 << 8 | h3) != width:
                raise ValueError("unsupported HDR scanline width")
            p = 0
            while p < width * 4:
                run = reader.byte()
                if run > 128:
                    count = run - 128
                    value = reader.byte()
                    scan[p:p + count] = bytes([value]) * count
                    p += count
                else:
                    for _ in range(run):
                        scan[p] = reader.byte()
                        p += 1
            # Scanline stores channels planar: R*, G*, B*, E*.
            for col in range(width):
                _rgbe_to_rgb(scan[col], scan[width + col],
                             scan[2 * width + col], scan[3 * width + col],
                             pixels, (row * width + col) * 3)
        else:
            # Uncompressed scanline: first pixel already consumed.
            col = 0
            r0, g0, b0, e0 = h0, h1, h2, h3
            while col < width:
                _rgbe_to_rgb(r0, g0, b0, e0, pixels, (row * width + col) * 3)
                col += 1
                if col < width:
                    r0, g0, b0, e0 = reader.byte(), reader.byte(), reader.byte(), reader.byte()
    return Image(width, height, pixels, 3)


def _rgbe_to_rgb(r, g, b, e, out, idx):
    if e == 0:
        out[idx] = out[idx + 1] = out[idx + 2] = 0.0
        return
    scale = math_ldexp(1.0, e - (128 + 8))
    out[idx] = r * scale
    out[idx + 1] = g * scale
    out[idx + 2] = b * scale


def math_ldexp(mantissa, exponent):
    return mantissa * (2.0 ** exponent)


def save(path, image):
    lower = path.lower()
    if lower.endswith(".ppm"):
        _save_ppm(path, image)
    elif lower.endswith(".png"):
        _save_png(path, image)
    else:
        raise ValueError(f"unsupported image format: {path}")


def from_rgb(width, height, rgb_rows):
    flat = []
    for row in rgb_rows:
        for px in row:
            flat.extend(min(1.0, max(0.0, float(c))) for c in px[:3])
    return Image(width, height, flat, 3)


# ---------------------------------------------------------------------------
# PPM
# ---------------------------------------------------------------------------

def _tokenize_ppm(data):
    tokens, i, n = [], 0, len(data)
    while i < n:
        ch = data[i:i + 1]
        if ch.isspace():
            i += 1
        elif ch == b"#":
            while i < n and data[i] not in b"\r\n":
                i += 1
        else:
            start = i
            while i < n and not data[i:i + 1].isspace() and data[i:i + 1] != b"#":
                i += 1
            tokens.append(data[start:i])
    return tokens


def _load_ppm(path):
    with open(path, "rb") as fh:
        data = fh.read()
    tokens = _tokenize_ppm(data)
    magic = tokens[0]
    width, height, maxval = int(tokens[1]), int(tokens[2]), int(tokens[3])
    if magic == b"P6":
        # Header is ASCII; binary payload starts at the single whitespace
        # byte immediately following the maxval token.
        header_end = data.index(tokens[3]) + len(tokens[3])
        payload = data[header_end + 1:]
        if maxval < 256:
            vals = list(payload[: width * height * 3])
        else:
            vals = []
            for k in range(0, width * height * 3 * 2, 2):
                vals.append((payload[k] << 8) | payload[k + 1])
    elif magic == b"P3":
        vals = [int(t) for t in tokens[4:4 + width * height * 3]]
    else:
        raise ValueError("only P3/P6 PPM is supported")
    scale = 1.0 / maxval
    pixels = [v * scale for v in vals]
    return Image(width, height, pixels, 3)


def _save_ppm(path, image):
    data = bytearray(f"P6\n{image.width} {image.height}\n255\n".encode())
    for i in range(0, len(image.pixels), image.channels):
        for c in range(3):
            data.append(int(round(image.pixels[i + c] * 255)))
    with open(path, "wb") as fh:
        fh.write(data)


# ---------------------------------------------------------------------------
# PNG (truecolor RGB/RGBA, 8-bit, single IDAT)
# ---------------------------------------------------------------------------

def _png_chunk(tag, payload):
    chunk = struct.pack(">I", len(payload)) + tag + payload
    crc = zlib.crc32(tag + payload) & 0xFFFFFFFF
    return chunk + struct.pack(">I", crc)


def _load_png(path):
    with open(path, "rb") as fh:
        data = fh.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG file")
    pos = 8
    width = height = bit_depth = color_type = None
    idat = bytearray()
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        tag = data[pos + 4:pos + 8]
        payload = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if tag == b"IHDR":
            width, height, bit_depth, color_type = struct.unpack(">IIBB", payload[:10])
        elif tag == b"IDAT":
            idat.extend(payload)
        elif tag == b"IEND":
            break
    if bit_depth != 8 or color_type not in (2, 6):
        raise ValueError("only 8-bit RGB/RGBA PNG is supported")
    channels = 3 if color_type == 2 else 4
    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    pixels = [0.0] * (width * height * 3)
    prev = [0] * stride
    src = 0
    for row in range(height):
        filt = raw[src]
        src += 1
        line = list(raw[src:src + stride])
        src += stride
        recon = [0] * stride
        for i in range(stride):
            x = line[i]
            left = recon[i - channels] if i >= channels else 0
            up = prev[i]
            ul = prev[i - channels] if i >= channels else 0
            if filt == 0:
                recon[i] = x
            elif filt == 1:
                recon[i] = (x + left) & 255
            elif filt == 2:
                recon[i] = (x + up) & 255
            elif filt == 3:
                recon[i] = (x + ((left + up) >> 1)) & 255
            else:
                p = left + up - ul
                pa, pb, pc = abs(p - left), abs(p - up), abs(p - ul)
                pr = left if pa <= pb and pa <= pc else (up if pb <= pc else ul)
                recon[i] = (x + pr) & 255
        prev = recon
        out = row * width * 3
        for col in range(width):
            k = col * channels
            pixels[out + col * 3] = recon[k] / 255.0
            pixels[out + col * 3 + 1] = recon[k + 1] / 255.0
            pixels[out + col * 3 + 2] = recon[k + 2] / 255.0
    return Image(width, height, pixels, 3)


def _save_png(path, image):
    channels = image.channels
    color_type = 2 if channels == 3 else 6
    header = struct.pack(
        ">IIBBBBB", image.width, image.height, 8, color_type, 0, 0, 0
    )
    raw = bytearray()
    stride = image.width * channels
    for row in range(image.height):
        raw.append(0)  # filter type 0 (none)
        start = row * stride
        for i in range(stride):
            raw.append(int(round(image.pixels[start + i] * 255)))
    png = b"\x89PNG\r\n\x1a\n"
    png += _png_chunk(b"IHDR", header)
    png += _png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += _png_chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)
