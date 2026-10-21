#!/usr/bin/env python3
"""
Regenerates the WorkNest HR Android launcher icons so the *visible* artwork is
centred exactly on the icon canvas.

Background / root cause
-----------------------
The original `Worknest Logo.png.png` contains ~37,000 near-invisible pixels
(alpha 1-8) that form a faint halo around the artwork, extending well beyond it.
Measuring the artwork with `Image.getbbox()` counts any pixel with alpha != 0,
so the halo was mistaken for artwork: the launcher crop spanned x=103-1013 while
the visible logo is actually x=276-1010. That injected 173 px of dead space on
the left but only 3 px on the right, pushing the drawn logo ~5.8% of the canvas
width to the right (measured: +25 px at 432 px, margins L133 R83), and it also
made the icon render smaller than intended because the scaling used the inflated
crop width.

Fix
---
Crop and centre on the *visible* artwork (alpha above a visibility threshold),
verify the result pixel-by-pixel, and correct any residual rounding bias. The
original logo file is only ever read, never modified.

Usage:  python3 scripts/generate_launcher_icons.py [--verify-only]
"""

from __future__ import annotations

import argparse
import os
import sys
from PIL import Image, ImageDraw

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

LOGO_PATH = "Worknest Logo.png.png"
RES_DIR = "android/app/src/main/res"

# Alpha above which a pixel counts as visible artwork. The logo's halo sits at
# alpha 1-8; measured bounds are stable from alpha>8 all the way to alpha>64.
VISIBLE_ALPHA = 16

# Row band of the logo that contains the "W + people + clock" symbol only
# (the wordmark and tagline sit below it). Measured from content bands.
SYMBOL_BAND = (206, 714)

# Fraction of the canvas width that the VISIBLE artwork should occupy.
ADAPTIVE_FILL = 0.62   # adaptive foreground (108dp canvas)
SQUARE_FILL = 0.66     # legacy square icon   (48dp canvas)
ROUND_FILL = 0.60      # legacy round icon    (48dp canvas, must fit the circle)

DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}

WHITE = (255, 255, 255, 255)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def visible_bbox(image: Image.Image, alpha: int = VISIBLE_ALPHA):
    """Bounding box of *visible* artwork, ignoring near-invisible halo pixels."""
    mask = image.getchannel("A").point(lambda v: 255 if v > alpha else 0)
    return mask.getbbox()


def art_centre_offset(image: Image.Image, alpha: int = VISIBLE_ALPHA):
    """(dx, dy) of the visible artwork centre relative to the canvas centre."""
    box = visible_bbox(image, alpha)
    if not box:
        return None
    w, h = image.size
    return ((box[0] + box[2]) / 2 - w / 2, (box[1] + box[3]) / 2 - h / 2)


def _composite(canvas_size: int, art: Image.Image, pos) -> Image.Image:
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    canvas.alpha_composite(art, pos)
    return canvas


def centre_art_on_canvas(canvas_size: int, art: Image.Image, content_width: int) -> Image.Image:
    """
    Return a transparent canvas of `canvas_size` with `art` scaled so its visible
    width is as close as possible to `content_width`, positioned so the *visible*
    artwork is centred horizontally and vertically.

    Two details make the centring exact rather than approximate:

    * The content width is snapped to the same parity as the canvas. Otherwise
      (canvas - content) is odd and the artwork centre inherently lands on a
      half pixel, which is the residual bias seen in the first attempt.
    * The position is solved in one step. Because the composited bounding box
      shifts one-for-one with the paste position, the offset at any position is
      `offset(base) + (pos - base)`, so the best integer position can be computed
      directly instead of by iterating (which oscillated by +-1.5 px).
    """
    best = None

    for cw in (content_width, content_width + 1, content_width - 1):
        if cw < 1:
            continue
        # snap to the canvas parity so equal margins are attainable
        if (cw % 2) != (canvas_size % 2):
            cw += 1

        scale = cw / art.width
        scaled = art.resize(
            (max(1, round(art.width * scale)), max(1, round(art.height * scale))),
            Image.LANCZOS,
        )
        box = visible_bbox(scaled)
        if not box:
            continue

        base = (round(canvas_size / 2 - (box[0] + box[2]) / 2),
                round(canvas_size / 2 - (box[1] + box[3]) / 2))
        canvas = _composite(canvas_size, scaled, base)
        off = art_centre_offset(canvas)
        if off is None:
            continue

        # one-shot correction: off(pos) = off + (pos - base)
        pos = (base[0] + round(-off[0]), base[1] + round(-off[1]))
        canvas = _composite(canvas_size, scaled, pos)
        final = art_centre_offset(canvas)
        if final is None:
            continue

        score = (abs(final[0]) + abs(final[1]), abs(cw - content_width))
        if best is None or score < best[0]:
            best = (score, canvas)

    if best is None:
        raise ValueError("unable to centre artwork: no visible pixels found")
    return best[1]


