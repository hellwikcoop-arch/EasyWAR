#!/usr/bin/env python3
"""Генерує процедурну модель вантажівки M1084A1P2 (родина FMTV 6×6 з вантажним краном) для довідника
(src/models/m1084a1p2.glb).

    pip install numpy scipy trimesh pillow xatlas   # текстури: script/glb_bake.py, paint_lib.py, vehicle_paint.py
    # EW_FAST=1 — напіврозрізнення для швидкої перевірки; EW_BAKE_CACHE=<тека> — кеш запікань (перед випуском чистити)
    python3 script/build-m1084-model.py [вихідний.glb]

Форму знято з довідкових зображень, які надав користувач (спереду, ззаду й збоку), і узгоджено з відкритими габаритами
родини FMTV (довжина ≈ 8 м, ширина ≈ 2,5 м, колісна база 6×6, шини 395/85R20): броньована кабіна з двома вітровими
шибами й широкою ґратою, вантажна платформа з відкидними бортами, запасне колесо за кабіною, кран для вантажних робіт у
кормі зі складеною стрілою, корма з ліхтарями, фаркопом і підніжками. Це не скан і не копія чужої моделі, сторонніх
текстур немає. Для перегляду, а не для впізнавання чи розрахунків. Одиниці — метри, перед машини дивиться в +x, «вгору»
— +y, права сторона — +z (як у glTF).
"""
import sys
from pathlib import Path

import numpy as np

from glb_bake import BakeSpec, TileSpec
from glb_rig import GlbWriter, node
import vehicle_kit as k
import vehicle_paint as vp
from vehicle_kit import box, cyl_between, cyl_x, cyl_z, level_hull, merge, rivet, rivet_row

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "src" / "models" / "m1084a1p2.glb"
OLIVE_RGB = (84, 90, 62)

AXLES = [2.55, -0.95, -2.45]                 # передня вісь і задній тандем
WHEEL_R, WHEEL_Y, WHEEL_Z, WHEEL_W = 0.53, 0.53, 1.00, 0.40
CAB_FRONT, CAB_REAR = 3.85, 2.05
BED_X0, BED_X1, BED_Y, BED_HALF = -3.95, 1.92, 1.40, 1.22
BOARD_H = 0.62


def slope_box(p0, p1, t, offset, extents, z):
    """Пластина на похилій площині (p0→p1 у площині x–y); t — частка довжини, offset — назовні."""
    p0, p1 = np.array(p0, float), np.array(p1, float)
    d = p1 - p0
    length = np.linalg.norm(d)
    d /= length
    n = np.array([d[1], -d[0]])
    c = p0 + d * (t * length) + n * offset
    return box((c[0], c[1], z), (extents[1], extents[0], extents[2]), rot_z=np.arctan2(d[1], d[0]))   # (товщина, довжина вздовж схилу, ширина)


