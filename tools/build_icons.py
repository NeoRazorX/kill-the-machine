"""Regenerate the web icons: python3 tools/build_icons.py (requires Pillow).

Artwork in assets/icons is covered by assets/LICENSE; this script by LICENSE.
All foreground artwork fits in the central 80%-diameter maskable safe circle.
"""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "assets" / "icons"
BACKGROUND = "#0b0f14"
# Shared geometry keeps the SVG and all raster sizes in sync.
SHAPES = [
    ("#8394a6", [(20, 19), (44, 19), (48, 25), (48, 41), (40, 48), (24, 48), (16, 41), (16, 25)]),
    ("#16212c", [(23, 23), (41, 23), (44, 27), (44, 39), (38, 44), (26, 44), (20, 39), (20, 27)]),
    ("#ff3b30", [(22, 29), (30, 31), (30, 35), (22, 34)]),
    ("#ff3b30", [(34, 31), (42, 29), (42, 34), (34, 35)]),
    ("#8394a6", [(27, 39), (37, 39), (37, 41), (27, 41)]),
    ("#3d8bff", [(41, 16), (47, 16), (23, 49), (17, 49)]),
]


def render(size):
    scale = size * 4 / 64
    image = Image.new("RGB", (size * 4, size * 4), BACKGROUND)
    draw = ImageDraw.Draw(image)
    for color, points in SHAPES:
        draw.polygon([(round(x * scale), round(y * scale)) for x, y in points], fill=color)
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main():
    ICONS.mkdir(parents=True, exist_ok=True)
    polygons = "\n".join(
        f'  <polygon fill="{color}" points="{" ".join(f"{x},{y}" for x, y in points)}"/>'
        for color, points in SHAPES
    )
    (ICONS / "favicon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n'
        f'  <rect width="64" height="64" fill="{BACKGROUND}"/>\n{polygons}\n</svg>\n'
    )
    for name, size in [
        ("favicon-16x16.png", 16),
        ("favicon-32x32.png", 32),
        ("apple-touch-icon.png", 180),
        ("android-chrome-192x192.png", 192),
        ("android-chrome-512x512.png", 512),
        ("maskable-icon-512x512.png", 512),
    ]:
        render(size).save(ICONS / name)
    # Use explicitly rendered frames so even the smallest ICO size is supersampled.
    frames = [render(size) for size in (16, 32, 48)]
    frames[-1].save(ROOT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)],
                    append_images=frames[:-1], format="ICO")


if __name__ == "__main__":
    main()
