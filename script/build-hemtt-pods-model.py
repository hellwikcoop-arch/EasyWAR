#!/usr/bin/env python3
"""Генерує процедурну модель пакетовоза на шасі HEMTT 8×8 (типу M985) із причепом і ракетними пакетами M26 для довідника
(src/models/hemtt-pod-carrier.glb).

    pip install numpy scipy trimesh pillow xatlas   # текстури: script/glb_bake.py, paint_lib.py, vehicle_paint.py
    # EW_FAST=1 — напіврозрізнення для швидкої перевірки; EW_BAKE_CACHE=<тека> — кеш запікань (перед випуском чистити)
    python3 script/build-hemtt-pods-model.py [вихідний.glb]

Форму знято з довідкового зображення (вид із чотирьох боків), яке надав користувач, і узгоджено з відкритими габаритами родини
HEMTT: шасі, кабіна й задня балка взяті з build-m984-model.py (одна й та сама машина без кранового модуля), позаду кабіни —
навантажувальний кран у транспортному положенні, на платформі й причепі по чотири пакети M26 (використовується той самий
пакет, що в моделях HIMARS і M270) під білими фіксувальними рамами з ременями. Це не скан і не копія чужої моделі,
сторонніх текстур немає. Для перегляду, а не для впізнавання чи розрахунків. Одиниці — метри, перед машини дивиться в +x,
«вгору» — +y, права сторона — +z (як у glTF).
"""
import importlib.util
import sys
from pathlib import Path

import numpy as np

from glb_bake import BakeSpec, TileSpec
from glb_rig import GlbWriter, lpc_pod, node
import vehicle_kit as k
import vehicle_paint as vp
from vehicle_kit import box, cyl_between, cyl_z, merge, rivet_row

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("m984", HERE / "build-m984-model.py")
m984 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m984)

DEFAULT_OUT = HERE.parent / "src" / "models" / "hemtt-pod-carrier.glb"
DECK_Y, DECK_X0, DECK_X1, DECK_HALF = m984.DECK_Y, m984.DECK_X0, m984.DECK_X1, m984.DECK_HALF
WHEEL_R, WHEEL_Y, WHEEL_Z, WHEEL_W = m984.WHEEL_R, m984.WHEEL_Y, m984.WHEEL_Z, m984.WHEEL_W

POD_L, POD_H, POD_HALF = 3.00, 0.70, 0.50
POD_LUGS = (-0.40, 0.40)
POD_Z = 0.545                                  # половина колії між осями двох колон пакетів
RACK_TOP = 0.98                                # висота верхніх балок рами над настилом

TR_X0, TR_X1, TR_Y = -6.45, -12.95, 1.25       # причіп: передній і задній торці, висота настилу
TR_AXLES = [-10.6, -12.0]
TR_HALF = 1.14
EYE_X = DECK_X0 - 0.40


def rack(x0, x1, y0, half, cuts):
    """Біла фіксувальна рама над двома колонами пакетів: стійки, верхні поздовжні й поперечні балки, розкоси, ремені."""
    xs = [x0 - 0.04] + list(cuts) + [x1 + 0.04]
    posts, rails, straps = [], [], []
    for x in xs:
        for s in (-1, 1):
            posts.append(box((x, y0 + RACK_TOP / 2, s * (half - 0.04)), (0.07, RACK_TOP, 0.07), bevel=0.012))
        rails.append(box((x, y0 + RACK_TOP, 0.0), (0.07, 0.06, 2 * half - 0.08), bevel=0.01))
    for s in (-1, 1):
        rails.append(box(((x0 + x1) / 2, y0 + RACK_TOP, s * (half - 0.04)), (abs(x0 - x1) + 0.08, 0.07, 0.07), bevel=0.012))
    rails.append(box(((x0 + x1) / 2, y0 + RACK_TOP + 0.01, 0.0), (abs(x0 - x1) + 0.08, 0.06, 0.07), bevel=0.012))
    for xa, xb in zip(xs[:-1], xs[1:]):
        for s in (-1, 1):
            d = np.array([xb - xa, RACK_TOP - 0.12])
            rails.append(box(((xa + xb) / 2, y0 + RACK_TOP / 2 + 0.03, s * (half - 0.04)), (np.hypot(*d), 0.035, 0.035), rot_z=float(np.arctan2(d[1], d[0])), bevel=0.005))
    for xa, xb in zip(xs[:-1], xs[1:]):
        for f in (0.25, 0.75):
            x = xa + (xb - xa) * f
            straps.append(box((x, y0 + POD_H + 0.065, 0.0), (0.10, 0.018, 2 * half - 0.02), bevel=0.003))
            for s in (-1, 1):
                straps.append(box((x, y0 + POD_H / 2 + 0.03, s * (half - 0.005)), (0.10, POD_H, 0.016), bevel=0.003))
                straps.append(box((x, y0 + POD_H * 0.55, s * (half + 0.01)), (0.10, 0.07, 0.03), bevel=0.006))     # храпові замки
    return merge(posts + rails), merge(straps)