def build():
    parts, rivets = {}, []

    # ---------- Рама, мости, ресори, баки ----------
    frame = [box((-0.20, 1.02, s * 0.45), (7.50, 0.24, 0.10)) for s in (-1, 1)]
    frame += [box((x, 1.02, 0.0), (0.10, 0.18, 0.90)) for x in (3.2, 2.0, 0.6, -0.9, -2.0, -3.2)]
    parts["frame"] = merge(frame)
    axle, springs = [], []
    for x in AXLES:
        axle.append(cyl_between((x, WHEEL_Y, -WHEEL_Z + 0.12), (x, WHEEL_Y, WHEEL_Z - 0.12), 0.085, 16))
        axle.append(box((x, 0.58, 0.0), (0.46, 0.30, 0.40)))
        for s in (-1, 1):
            springs += k.leaf_spring(x, 0.82, s * 0.47, 0.95 if x < 0 else 0.80)
    axle.append(cyl_between((-0.95, 0.60, 0.0), (2.55, 0.64, 0.0), 0.05, 12))
    axle.append(cyl_between((-2.45, 0.60, 0.0), (-0.95, 0.60, 0.0), 0.05, 12))
    parts["axles"] = merge(axle)
    parts["springs"] = merge(springs)
    tanks = [box((0.75, 0.88, -0.84), (1.10, 0.46, 0.50), bevel=0.04),                # паливний бак
             box((0.75, 0.88, 0.84), (0.90, 0.40, 0.46), bevel=0.04),                 # акумуляторний і інструментальний ящик
             box((-1.60, 0.86, 0.84), (0.70, 0.36, 0.44), bevel=0.03)]
    parts["tanks"] = merge(tanks)
    parts["exhaust"] = merge([cyl_between((1.92, 1.05, 1.02), (1.92, 2.95, 1.02), 0.075, 14),
                              cyl_between((1.92, 2.95, 1.02), (1.92, 3.02, 1.02), 0.10, 14),
                              cyl_between((2.30, 0.95, 1.02), (1.92, 1.05, 1.02), 0.06, 12)])
    fenders = []
    for x in AXLES:
        for s in (-1, 1):
            fenders.append(box((x, 0.98, s * 1.08), (1.16, 0.05, 0.50), bevel=0.012))
            fenders.append(box((x + 0.58, 0.82, s * 1.08), (0.05, 0.36, 0.50), bevel=0.01))
            fenders.append(box((x - 0.58, 0.82, s * 1.08), (0.05, 0.36, 0.50), bevel=0.01))
    parts["fenders"] = merge(fenders)

    # ---------- Колеса ----------
    tyres, rims, bolts = k.wheel_set(AXLES, WHEEL_R, WHEEL_Y, WHEEL_Z, WHEEL_W, r_rim=0.30, lug_count=26)
    # запасне колесо за кабіною (з правого боку, як на фото)
    ring, lug = k.tyre(0.0, 0.0, 0.0, r_out=WHEEL_R, width=WHEEL_W, lug_count=26)
    for m in (ring, lug):  # вісь шини вздовж x: колесо стоїть на ребрі впритул до задньої стінки кабіни
        m.apply_transform(__import__("trimesh").transformations.rotation_matrix(np.pi / 2, [0, 1, 0]))
        m.apply_translation((CAB_REAR - 0.28, BED_Y + WHEEL_R + 0.06, 0.62))
    tyres += [ring, lug]
    parts["tyres"] = merge(tyres)
    parts["rims"] = merge(rims)
    parts["wheel_bolts"] = merge(bolts)

    # ---------- Корма: балка, ліхтарі, фаркоп, підніжка ----------
    stern = [box((-3.99, 1.08, 0.0), (0.16, 0.24, 2.30)), box((-3.90, 0.78, 0.0), (0.10, 0.10, 1.90))]
    stern += [box((-3.92, 0.92, s * 0.95), (0.06, 0.40, 0.06)) for s in (-1, 1)]
    stern += [box((-4.05, 1.10, s * 0.92), (0.06, 0.24, 0.34)) for s in (-1, 1)]
    parts["rear_beam"] = merge(stern)
    lights = []
    for s in (-1, 1):
        lights.append(cyl_between((-4.08, 1.14, s * 1.00), (-4.12, 1.14, s * 1.00), 0.055, 16))
        lights.append(cyl_between((-4.08, 1.14, s * 0.80), (-4.12, 1.14, s * 0.80), 0.045, 16))
    parts["rear_red"] = merge(lights)
    parts["rear_amber"] = merge([cyl_between((-4.08, 1.02, s * 1.00), (-4.12, 1.02, s * 1.00), 0.035, 12) for s in (-1, 1)])
    parts["hitch"] = merge([cyl_between((-4.05, 1.04, 0.0), (-4.30, 1.04, 0.0), 0.055, 12), cyl_z((-4.28, 1.04, 0.0), 0.075, 0.04, 16)])
    parts["tow_rings"] = merge([cyl_between((-4.06, 0.84, s * 0.78), (-4.20, 0.84, s * 0.78), 0.03, 8) for s in (-1, 1)]
                                + [k.box((-4.20, 0.84, s * 0.78), (0.03, 0.16, 0.16), bevel=0.01) for s in (-1, 1)])

    # ---------- Кабіна (броньована, гранчаста) ----------
    levels = [(1.12, 3.80, CAB_REAR, 1.15, 0.10), (1.70, CAB_FRONT, CAB_REAR, 1.20, 0.12), (2.06, CAB_FRONT - 0.02, CAB_REAR, 1.20, 0.10),
              (2.58, 3.36, CAB_REAR + 0.05, 1.16, 0.10), (2.80, 3.20, CAB_REAR + 0.10, 1.09, 0.10)]
    parts["cab"] = level_hull(levels)
    ws0, ws1 = (CAB_FRONT - 0.02, 2.06), (3.36, 2.58)
    glass, frames, wipers = [], [], []
    for z0 in (-0.58, 0.58):
        glass.append(slope_box(ws0, ws1, 0.5, 0.05, (0.012, 0.50, 0.96), z0))
        frames.append(slope_box(ws0, ws1, 0.5, 0.03, (0.018, 0.56, 1.06), z0))
        wipers.append(slope_box(ws0, ws1, 0.30, 0.07, (0.012, 0.30, 0.02), z0 + 0.1))
    frames.append(slope_box(ws0, ws1, 0.5, 0.035, (0.025, 0.58, 0.05), 0.0))
    parts["windshields"] = merge(glass)
    parts["windshield_frames"] = merge(frames)
    parts["wipers"] = merge(wipers)
    grille = [box((CAB_FRONT + 0.012, 1.46, 0.0), (0.03, 0.46, 1.40), bevel=0.008)]
    parts["grille_back"] = merge([box((CAB_FRONT + 0.004, 1.46, 0.0), (0.02, 0.42, 1.34), bevel=0.004)])
    bars = [box((CAB_FRONT + 0.03, 1.28 + 0.05 * i, 0.0), (0.012, 0.022, 1.34), bevel=0.004) for i in range(8)]
    parts["grille"] = merge(grille + bars)
    doors, handles, side_win = [], [], []
    for s in (-1, 1):
        zf = s * (1.20 + 0.01)
        doors.append(box(((CAB_FRONT + CAB_REAR) / 2 + 0.05, 1.70, zf), (1.50, 1.02, 0.025), bevel=0.012))
        side_win.append(box((3.20, 2.20, s * 1.215), (0.78, 0.54, 0.014), bevel=0.004))
        handles.append(box((2.58, 1.80, s * 1.225), (0.14, 0.04, 0.04), bevel=0.008))
        for x in (2.5, 3.5):
            rivets += rivet_row((x, 1.25, s * 1.202), (x, 2.0, s * 1.202), 0.12, (0, 0, s))
    parts["doors"] = merge(doors)
    parts["side_windows"] = merge(side_win)
    parts["door_handles"] = merge(handles)
    lamps, amber = [], []
    for s in (-1, 1):
        lamps.append(cyl_between((CAB_FRONT + 0.03, 1.60, s * 0.86), (CAB_FRONT + 0.075, 1.60, s * 0.86), 0.062, 16))
        amber.append(box((CAB_FRONT + 0.03, 1.60, s * 1.04), (0.03, 0.10, 0.14), bevel=0.006))
        amber.append(box((3.30, 2.86, s * 0.55), (0.12, 0.07, 0.17), bevel=0.01))
    parts["lamps"] = merge(lamps)
    parts["lamps_amber"] = merge(amber + [box((3.30, 2.86, 0.0), (0.12, 0.07, 0.17), bevel=0.01)])
    parts["bumper"] = merge([box((CAB_FRONT + 0.10, 0.98, 0.0), (0.26, 0.26, 2.36), bevel=0.03),
                             box((CAB_FRONT + 0.05, 1.18, 0.0), (0.10, 0.08, 2.20), bevel=0.01)]
                            + [cyl_between((CAB_FRONT + 0.10, 0.80, s * 0.70), (CAB_FRONT + 0.34, 0.80, s * 0.70), 0.03, 8) for s in (-1, 1)])
    mir_arm, mir = [], []
    for s in (-1, 1):
        a, m = k.mirror((CAB_FRONT - 0.50, 2.25, s * 1.24), s, h=0.48, w=0.24)
        mir_arm += a
        mir.append(m)
    parts["mirror_arms"], parts["mirrors"] = merge(mir_arm), merge(mir)
    steps = []
    for s in (-1, 1):
        steps += k.ladder_steps(3.0, 0.62, s * 1.24, n=2, step=0.30, width=0.52)
    parts["steps"] = merge(steps)

    # ---------- Платформа: настил, борти, передній борт, кран ----------
    L = BED_X1 - BED_X0
    xc = (BED_X0 + BED_X1) / 2
    bed = [box((xc, BED_Y, 0.0), (L, 0.12, 2 * BED_HALF)),
           box((xc, BED_Y - 0.10, 0.0), (L - 0.20, 0.10, 1.80))]
    for z0 in (-0.78, -0.26, 0.26, 0.78):
        bed.append(box((xc, BED_Y - 0.16, z0), (L, 0.10, 0.07)))
    parts["bed"] = merge(bed)
    boards, ribs = [], []
    for s in (-1, 1):
        zb = s * (BED_HALF - 0.04)
        boards.append(box((xc, BED_Y + BOARD_H / 2 + 0.05, zb), (L, BOARD_H, 0.07), bevel=0.012))
        for x in np.linspace(BED_X0 + 0.15, BED_X1 - 0.15, 8):
            ribs.append(box((x, BED_Y + BOARD_H / 2 + 0.05, s * (BED_HALF - 0.005)), (0.07, BOARD_H, 0.03), bevel=0.006))
        boards.append(box((xc, BED_Y + BOARD_H + 0.07, zb), (L, 0.05, 0.10), bevel=0.012))
        rivets += rivet_row((BED_X0 + 0.1, BED_Y + 0.40, s * (BED_HALF + 0.001)), (BED_X1 - 0.1, BED_Y + 0.40, s * (BED_HALF + 0.001)), 0.14, (0, 0, s))
    boards.append(box((BED_X0 + 0.04, BED_Y + BOARD_H / 2 + 0.05, 0.0), (0.07, BOARD_H, 2 * BED_HALF - 0.04), bevel=0.012))   # задній борт
    boards.append(box((BED_X1 - 0.04, BED_Y + 0.70, 0.0), (0.10, 1.40, 2 * BED_HALF - 0.04), bevel=0.02))                      # передній борт-щит
    boards.append(box((BED_X1 - 0.04, BED_Y + 1.46, 0.0), (0.14, 0.07, 2 * BED_HALF - 0.04), bevel=0.02))
    parts["bed_sides"] = merge(boards)
    parts["bed_ribs"] = merge(ribs)
    rings = []
    for s in (-1, 1):
        for x in (-3.0, -1.4, 0.2):
            rings.append(cyl_z((x, BED_Y + 0.08, s * (BED_HALF - 0.14)), 0.05, 0.02, 12))
    parts["tie_downs"] = merge(rings)

    # Кран: основа, складена стріла вздовж платформи, гідроциліндри, гак.
    crane_x, crane_z = -3.25, -0.62
    base = [box((crane_x, BED_Y + 0.30, crane_z), (0.70, 0.60, 0.70), bevel=0.03),
            cyl_z((crane_x, BED_Y + 0.62, crane_z), 0.30, 0.10, 24)]
    parts["crane_base"] = merge(base)
    lift = np.radians(7)
    b0 = np.array([crane_x, BED_Y + 0.85, crane_z])
    b1 = b0 + np.array([np.cos(lift) * 3.3, np.sin(lift) * 3.3, 0.0])
    boom = [cyl_between(b0 + (0, 0, 0.14 * s2), b1 + (0, 0, 0.14 * s2), 0.07, 8) for s2 in (-1, 1)]
    boom += [box((b0[0] + 1.65 * np.cos(lift), b0[1] + 1.65 * np.sin(lift), crane_z), (3.3, 0.22, 0.30), rot_z=lift, bevel=0.02)]
    boom += [box((b1[0] + 0.15, b1[1] + 0.05, crane_z), (0.46, 0.34, 0.34), bevel=0.03)]
    parts["crane_boom"] = merge(boom)
    parts["crane_rams"] = merge([cyl_between((crane_x + 0.1, BED_Y + 0.50, crane_z + 0.22), (crane_x + 1.30, BED_Y + 0.98, crane_z + 0.22), 0.045, 12),
                                 cyl_between((crane_x + 0.1, BED_Y + 0.50, crane_z - 0.22), (crane_x + 1.30, BED_Y + 0.98, crane_z - 0.22), 0.045, 12),
                                 cyl_between((crane_x + 1.5, BED_Y + 0.7, crane_z + 0.0), (crane_x + 2.4, BED_Y + 0.92, crane_z), 0.035, 10)])
    parts["crane_hook"] = merge([cyl_between((b1[0] + 0.30, b1[1] - 0.17, crane_z), (b1[0] + 0.30, b1[1] - 0.55, crane_z), 0.012, 6),
                                 box((b1[0] + 0.30, b1[1] - 0.62, crane_z), (0.10, 0.12, 0.12), bevel=0.02)])
    parts["rivets"] = merge(rivets)
    return parts


