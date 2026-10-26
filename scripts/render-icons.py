"""Erzeugt aus assets/icon/icon-256.png (gerendert aus sqizzo.svg) alle Symbolgrößen."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent / "assets" / "icon"
src = Image.open(root / "icon-256.png").convert("RGBA")
print("Ecke transparent:", src.getpixel((0, 0))[3] == 0)
for size in (128, 32):
    im = src.resize((size, size), Image.LANCZOS)
    im.save(root / f"icon-{size}.png")
    (root / f"icon-{size}.rgba").write_bytes(im.tobytes())
src.save(root / "sqizzo.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("ok")