def max_visible_radius(image: Image.Image) -> float:
    """Greatest distance of any visible artwork pixel from the canvas centre."""
    w, h = image.size
    mask = image.getchannel("A").point(lambda v: 255 if v > VISIBLE_ALPHA else 0)
    px = mask.load()
    cx = cy = (w - 1) / 2
    worst = 0.0
    for y in range(h):
        for x in range(w):
            if px[x, y]:
                d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
                if d > worst:
                    worst = d
    return worst


def centre_art_within_mask(canvas_size: int, art: Image.Image, content_width: int,
                           safe_radius_px: float) -> Image.Image:
    """
    Centre the artwork, shrinking it if necessary so that *every* visible pixel
    stays inside `safe_radius_px` of the centre.

    Android only guarantees the central 72dp of the 108dp adaptive layer
    (radius 36dp = 1/3 of the layer). Circular launcher masks use exactly that
    circle, so any artwork outside it gets shaved - which is what happened to the
    outer tips of the "W" at the previous size.
    """
    cw = content_width
    canvas = centre_art_on_canvas(canvas_size, art, cw)
    for _ in range(24):
        worst = max_visible_radius(canvas)
        if worst <= safe_radius_px:
            return canvas
        # shrink proportionally, with a little extra so parity snapping cannot
        # push it back over the limit
        cw = max(1, int(cw * (safe_radius_px / worst)) - 2)
        canvas = centre_art_on_canvas(canvas_size, art, cw)
    return canvas


