#!/usr/bin/env python3
"""Generate the Palimpsest app icon set from one master (Apothecary style:
cream paper, ink hairline border, stamp-red circular stamp with a serif P).
Usage: python3 scripts/make_icons.py   (run from apps/readest-app/)"""
import os
import subprocess
from PIL import Image, ImageDraw, ImageFont

S = 1024
PAPER = (244, 239, 228)  # apothecary cream
INK = (38, 34, 27)  # #26221B
STAMP = (140, 59, 34)  # #8C3B22
SERIF = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"
SERIF_PLAIN = "/System/Library/Fonts/Supplemental/Georgia.ttf"


def master() -> Image.Image:
    img = Image.new("RGBA", (S, S), PAPER + (255,))
    d = ImageDraw.Draw(img)
    # Double hairline border, like a bookplate
    for inset, width in ((28, 3), (48, 1)):
        d.rectangle([inset, inset, S - inset, S - inset], outline=INK + (255,), width=width)
    cx = cy = S // 2
    # Stamp: two concentric rings with a distressed gap in the outer ring
    outer = 340
    d.ellipse([cx - outer, cy - outer, cx + outer, cy + outer], outline=STAMP + (255,), width=26)
    d.arc(
        [cx - outer, cy - outer, cx + outer, cy + outer],
        start=205,
        end=245,
        fill=PAPER + (255,),
        width=30,
    )  # wear mark
    inner = 280
    d.ellipse([cx - inner, cy - inner, cx + inner, cy + inner], outline=STAMP + (255,), width=8)
    # Serif P
    f = ImageFont.truetype(SERIF, 400)
    bbox = d.textbbox((0, 0), "P", font=f)
    d.text(
        (cx - (bbox[2] - bbox[0]) / 2 - bbox[0], cy - (bbox[3] - bbox[1]) / 2 - bbox[1] - 14),
        "P",
        font=f,
        fill=STAMP + (255,),
    )
    return img


SIZES_TAURI = {
    "32x32.png": 32,
    "64x64.png": 64,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 1024,
    "Square30x30Logo.png": 30,
    "Square44x44Logo.png": 44,
    "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89,
    "Square107x107Logo.png": 107,
    "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150,
    "Square284x284Logo.png": 284,
    "Square310x310Logo.png": 310,
    "StoreLogo.png": 50,
}


def main() -> None:
    m = master()
    here = os.path.dirname(os.path.abspath(__file__))
    icons = os.path.join(here, "..", "src-tauri", "icons")
    pub = os.path.join(here, "..", "public")
    for name, size in SIZES_TAURI.items():
        m.resize((size, size), Image.LANCZOS).save(os.path.join(icons, name))
    m.resize((48, 48), Image.LANCZOS).save(os.path.join(icons, "icon.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48)])
    # macOS .icns via iconutil
    iconset = os.path.join(here, "icon.iconset")
    os.makedirs(iconset, exist_ok=True)
    for sz in (16, 32, 64, 128, 256, 512, 1024):
        fn = f"icon_{sz//2}x{sz//2}.png" if sz <= 32 else f"icon_{sz//2}x{sz//2}.png"
        m.resize((sz, sz), Image.LANCZOS).save(os.path.join(iconset, fn))
        if sz >= 32:
            m.resize((sz, sz), Image.LANCZOS).save(os.path.join(iconset, fn.replace(".png", "@2x.png")))
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(icons, "icon.icns")], check=True)
    # Web/PWA icons
    m.resize((180, 180), Image.LANCZOS).save(os.path.join(pub, "apple-touch-icon.png"))
    m.resize((512, 512), Image.LANCZOS).save(os.path.join(pub, "icon.png"))
    m.resize((64, 64), Image.LANCZOS).save(os.path.join(pub, "icon-tiny.png"))
    m.resize((48, 48), Image.LANCZOS).save(os.path.join(pub, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)])
    print("icon set written")


if __name__ == "__main__":
    main()