# ---------- групи для запікання ----------
OL = vp.R("camo", 0.72, 0.1)
OL_DK = vp.R("camo", 0.74, 0.12, tone=0.8)
CHASSIS_NAMES = ["frame", "axles", "springs", "tanks", "exhaust", "fenders", "rear_beam", "rear_red", "rear_amber", "hitch", "tow_rings", "steps", "rivets"]
CHASSIS_RECIPES = {"frame": vp.R((56, 56, 46), 0.82, 0.3), "axles": vp.R((50, 50, 42), 0.8, 0.4), "springs": vp.R((44, 44, 38), 0.7, 0.6),
                   "tanks": vp.R("camo", 0.7, 0.2, tone=0.8), "exhaust": vp.R((74, 62, 50), 0.6, 0.5), "fenders": OL_DK, "rear_beam": vp.R((54, 54, 44), 0.8, 0.35),
                   "rear_red": vp.LENS_R, "rear_amber": vp.LENS_A, "hitch": vp.R((38, 38, 36), 0.5, 0.8), "tow_rings": vp.R((60, 62, 46), 0.6, 0.4),
                   "steps": vp.R((46, 46, 40), 0.8, 0.5), "rivets": vp.R("camo", 0.7, 0.2, tone=0.75)}
CAB_NAMES = ["cab", "windshields", "windshield_frames", "wipers", "grille_back", "grille", "doors", "side_windows", "door_handles",
             "lamps", "lamps_amber", "bumper", "mirror_arms", "mirrors"]
