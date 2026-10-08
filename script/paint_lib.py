"""Процедурне «малювання» поверхонь для згенерованих моделей техніки (M270, HIMARS).

Усе рахується на numpy детерміновано, тож GLB відтворюється побайтово. Тут:
  * тривимірний і тайловий шум (fbm), яким малюються плями, пил, бруд, подряпини;
  * рецепти матеріалів: фарба з пилом, підтіками й потертостями на ребрах, натівський камуфляж, гума, потерта сталь;
  * трафарети й таблички (decals): картинка проєктується на площину моделі й малюється в текстуру.
Кольори — sRGB 0…1, шорсткість/металевість — 0…1, висота — метри (із неї рахується карта нормалей).
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

U32 = np.uint32


# ------------------------------------------------------------------------------------------------ шум
def _hash(ix, iy, iz, seed):
    h = ix.astype(np.int64).astype(np.uint32) * U32(374761393)
    h = h + iy.astype(np.int64).astype(np.uint32) * U32(668265263)
    h = h + iz.astype(np.int64).astype(np.uint32) * U32(2147483629)
    h = h + U32((seed * 2246822519) & 0xFFFFFFFF)
    h = (h ^ (h >> U32(13))) * U32(1274126177)
    h = h ^ (h >> U32(16))
    return (h >> U32(8)).astype(np.float32) * np.float32(1.0 / 16777216.0)


def noise3(p, seed=0):
    """Значеннєвий шум у точках p (n, 3), значення 0…1."""
    p = np.asarray(p, dtype=np.float32)
    i = np.floor(p)
    f = p - i
    u = f * f * (3 - 2 * f)
    ix, iy, iz = i[:, 0], i[:, 1], i[:, 2]
    ux, uy, uz = u[:, 0], u[:, 1], u[:, 2]
    c = {}
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                c[dx, dy, dz] = _hash(ix + dx, iy + dy, iz + dz, seed)
    x00 = c[0, 0, 0] + (c[1, 0, 0] - c[0, 0, 0]) * ux
    x10 = c[0, 1, 0] + (c[1, 1, 0] - c[0, 1, 0]) * ux
    x01 = c[0, 0, 1] + (c[1, 0, 1] - c[0, 0, 1]) * ux
    x11 = c[0, 1, 1] + (c[1, 1, 1] - c[0, 1, 1]) * ux
    y0 = x00 + (x10 - x00) * uy
    y1 = x01 + (x11 - x01) * uy
    return y0 + (y1 - y0) * uz


def fbm(p, octaves=4, seed=0, gain=0.5, lac=2.03):
    """Сума октав шуму, нормована до 0…1."""
    p = np.asarray(p, dtype=np.float32)
    total = np.zeros(len(p), dtype=np.float32)
    amp, norm, off = 1.0, 0.0, 0.0
    for o in range(octaves):
        total += amp * noise3(p * (lac ** o) + off, seed + 31 * o)
        norm += amp
        amp *= gain
        off += 17.3
    return total / norm


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    t = np.asarray(t)
    if t.ndim == 1 and np.ndim(a) == 2:
        t = t[:, None]
    return a + (b - a) * t


# Тайловий (безшовний) двовимірний шум для матеріалів, що повторюються (гума, ланки, метал).
def tile_noise(size, cells, seed=0):
    rng = np.random.default_rng(seed)
    g = rng.random((cells, cells)).astype(np.float32)
    x = np.arange(size, dtype=np.float32) / size * cells
    i0 = np.floor(x).astype(int) % cells
    i1 = (i0 + 1) % cells
    f = x - np.floor(x)
    u = f * f * (3 - 2 * f)
    top = g[i0][:, i0] * (1 - u)[None, :] + g[i0][:, i1] * u[None, :]
    bot = g[i1][:, i0] * (1 - u)[None, :] + g[i1][:, i1] * u[None, :]
    return top * (1 - u)[:, None] + bot * u[:, None]


def tile_fbm(size, cells=4, octaves=5, seed=0, gain=0.5):
    total = np.zeros((size, size), dtype=np.float32)
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        total += amp * tile_noise(size, cells * 2 ** o, seed + 13 * o)
        norm += amp
        amp *= gain
    return total / norm


# ------------------------------------------------------------------------------------------------ матеріали
def srgb(r, g, b):
    return np.array([r, g, b], dtype=np.float32) / 255.0


class Surface:
    """Накопичувач шарів поверхні для n текселів: колір, шорсткість, металевість, висота."""

    def __init__(self, n, base_rgb, rough=0.7, metal=0.1):
        self.n = n
        self.color = np.tile(np.asarray(base_rgb, dtype=np.float32), (n, 1))
        self.rough = np.full(n, rough, dtype=np.float32)
        self.metal = np.full(n, metal, dtype=np.float32)
        self.height = np.zeros(n, dtype=np.float32)

    def blend(self, rgb, alpha, rough=None, metal=None, height=None):
        a = np.clip(alpha, 0, 1).astype(np.float32)
        self.color = self.color + (np.asarray(rgb, dtype=np.float32) - self.color) * a[:, None]
        if rough is not None:
            self.rough = self.rough + (rough - self.rough) * a
        if metal is not None:
            self.metal = self.metal + (metal - self.metal) * a
        if height is not None:
            self.height = self.height + height * a


def weather(s, P, N, edge_convex, edge_concave, *, seed=0, dust=0.35, rain=0.5, wear=0.6, mud=0.35, rust=0.0,
            dust_rgb=(0.50, 0.42, 0.30), mud_rgb=(0.27, 0.21, 0.15), metal_rgb=(0.52, 0.52, 0.50), scale=1.0,
            ground=0.0):
    """Старіння фарби: плямистість, пил зверху, багнюка знизу, підтіки на вертикалях, потертості на ребрах,
    темніші западини. P — світові координати, N — нормаль, edge_* — відстань до найближчого ребра, м."""
    dust_rgb, mud_rgb, metal_rgb = (np.asarray(c, dtype=np.float32) for c in (dust_rgb, mud_rgb, metal_rgb))
    up = np.clip(N[:, 1], 0, 1)
    side = 1 - np.abs(N[:, 1])
    y = P[:, 1] - ground
    # Плямистість фарби в двох масштабах і дрібне зерно.
    m1 = fbm(P * 1.1 * scale, 4, seed + 1)
    m2 = fbm(P * 7.0 * scale, 3, seed + 2)
    s.color *= (0.84 + 0.30 * m1 + 0.10 * (m2 - 0.5))[:, None]
    grain = noise3(P * 260.0, seed + 3)
    s.color *= (0.97 + 0.06 * grain)[:, None]
    s.height += (grain - 0.5) * 0.00018
    s.rough += (m2 - 0.5) * 0.16
    # Темніші западини (замінник затінення): уздовж увігнутих ребер і в глибоких місцях.
    cav = 1 - smooth(0.0, 0.07, edge_concave)
    s.color *= (1 - 0.34 * cav)[:, None]
    # Підтіки дощу: тонкі вертикальні смуги на похилих і прямовисних гранях.
    st = noise3(np.stack([P[:, 0] * 55, P[:, 1] * 2.4, P[:, 2] * 55], 1), seed + 5) * 0.65 \
        + noise3(np.stack([P[:, 0] * 130, P[:, 1] * 5.0, P[:, 2] * 130], 1), seed + 6) * 0.35
    streak = smooth(0.58, 0.88, st) * side * (0.3 + 0.7 * smooth(0.2, 0.9, fbm(P * 0.9, 3, seed + 7)))
    s.blend((0.20, 0.17, 0.12), streak * 0.42 * rain * 2)
    # Пил: на горизонталях і, слабше, на всьому, плямами.
    d = smooth(0.30, 0.78, fbm(P * 2.4 * scale, 4, seed + 8)) * (0.20 + 0.80 * up) * dust
    s.blend(dust_rgb, d * 0.85, rough=0.9)
    # Багнюка й брудні бризки в нижній частині.
    low = smooth(1.35, 0.15, y)
    mm = smooth(0.38, 0.72, fbm(P * 5.0 * scale, 4, seed + 9)) * low * mud
    s.blend(mud_rgb, mm * 0.95, rough=0.93, metal=0.0, height=0.0012)
    # Потертості фарби на ребрах: видно голий метал.
    chip = smooth(0.35, 0.68, fbm(P * 28.0 * scale, 3, seed + 10))
    w = (1 - smooth(0.0025, 0.016, edge_convex)) * chip * wear
    s.blend(metal_rgb, w, rough=0.38, metal=0.85, height=-0.0004)
    # Іржа в потертостях і на нижніх плямах.
    if rust > 0:
        r = (w * 0.7 + smooth(0.62, 0.8, fbm(P * 14.0, 3, seed + 11)) * 0.25 * low) * rust
        s.blend((0.36, 0.20, 0.10), r, rough=0.8, metal=0.3)
    # Дрібні відколи фарби в довільних місцях.
    c = smooth(0.80, 0.86, noise3(P * 90.0, seed + 12)) * smooth(0.45, 0.7, fbm(P * 6.0, 2, seed + 13)) * wear * 0.6
    s.blend(metal_rgb * 0.8, c, rough=0.45, metal=0.7, height=-0.0003)
    return s


def nato_camo(P, seed=0, colors=None, scale=0.55):
    """Триколірний натівський камуфляж: зелений фон, коричневі й чорні плями. Повертає кольори (n, 3)."""
    green, brown, black = colors or (srgb(84, 92, 58), srgb(150, 116, 72), srgb(27, 29, 25))
    q = P * scale
    a = fbm(q, 4, seed + 101) + 0.10 * (fbm(q * 5.0, 3, seed + 103) - 0.5)
    b = fbm(q + 50.0, 4, seed + 102) + 0.10 * (fbm(q * 5.0 + 9, 3, seed + 104) - 0.5)
    brown_m = smooth(0.525, 0.545, a)
    black_m = smooth(0.585, 0.605, b)
    col = np.tile(green, (len(P), 1))
    col = mix(col, brown, brown_m)
    col = mix(col, black, black_m)
    return col


# ------------------------------------------------------------------------------------------------ трафарети
FONT_DIRS = ['/usr/share/fonts/opentype/urw-base35', '/usr/share/fonts/X11/Type1', '/usr/share/fonts/truetype/dejavu']
_FONTS = {}


def font(px, name='NimbusSansNarrow-Bold.otf'):
    key = (px, name)
    if key not in _FONTS:
        for d in FONT_DIRS:
            f = Path(d) / name
            if f.exists():
                _FONTS[key] = ImageFont.truetype(str(f), px)
                break
        else:
            try:
                _FONTS[key] = ImageFont.truetype('DejaVuSansCondensed-Bold.ttf', px)
            except OSError:
                _FONTS[key] = ImageFont.load_default()
    return _FONTS[key]


def text_decal(lines, height_m, px_per_m=900, color=(235, 232, 218), name='NimbusSansNarrow-Bold.otf', gap=0.0, pad=0.01):
    """Картинка RGBA з написом (кілька рядків). Повертає (image, width_m, height_m)."""
    px = max(8, int(height_m * px_per_m / (len(lines) * 1.25)))
    f = font(px, name)
    boxes = [f.getbbox(t) for t in lines]
    w = max(b[2] - b[0] for b in boxes)
    line_h = int(px * 1.22)
    pad_px = int(pad * px_per_m)
    img = Image.new('RGBA', (w + 2 * pad_px, line_h * len(lines) + 2 * pad_px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i, t in enumerate(lines):
        bw = boxes[i][2] - boxes[i][0]
        d.text((pad_px + (w - bw) / 2 - boxes[i][0], pad_px + i * line_h), t, font=f, fill=(*color, 255))
    return img, img.width / px_per_m, img.height / px_per_m


def stencil_cuts(img, every=0.18, width=0.012):
    """Розрізи-перемички, як у трафаретному шрифті: кілька тонких вертикальних проміжків."""
    a = np.array(img)
    w = a.shape[1]
    step = max(4, int(w * every))
    cut = max(1, int(w * width * 0.5))
    for x in range(step // 2, w, step):
        a[:, x:x + cut, 3] = 0
    return Image.fromarray(a, 'RGBA')


def apply_decal(s, P, N, img, origin, u_axis, v_axis, width, height, *, thick=0.03, min_facing=0.55, relief=0.00035,
                rough=0.7, metal=0.0, seed=0, worn=0.35):
    """Проєктує картинку RGBA на поверхню: точка P потрапляє в трафарет, якщо лежить поблизу площини
    (origin, u_axis, v_axis), дивиться в бік нормалі площини й у межах width × height. v_axis — вгору по картинці."""
    u_axis = np.asarray(u_axis, dtype=np.float32)
    v_axis = np.asarray(v_axis, dtype=np.float32)
    nrm = np.cross(u_axis, v_axis)
    nrm = nrm / np.linalg.norm(nrm)
    rel = P - np.asarray(origin, dtype=np.float32)
    u = rel @ u_axis / width
    v = rel @ v_axis / height
    dist = rel @ nrm
    sel = (u >= 0) & (u < 1) & (v >= 0) & (v < 1) & (np.abs(dist) < thick) & (N @ nrm > min_facing)
    if not sel.any():
        return 0
    idx = np.nonzero(sel)[0]
    arr = np.asarray(img.convert('RGBA'), dtype=np.float32) / 255.0
    h, w = arr.shape[:2]
    from scipy.ndimage import map_coordinates
    uu = u[idx] * (w - 1)
    vv = (1 - v[idx]) * (h - 1)
    coords = np.stack([vv, uu])
    chans = [map_coordinates(arr[:, :, c], coords, order=1, mode='nearest') for c in range(4)]
    alpha = chans[3]
    # Витертий трафарет: випадкові відколи фарби.
    wear = smooth(0.55, 0.85, fbm(P[idx] * 70.0, 3, seed + 41))
    alpha = alpha * (1 - worn * wear)
    rgb = np.stack(chans[:3], 1)
    pre = s.color[idx].copy()
    a = np.clip(alpha, 0, 1)[:, None]
    s.color[idx] = pre + (rgb - pre) * a
    s.rough[idx] += (rough - s.rough[idx]) * a[:, 0]
    s.metal[idx] += (metal - s.metal[idx]) * a[:, 0]
    s.height[idx] += a[:, 0] * relief
    return int(sel.sum())


def box_decal(s, P, N, img, center, normal, up, width, height, **kw):
    """Зручна обгортка: трафарет на площині з центром center, нормаллю normal (назовні) і напрямом «вгору» up."""
    normal = np.asarray(normal, dtype=np.float32)
    normal = normal / np.linalg.norm(normal)
    up = np.asarray(up, dtype=np.float32)
    right = np.cross(up, normal)
    right = right / np.linalg.norm(right)
    up = np.cross(normal, right)
    origin = np.asarray(center, dtype=np.float32) - right * width / 2 - up * height / 2
    return apply_decal(s, P, N, img, origin, right, up, width, height, **kw)


# ------------------------------------------------------------------------------------------------ тайлові матеріали
def _tile_pack(color, rough, metal, height, tile_m, strength=1.0):
    """Пакує тайл: колір (RGB 0…1), шорсткість, металевість, висота (м) → три uint8-картинки."""
    from scipy.ndimage import gaussian_filter
    size = color.shape[0]
    h = gaussian_filter(height.astype(np.float32), 0.5, mode='wrap')
    ts = tile_m / size
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / (2 * ts)
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * ts)
    nx, ny = -gx * strength, gy * strength
    ln = np.sqrt(nx * nx + ny * ny + 1)
    nrm = np.stack([nx / ln, ny / ln, 1 / ln], -1) * 0.5 + 0.5
    orm = np.stack([np.ones_like(rough), rough, metal], -1)
    q = lambda a: (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)
    return q(color), q(orm), q(nrm)


def tile_texture(kind, size=1024, tile_m=0.6):
    """Безшовні PBR-текстури для матеріалів, що повторюються. Колір майже нейтральний (світліше/темніше), тож його
    множать на baseColorFactor матеріалу. Повертає (колір, ORM, нормалі) як uint8-масиви size×size×3."""
    seed = {'paint': 1, 'rubber': 2, 'steel': 3, 'track': 4, 'cast': 5}[kind]
    m1 = tile_fbm(size, 4, 5, seed)
    m2 = tile_fbm(size, 16, 4, seed + 10)
    grain = tile_noise(size, size // 4, seed + 20)
    if kind == 'paint':
        col = np.stack([0.80 + 0.30 * m1 + 0.06 * (m2 - 0.5)] * 3, -1)
        chips = (tile_fbm(size, 24, 3, seed + 30) > 0.66) & (tile_noise(size, 96, seed + 31) > 0.58)
        scratch = tile_noise(size, 256, seed + 32)
        col = np.where(chips[..., None], 1.0, col)
        h = (grain - 0.5) * 0.00025 - chips * 0.0004
        rough = 0.62 + (m2 - 0.5) * 0.18 - chips * 0.2
        metal = 0.15 + chips * 0.6
        return _tile_pack(np.clip(col, 0, 1), rough, metal, h, tile_m)
    if kind == 'cast':
        col = np.stack([0.78 + 0.34 * m1] * 3, -1)
        h = (grain - 0.5) * 0.0008 + (m2 - 0.5) * 0.0015
        return _tile_pack(col, 0.7 + (m2 - 0.5) * 0.2, np.full((size, size), 0.2), h, tile_m)
    if kind == 'rubber':
        col = np.stack([0.62 + 0.45 * m1] * 3, -1) * (0.93 + 0.14 * grain)[..., None]
        h = (grain - 0.5) * 0.0006 + (m2 - 0.5) * 0.0008
        return _tile_pack(col, 0.86 + (m2 - 0.5) * 0.1, np.zeros((size, size)), h, tile_m)
    if kind == 'steel':
        brush = tile_noise(size, 6, seed + 40)
        lines = np.stack([tile_noise(size, 512, seed + 41)] * 1, -1)[..., 0]
        col = np.stack([0.72 + 0.22 * m1 + 0.06 * lines] * 3, -1)
        h = (lines - 0.5) * 0.00018
        return _tile_pack(col, 0.38 + (m2 - 0.5) * 0.2 + 0.1 * brush, np.full((size, size), 0.9), h, tile_m)
    # 'track': темна гусеничнa сталь з іржею, брудом і блискучими стертими краями
    rust = np.clip((tile_fbm(size, 8, 4, seed + 50) - 0.5) * 3.0 + 0.5, 0, 1)
    dirt = np.clip((m1 - 0.42) * 3.5, 0, 1)
    base = np.array([0.30, 0.29, 0.27], np.float32)
    col = base[None, None] * (0.8 + 0.4 * m2[..., None])
    col = col * (1 - 0.6 * dirt[..., None]) + np.array([0.20, 0.15, 0.10]) * (0.6 * dirt[..., None])
    col = col * (1 - 0.30 * rust[..., None]) + np.array([0.36, 0.22, 0.13]) * (0.30 * rust[..., None])
    wornmask = (tile_fbm(size, 20, 3, seed + 60) > 0.72)
    col = np.where(wornmask[..., None], np.array([0.62, 0.62, 0.60]), col)
    h = (grain - 0.5) * 0.0005 + (m2 - 0.5) * 0.0012
    rough = 0.5 + 0.35 * rust + 0.2 * dirt - 0.2 * wornmask
    metal = np.clip(0.85 - 0.6 * rust - 0.6 * dirt + 0.2 * wornmask, 0, 1)
    return _tile_pack(np.clip(col, 0, 1), np.clip(rough, 0.2, 1), metal, h, tile_m)


def panel_seams(s, P, N, sel, *, spacing=(1.15, 0.85), seed=0, seam_w=0.0022, bolt_r=0.0085, bolt_pitch=0.075, groove=0.0016,
                bolt_h=0.0024, min_area_facing=0.72):
    """Шви між листами броні на великих пласких гранях і ряди болтів уздовж швів. Лінії лежать у площинах, паралельних
    осям моделі: на гранях ±z — за x,y; на ±x — за z,y; на ±y — за x,z. sel — маска частин, на які накладаємо шви."""
    axes = ((2, 1, 0), (0, 2, 1), (0, 1, 2))          # (a, b, нормаль): площини x–y, z–y, x–z
    face = np.argmax(np.abs(N), axis=1)
    out_idx = np.nonzero(sel)[0]
    rng = np.random.default_rng(seed)
    for k, (ax_a, ax_b, ax_n) in enumerate(((0, 1, 2), (2, 1, 0), (0, 2, 1))):
        m = sel & (face == ax_n) & (np.abs(N[:, ax_n]) > min_area_facing)
        if not m.any():
            continue
        idx = np.nonzero(m)[0]
        a = P[idx, ax_a]
        b = P[idx, ax_b]
        off_a, off_b = rng.random() * spacing[0], rng.random() * spacing[1]
        # Вертикальні шви (постійне a) і горизонтальні (постійне b); невелике зміщення за позицією, щоб листи були різні.
        ja = (noise3(np.stack([np.floor((b + off_b) / spacing[1]), np.zeros_like(b), np.full_like(b, k)], 1), seed + 70) - 0.5) * spacing[0] * 0.5
        fa = ((a + off_a + ja) / spacing[0]) % 1.0
        fb = ((b + off_b) / spacing[1]) % 1.0
        da = np.minimum(fa, 1 - fa) * spacing[0]
        db = np.minimum(fb, 1 - fb) * spacing[1]
        seam = 1 - pl_smooth(seam_w * 0.45, seam_w, np.minimum(da, db))
        d_edge = np.minimum(da, db)
        # Болти: ряд з обох боків від шва, крок bolt_pitch.
        u_along = np.where(da < db, b, a)
        pitch = (u_along / bolt_pitch) % 1.0
        along = np.abs(pitch - 0.5) * bolt_pitch
        across = np.abs(d_edge - 0.017)
        bolt = 1 - pl_smooth(bolt_r * 0.55, bolt_r, np.hypot(along, across))
        sub = np.full(len(idx), True)
        ss = Surface.__new__(Surface)
        for name in ('color', 'rough', 'metal', 'height'):
            setattr(ss, name, getattr(s, name)[idx])
        ss.n = len(idx)
        ss.blend((0.07, 0.07, 0.06), seam * 0.75, height=-groove)
        ss.blend((0.30, 0.30, 0.28), bolt * 0.8, rough=0.5, metal=0.7, height=bolt_h)
        ss.blend((0.04, 0.04, 0.04), np.clip(bolt_r * 3 - np.hypot(along, across + 0.0015), 0, 1) * 0.0, height=0.0)
        for name in ('color', 'rough', 'metal', 'height'):
            getattr(s, name)[idx] = getattr(ss, name)


pl_smooth = smooth
