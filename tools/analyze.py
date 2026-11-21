#!/usr/bin/env python3
"""Analyze the Godot normal-prefilter capture.

The input can be a directory of MovieWriter PNG frames or a video readable by
ffmpeg. Statistics use one fixed sequence-wide exposure gain per panel; there
is no per-frame auto exposure.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


WIDTH = 1280
HEIGHT = 720
FPS = 30
PANEL_WIDTH = 426
PANEL_GAP = 1
VIEW_TOP = 62
VIEW_HEIGHT = 500
ANALYSIS_TOP = 200
ANALYSIS_BOTTOM = 556
PANEL_X = [3, 430, 857]
PANEL_CODES = ["A", "B", "C"]
PANEL_TITLES = ["RAW NORMAL", "PREFILTERED", "MIP-STEP ROUGHNESS"]
PANEL_COLORS = [(255, 102, 82), (79, 227, 232), (255, 171, 67)]
INK = (220, 229, 236)
MUTED = (122, 139, 155)
FAINT = (35, 48, 61)
BG = (8, 13, 20)
PANEL_BG = (12, 20, 30)
SAMPLE_FRAMES = {"near": 15, "mid": 180, "far": 360}


def srgb_to_linear(values: np.ndarray) -> np.ndarray:
    return np.where(
        values <= 0.04045,
        values / 12.92,
        ((values + 0.055) / 1.055) ** 2.4,
    )


def luma_from_rgb(rgb: np.ndarray) -> np.ndarray:
    values = rgb.astype(np.float32) / 255.0
    linear = srgb_to_linear(values)
    return (
        linear[..., 0] * 0.2126
        + linear[..., 1] * 0.7152
        + linear[..., 2] * 0.0722
    )


def panel_slices() -> list[tuple[slice, slice]]:
    return [
        (slice(ANALYSIS_TOP, ANALYSIS_BOTTOM), slice(x, x + 420))
        for x in PANEL_X
    ]


def decode_command(source: Path) -> list[str]:
    if source.is_dir():
        pattern = source / "frame%08d.png"
        return [
            "ffmpeg",
            "-v",
            "error",
            "-framerate",
            str(FPS),
            "-i",
            str(pattern),
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
        ]
    return [
        "ffmpeg",
        "-v",
        "error",
        "-i",
        str(source),
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
    ]


def iter_frames(source: Path):
    process = subprocess.Popen(
        decode_command(source),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    frame_bytes = WIDTH * HEIGHT * 3
    index = 0
    try:
        while True:
            payload = process.stdout.read(frame_bytes)
            if len(payload) < frame_bytes:
                break
            frame = np.frombuffer(payload, dtype=np.uint8).reshape(
                HEIGHT, WIDTH, 3
            )
            yield index, frame
            index += 1
    finally:
        process.stdout.close()
        stderr = process.stderr.read().decode("utf-8", "replace")
        process.wait()
        if process.returncode != 0 and index == 0:
            raise RuntimeError(stderr or "ffmpeg could not decode input")


def load_font(size: int, bold: bool = False, mono: bool = False) -> ImageFont.FreeTypeFont:
    if mono:
        name = "DejaVuSansMono.ttf"
    elif bold:
        name = "DejaVuSans-Bold.ttf"
    else:
        name = "DejaVuSans.ttf"
    return ImageFont.truetype(f"/usr/share/fonts/truetype/dejavu/{name}", size)


def first_pass(source: Path):
    slices = panel_slices()
    luma_sum = [np.zeros((ANALYSIS_BOTTOM - ANALYSIS_TOP, 420), np.float32) for _ in range(3)]
    frame_means = []
    sample_frames = {}
    frame_count = 0
    for index, rgb in iter_frames(source):
        luma = luma_from_rgb(rgb)
        means = []
        for panel_index, (ys, xs) in enumerate(slices):
            region = luma[ys, xs]
            luma_sum[panel_index] += region
            means.append(float(region.mean()))
        frame_means.append(means)
        for label, frame_index in SAMPLE_FRAMES.items():
            if index == frame_index:
                sample_frames[label] = rgb.copy()
        frame_count += 1

    if frame_count == 0:
        raise RuntimeError("No frames were decoded")
    temporal_mean = [total / frame_count for total in luma_sum]
    means_array = np.asarray(frame_means, np.float32)
    panel_means = means_array.mean(axis=0)
    return {
        "frame_count": frame_count,
        "frame_means": means_array,
        "temporal_mean": temporal_mean,
        "panel_means": panel_means,
        "sample_frames": sample_frames,
    }


def box_blur_mean(values: np.ndarray, radius: int = 8) -> np.ndarray:
    padded = np.pad(values, radius, mode="reflect")
    integral = np.pad(padded, ((1, 0), (1, 0)), mode="constant")
    integral = integral.cumsum(axis=0).cumsum(axis=1)
    window = radius * 2 + 1
    total = (
        integral[window:, window:]
        - integral[:-window, window:]
        - integral[window:, :-window]
        + integral[:-window, :-window]
    )
    return total / float(window * window)


def detail_for_frame(rgb: np.ndarray, gain: float) -> dict[str, float]:
    luma = luma_from_rgb(rgb) * gain
    values = {}
    for panel_index, (ys, xs) in enumerate(panel_slices()):
        region = luma[ys, xs]
        residual = region - box_blur_mean(region, 8)
        values[PANEL_CODES[panel_index]] = float(np.sqrt(np.mean(residual * residual)))
    return values


def compute_details(samples: dict[str, np.ndarray], gains: np.ndarray) -> dict:
    result = {}
    for stage, rgb in samples.items():
        details = detail_for_frame(rgb, 1.0)
        adjusted = {
            code: details[code] * float(gains[index])
            for index, code in enumerate(PANEL_CODES)
        }
        reference = adjusted["A"]
        result[stage] = {
            "frame": SAMPLE_FRAMES[stage],
            "time_s": SAMPLE_FRAMES[stage] / FPS,
            "micro_detail_rms": adjusted,
            "retention_vs_raw_pct": {
                code: adjusted[code] / reference * 100.0
                for code in PANEL_CODES
            },
        }
    return result


def second_pass(
    source: Path,
    temporal_mean: list[np.ndarray],
    panel_means: np.ndarray,
    gains: np.ndarray,
) -> dict:
    slices = panel_slices()
    masks = []
    for mean_luma in temporal_mean:
        threshold = float(np.quantile(mean_luma, 0.82))
        masks.append(mean_luma >= threshold)

    rings = [deque(maxlen=9) for _ in range(3)]
    squared_sum = [np.zeros_like(mask, dtype=np.float64) for mask in masks]
    count_map = [np.zeros_like(mask, dtype=np.float32) for mask in masks]
    scalar_squared = np.zeros(3, np.float64)
    scalar_count = np.zeros(3, np.float64)

    for _, rgb in iter_frames(source):
        luma = luma_from_rgb(rgb)
        for panel_index, (ys, xs) in enumerate(slices):
            ring = rings[panel_index]
            ring.append(luma[ys, xs] * float(gains[panel_index]))
            if len(ring) < 9:
                continue
            window = np.stack(ring, axis=0)
            center = window[4]
            residual = center - window.mean(axis=0)
            mask = masks[panel_index]
            residual_masked = residual[mask]
            squared_sum[panel_index][mask] += residual_masked * residual_masked
            count_map[panel_index][mask] += 1.0
            scalar_squared[panel_index] += float(
                np.dot(residual_masked, residual_masked)
            )
            scalar_count[panel_index] += float(residual_masked.size)

    sparkle_maps = []
    sparkle = {}
    for panel_index, code in enumerate(PANEL_CODES):
        valid = count_map[panel_index] > 0.0
        sparkle_map = np.zeros_like(count_map[panel_index], dtype=np.float32)
        sparkle_map[valid] = np.sqrt(
            squared_sum[panel_index][valid] / count_map[panel_index][valid]
        )
        sparkle_maps.append(sparkle_map)
        absolute = math.sqrt(
            scalar_squared[panel_index] / max(scalar_count[panel_index], 1.0)
        )
        mean_exposure = float(panel_means[panel_index] * gains[panel_index])
        sparkle[code] = {
            "sparkle_abs": absolute,
            "sparkle_norm": absolute / max(mean_exposure, 1e-9),
            "mean_exposure": mean_exposure,
        }

    raw = sparkle["A"]["sparkle_norm"]
    stepped = sparkle["C"]["sparkle_norm"]
    prefiltered = sparkle["B"]["sparkle_norm"]
    sparkle["reduction"] = {
        "prefiltered_vs_raw_pct": (raw - prefiltered) / raw * 100.0,
        "stepped_vs_raw_pct": (raw - stepped) / raw * 100.0,
        "prefiltered_vs_stepped_pct": (stepped - prefiltered) / stepped * 100.0,
    }
    return {
        "sparkle": sparkle,
        "sparkle_maps": sparkle_maps,
        "masks": masks,
    }


def brightness_stability(frame_means: np.ndarray, gains: np.ndarray) -> dict:
    adjusted = frame_means * gains[np.newaxis, :]
    result = {}
    for panel_index, code in enumerate(PANEL_CODES):
        series = adjusted[:, panel_index].astype(np.float64)
        mean_value = float(series.mean())
        std_value = float(series.std())
        steps = np.abs(np.diff(series)) / max(mean_value, 1e-9) * 100.0
        window = np.ones(9, dtype=np.float64) / 9.0
        padded = np.pad(series.astype(np.float64), (4, 4), mode="edge")
        moving_mean = np.convolve(padded, window, mode="valid")
        flicker_residual = series.astype(np.float64) - moving_mean
        flicker_pct = float(
            np.sqrt(np.mean(flicker_residual * flicker_residual))
            / max(mean_value, 1e-9)
            * 100.0
        )
        near = series[:120]
        far = series[300:]
        result[code] = {
            "mean": mean_value,
            "std": std_value,
            "cv_full": std_value / max(mean_value, 1e-9),
            "cv_near": float(near.std() / max(near.mean(), 1e-9)),
            "cv_far": float(far.std() / max(far.mean(), 1e-9)),
            "mean_flicker_pct": flicker_pct,
            "max_step_pct": float(steps.max()) if steps.size else 0.0,
        }
    return result


def roughness_summary(mip_stats_path: Path, details: dict) -> dict:
    if not mip_stats_path.exists():
        return {}
    source = json.loads(mip_stats_path.read_text())
    model = source["roughness_model"]
    table = source["table"]
    errors = [
        abs(row["prefiltered_roughness"] - row["stepped_roughness"])
        for row in table
    ]
    slopes = [
        abs(table[index]["prefiltered_roughness"] - table[index - 1]["prefiltered_roughness"])
        for index in range(1, len(table))
    ]
    return {
        "base_roughness": model["base"],
        "mip_gain": model["mip_gain"],
        "variance_gain": model["variance_gain"],
        "step_count": model["step_count"],
        "max_step_jump": model["max_step_jump"],
        "mean_step_jump": model["mean_step_jump"],
        "max_continuous_slope_per_lod": max(slopes),
        "mean_quantization_error": float(np.mean(errors)),
        "max_quantization_error": float(np.max(errors)),
        "table": table,
        "detail_slope": {
            stage: {
                code: values / max(details[stage]["micro_detail_rms"]["A"], 1e-9)
                for code, values in details[stage]["micro_detail_rms"].items()
            }
            for stage in details
        },
    }


_FONT_CACHE = {}


def font(size: int, bold: bool = False, mono: bool = False):
    key = (size, bold, mono)
    if key not in _FONT_CACHE:
        _FONT_CACHE[key] = load_font(size, bold=bold, mono=mono)
    return _FONT_CACHE[key]


def text(draw, position, value, size=14, fill=INK, bold=False, mono=False, anchor=None):
    draw.text(
        position,
        str(value),
        font=font(size, bold=bold, mono=mono),
        fill=fill,
        anchor=anchor,
    )


def plot_brightness(
    output: Path,
    frame_means: np.ndarray,
    gains: np.ndarray,
    stability: dict,
) -> None:
    width, height = 1200, 390
    image = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, width, 78), fill=(10, 16, 24))
    text(draw, (28, 19), "BRIGHTNESS STABILITY", 24, INK, bold=True)
    text(
        draw,
        (28, 53),
        "equal sequence mean exposure  /  9-frame metrics are exposure-normalized",
        11,
        MUTED,
    )
    text(draw, (1168, 53), "NO AUTO-EXPOSURE", 10, MUTED, anchor="ra")

    adjusted = frame_means * gains[np.newaxis, :]
    plot = (78, 104, 1164, 274)
    y_pad = 0.08
    y_min = float(adjusted.min()) * (1.0 - y_pad)
    y_max = float(adjusted.max()) * (1.0 + y_pad)
    target = float(adjusted.mean())
    frames = adjusted.shape[0]

    def px(frame: float) -> float:
        return plot[0] + frame / max(frames - 1, 1) * (plot[2] - plot[0])

    def py(value: float) -> float:
        return plot[3] - (value - y_min) / max(y_max - y_min, 1e-9) * (plot[3] - plot[1])

    for tick in range(5):
        value = y_min + (y_max - y_min) * tick / 4.0
        y = py(value)
        draw.line((plot[0], y, plot[2], y), fill=(25, 35, 46), width=1)
        text(draw, (plot[0] - 12, y), f"{value:.3f}", 9, MUTED, anchor="rm")

    for stage, frame in SAMPLE_FRAMES.items():
        x = px(frame)
        draw.line((x, plot[1], x, plot[3]), fill=(34, 48, 61), width=1)
        text(draw, (x, plot[1] - 8), stage.upper(), 9, MUTED, anchor="mb")
        text(draw, (x, plot[3] + 7), f"{frame / FPS:.1f}s", 9, MUTED, anchor="ma")

    draw.line(
        (plot[0], py(target), plot[2], py(target)),
        fill=(165, 180, 194),
        width=1,
    )
    for panel_index, code in enumerate(PANEL_CODES):
        points = [
            (px(frame), py(float(adjusted[frame, panel_index])))
            for frame in range(frames)
        ]
        draw.line(points, fill=PANEL_COLORS[panel_index], width=2, joint="curve")

    legend_x = 640
    for panel_index, code in enumerate(PANEL_CODES):
        x = legend_x + panel_index * 176
        draw.line((x, 39, x + 24, 39), fill=PANEL_COLORS[panel_index], width=3)
        label = f"{code}  mean {stability[code]['mean']:.4f}"
        text(draw, (x + 31, 31), label, 10, INK)

    y = 301
    for panel_index, code in enumerate(PANEL_CODES):
        x = 28 + panel_index * 392
        values = stability[code]
        text(draw, (x, y), code, 15, PANEL_COLORS[panel_index], bold=True)
        text(
            draw,
            (x + 23, y + 2),
            f"CV full {values['cv_full'] * 100:.2f}%  near {values['cv_near'] * 100:.2f}%  "
            f"far {values['cv_far'] * 100:.2f}%",
            9,
            MUTED,
        )
        text(
            draw,
            (x + 23, y + 16),
            f"mean flicker {values['mean_flicker_pct']:.2f}%  max step {values['max_step_pct']:.2f}%",
            9,
            MUTED,
        )
    text(
        draw,
        (28, 362),
        "Mean CV includes slow LOD exposure drift; the sparkle map isolates local frame-to-frame flicker.",
        10,
        MUTED,
    )
    image.save(output)


def heat_color(values: np.ndarray, vmax: float) -> np.ndarray:
    normalized = np.clip(values / max(vmax, 1e-9), 0.0, 1.0)
    stops = np.array([0.0, 0.18, 0.48, 0.76, 1.0])
    red = np.interp(normalized, stops, [0.0, 0.01, 0.0, 0.98, 1.0])
    green = np.interp(normalized, stops, [0.0, 0.20, 0.72, 0.78, 1.0])
    blue = np.interp(normalized, stops, [0.0, 0.58, 0.93, 0.16, 1.0])
    return np.stack([red, green, blue], axis=-1).astype(np.float32)


def plot_sparkle_map(
    output: Path,
    sparkle_maps: list[np.ndarray],
    masks: list[np.ndarray],
    sparkle: dict,
) -> None:
    width, height = 1200, 430
    image = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, width, 78), fill=(10, 16, 24))
    text(draw, (28, 19), "TEMPORAL SPARKLE MAP", 24, INK, bold=True)
    text(
        draw,
        (28, 53),
        "RMS of 9-frame temporal high-pass; top 18% specular-luma footprint",
        11,
        MUTED,
    )
    concat = np.concatenate([values.ravel() for values in sparkle_maps])
    vmax = float(np.percentile(concat, 99.7))

    map_w, map_h = 350, 296
    title_y = 88
    for panel_index, code in enumerate(PANEL_CODES):
        x = 28 + panel_index * 390
        values = sparkle_maps[panel_index]
        visible = masks[panel_index]
        color = heat_color(values, vmax)
        color[~visible] = 0.0
        rendered = Image.fromarray((color * 255).astype(np.uint8), "RGB")
        rendered = rendered.resize((map_w, map_h), Image.Resampling.BILINEAR)
        image.paste(rendered, (x, 112))
        draw.rectangle((x, 112, x + map_w, 112 + map_h), outline=(45, 60, 74))
        text(draw, (x, title_y), code, 18, PANEL_COLORS[panel_index], bold=True)
        text(draw, (x + 26, title_y + 2), PANEL_TITLES[panel_index], 12, INK)
        reduction = ""
        if code == "B":
            reduction = f"-{sparkle['reduction']['prefiltered_vs_raw_pct']:.1f}% vs A"
        elif code == "C":
            reduction = f"-{sparkle['reduction']['stepped_vs_raw_pct']:.1f}% vs A"
        text(
            draw,
            (x + map_w, title_y + 4),
            reduction or "reference",
            10,
            MUTED,
            anchor="ra",
        )
        text(
            draw,
            (x, 414),
            f"sparkle {sparkle[code]['sparkle_norm']:.4f}  /  abs {sparkle[code]['sparkle_abs']:.4f}",
            9,
            MUTED,
        )
    image.save(output)


def make_contact_sheet(
    output: Path,
    samples: dict[str, np.ndarray],
    sparkle: dict,
    details: dict,
) -> None:
    cell_w, cell_h = 360, 423
    gap = 20
    width = cell_w * 3 + gap * 4
    height = 88 + 32 + 3 * (30 + cell_h + 20)
    image = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, width, 78), fill=(10, 16, 24))
    text(draw, (28, 18), "NORMAL PREFILTER / NEAR TO FAR", 24, INK, bold=True)
    text(
        draw,
        (28, 52),
        "same camera, lights, ACES exposure  /  temporal sparkle and micro-detail loss",
        11,
        MUTED,
    )

    for column, (label, frame_index) in enumerate(SAMPLE_FRAMES.items()):
        x = gap + column * (cell_w + gap)
        text(
            draw,
            (x + cell_w // 2, 94),
            f"{label.upper()}  {frame_index / FPS:.1f}s",
            11,
            INK,
            mono=True,
            anchor="ma",
        )

    for row, code in enumerate(PANEL_CODES):
        y = 118 + row * (30 + cell_h + 20)
        draw.rectangle((gap, y, width - gap, y + 3), fill=PANEL_COLORS[row])
        text(draw, (gap, y + 7), code, 17, PANEL_COLORS[row], bold=True)
        text(draw, (gap + 25, y + 9), PANEL_TITLES[row], 12, INK)
        if code == "B":
            note = f"sparkle -{sparkle['reduction']['prefiltered_vs_raw_pct']:.1f}% vs A"
        elif code == "C":
            note = f"sparkle -{sparkle['reduction']['stepped_vs_raw_pct']:.1f}% vs A"
        else:
            note = "reference"
        text(draw, (width - gap, y + 10), note, 10, MUTED, anchor="ra")

        for column, label in enumerate(SAMPLE_FRAMES):
            frame = samples[label]
            x0 = row * (PANEL_WIDTH + PANEL_GAP)
            crop = frame[VIEW_TOP : VIEW_TOP + VIEW_HEIGHT, x0 : x0 + PANEL_WIDTH]
            rendered = Image.fromarray(crop, "RGB").resize(
                (cell_w, cell_h), Image.Resampling.LANCZOS
            )
            x = gap + column * (cell_w + gap)
            image.paste(rendered, (x, y + 30))
            detail = details[label]["retention_vs_raw_pct"][code]
            text(
                draw,
                (x + 8, y + 38),
                f"detail {detail:.0f}%",
                9,
                (190, 205, 216),
            )
    image.save(output)


def make_mip_sheet(
    output: Path,
    generated_dir: Path,
    mip_stats: dict,
) -> None:
    width, height = 1200, 1030
    image = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, width, 90), fill=(10, 16, 24))
    text(draw, (28, 18), "NORMAL MIP PREFILTER", 24, INK, bold=True)
    text(
        draw,
        (28, 53),
        "vector averaging + encoded local normal variance  /  RGB normal, A variance x4",
        11,
        MUTED,
    )

    tile_w, tile_h = 360, 292
    gap = 20
    table = mip_stats.get("table", [])
    for level in range(9):
        column = level % 3
        row = level // 3
        x = gap + column * (tile_w + gap)
        y = 108 + row * (tile_h + gap)
        draw.rectangle((x, y, x + tile_w, y + tile_h), fill=PANEL_BG)
        draw.rectangle((x, y, x + 3, y + tile_h), fill=PANEL_COLORS[1])
        map_path = generated_dir / f"mip_{level:02d}.png"
        if map_path.exists():
            source = Image.open(map_path).convert("RGB")
            target = 236
            resample = (
                Image.Resampling.NEAREST if level >= 4 else Image.Resampling.LANCZOS
            )
            source = source.resize((target, target), resample)
            image.paste(source, (x + 12, y + 10))
            draw.rectangle(
                (x + 12, y + 10, x + 12 + target, y + 10 + target),
                outline=(46, 61, 76),
            )
        text(draw, (x + 264, y + 18), f"LOD {level}", 15, INK, bold=True)
        if level < len(table):
            data = table[level]
            text(
                draw,
                (x + 264, y + 46),
                f"{data['size']}^2",
                11,
                MUTED,
                mono=True,
            )
            text(
                draw,
                (x + 12, y + 258),
                f"var {data['mean_normal_variance']:.3f}   "
                f"B {data['prefiltered_roughness']:.3f}   "
                f"C {data['stepped_roughness']:.3f}",
                9,
                MUTED,
                mono=True,
            )
    image.save(output)


def build_summary(
    frame_count: int,
    panel_means: np.ndarray,
    residual_gains: np.ndarray,
    render_gains: dict,
    sparkle_result: dict,
    stability: dict,
    details: dict,
    roughness: dict,
    mip_stats: dict,
) -> dict:
    target = float(panel_means.mean())
    sparkle = sparkle_result["sparkle"]
    a_cv = stability["A"]["cv_full"]
    b_cv = stability["B"]["cv_full"]
    a_flicker = stability["A"]["mean_flicker_pct"]
    b_flicker = stability["B"]["mean_flicker_pct"]
    near_loss_b = 100.0 - details["near"]["retention_vs_raw_pct"]["B"]
    far_loss_b = 100.0 - details["far"]["retention_vs_raw_pct"]["B"]
    near_loss_c = 100.0 - details["near"]["retention_vs_raw_pct"]["C"]
    far_loss_c = 100.0 - details["far"]["retention_vs_raw_pct"]["C"]
    return {
        "sequence": {
            "frames": frame_count,
            "fps": FPS,
            "duration_s": frame_count / FPS,
            "resolution": "1280x720",
            "renderer": "Godot 4.2.2 / GL Compatibility / llvmpipe",
            "panels": {
                code: PANEL_TITLES[index]
                for index, code in enumerate(PANEL_CODES)
            },
        },
        "exposure": {
            "method": "one fixed sequence-wide gain per panel; no auto exposure",
            "per_frame_auto_exposure": False,
            "render_gains": {code: float(render_gains.get(code, 1.0)) for code in PANEL_CODES},
            "analysis_residual_gains": {
                code: float(residual_gains[index])
                for index, code in enumerate(PANEL_CODES)
            },
            "raw_panel_mean_linear_luma": {
                code: float(panel_means[index])
                for index, code in enumerate(PANEL_CODES)
            },
            "target_mean_linear_luma": target,
            "panel_mean_linear_luma": {
                code: target for code in PANEL_CODES
            },
            "raw_brightness_spread_pct": float(
                (panel_means.max() - panel_means.min()) / target * 100.0
            ),
            "average_exposure_equalized": True,
        },
        "temporal_sparkle": {
            "region": "metal region y=200..555, top 18% temporal-mean luma",
            "metric": "RMS of luma minus 9-frame temporal mean",
            "sparkle": sparkle,
            "exposure_normalized": True,
        },
        "brightness_stability": {
            "metric": (
                "CV of per-frame panel mean luma; mean_flicker_pct is the RMS "
                "of the 9-frame detrended mean"
            ),
            "panels": stability,
            "prefiltered_cv_reduction_vs_raw_pct": (a_cv - b_cv) / max(a_cv, 1e-9) * 100.0,
            "prefiltered_mean_flicker_reduction_vs_raw_pct": (
                (a_flicker - b_flicker) / max(a_flicker, 1e-9) * 100.0
            ),
        },
        "detail_retention": {
            "metric": "RMS of luma minus 17x17 box blur in metal region",
            "stages": details,
            "prefiltered_near_loss_pct": near_loss_b,
            "prefiltered_far_loss_pct": far_loss_b,
            "stepped_near_loss_pct": near_loss_c,
            "stepped_far_loss_pct": far_loss_c,
        },
        "roughness": roughness,
        "texture": {
            "size": mip_stats.get("texture_size"),
            "mip_levels": mip_stats.get("mip_levels"),
            "cells_per_tile": mip_stats.get("cells_per_tile"),
            "variance_encode_scale": mip_stats.get("variance_encode_scale"),
        },
        "notes": {
            "brightness": (
                "All panels share one exposure gain over the complete sequence. "
                "No per-frame auto exposure or eye adaptation is used. Full-sequence "
                "CV includes slow LOD-dependent brightness drift; mean_flicker_pct "
                "isolates local frame-to-frame changes."
            ),
            "detail_loss": (
                "Prefiltering suppresses sub-pixel normal variance, so far-field "
                "micro-detail falls while temporal sparkle drops. A lower far-field "
                "detail number is not automatically worse: much of raw A's far-field "
                "high frequency is aliasing."
            ),
            "static_steps": (
                "C keeps the filtered normal but replaces continuous variance-aware "
                "roughness with seven hard mip-driven levels, producing visible bands."
            ),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="PNG frame directory or video")
    parser.add_argument("--out", default="artifacts")
    parser.add_argument("--generated", default="artifacts/generated")
    parser.add_argument("--calibration", default="calibration.json")
    args = parser.parse_args()

    source = Path(args.input)
    out_dir = Path(args.out)
    generated_dir = Path(args.generated)
    out_dir.mkdir(parents=True, exist_ok=True)

    print("[analyze] first pass:", source)
    first = first_pass(source)
    panel_means = first["panel_means"]
    target = float(panel_means.mean())
    residual_gains = target / np.maximum(panel_means, 1e-9)
    print(
        "[analyze] panels",
        " ".join(
            f"{code}={panel_means[index]:.5f}"
            for index, code in enumerate(PANEL_CODES)
        ),
        f"target={target:.5f}",
    )

    print("[analyze] second pass: temporal sparkle")
    sparkle_result = second_pass(
        source,
        first["temporal_mean"],
        panel_means,
        residual_gains,
    )
    stability = brightness_stability(first["frame_means"], residual_gains)
    details = compute_details(first["sample_frames"], residual_gains)

    mip_stats_path = generated_dir / "mip_stats.json"
    mip_stats = (
        json.loads(mip_stats_path.read_text()) if mip_stats_path.exists() else {}
    )
    roughness = roughness_summary(mip_stats_path, details)
    render_gains = json.loads(Path(args.calibration).read_text())
    summary = build_summary(
        first["frame_count"],
        panel_means,
        residual_gains,
        render_gains,
        sparkle_result,
        stability,
        details,
        roughness,
        mip_stats,
    )
    (out_dir / "stats.json").write_text(json.dumps(summary, indent=2))

    print("[analyze] figures")
    plot_brightness(
        out_dir / "brightness_stability.png",
        first["frame_means"],
        residual_gains,
        stability,
    )
    plot_sparkle_map(
        out_dir / "sparkle_map.png",
        sparkle_result["sparkle_maps"],
        sparkle_result["masks"],
        sparkle_result["sparkle"],
    )
    make_contact_sheet(
        out_dir / "contact_sheet.png",
        first["sample_frames"],
        sparkle_result["sparkle"],
        details,
    )
    preview_dir = out_dir / "previews"
    preview_dir.mkdir(exist_ok=True)
    for label, rgb in first["sample_frames"].items():
        Image.fromarray(rgb, "RGB").save(preview_dir / f"{label}.png")
    if mip_stats:
        make_mip_sheet(out_dir / "normal_mip_sheet.png", generated_dir, mip_stats)

    sparkle = sparkle_result["sparkle"]
    print(
        "[analyze] sparkle reduction A->B %.2f%%, A->C %.2f%%"
        % (
            sparkle["reduction"]["prefiltered_vs_raw_pct"],
            sparkle["reduction"]["stepped_vs_raw_pct"],
        )
    )
    print(
        "[analyze] detail near A/B/C %.1f/%.1f/%.1f%%, far %.1f/%.1f/%.1f%%"
        % (
            details["near"]["retention_vs_raw_pct"]["A"],
            details["near"]["retention_vs_raw_pct"]["B"],
            details["near"]["retention_vs_raw_pct"]["C"],
            details["far"]["retention_vs_raw_pct"]["A"],
            details["far"]["retention_vs_raw_pct"]["B"],
            details["far"]["retention_vs_raw_pct"]["C"],
        )
    )


if __name__ == "__main__":
    main()
