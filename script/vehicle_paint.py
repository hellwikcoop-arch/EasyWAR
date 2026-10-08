"""Малювальники поверхонь для моделей техніки (M270, HIMARS): пакет LP/C, корпуси, кабіна, ходова.
Кожен малювальник отримує Texels (світові точки, нормалі, відстані до ребер) і повертає paint_lib.Surface."""
import numpy as np

import paint_lib as pl
from paint_lib import Surface, srgb

# Базові кольори (sRGB). Оливкова фарба CARC зі зношеністю, світла хакі труб, темна гума.
OLIVE = srgb(78, 82, 56)
OLIVE_DK = srgb(58, 62, 42)
KHAKI = srgb(142, 138, 100)
KHAKI_LT = srgb(158, 153, 110)
GREY_BULK = srgb(122, 124, 118)
WHITE_STENCIL = (232, 228, 212)
YELLOW_STENCIL = (226, 186, 40)
RED_STENCIL = (176, 40, 34)


def _by_id(tx, table, default):
    out = np.tile(np.asarray(default, np.float32), (tx.n, 1))
    for k, v in table.items():
        out[tx.ids == k] = v
    return out


def fwd_decal(direction, height=0.034, px_per_m=900):
    """Напис «FWD» зі стрілкою й червоною плашкою; direction = +1 — стрілка вправо, −1 — вліво."""
    from PIL import Image, ImageDraw
    text, tw, th = pl.text_decal(['FWD'], height, px_per_m=px_per_m, color=WHITE_STENCIL)
    arrow_w = int(0.075 * px_per_m)
    red_w = int(0.05 * px_per_m)
    W = text.width + arrow_w + red_w + int(0.02 * px_per_m)
    img = Image.new('RGBA', (W, text.height), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    h = text.height
    if direction > 0:
        img.alpha_composite(text, (0, 0))
        x0 = text.width + int(0.006 * px_per_m)
        d.polygon([(x0, h * 0.5 - h * 0.12), (x0 + arrow_w * 0.62, h * 0.5 - h * 0.12), (x0 + arrow_w * 0.62, h * 0.5 - h * 0.30),
                   (x0 + arrow_w, h * 0.5), (x0 + arrow_w * 0.62, h * 0.5 + h * 0.30), (x0 + arrow_w * 0.62, h * 0.5 + h * 0.12),
                   (x0, h * 0.5 + h * 0.12)], fill=(*WHITE_STENCIL, 255))
        d.rectangle([x0 + arrow_w + int(0.008 * px_per_m), h * 0.18, W, h * 0.82], fill=(*RED_STENCIL, 255))
    else:
        d.rectangle([0, h * 0.18, red_w, h * 0.82], fill=(*RED_STENCIL, 255))
        x0 = red_w + int(0.008 * px_per_m)
        d.polygon([(x0 + arrow_w, h * 0.5 - h * 0.12), (x0 + arrow_w * 0.38, h * 0.5 - h * 0.12), (x0 + arrow_w * 0.38, h * 0.5 - h * 0.30),
                   (x0, h * 0.5), (x0 + arrow_w * 0.38, h * 0.5 + h * 0.30), (x0 + arrow_w * 0.38, h * 0.5 + h * 0.12),
                   (x0 + arrow_w, h * 0.5 + h * 0.12)], fill=(*WHITE_STENCIL, 255))
        img.alpha_composite(text, (arrow_w + red_w + int(0.02 * px_per_m), 0))
    return img, img.width / px_per_m, img.height / px_per_m


def _spent_muzzles(s, tx, length, height, half, ID_BULK, ID_BORE, ID_COLLAR, depth):
    """Дульні отвори порожнього пакета: нагар і пригар на щиті навколо отворів (радіальні патьоки), вигорілий метал на
    бортику, канал труби, що темнішає з глибиною, з сажею й слідами від ракети."""
    L2, H, W = length / 2, height, half
    r = min((H - 0.06) / 4, (2 * W - 0.06) / 6)
    rh = r - 0.028
    rows = (0.03 + (H - 0.06) * 0.25, 0.03 + (H - 0.06) * 0.75)
    P = tx.P
    dmin = np.full(tx.n, 9.0, np.float32)
    ang = np.zeros(tx.n, np.float32)
    for y in rows:
        for z in (-2 * r, 0.0, 2 * r):
            dy, dz = P[:, 1] - y, P[:, 2] - z
            d = np.hypot(dy, dz).astype(np.float32)
            near = d < dmin
            dmin[near] = d[near]
            ang[near] = np.arctan2(dy, dz)[near]
    bulk, bore, collar = tx.ids == ID_BULK, tx.ids == ID_BORE, tx.ids == ID_COLLAR
    out = np.maximum(dmin - rh, 0)
    # ---- щит: радіальні патьоки сажі від газів, кільце пригару, нерівномірне по колу
    rad = np.stack([np.cos(ang) * 6.0, np.sin(ang) * 6.0, dmin * 2.5], 1)
    streak = pl.noise3(rad, 41) * 0.65 + pl.noise3(rad * 2.7, 43) * 0.35
    soot = np.clip(np.exp(-out / 0.075) * (0.35 + 1.1 * streak), 0, 1) * bulk
    s.blend((0.030, 0.026, 0.022), soot * 0.88, rough=0.88, metal=0.1)
    heat = pl.smooth(0.0, 0.004, out) * (1 - pl.smooth(0.02, 0.05, out)) * (0.4 + 0.6 * streak) * bulk
    s.blend((0.20, 0.15, 0.10), heat * 0.55)
    flake = pl.smooth(0.62, 0.8, pl.fbm(P * 55.0, 3, 47)) * np.exp(-out / 0.04) * bulk      # облущена фарба біля краю
    s.blend((0.42, 0.40, 0.37), flake * 0.7, rough=0.5, metal=0.6)
    # ---- бортик: чистий метал, обпалений зсередини
    inner = np.clip(1 - (dmin - rh) / 0.012, 0, 1)
    s.blend((0.30, 0.29, 0.27), collar.astype(np.float32) * 0.8, rough=0.45, metal=0.75)
    s.blend((0.035, 0.03, 0.026), collar * (0.35 + 0.55 * inner) * (0.6 + 0.6 * streak), rough=0.8)
    s.blend((0.26, 0.20, 0.12), collar * pl.smooth(0.3, 0.9, pl.fbm(P * 90.0, 3, 51)) * 0.4)
    # ---- канал: від обпаленої міді біля дула до суцільної чорноти
    dep = np.clip(((L2 + 0.012) - P[:, 0]) / depth, 0, 1)
    ax = np.stack([P[:, 0] * 5.0, np.cos(ang) * 4.0 + 7.0, np.sin(ang) * 4.0], 1)
    sstreak = pl.noise3(ax, 53) * 0.6 + pl.noise3(ax * 2.9, 59) * 0.4
    mouth = 1 - pl.smooth(0.0, 0.16, dep)
    base = np.asarray((0.030, 0.025, 0.021), np.float32) * (0.5 + 0.9 * sstreak)[:, None]
    col = base * (1 - dep ** 0.35)[:, None] * 1.0 + np.asarray((0.004, 0.004, 0.004), np.float32) * (dep ** 0.35)[:, None]
    s.blend((0, 0, 0), bore.astype(np.float32))                                    # скидаємо базу
    s.color[bore] = col[bore]
    cop = np.asarray((0.17, 0.11, 0.07), np.float32) * (0.6 + 0.6 * sstreak)[:, None]
    s.color[bore] = s.color[bore] + cop[bore] * (mouth * bore)[bore][:, None] * 0.7
    rib = pl.smooth(0.9, 1.0, np.abs(np.sin(P[:, 0] * 90.0))) * bore * (1 - dep)
    s.blend((0.10, 0.075, 0.05), rib * 0.5)
    s.rough[bore] = 0.45 + 0.4 * sstreak[bore]
    s.metal[bore] = 0.55 * (1 - dep[bore])


def pod_painter(length, height, half, fresh, lugs):
    """Пакет: рама оливкова з потертостями до металу, труби світлі хакі, на торці щит із отворами або кришки.
    Написи — як на довідковому зображенні пакета (FWD, LIFT HERE, DO NOT TOW …)."""
    from glb_rig import BORE_DEPTH, ID_BORE, ID_BULK, ID_CAP, ID_CAP_DK, ID_COLLAR, ID_FRAME, ID_HOLE, ID_TUBE

    def painter(tx):
        s = Surface(tx.n, OLIVE, 0.62, 0.25)
        s.color = _by_id(tx, {ID_FRAME: OLIVE, ID_TUBE: KHAKI, ID_CAP: KHAKI_LT, ID_CAP_DK: srgb(118, 114, 80),
                              ID_BULK: GREY_BULK, ID_HOLE: srgb(14, 14, 13), ID_BORE: srgb(20, 16, 12), ID_COLLAR: srgb(92, 92, 86)}, OLIVE)
        rough = {ID_FRAME: 0.60, ID_TUBE: 0.42, ID_CAP: 0.5, ID_CAP_DK: 0.55, ID_BULK: 0.5, ID_HOLE: 0.9, ID_BORE: 0.55, ID_COLLAR: 0.48}
        metal = {ID_FRAME: 0.35, ID_TUBE: 0.12, ID_CAP: 0.1, ID_CAP_DK: 0.1, ID_BULK: 0.55, ID_HOLE: 0.2, ID_BORE: 0.55, ID_COLLAR: 0.7}
        for k in rough:
            s.rough[tx.ids == k] = rough[k]
            s.metal[tx.ids == k] = metal[k]
        pl.weather(s, tx.P, tx.N, tx.edge_cx, tx.edge_cc, seed=11, dust=0.28, rain=0.35, wear=0.75, mud=0.12, rust=0.55,
                   scale=2.2, ground=-0.2)
        # Бруд і плями на сірому щиті, нагар у стволах після пуску.
        bulk = tx.ids == ID_BULK
        stain = pl.smooth(0.45, 0.8, pl.fbm(tx.P * 9.0, 4, 31)) * bulk
        s.blend((0.20, 0.19, 0.17), stain * 0.55)
        if not fresh:
            _spent_muzzles(s, tx, length, height, half, ID_BULK, ID_BORE, ID_COLLAR, BORE_DEPTH)
        # Трубі додаємо тонкі кільця й шви, щоб вони не були «пластмасовими».
        tube = (tx.ids == ID_TUBE)
        ring = pl.smooth(0.96, 1.0, np.abs(np.sin(tx.P[:, 0] * 14.0))) * tube
        s.blend((0.26, 0.25, 0.18), ring * 0.55, height=-0.0007)
        # ---- написи на нижніх і верхніх поздовжніх балках з обох боків (як на довідковому зображенні пакета)
        L2, H, W = length / 2, height, half
        def label(text, h=0.034):
            return pl.text_decal([text], h, color=WHITE_STENCIL)
        fwd_r = fwd_decal(+1)
        fwd_l = fwd_decal(-1)
        texts = {k: label(k) for k in ('LIFT HERE', 'CENTER OF BALANCE', 'DO NOT TOW', 'DO NOT DROP', 'FORKLIFT AREA', 'DO NOT PUSH')}
        lower_y, upper_y = 0.036, H - 0.03
        for sgn in (-1, 1):
            n, up, z = (0, 0, sgn), (0, 1, 0), sgn * (W + 0.002)
            # Стрілка «FWD» дивиться до дульного (+x) кінця; на боці −z текст читається в інший бік.
            img, w, h = (fwd_r if sgn == 1 else fwd_l)
            pl.box_decal(s, tx.P, tx.N, img, (L2 - 0.46, lower_y, z), n, up, w, h, thick=0.025, seed=3, worn=0.4)
            for text, x, y in (('LIFT HERE', -L2 * 0.36, upper_y), ('LIFT HERE', L2 * 0.36, upper_y), ('CENTER OF BALANCE', 0.0, upper_y),
                               ('DO NOT TOW', -L2 * 0.58, lower_y), ('DO NOT DROP', -L2 * 0.16, lower_y),
                               ('FORKLIFT AREA', L2 * 0.12, lower_y), ('DO NOT PUSH', -L2 * 0.86, lower_y)):
                img, w, h = texts[text]
                pl.box_decal(s, tx.P, tx.N, img, (x, y, z), n, up, w, h, thick=0.025, seed=3, worn=0.4)
        return s
    return painter


# ------------------------------------------------------------------------------------------------ групи частин
# Рецепт частини: (колір sRGB 0…255 або 'camo', шорсткість, металевість, сила старіння 0…1, тон камуфляжу).
def R(color, rough=0.68, metal=0.12, age=1.0, tone=1.0):
    return dict(color=color, rough=rough, metal=metal, age=age, tone=tone)


BLACK = R((26, 27, 25), 0.78, 0.1, 0.8)
STEEL = R((150, 152, 148), 0.34, 0.9, 0.7)
GLASS = R((24, 30, 32), 0.06, 0.3, 0.12)
LENS_W = R((238, 236, 226), 0.08, 0.0, 0.1)
LENS_A = R((238, 142, 30), 0.12, 0.0, 0.1)
LENS_R = R((172, 36, 30), 0.15, 0.0, 0.15)
WOOD = R((150, 110, 68), 0.82, 0.0, 0.8)


def group_painter(names, recipes, *, camo=True, seed=1, weather=None, post=None, camo_colors=None, olive=(78, 82, 56), seams=None):
    """Малювальник групи частин. names[i] — частина з id = i; recipes — словник рецептів за назвою частини."""
    weather = weather or {}

    def painter(tx):
        s = Surface(tx.n, srgb(*olive), 0.68, 0.12)
        cam = pl.nato_camo(tx.P, seed, camo_colors) if camo else None
        age = np.ones(tx.n, np.float32)
        for i, name in enumerate(names):
            sel = tx.ids == i
            if not sel.any():
                continue
            r = recipes[name]
            if r['color'] == 'camo':
                s.color[sel] = (cam[sel] if camo else srgb(*olive)) * r['tone']
            else:
                s.color[sel] = srgb(*r['color']) * r['tone']
            s.rough[sel], s.metal[sel], age[sel] = r['rough'], r['metal'], r['age']
        clean = s.color.copy(), s.rough.copy(), s.metal.copy()
        kw = dict(seed=seed * 7, dust=0.38, rain=0.55, wear=0.65, mud=0.5, rust=0.25, scale=1.0)
        kw.update(weather)
        pl.weather(s, tx.P, tx.N, tx.edge_cx, tx.edge_cc, **kw)
        # Скло, лінзи й чиста сталь старіють слабше: повертаємо частину чистого вигляду.
        back = (1 - age)[:, None]
        s.color = s.color + (clean[0] - s.color) * back
        s.rough = s.rough + (clean[1] - s.rough) * (1 - age)
        s.metal = s.metal + (clean[2] - s.metal) * (1 - age)
        s.height *= age
        seam_names = seams or ()
        if seam_names:
            sel = np.zeros(tx.n, bool)
            for i, n in enumerate(names):
                if n in seam_names:
                    sel |= tx.ids == i
            pl.panel_seams(s, tx.P, tx.N, sel, seed=seed + 5)
        if post:
            post(s, tx, {n: tx.ids == i for i, n in enumerate(names)})
        return s
    painter.__name__ = 'group_' + '_'.join(names[:2])
    painter.sig = repr((names, recipes, camo, seed, weather, camo_colors, olive, seams, getattr(post, '__name__', None)))
    return painter


# ------------------------------------------------------------------------------------------------ трафарети й таблички
_IMG = {}


def _cached(key, fn):
    if key not in _IMG:
        _IMG[key] = fn()
    return _IMG[key]


def mlc_disc(number, radius=0.11, px_per_m=1400):
    """Жовтий диск класифікації за вантажопідйомністю мостів: чорне коло, цифри."""
    def make():
        from PIL import Image, ImageDraw
        d = int(2 * radius * px_per_m)
        img = Image.new('RGBA', (d, d), (0, 0, 0, 0))
        dr = ImageDraw.Draw(img)
        dr.ellipse([0, 0, d - 1, d - 1], fill=(20, 20, 18, 255))
        b = max(2, int(d * 0.07))
        dr.ellipse([b, b, d - 1 - b, d - 1 - b], fill=(*YELLOW_STENCIL, 255))
        f = pl.font(int(d * 0.50))
        tb = f.getbbox(str(number))
        dr.text(((d - (tb[2] - tb[0])) / 2 - tb[0], (d - (tb[3] - tb[1])) / 2 - tb[1]), str(number), font=f, fill=(20, 20, 18, 255))
        return img
    return _cached(('mlc', number, radius), make), 2 * radius, 2 * radius


def plate(lines, width, height, bg=YELLOW_STENCIL, fg=(20, 20, 18), px_per_m=1200, border=True):
    """Прямокутна табличка з написом (жовта попереджувальна або світла паспортна)."""
    def make():
        from PIL import Image, ImageDraw
        w, h = int(width * px_per_m), int(height * px_per_m)
        img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        dr = ImageDraw.Draw(img)
        dr.rounded_rectangle([0, 0, w - 1, h - 1], radius=int(h * 0.08), fill=(*bg, 255))
        if border:
            b = max(2, int(h * 0.05))
            dr.rounded_rectangle([b, b, w - 1 - b, h - 1 - b], radius=int(h * 0.06), outline=(*fg, 255), width=max(2, int(h * 0.035)))
        n = len(lines)
        px = int(h * 0.62 / n)
        f = pl.font(px)
        y = (h - n * px * 1.15) / 2
        for t in lines:
            tb = f.getbbox(t)
            while tb[2] - tb[0] > w * 0.88 and px > 8:
                px -= 1
                f = pl.font(px)
                tb = f.getbbox(t)
            dr.text(((w - (tb[2] - tb[0])) / 2 - tb[0], y - tb[1] + px * 0.05), t, font=f, fill=(*fg, 255))
            y += px * 1.15
        return img
    return _cached(('plate', tuple(lines), width, height, bg, fg), make), width, height


def stencil_text(text, height, color=WHITE_STENCIL):
    """Білий трафаретний напис (з перемичками)."""
    def make():
        img, w, h = pl.text_decal([text], height, px_per_m=1100, color=color)
        return pl.stencil_cuts(img, 0.2, 0.012), w, h
    return _cached(('st', text, height, color), make)


def hazard_stripes(width, height, px_per_m=800):
    def make():
        from PIL import Image, ImageDraw
        w, h = int(width * px_per_m), int(height * px_per_m)
        img = Image.new('RGBA', (w, h), (*YELLOW_STENCIL, 255))
        dr = ImageDraw.Draw(img)
        step = int(h * 0.9)
        for k in range(-h, w + h, step * 2):
            dr.polygon([(k, h), (k + step, h), (k + step + h, 0), (k + h, 0)], fill=(22, 22, 20, 255))
        return img
    return _cached(('hz', width, height), make), width, height


def put(s, tx, deco, center, normal, up, **kw):
    img, w, h = deco
    kw.setdefault('thick', 0.03)
    kw.setdefault('worn', 0.4)
    return pl.box_decal(s, tx.P, tx.N, img, center, normal, up, w, h, **kw)


def post_m270_cab(s, tx, masks):
    Y = (0, 1, 0)
    put(s, tx, mlc_disc(28), (3.428, 1.55, 0.50), (1, 0, 0), Y)
    put(s, tx, stencil_text('M270A1', 0.075), (3.428, 1.55, -0.48), (1, 0, 0), Y)
    for sg in (-1, 1):
        z = sg * 1.426
        put(s, tx, plate(['DATA'], 0.16, 0.10, bg=(176, 178, 170), px_per_m=900), (2.15, 1.42, z), (0, 0, sg), Y)
        put(s, tx, stencil_text('NO STEP', 0.05), (1.55, 2.12, sg * 1.4), (0, 0, sg), Y, thick=0.05)
    put(s, tx, stencil_text('NO STEP', 0.07), (0.62, 2.206, -0.98), (0, 1, 0), (1, 0, 0), thick=0.02)
    put(s, tx, stencil_text('NO STEP', 0.07), (1.85, 2.66, 0.35), (0, 1, 0), (1, 0, 0), thick=0.03)


def post_m270_hull(s, tx, masks):
    Y = (0, 1, 0)
    for sg in (-1, 1):
        put(s, tx, stencil_text('LIFT', 0.06), (-3.452, 0.93, sg * 0.55), (-1, 0, 0), Y)
        put(s, tx, stencil_text('M270A1', 0.075), (2.5, 1.11, sg * 1.452), (0, 0, sg), Y)
    put(s, tx, hazard_stripes(0.9, 0.06), (-3.452, 0.72, 0.0), (-1, 0, 0), Y)


def post_m270_launcher(s, tx, masks):
    Y = (0, 1, 0)
    for sg in (-1, 1):
        z = sg * 1.405
        put(s, tx, plate(['DANGER', 'BACKBLAST'], 0.60, 0.30), (0.55, 0.62, z), (0, 0, sg), Y, thick=0.04)
        put(s, tx, stencil_text('GMLRS', 0.11), (2.15, 0.62, z), (0, 0, sg), Y, thick=0.04)
        put(s, tx, stencil_text('ATACMS', 0.11), (3.0, 0.62, z), (0, 0, sg), Y, thick=0.04)


def post_himars_cab(s, tx, masks):
    Y = (0, 1, 0)
    put(s, tx, mlc_disc(22, 0.075), (3.742, 0.95, -0.62), (1, 0, 0), Y)
    put(s, tx, stencil_text('M142', 0.07), (3.742, 0.95, 0.60), (1, 0, 0), Y)
    for sg in (-1, 1):
        put(s, tx, plate(['DATA'], 0.14, 0.09, bg=(176, 178, 170), px_per_m=900), (2.55, 1.74, sg * 1.205), (0, 0, sg), Y)


def post_himars_chassis(s, tx, masks):
    put(s, tx, stencil_text('NO STEP', 0.06), (1.46, 2.206, 0.90), (0, 1, 0), (1, 0, 0), thick=0.02)


def post_himars_module(s, tx, masks):
    Y = (0, 1, 0)
    H = (0.12, 1.36, 0.0)
    for sg in (-1, 1):
        c = lambda x, y, z: (x - H[0], y - H[1], z - H[2])
        put(s, tx, plate(['DANGER', 'BACKBLAST'], 0.50, 0.26), c(-3.0, 2.0, sg * 1.208), (0, 0, sg), Y, thick=0.04)
        put(s, tx, stencil_text('HIMARS', 0.10), c(-1.1, 1.98, sg * 1.208), (0, 0, sg), Y, thick=0.04)
