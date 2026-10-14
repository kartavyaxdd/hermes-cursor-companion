from PIL import Image, ImageDraw, ImageFilter


def make_icon(size: int) -> Image.Image:
    scale = 4
    s = size * scale
    base = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    g.ellipse((s * .14, s * .14, s * .86, s * .86), fill=(63, 145, 255, 105))
    glow = glow.filter(ImageFilter.GaussianBlur(s * .085))
    base.alpha_composite(glow)
    d = ImageDraw.Draw(base)
    d.ellipse((s * .16, s * .16, s * .84, s * .84), fill=(24, 40, 83, 247), outline=(132, 204, 255, 240), width=int(s * .028))
    d.ellipse((s * .31, s * .31, s * .69, s * .69), fill=(78, 137, 240, 255))
    d.ellipse((s * .38, s * .35, s * .58, s * .55), fill=(222, 247, 255, 255))
    d.ellipse((s * .75, s * .11, s * .89, s * .25), fill=(108, 240, 224, 255))
    return base.resize((size, size), Image.Resampling.LANCZOS)


if __name__ == "__main__":
    make_icon(256).save("assets/icon.ico", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    make_icon(32).save("assets/tray.png")