def trailer(parts):
    L = abs(TR_X1 - TR_X0)
    xc = (TR_X0 + TR_X1) / 2
    frame = [box((xc, 1.00, s * 0.55), (L + 0.20, 0.20, 0.10)) for s in (-1, 1)]
    frame += [box((x, 1.00, 0.0), (0.10, 0.16, 1.10)) for x in np.linspace(TR_X0 - 0.2, TR_X1 + 0.2, 8)]
    # дишло-трикутник, вушко, опора-домкрат
    frame += [cyl_between((TR_X0 + 0.1, 1.00, s * 0.55), (EYE_X - 0.04, 1.04, 0.0), 0.05, 10) for s in (-1, 1)]
    frame += [cyl_between((EYE_X - 0.04, 1.04, 0.0), (EYE_X - 0.02, 1.04, 0.0), 0.07, 12), cyl_z((EYE_X - 0.02, 1.04, 0.0), 0.12, 0.05, 20)]
    frame += [cyl_between((TR_X0 - 0.35, 0.96, 0.0), (TR_X0 - 0.35, 0.18, 0.0), 0.04, 8), box((TR_X0 - 0.35, 0.14, 0.0), (0.30, 0.04, 0.30), bevel=0.008),
              box((TR_X0 - 0.35, 0.72, 0.0), (0.20, 0.06, 0.20), bevel=0.01)]
    parts["t_frame"] = merge(frame)
    axle, springs = [], []
    for x in TR_AXLES:
        axle.append(cyl_between((x, WHEEL_Y, -WHEEL_Z + 0.14), (x, WHEEL_Y, WHEEL_Z - 0.14), 0.09, 16))
        axle.append(box((x, 0.64, 0.0), (0.46, 0.30, 0.40)))
        for s in (-1, 1):
            springs += k.leaf_spring(x, 0.86, s * 0.50, 0.85)
    parts["t_axles"] = merge(axle)
    parts["t_springs"] = merge(springs)
    fend = []
    xa, xb = TR_AXLES
    xc2, w = (xa + xb) / 2, abs(xa - xb) + 1.30
    for s in (-1, 1):
        fend += [box((xc2, 1.06, s * 1.12), (w, 0.05, 0.54), bevel=0.012), box((xc2 + w / 2, 0.88, s * 1.12), (0.05, 0.36, 0.54), bevel=0.01),
                 box((xc2 - w / 2, 0.88, s * 1.12), (0.05, 0.36, 0.54), bevel=0.01)]
    parts["t_fenders"] = merge(fend)
    parts["t_deck"] = merge([box((xc, TR_Y - 0.06, 0.0), (L, 0.12, 2 * TR_HALF)), box((xc, TR_Y - 0.17, 0.0), (L - 0.4, 0.10, 1.80))] +
                            [box((xc, TR_Y - 0.14, z), (L, 0.08, 0.07)) for z in (-0.80, -0.27, 0.27, 0.80)] +
                            [box((TR_X0 - 0.04, TR_Y + 0.28, 0.0), (0.10, 0.56, 2 * TR_HALF - 0.04), bevel=0.02)])        # передній щит
    parts["t_rear"] = merge([box((TR_X1 - 0.09, 1.08, 0.0), (0.16, 0.24, 2.30)), box((TR_X1 - 0.14, 1.28, 1.06), (0.08, 0.30, 0.24)),
                             box((TR_X1 - 0.14, 1.28, -1.06), (0.08, 0.30, 0.24))])
    parts["t_red"] = merge([cyl_between((TR_X1 - 0.19, 1.30, s * 1.06), (TR_X1 - 0.23, 1.30, s * 1.06), 0.05, 14) for s in (-1, 1)])
    parts["t_amber"] = merge([cyl_between((TR_X1 - 0.19, 1.18, s * 1.06), (TR_X1 - 0.23, 1.18, s * 1.06), 0.034, 12) for s in (-1, 1)])
    t_tyres, t_rims, t_bolts = k.wheel_set(TR_AXLES, WHEEL_R, WHEEL_Y, WHEEL_Z, WHEEL_W, r_rim=0.33, lug_count=28)
    for key, extra in (("tyres", t_tyres), ("rims", t_rims), ("wheel_bolts", t_bolts)):
        parts[key] = merge([parts[key]] + extra)
    # білі рами й ремені причепа
    r, st = rack(TR_X0, -12.6, TR_Y, TR_HALF - 0.07, (-9.5,))
    return r, st