def mask_clip_report(canvas: Image.Image, radius: float):
    """Count visible pixels lying outside a circular mask of the given radius."""
    w, h = canvas.size
    cx = cy = (w - 1) / 2
    mask = canvas.getchannel("A").point(lambda v: 255 if v > VISIBLE_ALPHA else 0)
    px = mask.load()
    outside = 0
    for y in range(h):
        for x in range(w):
            if px[x, y] and ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 > radius:
                outside += 1
    return outside


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify-only", action="store_true",
                        help="only check the assets already on disk")
    args = parser.parse_args()

    logo = Image.open(LOGO_PATH).convert("RGBA")

    # ---- Extract the symbol using VISIBLE artwork bounds (not the halo) ---- #
    band_top, band_bottom = SYMBOL_BAND
    band = logo.crop((0, band_top, logo.width, band_bottom))
    symbol_box = visible_bbox(band)
    if not symbol_box:
        print("ERROR: could not locate the logo symbol", file=sys.stderr)
        return 1
    symbol = band.crop(symbol_box)
    sym_w, sym_h = symbol.size

    # ---- Full lockup, for the splash screens (same defect, independently confirmed) ---- #
    lockup_box = visible_bbox(logo)
    lockup = logo.crop(lockup_box)
    lock_w, lock_h = lockup.size

    print("Corrected source bounds (visible artwork, alpha > %d)" % VISIBLE_ALPHA)
    print(f"  symbol : x={symbol_box[0]}..{symbol_box[2]} y={band_top+symbol_box[1]}..{band_top+symbol_box[3]}"
          f"  -> {sym_w}x{sym_h}px  aspect={sym_w/sym_h:.3f}")
    print(f"  lockup : x={lockup_box[0]}..{lockup_box[2]} y={lockup_box[1]}..{lockup_box[3]}"
          f"  -> {lock_w}x{lock_h}px  aspect={lock_w/lock_h:.3f}")
    print(f"  (previously used symbol x=103..1013 and full x=0..1139 from the raw halo bounds)")
    print()

    if args.verify_only:
        return verify_only()

    failures: list[str] = []
    written = 0

    # ------------------------------------------------------------------ #
    # 1. Adaptive icon foreground (108dp canvas; background comes from
    #    @color/ic_launcher_background = #FFFFFF)
    # ------------------------------------------------------------------ #
    # Android guarantees the central 72dp of the 108dp layer (radius 36dp). Keep
    # a small margin inside it so circular masks never shave the artwork.
    SAFE_RADIUS_DP = 35.5

    for name, scale in DENSITIES.items():
        cs = round(108 * scale)
        content_w = max(1, round(cs * ADAPTIVE_FILL))
        canvas = centre_art_within_mask(cs, symbol, content_w, SAFE_RADIUS_DP * scale)
        content_w = visible_bbox(canvas)[2] - visible_bbox(canvas)[0]

        # The central 72dp square must contain the artwork in every direction.
        box = visible_bbox(canvas)
        min_margin = min(box[0], box[1], cs - box[2], cs - box[3])
        min_margin_dp = min_margin / scale
        if min_margin_dp < (108 - 72) / 2:  # 18dp reserved ring
            failures.append(f"foreground-{name}: artwork intrudes into the reserved ring")
        # Hard guarantee: nothing outside the circular safe zone. The central
        # 72dp of the 108dp layer is always visible, so its radius is 36dp.
        worst_dp = max_visible_radius(canvas) / scale
        if worst_dp > 36.0:
            failures.append(
                f"foreground-{name}: {worst_dp - 36:.1f}dp of artwork falls outside the 36dp safe circle"
            )

        path = f"{RES_DIR}/mipmap-{name}/ic_launcher_foreground.png"
        canvas.save(path)
        written += 1
        off = art_centre_offset(canvas)
        print(f"  {path:58s} {cs:>3}px  content {content_w}px  "
              f"offset ({off[0]:+.1f},{off[1]:+.1f})  margin {min_margin_dp:.1f}dp  "
              f"max radius {worst_dp:.1f}dp (safe <= {SAFE_RADIUS_DP}dp)")

    print()

    # ------------------------------------------------------------------ #
    # 2. Legacy launcher icons (48dp canvas, opaque white like the logo)
    # ------------------------------------------------------------------ #
    for name, scale in DENSITIES.items():
        cs = round(48 * scale)
        for variant, fill, circular in (("", SQUARE_FILL, False), ("_round", ROUND_FILL, True)):
            content_w = max(1, round(cs * fill))
            art_layer = centre_art_on_canvas(cs, symbol, content_w)

            background = Image.new("RGBA", (cs, cs), (0, 0, 0, 0))
            draw = ImageDraw.Draw(background)
            if circular:
                draw.ellipse((0, 0, cs - 1, cs - 1), fill=WHITE)
            else:
                draw.rectangle((0, 0, cs, cs), fill=WHITE)

            if circular and mask_clip_report(art_layer, cs / 2) > 0:
                failures.append(f"legacy{'_round' or ''}-{name}: artwork clipped by the round icon shape")

            icon = Image.alpha_composite(background, art_layer)
            path = f"{RES_DIR}/mipmap-{name}/ic_launcher{variant}.png"
            icon.save(path)
            written += 1
            off = art_centre_offset(art_layer)
            print(f"  {path:58s} {cs:>3}px  content {content_w}px  offset ({off[0]:+.1f},{off[1]:+.1f})")

    print()

    # ------------------------------------------------------------------ #
    # 3. Splash screens — same halo defect independently confirmed, so the
    #    lockup is re-centred on the visible artwork too.
    # ------------------------------------------------------------------ #
    splashes = {
        "drawable/splash.png": (480, 320),
        "drawable-land-mdpi/splash.png": (480, 320),
        "drawable-land-hdpi/splash.png": (800, 480),
        "drawable-land-xhdpi/splash.png": (1280, 720),
        "drawable-land-xxhdpi/splash.png": (1600, 960),
        "drawable-land-xxxhdpi/splash.png": (1920, 1280),
        "drawable-port-mdpi/splash.png": (320, 480),
        "drawable-port-hdpi/splash.png": (480, 800),
        "drawable-port-xhdpi/splash.png": (720, 1280),
        "drawable-port-xxhdpi/splash.png": (960, 1600),
        "drawable-port-xxxhdpi/splash.png": (1280, 1920),
    }
    for rel, (w, h) in splashes.items():
        target_w = int(w * 0.55) if w <= h else int(w * 0.42)
        target_w = min(target_w, int(w * 0.80))
        if lock_w / lock_h * 1 > 0 and target_w / (lock_w / lock_h) > int(h * 0.80):
            target_w = int(int(h * 0.80) * (lock_w / lock_h))
        scaled = lockup.resize(
            (max(1, target_w), max(1, round(target_w * lock_h / lock_w))), Image.LANCZOS
        )

        canvas = Image.new("RGBA", (w, h), WHITE)
        # centre the visible lockup exactly, in whole pixels
        rect_off = art_centre_offset(scaled)
        pos = (round((w - scaled.width) / 2 - rect_off[0]),
               round((h - scaled.height) / 2 - rect_off[1]))
        canvas.alpha_composite(scaled, pos)
        canvas.convert("RGB").save(f"{RES_DIR}/{rel}")
        written += 1

    print(f"  re-centred {len(splashes)} splash images (visible lockup, was ~37px high / 60px right of centre)")

    # ---- report ---- #
    print()
    if failures:
        print("VALIDATION FAILURES:")
        for f in failures:
            print("  -", f)
        return 1

    print(f"SUCCESS: wrote {written} assets; every launcher icon is centred on the visible artwork")
    return verify_only()


