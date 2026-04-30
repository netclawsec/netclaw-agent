#!/usr/bin/env python3
"""
Generate a macOS .icns icon for NetClaw Agent.

Input:  LOGO_01.jpg (full logo with "网钳" text below the graphic)
Output: packaging/macos/icon/NetClawAgent.icns

Steps:
    1. Load the source JPG, crop the upper half so only the graphic remains
       (the Chinese characters below are dropped).
    2. Auto-trim whitespace around the graphic so it scales correctly.
    3. Draw a macOS-style squircle background (solid white with subtle blue
       gradient) and composite the graphic centered inside a 80% safe area.
    4. Apply a rounded-rectangle alpha mask so the icon has transparent
       corners (macOS Big Sur+ app icon convention).
    5. Save each required size into a .iconset directory.
    6. Call `iconutil -c icns ...` to produce the final .icns.

Usage:
    python3 packaging/macos/make_icns.py \\
        --input LOGO_01.jpg \\
        --output packaging/macos/icon/NetClawAgent.icns
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:
    print("Pillow required. Install with: pip install Pillow", file=sys.stderr)
    sys.exit(1)


ICNS_SIZES = [
    # (pixel_size, filename_inside_iconset)
    (16, "icon_16x16.png"),
    (32, "icon_16x16@2x.png"),
    (32, "icon_32x32.png"),
    (64, "icon_32x32@2x.png"),
    (128, "icon_128x128.png"),
    (256, "icon_128x128@2x.png"),
    (256, "icon_256x256.png"),
    (512, "icon_256x256@2x.png"),
    (512, "icon_512x512.png"),
    (1024, "icon_512x512@2x.png"),
]

# macOS icon corner-radius-to-side ratio. Real squircle is closer to ~22.37%
# but a rounded rectangle at 22.5% is visually indistinguishable at app sizes.
CORNER_RADIUS_RATIO = 0.2237


def _auto_crop(image: Image.Image, threshold: int = 240) -> Image.Image:
    """Trim mostly-white margins around the opaque content."""
    gray = image.convert("L")
    # treat anything below `threshold` as content
    mask = gray.point(lambda p: 0 if p > threshold else 255)
    bbox = mask.getbbox()
    if bbox is None:
        return image
    return image.crop(bbox)


def _whites_to_transparent(image: Image.Image, threshold: int = 235) -> Image.Image:
    """Replace near-white pixels with transparency (vectorized via numpy).

    For pixels above `threshold` (very near white) → fully transparent.
    For mid-range pixels (180..threshold) → proportional alpha for smooth edges.
    """
    import numpy as np

    rgba = np.asarray(image.convert("RGBA")).astype(np.int32)
    r, g, b = rgba[..., 0], rgba[..., 1], rgba[..., 2]
    brightness = (r + g + b) // 3

    alpha = rgba[..., 3].astype(np.float32)
    # Above threshold → fully transparent.
    alpha = np.where(brightness >= threshold, 0.0, alpha)
    # Mid-range 180..threshold → linear fade.
    mid = (brightness >= 180) & (brightness < threshold)
    scale = (threshold - brightness.astype(np.float32)) / float(max(1, threshold - 180))
    scale = np.clip(scale, 0.0, 1.0)
    alpha = np.where(mid, alpha * scale, alpha)

    rgba[..., 3] = np.clip(alpha, 0, 255).astype(np.int32)
    return Image.fromarray(rgba.astype(np.uint8), "RGBA")


def _squircle_mask(size: int, radius_ratio: float = CORNER_RADIUS_RATIO) -> Image.Image:
    """Return an L-mode mask with a rounded-square shape."""
    mask = Image.new("L", (size, size), 0)
    radius = int(size * radius_ratio)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def _make_background(size: int) -> Image.Image:
    """Build a 1024x1024 background — solid white canvas for the logo."""
    # The source logo is blue-on-white; keep the background white so the
    # brand color pops. macOS automatic color adjustment handles dark mode.
    bg = Image.new("RGBA", (size, size), (255, 255, 255, 255))

    # Subtle radial gradient for depth (light blue tint toward top-left)
    gradient = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(gradient)
    for i in range(size, 0, -8):
        alpha = max(0, int(18 * (i / size)))
        # faint NetClaw brand-blue ( ~#5BA9F5 ) dotted over white
        gdraw.ellipse(
            (
                size // 2 - i // 2,
                size // 2 - i // 2,
                size // 2 + i // 2,
                size // 2 + i // 2,
            ),
            fill=(91, 169, 245, alpha),
        )
    gradient = gradient.filter(ImageFilter.GaussianBlur(radius=size // 32))
    bg = Image.alpha_composite(bg, gradient)
    return bg


def _compose_icon(source_path: Path, output_size: int = 1024) -> Image.Image:
    """Produce a single high-res icon PNG (RGBA, 1024x1024 default)."""
    src = Image.open(source_path).convert("RGBA")

    # The full logo is vertical with the graphic in the top ~55% and the
    # "网钳" characters in the bottom ~45%. Slice off the bottom.
    w, h = src.size
    top_half = src.crop((0, 0, w, int(h * 0.55)))

    # Trim residual whitespace so the graphic centers properly.
    cropped = _auto_crop(top_half, threshold=245)

    # Replace the near-white JPEG background with transparency so only the
    # blue figure shows on top of our squircle canvas.
    cropped = _whites_to_transparent(cropped, threshold=235)

    # Fit the cropped graphic into a square with 20% padding on all sides
    # (i.e. graphic occupies 80% of the icon area — matches Apple's HIG
    # "safe zone" guidance for app icons).
    inner = int(output_size * 0.78)
    cw, ch = cropped.size
    scale = min(inner / cw, inner / ch)
    new_w = max(1, int(cw * scale))
    new_h = max(1, int(ch * scale))
    scaled = cropped.resize((new_w, new_h), Image.LANCZOS)

    bg = _make_background(output_size)

    # Center the graphic
    ox = (output_size - new_w) // 2
    oy = (output_size - new_h) // 2
    bg.alpha_composite(scaled, (ox, oy))

    # Apply squircle alpha mask — transparent corners.
    mask = _squircle_mask(output_size)
    bg.putalpha(mask)

    return bg


def _generate_iconset(master: Image.Image, iconset_dir: Path) -> None:
    iconset_dir.mkdir(parents=True, exist_ok=True)
    for size, fname in ICNS_SIZES:
        resized = master.resize((size, size), Image.LANCZOS)
        # Re-apply a size-appropriate mask so corners stay crisp at small
        # sizes (resampling a 1024 mask down loses sharpness).
        mask = _squircle_mask(size)
        resized.putalpha(mask)
        resized.save(iconset_dir / fname, "PNG", optimize=True)


def _pack_icns(iconset_dir: Path, output_icns: Path) -> None:
    output_icns.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["iconutil", "-c", "icns", str(iconset_dir), "-o", str(output_icns)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(
            f"iconutil failed: {result.stderr}\n"
            "Tip: iconutil ships with Xcode Command Line Tools."
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input", type=Path, required=True, help="Source logo file (JPG/PNG)."
    )
    parser.add_argument("--output", type=Path, required=True, help="Output .icns path.")
    parser.add_argument(
        "--keep-iconset",
        action="store_true",
        help="Keep the intermediate .iconset directory alongside the .icns.",
    )
    args = parser.parse_args()

    if not args.input.is_file():
        print(f"Input file not found: {args.input}", file=sys.stderr)
        return 1

    master = _compose_icon(args.input, output_size=1024)

    with tempfile.TemporaryDirectory() as tmp:
        iconset_dir = Path(tmp) / "NetClawAgent.iconset"
        _generate_iconset(master, iconset_dir)
        _pack_icns(iconset_dir, args.output)

        if args.keep_iconset:
            persistent = args.output.with_suffix(".iconset")
            if persistent.exists():
                shutil.rmtree(persistent)
            shutil.copytree(iconset_dir, persistent)

    print(f"[icon] wrote {args.output} ({args.output.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
