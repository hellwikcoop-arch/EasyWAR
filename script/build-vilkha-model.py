#!/usr/bin/env python3
"""Генерує процедурну модель реактивної системи залпового вогню Р-624 «Вільха» (колісне шасі 8×8, 12 труб калібру 300 мм
у пакеті 3×4) для довідника (src/models/vilkha.glb).

    pip install numpy scipy trimesh pillow xatlas   # текстури: script/glb_bake.py, paint_lib.py, vehicle_paint.py
    # EW_FAST=1 — напіврозрізнення для швидкої перевірки; EW_BAKE_CACHE=<тека> — кеш запікань (перед випуском чистити)
    python3 script/build-vilkha-model.py [вихідний.glb]

Форму знято з фото, яке надав користувач (вид спереду зліва): шасі типу МАЗ-543 з двома окремими кабінами по краях і
моторним тунелем між ними, низький широкий капот-«ніс» з фарами й трубчастим бампером, за кабінами — довгий кожух пакета
з піксельним камуфляжем і дульними кінцями трьох рядів труб із червоними кришками, що виглядають між кабінами, ґратчастий
щит позаду, великі колеса з арками. Це не скан і не копія чужих моделей, сторонніх текстур немає. Для перегляду, а не для
впізнавання чи розрахунків. Одиниці — метри, перед машини дивиться в +x, «вгору» — +y, права сторона — +z (як у glTF).
"""
import sys
from pathlib import Path

import numpy as np

from glb_bake import BakeSpec, TileSpec
from glb_rig import GlbWriter, node
import vehicle_8x8 as v8
import vehicle_kit as k
import vehicle_paint as vp
from vehicle_kit import box, cyl_between, cyl_x, level_hull, merge, rivet_row, slope_box

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "src" / "models" / "vilkha.glb"
AXLES = [3.75, 1.95, -0.65, -2.45]
FRAME_X0, FRAME_X1 = -5.45, 4.95
NOSE_X = 5.00                       # передня грань капота
CAB_X0, CAB_X1 = 3.25, 4.90         # кабіни: задня й передня грані
CAB_ZC, CAB_HW = 1.03, 0.40         # центр і півширина кожної кабіни
TUNNEL_TOP = 1.90
HOUSE_X0, HOUSE_X1 = -5.30, 2.72
HOUSE_Y0, HOUSE_Y1, HOUSE_HALF = 1.62, 3.02, 1.38
TUBE_R, PITCH = 0.135, 0.30
ROWS = (2.12, 2.42, 2.72)
COLS = [(-1.5 + i) * PITCH for i in range(4)]
MUZZLE_X = 3.50


def cab_side(s):
    """Кабіна з одного боку: гранчастий корпус, лобове скло під нахилом, двері з вікном, поруччя, підніжки, дзеркало."""
    p, rivets = {}, []
    zc = s * CAB_ZC
    hull = level_hull([(1.42, CAB_X1, CAB_X0, CAB_HW, 0.06), (2.00, CAB_X1, CAB_X0, CAB_HW, 0.06), (2.76, CAB_X1 - 0.42, CAB_X0, CAB_HW - 0.02, 0.10)])
    hull.apply_translation((0, 0, zc))
    p["cab"] = hull
    ws0, ws1 = (CAB_X1, 2.0), (CAB_X1 - 0.42, 2.76)
    p["glass"] = [slope_box(ws0, ws1, 0.5, 0.05, (0.012, 0.80, 0.56), zc)]
    p["frames"] = [slope_box(ws0, ws1, 0.5, 0.03, (0.018, 0.86, 0.64), zc)]
    p["wipers"] = [slope_box(ws0, ws1, 0.3, 0.07, (0.012, 0.32, 0.02), zc + 0.1)]
    zf = s * (CAB_ZC + CAB_HW + 0.01)
    p["doors"] = [box(((CAB_X0 + CAB_X1) / 2 - 0.05, 1.95, zf), (1.20, 1.00, 0.025), bevel=0.012)]
    p["side_glass"] = [box((4.15, 2.40, zf + s * 0.004), (0.74, 0.42, 0.014), bevel=0.004)]
    p["handles"] = [box((3.50, 1.95, zf + s * 0.014), (0.14, 0.04, 0.04), bevel=0.008)]
    steps = k.ladder_steps(4.30, 0.78, s * (CAB_ZC + CAB_HW + 0.06), n=3, step=0.30, width=0.50)
    p["steps"] = steps
    a, m = k.mirror((CAB_X1 - 0.30, 2.40, s * (CAB_ZC + CAB_HW + 0.02)), s, h=0.50, w=0.24)
    p["mirror_arms"], p["mirrors"] = a, [m]
    for x in (3.5, 4.5):
        rivets += rivet_row((x, 1.5, zf + s * 0.003), (x, 2.35, zf + s * 0.003), 0.13, (0, 0, s))
    p["rivets"] = rivets
    return p