CAB_RECIPES = {"cab": OL, "windshields": vp.GLASS, "windshield_frames": OL_DK, "wipers": vp.BLACK, "grille_back": vp.BLACK,
               "grille": vp.R("camo", 0.7, 0.2, tone=0.75), "doors": OL, "side_windows": vp.GLASS, "door_handles": vp.R("camo", 0.6, 0.3, tone=0.7),
               "lamps": vp.LENS_W, "lamps_amber": vp.LENS_A, "bumper": vp.R("camo", 0.7, 0.2, tone=0.85), "mirror_arms": OL_DK, "mirrors": vp.BLACK}
BODY_NAMES = ["bed", "bed_sides", "bed_ribs", "tie_downs", "crane_base", "crane_boom", "crane_rams", "crane_hook"]
BODY_RECIPES = {"bed": vp.R((70, 66, 52), 0.8, 0.3), "bed_sides": OL, "bed_ribs": OL_DK, "tie_downs": vp.R((60, 62, 52), 0.6, 0.6),
                "crane_base": OL, "crane_boom": vp.R("camo", 0.68, 0.2, tone=0.9), "crane_rams": vp.STEEL, "crane_hook": vp.R((40, 40, 38), 0.5, 0.8)}
TILES = {"tyres": TileSpec("rubber", (36, 34, 31), 0.4, 1.0, 1.0), "rims": TileSpec("cast", (70, 74, 56), 0.5, 1.0, 1.0),
         "wheel_bolts": TileSpec("steel", (95, 97, 92), 0.3, 1.0, 1.0)}


