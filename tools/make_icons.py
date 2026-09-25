#!/usr/bin/env python3
"""Generate the PWA icons (two rooms: a red and a blue door on a dark tile). Our own art, not the publisher's."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "client" / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

def icon(size: int, pad: float) -> Image.Image:
    im = Image.new("RGBA", (size, size), (17, 17, 23, 255))
    d = ImageDraw.Draw(im)
    p = int(size * pad)
    w = (size - 2 * p) // 2
    r = max(2, size // 24)
    d.rounded_rectangle([p, p, p + w - size // 40, size - p], radius=r, fill=(229, 72, 77, 255))
    d.rounded_rectangle([p + w + size // 40, p, size - p, size - p], radius=r, fill=(62, 123, 250, 255))
    return im

icon(192, 0.18).save(OUT / "icon-192.png")
icon(512, 0.18).save(OUT / "icon-512.png")
icon(512, 0.28).save(OUT / "icon-512-maskable.png")
print("wrote", *sorted(p.name for p in OUT.iterdir()))