def build():
    parts = m984.build(spare=False)
    for name in ("lockers", "locker_doors", "tools", "deck_rivets", "crane_base", "crane_boom", "crane_boom_inner", "crane_rams", "crane_hook",
                 "boom_rest", "spades"):
        parts.pop(name)
    pods_y0 = DECK_Y + 0.06
    r, st = rack(1.74, -4.42, pods_y0, DECK_HALF - 0.05, (-1.34,))
    t_r, t_st = trailer(parts)
    parts["rack"] = merge([r, t_r])
    parts["straps"] = merge([st, t_st])

    # ---------- Навантажувальний кран за кабіною: колона, головна стріла й складена жирафа, гідроциліндри, гак ----------
    cx = 2.18
    base = [box((cx, DECK_Y + 0.62, 0.0), (0.80, 1.20, 0.90), bevel=0.04), cyl_z((cx, DECK_Y + 1.30, 0.0), 0.34, 0.12, 24)]
    base += [box((cx - 0.10, DECK_Y + 1.70, 0.30), (0.40, 0.40, 0.28), bevel=0.03)]
    parts["crane_base"] = merge(base)
    p0 = np.array([cx, DECK_Y + 1.62])
    p1 = np.array([-1.30, DECK_Y + 1.16])
    parts["crane_boom"] = merge([k.beam_between((p0[0], p0[1], 0.0), (p1[0], p1[1], 0.0), 0.32, 0.30, bevel=0.025)])
    q1 = p1 + np.array([0.12, -0.02])
    q2 = np.array([1.75, DECK_Y + 1.34])
    parts["crane_jib"] = merge([k.beam_between((q1[0], q1[1], 0.27), (q2[0], q2[1], 0.27), 0.22, 0.22, bevel=0.02),
                                box((q1[0] - 0.06, q1[1], 0.14), (0.26, 0.30, 0.30), bevel=0.03)])
    parts["crane_rams"] = merge([cyl_between((cx - 0.15, DECK_Y + 1.05, 0.20), (cx - 1.30, DECK_Y + 1.46, 0.20), 0.05, 12),
                                 cyl_between((p1[0] + 0.5, p1[1] + 0.10, 0.18), (p1[0] + 1.4, p1[1] + 0.22, 0.30), 0.035, 10)])
    parts["crane_hook"] = merge([cyl_between((q2[0], q2[1] - 0.10, 0.27), (q2[0], q2[1] - 0.55, 0.27), 0.012, 6),
                                 box((q2[0], q2[1] - 0.62, 0.27), (0.10, 0.12, 0.10), bevel=0.02)])
    return parts