def build():
    parts = v8.chassis(AXLES, FRAME_X0, FRAME_X1)
    cabs = {k_: [] for k_ in ("cab", "glass", "frames", "wipers", "doors", "side_glass", "handles", "steps", "mirror_arms", "mirrors", "rivets")}
    for s in (-1, 1):
        for key, lst in cab_side(s).items():
            cabs[key] += lst if isinstance(lst, list) else [lst]
    parts["cab"] = merge(cabs["cab"])
    parts["windshields"], parts["windshield_frames"], parts["wipers"] = merge(cabs["glass"]), merge(cabs["frames"]), merge(cabs["wipers"])
    parts["doors"], parts["side_windows"], parts["door_handles"] = merge(cabs["doors"]), merge(cabs["side_glass"]), merge(cabs["handles"])
    parts["steps"], parts["mirror_arms"], parts["mirrors"] = merge(cabs["steps"]), merge(cabs["mirror_arms"]), merge(cabs["mirrors"])
    parts["cab_rivets"] = merge(cabs["rivets"])

    # моторний тунель між кабінами, ґрати спереду, жалюзі зверху, нижній «ніс» з фарами й трубчастим бампером
    parts["tunnel"] = level_hull([(1.40, NOSE_X, HOUSE_X1, 0.64, 0.08), (TUNNEL_TOP, NOSE_X - 0.02, HOUSE_X1, 0.64, 0.08), (TUNNEL_TOP + 0.06, NOSE_X - 0.12, HOUSE_X1, 0.60, 0.1)])
    bars = [box((NOSE_X + 0.015, 1.50 + 0.05 * i, 0.0), (0.014, 0.024, 1.0), bevel=0.004) for i in range(8)]
    parts["grille"] = merge([box((NOSE_X + 0.008, 1.66, 0.0), (0.03, 0.44, 1.08), bevel=0.008)] + bars)
    parts["grille_back"] = merge([box((NOSE_X + 0.002, 1.66, 0.0), (0.02, 0.40, 1.02), bevel=0.004)])
    parts["vents"] = merge([box((4.0 - 0.18 * i, TUNNEL_TOP + 0.075, 0.0), (0.08, 0.025, 0.74), bevel=0.004) for i in range(6)])
    parts["nose"] = merge([box((NOSE_X + 0.28, 1.00, 0.0), (0.62, 0.62, 2.86), bevel=0.05),
                           box((NOSE_X + 0.10, 1.40, 0.0), (0.30, 0.20, 2.60), bevel=0.04)])
    parts["bumper_bar"] = merge([cyl_between((NOSE_X + 0.60, 0.92, -1.20), (NOSE_X + 0.60, 0.92, 1.20), 0.032, 10)] +
                                [cyl_between((NOSE_X + 0.58, 0.92, s * 1.20), (NOSE_X + 0.58, 0.92, s * 1.20 + 0.0), 0.0001, 3) if False else
                                 cyl_between((NOSE_X + 0.31, 0.95, s * 1.00), (NOSE_X + 0.60, 0.92, s * 1.00), 0.026, 8) for s in (-1, 1)] +
                                [cyl_between((NOSE_X + 0.31, 0.95, 0.0), (NOSE_X + 0.60, 0.92, 0.0), 0.026, 8)])
    parts["lamps"] = merge([box((NOSE_X + 0.60, 1.08, s * 0.90), (0.03, 0.14, 0.20), bevel=0.01) for s in (-1, 1)] +
                           [box((NOSE_X + 0.60, 1.08, s * 0.50), (0.03, 0.12, 0.16), bevel=0.01) for s in (-1, 1)])
    parts["lamps_amber"] = merge([box((NOSE_X + 0.60, 1.08, s * 1.28), (0.03, 0.10, 0.14), bevel=0.01) for s in (-1, 1)])
    parts["tow_hooks"] = merge([cyl_between((NOSE_X + 0.56, 0.70, s * 0.55), (NOSE_X + 0.68, 0.64, s * 0.55), 0.04, 8) for s in (-1, 1)])
    parts["exhaust"] = merge([cyl_between((2.55, 1.30, 1.30), (2.55, 3.20, 1.30), 0.07, 14), cyl_between((2.55, 3.20, 1.30), (2.55, 3.30, 1.30), 0.10, 14)])

    # кожух пакета на задній частині шасі
    hx = (HOUSE_X0 + HOUSE_X1) / 2
    parts["housing"] = box((hx, (HOUSE_Y0 + HOUSE_Y1) / 2, 0.0), (HOUSE_X1 - HOUSE_X0, HOUSE_Y1 - HOUSE_Y0, 2 * HOUSE_HALF), bevel=0.07)
    trim = []
    for s in (-1, 1):
        trim.append(box((hx, HOUSE_Y1 - 0.05, s * (HOUSE_HALF - 0.04)), (HOUSE_X1 - HOUSE_X0 + 0.02, 0.07, 0.10), bevel=0.015))
        trim.append(box((hx, HOUSE_Y0 + 0.06, s * (HOUSE_HALF - 0.01)), (HOUSE_X1 - HOUSE_X0, 0.12, 0.05), bevel=0.01))
    for x in np.linspace(HOUSE_X0 + 0.4, HOUSE_X1 - 0.4, 7):
        trim.append(box((x, HOUSE_Y1 + 0.01, 0.0), (0.09, 0.03, 2 * HOUSE_HALF - 0.14), bevel=0.006))     # ребра на даху
    parts["house_trim"] = merge(trim)
    sk = []
    for s in (-1, 1):
        sk.append(box((hx - 0.3, HOUSE_Y0 - 0.22, s * (HOUSE_HALF - 0.03)), (HOUSE_X1 - HOUSE_X0 - 1.2, 0.34, 0.06), bevel=0.01))
    parts["house_skirt"] = merge(sk)
    parts["house_rivets"] = merge(rivet_row((HOUSE_X0 + 0.2, 2.2, HOUSE_HALF + 0.001), (HOUSE_X1 - 0.2, 2.2, HOUSE_HALF + 0.001), 0.16, (0, 0, 1)) +
                                  rivet_row((HOUSE_X0 + 0.2, 2.2, -HOUSE_HALF - 0.001), (HOUSE_X1 - 0.2, 2.2, -HOUSE_HALF - 0.001), 0.16, (0, 0, -1)))
    # ґратчастий щит у кормі й драбинка
    rb = [box((HOUSE_X0 - 0.07, 2.28, 0.0), (0.12, 1.10, 2.32), bevel=0.02)]
    for i in range(7):
        rb.append(box((HOUSE_X0 - 0.14, 1.88 + 0.12 * i, 0.0), (0.04, 0.05, 2.20), bevel=0.006))
    parts["rear_grille"] = merge(rb)
    parts["ladder"] = merge([cyl_between((HOUSE_X0 - 0.12, 1.55, s * 0.30), (HOUSE_X0 - 0.12, 2.9, s * 0.30), 0.02, 8) for s in (-1, 1)] +
                            [cyl_between((HOUSE_X0 - 0.12, 1.75 + 0.22 * i, -0.30), (HOUSE_X0 - 0.12, 1.75 + 0.22 * i, 0.30), 0.016, 8) for i in range(6)])

    # пакет: 12 труб 3×4, видимі дульні кінці між кабінами, червоні кришки
    tubes, rings, caps = [], [], []
    for y in ROWS:
        for z in COLS:
            tubes.append(cyl_x(HOUSE_X1 - 0.6, MUZZLE_X, y, z, TUBE_R, 28))
            rings.append(cyl_x(MUZZLE_X - 0.02, MUZZLE_X + 0.035, y, z, TUBE_R + 0.012, 28))
            caps.append(cyl_x(MUZZLE_X + 0.035, MUZZLE_X + 0.045, y, z, TUBE_R * 0.66, 20))
    parts["tubes"], parts["muzzle_rims"], parts["muzzle_caps"] = merge(tubes), merge(rings), merge(caps)
    ymid = ROWS[1]
    parts["pack_bands"] = merge([box((x, ymid, 0.0), (0.07, 3 * PITCH + 0.06, 4 * PITCH + 0.06), bevel=0.01) for x in (HOUSE_X1 + 0.06, HOUSE_X1 + 0.50)] +
                                [box((HOUSE_X1 + 0.15, ymid - 0.46, 0.0), (0.9, 0.06, 4 * PITCH + 0.2), bevel=0.01)])
    # опорні домкрати (підняті) біля задньої осі
    jacks = []
    for s in (-1, 1):
        x = -3.45
        jacks += [box((x, 1.00, s * 1.12), (0.30, 0.22, 0.20), bevel=0.02), cyl_between((x, 1.00, s * 1.26), (x, 0.72, s * 1.26), 0.065, 10),
                  box((x, 0.68, s * 1.26), (0.34, 0.06, 0.34), bevel=0.01)]
    parts["jacks"] = merge(jacks)
    return parts