def post_cab(s, tx, masks):
    Y = (0, 1, 0)
    vp.put(s, tx, vp.mlc_disc(14, 0.075), (CAB_FRONT + 0.0, 1.32, -0.62), (1, 0, 0), Y)
    for sg in (-1, 1):
        vp.put(s, tx, vp.plate(["DATA"], 0.14, 0.09, bg=(176, 178, 170), px_per_m=900), (2.55, 1.40, sg * 1.214), (0, 0, sg), Y)


def post_body(s, tx, masks):
    Y = (0, 1, 0)
    for sg in (-1, 1):
        vp.put(s, tx, vp.stencil_text("NO STEP", 0.06), (-1.2, BED_Y + 0.74, sg * (BED_HALF + 0.034)), (0, 0, sg), Y, thick=0.04)
    vp.put(s, tx, vp.hazard_stripes(1.0, 0.07), (BED_X0 - 0.0, BED_Y + 0.15, 0.0), (-1, 0, 0), Y, thick=0.1)


def group_nodes(parts):
    nodes = []
    spec = (("chassis", CHASSIS_NAMES, CHASSIS_RECIPES, 1024, None, ("fenders",)), ("cab", CAB_NAMES, CAB_RECIPES, 1536, post_cab, ("cab", "doors", "bumper")),
            ("body", BODY_NAMES, BODY_RECIPES, 1536, post_body, ("bed_sides", "crane_base")))
    for gi, (gname, names, recipes, res, post, seams) in enumerate(spec):
        meshes, ids = [], []
        for i, nme in enumerate(names):
            m = parts.pop(nme)
            meshes.append(m)
            ids.append(np.full(len(m.faces), i, np.int16))
        painter = vp.group_painter(names, recipes, camo=False, seed=31 + gi, olive=OLIVE_RGB, weather=dict(mud=0.65 if gname == "chassis" else 0.35, dust=0.5),
                                   seams=seams, post=post)
        nodes.append(node(gname, [(merge(meshes), BakeSpec(painter, res=res, ids=np.concatenate(ids), key=f"m1084-{gname}", seed=31 + gi))]))
    for nme, spec in TILES.items():
        nodes.append(node(nme, [(parts.pop(nme), spec)]))
    return nodes


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    parts = build()
    w = GlbWriter("EasyWAR build-m1084-model.py")
    for nd in group_nodes(parts):
        w.add(nd)
    assert not parts, f"частини без поверхні: {list(parts)}"
    glb = w.glb({"title": "M1084A1P2 (generated)", "generated": True,
                 "note": "Procedural model of an FMTV 6x6 cargo truck with a loading crane, built from open overall dimensions and user-supplied reference "
                         "views. Not a scan or copy of any other model."})
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(glb)
    print(f"{out.name}: {len(glb) / 1024:.0f} KB, {len(w.doc['nodes'])} nodes, {w.triangles} triangles")
    return 0


if __name__ == "__main__":
    sys.exit(main())
