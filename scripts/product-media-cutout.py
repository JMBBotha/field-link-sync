#!/usr/bin/env python3
"""Make a transparent cut-out PNG for a unit image that has a background (product_media.image_status = needs_cutout).
Usage: python3 scripts/product-media-cutout.py <image url or file> <out.png>
Needs: pip install "rembg[cpu]" pillow. Then upload the PNG on Admin > Unit content ("Cut-out PNG")."""
import io, sys, urllib.request
from PIL import Image
from rembg import remove

src, out = sys.argv[1], sys.argv[2]
data = urllib.request.urlopen(urllib.request.Request(src, headers={"User-Agent": "Mozilla/5.0"})).read() if src.startswith("http") else open(src, "rb").read()
im = Image.open(io.BytesIO(remove(data))).convert("RGBA")
bbox = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
if bbox:
    im = im.crop(bbox)
pad = 8
canvas = Image.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0))
canvas.paste(im, (pad, pad))
canvas.save(out, optimize=True)
print(out, canvas.size)