TILES = {"tyres": TileSpec("rubber", (36, 34, 31), 0.4, 1.0, 1.0), "rims": TileSpec("cast", (68, 80, 56), 0.5, 1.0, 1.0),
         "wheel_bolts": TileSpec("steel", (95, 97, 92), 0.3, 1.0, 1.0)}
OL, OL_DK = v8.OL, v8.OL_DK
DARK = vp.R((28, 29, 26), 0.78, 0.1, 0.8)
CHASSIS_NAMES = v8.CHASSIS_NAMES + ["steps", "exhaust", "jacks", "tow_hooks", "bumper_bar"]
CHASSIS_RECIPES = {**v8.CHASSIS_RECIPES, "steps": vp.R((46, 46, 40), 0.8, 0.5), "exhaust": vp.R((60, 54, 46), 0.6, 0.5), "jacks": vp.R((52, 54, 44), 0.75, 0.4),
                   "tow_hooks": vp.R((44, 44, 40), 0.6, 0.6), "bumper_bar": vp.R((150, 150, 144), 0.4, 0.9, 0.6)}
CAB_NAMES = ["cab", "windshields", "windshield_frames", "wipers", "doors", "side_windows", "door_handles", "mirror_arms", "mirrors", "cab_rivets",
             "tunnel", "grille", "grille_back", "vents", "nose", "lamps", "lamps_amber"]