# ---------- групи для запікання ----------
WHITE = vp.R((224, 223, 210), 0.62, 0.1, 0.9)
BELT = vp.R((196, 188, 150), 0.82, 0.0, 0.9)
EXTRA_CHASSIS = {"t_frame": vp.R((56, 56, 46), 0.82, 0.3), "t_axles": vp.R((50, 50, 42), 0.8, 0.4), "t_springs": vp.R((44, 44, 38), 0.7, 0.6),
                 "t_fenders": m984.OL_DK, "t_rear": vp.R((54, 54, 44), 0.8, 0.35), "t_red": vp.LENS_R, "t_amber": vp.LENS_A}
EXTRA_BODY = {"t_deck": vp.R((70, 66, 52), 0.8, 0.3), "crane_jib": vp.R("camo", 0.7, 0.2, tone=0.85)}


def group_nodes(parts):
    nodes = []
    chassis = [n for n in m984.CHASSIS_NAMES if n in parts] + list(EXTRA_CHASSIS)
    body = [n for n in m984.BODY_NAMES if n in parts] + list(EXTRA_BODY)
    cab = [n for n in m984.CAB_NAMES if n in parts]
    spec = (("chassis", chassis, {**m984.CHASSIS_RECIPES, **EXTRA_CHASSIS}, 1536, None, ("fenders", "t_fenders")),
            ("cab", cab, m984.CAB_RECIPES, 1536, m984.post_cab, ("cab", "doors", "bumper")),
            ("body", body, {**m984.BODY_RECIPES, **EXTRA_BODY}, 1536, None, ("deck", "crane_base", "crane_boom")),
            ("rack", ["rack", "straps"], {"rack": WHITE, "straps": BELT}, 1024, None, ("rack",)))
    for gi, (gname, names, recipes, res, post, seams) in enumerate(spec):
        meshes, ids = [], []
        for i, nme in enumerate(names):
            m = parts.pop(nme)
            meshes.append(m)
            ids.append(np.full(len(m.faces), i, np.int16))
        olive = m984.OLIVE_RGB
        painter = vp.group_painter(names, recipes, camo=False, seed=61 + gi, olive=olive, weather=dict(mud=0.65 if gname == "chassis" else 0.35, dust=0.5),
                                   seams=seams, post=post)
        nodes.append(node(gname, [(merge(meshes), BakeSpec(painter, res=res, ids=np.concatenate(ids), key=f"hemtt-pods-{gname}", seed=61 + gi))]))
    for nme, spec in m984.TILES.items():
        nodes.append(node(nme, [(parts.pop(nme), spec)]))
    # пакети: одна запечена сітка, вісім вузлів
    prims = lpc_pod(POD_L, POD_H, POD_HALF, True, POD_LUGS)
    n = 0
    for (x0, y0, xs) in ((DECK_X1 - 0.92 - POD_L / 2, DECK_Y + 0.06, 1), (DECK_X1 - 0.92 - POD_L * 1.5 - 0.06, DECK_Y + 0.06, 1)):
        for s in (-1, 1):
            pos = (x0, y0, s * POD_Z)
            nodes.append(node(f"pod_{n}", prims if n == 0 else (), t=pos, share=None if n == 0 else "pod_0"))
            n += 1
    for x0 in (-7.95, -11.05):
        for s in (-1, 1):
            nodes.append(node(f"pod_{n}", (), t=(x0, TR_Y, s * POD_Z), share="pod_0"))
            n += 1
    return nodes


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    parts = build()
    w = GlbWriter("EasyWAR build-hemtt-pods-model.py")
    for nd in group_nodes(parts):
        w.add(nd)
    assert not parts, f"частини без поверхні: {list(parts)}"
    glb = w.glb({"title": "HEMTT pod carrier with trailer (generated)", "generated": True,
                 "note": "Procedural model of a HEMTT 8x8 rocket-pod carrier with a loading crane and a pod trailer, built from open overall dimensions "
                         "and a user-supplied reference view. Not a scan or copy of any other model."})
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(glb)
    print(f"{out.name}: {len(glb) / 1024:.0f} KB, {len(w.doc['nodes'])} nodes, {w.triangles} triangles")
    return 0


if __name__ == "__main__":
    sys.exit(main())
