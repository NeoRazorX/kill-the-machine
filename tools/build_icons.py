"""Regenerate PNG/ICO icons from the real Segador render (requires Pillow).

First update the render if the model changes:
    blender -b --python tools/render_icon.py
Then regenerate the web sizes:
    python3 tools/build_icons.py

Artwork: assets/LICENSE. Script: LICENSE.
"""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "assets" / "icons"
BACKGROUND = "#0b0f14"


def render(size):
    with Image.open(ICONS / "spider-master.png") as source:
        image = Image.new("RGB", source.size, BACKGROUND)
        image.paste(source, mask=source.getchannel("A"))
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main():
    ICONS.mkdir(parents=True, exist_ok=True)
    for name, size in [
        ("favicon-16x16.png", 16),
        ("favicon-32x32.png", 32),
        ("apple-touch-icon.png", 180),
        ("android-chrome-192x192.png", 192),
        ("android-chrome-512x512.png", 512),
        ("maskable-icon-512x512.png", 512),
    ]:
        render(size).save(ICONS / name)
    # Use explicitly downsampled frames at each ICO size.
    frames = [render(size) for size in (16, 32, 48)]
    frames[-1].save(ROOT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)],
                    append_images=frames[:-1], format="ICO")


if __name__ == "__main__":
    main()