CAB_RECIPES = {"cab": OL, "windshields": vp.GLASS, "windshield_frames": OL_DK, "wipers": vp.BLACK, "doors": OL, "side_windows": vp.GLASS,
               "door_handles": vp.R("camo", 0.6, 0.3, tone=0.6), "mirror_arms": OL_DK, "mirrors": DARK, "cab_rivets": vp.R("camo", 0.7, 0.2, tone=0.75),
               "tunnel": OL, "grille": DARK, "grille_back": vp.BLACK, "vents": vp.R("camo", 0.7, 0.3, tone=0.6), "nose": OL_DK, "lamps": vp.LENS_W, "lamps_amber": vp.LENS_A}
HOUSE_NAMES = ["housing", "house_trim", "house_skirt", "house_rivets", "rear_grille", "ladder", "tubes", "muzzle_rims", "muzzle_caps", "pack_bands"]
HOUSE_RECIPES = {"housing": OL, "house_trim": OL_DK, "house_skirt": OL_DK, "house_rivets": vp.R("camo", 0.7, 0.2, tone=0.75), "rear_grille": DARK,
                 "ladder": vp.R((46, 46, 40), 0.8, 0.5), "tubes": vp.R((46, 54, 38), 0.7, 0.3), "muzzle_rims": vp.R((156, 40, 34), 0.5, 0.2, 0.8),
                 "muzzle_caps": vp.R((26, 27, 25), 0.7, 0.2, 0.8), "pack_bands": vp.R((44, 46, 38), 0.7, 0.45)}


