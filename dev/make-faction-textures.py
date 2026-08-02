#!/usr/bin/env python3
"""
Generate per-faction texture variants of the shared KayKit skeleton texture
atlas, for Dungeon Dash Phase 4 (graphics: faction identity, roadmap decision 5).

The source is a flat swatch/trim-sheet atlas (not a photographic bone texture),
so a per-pixel HSV hue rotation is a clean way to reskin it: it leaves the
Value (lightness) channel untouched, which is what sells the material read
(bone highlights/shadows, metal sheen), and leaves near-neutral swatches
(low-saturation greys/blacks/whites used for metal and shadow) essentially
unchanged since they carry little hue to rotate, while shifting the strongly
saturated bone/cloth/leather swatches into the target family.

Usage: python3 dev/make-faction-textures.py
Writes skeleton_texture_goblin.png and skeleton_texture_undead.png next to
the source atlas.
"""
import numpy as np
from PIL import Image

SRC = "KayKit Skeletons/texture/skeleton_texture.png"
OUT_GOBLIN = "KayKit Skeletons/texture/skeleton_texture_goblin.png"
OUT_UNDEAD = "KayKit Skeletons/texture/skeleton_texture_undead.png"

# Also duplicate into characters/gltf/ since that's the directory char3d.js's
# SKEL constant actually loads models from, and where the loose texture the
# generated variants are conceptually "next to" lives too.
DUP_DIRS = ["KayKit Skeletons/characters/gltf/"]


def hue_rotate(im: Image.Image, degrees: float, sat_mul: float = 1.0, val_mul: float = 1.0) -> Image.Image:
    """Rotate hue by `degrees` in HSV space, keep alpha untouched. PIL's HSV
    'H' channel is 0-255 representing 0-360 degrees."""
    rgba = np.array(im.convert("RGBA"))
    rgb = rgba[:, :, :3]
    alpha = rgba[:, :, 3]
    hsv = np.array(Image.fromarray(rgb, "RGB").convert("HSV")).astype(np.int16)
    shift = int(round((degrees / 360.0) * 255))
    hsv[:, :, 0] = (hsv[:, :, 0] + shift) % 256
    hsv[:, :, 1] = np.clip(hsv[:, :, 1].astype(np.float32) * sat_mul, 0, 255).astype(np.uint8)
    hsv[:, :, 2] = np.clip(hsv[:, :, 2].astype(np.float32) * val_mul, 0, 255).astype(np.uint8)
    out_rgb = np.array(Image.fromarray(hsv.astype(np.uint8), "HSV").convert("RGB"))
    out = np.dstack([out_rgb, alpha])
    return Image.fromarray(out, "RGBA")


def main():
    src = Image.open(SRC)

    # Goblin Mines: mine-dwelling raiders, earthy/green. Source is dominated by
    # warm tan/orange bone swatches (~hue 25-40deg) — rotate ~+75deg to land
    # them in olive/moss green (~hue 95-110deg), nudge saturation up slightly
    # since raw hue-rotated greens read a little washed out next to the warm
    # source palette.
    goblin = hue_rotate(src, degrees=75, sat_mul=1.15, val_mul=1.0)
    goblin.save(OUT_GOBLIN)
    print("wrote", OUT_GOBLIN, goblin.size, goblin.mode)

    # The Crypt: cold, necrotic. Rotate the same warm bone hues the other way,
    # ~-140deg, landing them in the blue-violet family that already matches
    # decor3d.js's crypt atmosphere block (bgTop 0x1c1c48, sun 0xcfd8ff).
    # Slightly darken (val_mul<1) for a colder, less lit "undead" read.
    undead = hue_rotate(src, degrees=-140, sat_mul=1.05, val_mul=0.92)
    undead.save(OUT_UNDEAD)
    print("wrote", OUT_UNDEAD, undead.size, undead.mode)

    import shutil, os
    for d in DUP_DIRS:
        for f in (OUT_GOBLIN, OUT_UNDEAD):
            dst = os.path.join(d, os.path.basename(f))
            shutil.copyfile(f, dst)
            print("copied to", dst)


if __name__ == "__main__":
    main()