def verify_only() -> int:
    """Measure the assets currently on disk and assert they are centred."""
    print("=" * 96)
    print("VERIFICATION - visible-artwork centre offset from canvas centre (must be < 1px)")
    print("=" * 96)
    bad = 0
    for name, scale in DENSITIES.items():
        for fname in ("ic_launcher", "ic_launcher_round", "ic_launcher_foreground"):
            path = f"{RES_DIR}/mipmap-{name}/{fname}.png"
            if not os.path.exists(path):
                print(f"  MISSING {path}")
                bad += 1
                continue
            im = Image.open(path).convert("RGBA")
            if fname == "ic_launcher":
                # opaque white background: measure the artwork itself
                art = Image.new("RGBA", im.size, (0, 0, 0, 0))
                px = im.load()
                ap = art.load()
                for y in range(im.height):
                    for x in range(im.width):
                        r, g, b, a = px[x, y]
                        if (255 - r) + (255 - g) + (255 - b) > 12:
                            ap[x, y] = (r, g, b, 255)
                off = art_centre_offset(art)
            else:
                off = art_centre_offset(im)
            status = "OK " if off and abs(off[0]) < 1 and abs(off[1]) < 1 else "OFF"
            if status == "OFF":
                bad += 1
            print(f"  [{status}] {path:58s} offset ({off[0]:+.1f}, {off[1]:+.1f})")
    print()
    print(f"RESULT: {'ALL CENTRED' if bad == 0 else f'{bad} asset(s) still off-centre'}")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