def post_cab(s, tx, masks):
    Y = (0, 1, 0)
    for sg in (-1, 1):
        vp.put(s, tx, vp.plate(["DATA"], 0.14, 0.09, bg=(176, 178, 170), px_per_m=900), (3.3, 1.45, sg * (CAB_ZC + CAB_HW + 0.016)), (0, 0, sg), Y)


def post_house(s, tx, masks):
    Y = (0, 1, 0)
    vp.put(s, tx, vp.hazard_stripes(1.2, 0.07), (HOUSE_X0 - 0.22, 1.76, 0.0), (-1, 0, 0), Y, thick=0.1)


def group_nodes(parts):
    nodes = []
    spec = (("chassis", CHASSIS_NAMES, CHASSIS_RECIPES, 1536, None, ("fenders",), "pixel"),
            ("cab", CAB_NAMES, CAB_RECIPES, 2048, post_cab, ("cab", "doors", "tunnel", "nose"), "pixel"),
            ("housing", HOUSE_NAMES, HOUSE_RECIPES, 2048, post_house, ("housing",), "pixel"))
    for gi, (gname, names, recipes, res, post, seams, camo) in enumerate(spec):
        meshes, ids = [], []
        for i, nme in enumerate(names):
            m = parts.pop(nme)
            meshes.append(m)
            ids.append(np.full(len(m.faces), i, np.int16))
        painter = vp.group_painter(names, recipes, camo=camo, seed=71 + gi, olive=v8.OLIVE_RGB, camo_colors=v8.PIXEL,
                                   weather=dict(mud=0.7 if gname == "chassis" else 0.3, dust=0.5), seams=seams, post=post)
        nodes.append(node(gname, [(merge(meshes), BakeSpec(painter, res=res, ids=np.concatenate(ids), key=f"vilkha2-{gname}", seed=71 + gi))]))
    for nme, spec in TILES.items():
        nodes.append(node(nme, [(parts.pop(nme), spec)]))
    return nodes


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    parts = build()
    w = GlbWriter("EasyWAR build-vilkha-model.py")
    for nd in group_nodes(parts):
        w.add(nd)
    assert not parts, f"частини без поверхні: {list(parts)}"
    glb = w.glb({"title": "R-624 Vilkha (generated)", "generated": True,
                 "note": "Procedural model of an 8x8 wheeled 300 mm rocket launcher with a twelve-tube pack, built from open overall dimensions and a "
                         "user-supplied reference photo. Not a scan or copy of any other model."})
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(glb)
    print(f"{out.name}: {len(glb) / 1024:.0f} KB, {len(w.doc['nodes'])} nodes, {w.triangles} triangles")
    return 0


if __name__ == "__main__":
    sys.exit(main())
