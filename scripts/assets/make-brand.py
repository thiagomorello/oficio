#!/usr/bin/env python3
"""Generates the default brand assets (logo.svg and PWA icons) from the same 5x7 pixel font used by the
in-world sign (client/src/art/brand.ts). Pure Pillow; no SVG rasterizer needed.

    python scripts/assets/make-brand.py [--text OFICIO] [--accent #7c9cff] [--out client/public/assets/brand]

Instances that want their own logo should set OFFICE_LOGO_URL instead of editing these files.
"""
import argparse
import os
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover
    print("Pillow is required: pip install pillow", file=sys.stderr)
    sys.exit(2)

FONT = {
    'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    'B': ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
    'C': ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
    'D': ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
    'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    'F': ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    'G': ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.####'],
    'H': ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    'I': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
    'J': ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
    'K': ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
    'L': ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    'M': ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    'N': ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
    'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    'P': ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    'Q': ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
    'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    'S': ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
    'T': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    'U': ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    'V': ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
    'W': ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
    'X': ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
    'Y': ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
    'Z': ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
    '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
    '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
    '4': ['#...#', '#...#', '#...#', '#####', '....#', '....#', '....#'],
    '5': ['#####', '#....', '#....', '####.', '....#', '....#', '####.'],
    '6': ['.####', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
    '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
    '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
    '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '####.'],
    '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
    ' ': ['.....'] * 7,
}
GW, GH, GAP = 5, 7, 1


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def luminance(rgb):
    def lin(v):
        s = v / 255
        return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def on_color(rgb):
    return (0x12, 0x12, 0x12) if luminance(rgb) > 0.35 else (0xff, 0xff, 0xff)


def glyph_pixels(text):
    """Yields (x, y) of lit pixels for `text` at scale 1, origin 0,0."""
    cx = 0
    for ch in text:
        rows = FONT.get(ch, FONT[' '])
        for y, row in enumerate(rows):
            for x, c in enumerate(row):
                if c == '#':
                    yield cx + x, y
        cx += GW + GAP


def text_width(text):
    n = len(text)
    return 0 if n == 0 else n * GW + (n - 1) * GAP


def rounded_box_rows(w, h, cut=2):
    """Yields (x, y, width) spans of a rounded rectangle, matching client/src/art/brand.ts."""
    for r in range(h):
        edge = min(r, h - 1 - r)
        inset = cut - edge if edge < cut else 0
        yield inset, r, w - inset * 2


def make_logo_svg(text, accent):
    """Wordmark: mark (rounded square with the first letter) + text in white, 1 unit = 1 pixel, viewBox scales."""
    rgb = hex_rgb(accent)
    on = '#%02x%02x%02x' % on_color(rgb)
    mark = 16
    gap_after_mark = 4
    tw = text_width(text)
    w = mark + gap_after_mark + tw
    h = mark
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w * 8}" height="{h * 8}" shape-rendering="crispEdges" role="img" aria-label="{text}">']
    for x, y, sw in rounded_box_rows(mark, mark):
        parts.append(f'<rect x="{x}" y="{y}" width="{sw}" height="1" fill="{accent}"/>')
    first = next((c for c in text if c != ' ' and c in FONT), 'O')
    for x, y in glyph_pixels(first):
        parts.append(f'<rect x="{5 + x}" y="{4 + y}" width="1" height="1" fill="{on}"/>')
    ty = (h - GH) // 2
    for x, y in glyph_pixels(text):
        parts.append(f'<rect x="{mark + gap_after_mark + x}" y="{ty + y}" width="1" height="1" fill="#ffffff"/>')
    parts.append('</svg>')
    return '\n'.join(parts) + '\n'


def make_icon(size, text, accent, maskable=False, bg=None):
    """Square icon: rounded accent box with the first letter. Maskable icons fill the whole canvas (safe zone 80%)."""
    rgb = hex_rgb(accent)
    on = on_color(rgb)
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0) if bg is None else bg)
    d = ImageDraw.Draw(img)
    # 16-unit grid, like the in-world mark
    unit = size / 16
    if maskable:
        d.rectangle([0, 0, size, size], fill=rgb)
        scale = 0.8
        off = (size - size * scale) / 2
        u = unit * scale
    else:
        off, u = 0, unit
        for x, y, sw in rounded_box_rows(16, 16):
            d.rectangle([round(x * u), round(y * u), round((x + sw) * u) - 1, round((y + 1) * u) - 1], fill=rgb)
    first = next((c for c in text if c != ' ' and c in FONT), 'O')
    for x, y in glyph_pixels(first):
        x0 = off + (5 + x) * u
        y0 = off + (4 + y) * u
        d.rectangle([round(x0), round(y0), round(x0 + u) - 1, round(y0 + u) - 1], fill=on)
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--text', default='OFICIO')
    ap.add_argument('--accent', default='#7c9cff')
    ap.add_argument('--out', default=os.path.join('client', 'public', 'assets', 'brand'))
    a = ap.parse_args()
    text = a.text.upper()
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, 'logo.svg'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(make_logo_svg(text, a.accent))
    make_icon(192, text, a.accent).save(os.path.join(a.out, 'icon-192.png'))
    make_icon(512, text, a.accent).save(os.path.join(a.out, 'icon-512.png'))
    make_icon(512, text, a.accent, maskable=True).save(os.path.join(a.out, 'icon-maskable-512.png'))
    make_icon(180, text, a.accent, bg=(0x12, 0x12, 0x12, 255)).save(os.path.join(a.out, 'apple-touch-icon.png'))
    print('brand assets written to', a.out)


if __name__ == '__main__':
    main()
