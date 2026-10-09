#!/usr/bin/env python3
"""Генерує процедурну модель оперативно-тактичного ракетного комплексу «Сапсан» (колісне шасі 10×10, один великий
транспортно-пусковий контейнер) для довідника (src/models/sapsan.glb).

    pip install numpy scipy trimesh pillow xatlas   # текстури: script/glb_bake.py, paint_lib.py, vehicle_paint.py
    # EW_FAST=1 — напіврозрізнення для швидкої перевірки; EW_BAKE_CACHE=<тека> — кеш запікань (перед випуском чистити)
    python3 script/build-sapsan-model.py [вихідний.glb]

Форму знято з фото, яке надав користувач (вид спереду зліва): висока гранчаста броньована кабіна над передніми мостами з
двома великими лобовими вікнами під броньованими заслінками, широкий низький бампер із фарами в нішах, номерний знак,
двері з вікном і підніжками, люк на даху, за кабіною — жалюзійний відсік двигуна, далі довгий гранчастий контейнер із
піксельним камуфляжем і ґратчастою кормою, п'ять рівно розставлених осей на борт, великі колеса й арки. Це не скан і не копія чужих моделей,
сторонніх текстур немає. Для перегляду, а не для впізнавання чи розрахунків. Одиниці — метри, перед машини дивиться в +x,
«вгору» — +y, права сторона — +z (як у glTF).
"""
import sys
from pathlib import Path

import numpy as np

from glb_bake import BakeSpec, TileSpec
from glb_rig import GlbWriter, node
import vehicle_8x8 as v8
import vehicle_kit as k
import vehicle_paint as vp
from vehicle_kit import box, cyl_between, level_hull, merge, rivet_row

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "src" / "models" / "sapsan.glb"
AXLES = [3.95, 2.05, 0.15, -1.75, -3.65]       # 10×10: п'ять осей на борт, рівні проміжки
FRAME_X0, FRAME_X1 = -6.40, 5.00
XF = 5.15                          # лобова грань кабіни
CAB_X0 = 3.00
CAB_HALF = 1.30
CAB_Y0, CAB_Y1 = 1.55, 3.18
BOX2_X0 = 1.72                     # відсік двигуна за кабіною
CONT_X0, CONT_X1 = -6.05, 1.72
CONT_Y0, CONT_Y1, CONT_HALF = 1.62, 3.16, 1.34


def build():
    parts = v8.chassis(AXLES, FRAME_X0, FRAME_X1, groups=[(0, 1), (2, 3, 4)])
    rivets = []
    # кабіна
    parts["cab"] = level_hull([(CAB_Y0 - 0.05, XF, CAB_X0, CAB_HALF, 0.10), (2.30, XF, CAB_X0, CAB_HALF, 0.08), (CAB_Y1 - 0.12, XF - 0.05, CAB_X0, CAB_HALF, 0.10),
                               (CAB_Y1, XF - 0.30, CAB_X0 + 0.04, CAB_HALF - 0.05, 0.14)])
    fr, gl, wp = [], [], []
    for z in (-0.58, 0.58):
        fr.append(box((XF + 0.03, 2.58, z), (0.06, 1.00, 1.08), bevel=0.012))
        gl.append(box((XF + 0.075, 2.58, z), (0.02, 0.88, 0.96), bevel=0.004))
        gl.append(box((XF + 0.095, 2.58, z), (0.012, 0.80, 0.88), bevel=0.003))
        wp.append(box((XF + 0.115, 2.42, z + 0.1), (0.012, 0.03, 0.46), bevel=0.003))
        wp.append(box((XF + 0.115, 2.24, z - 0.1), (0.012, 0.03, 0.46), bevel=0.003))
    fr.append(box((XF + 0.04, 2.58, 0.0), (0.08, 1.04, 0.10), bevel=0.01))
    parts["windshield_frames"], parts["windshields"], parts["wipers"] = merge(fr), merge(gl), merge(wp)
    # броньований «козирок» над вікнами й плита під ними
    parts["visor"] = merge([box((XF + 0.08, 3.14, 0.0), (0.20, 0.07, 2.62), bevel=0.02), box((XF + 0.03, 2.00, 0.0), (0.08, 0.10, 2.62), bevel=0.02)])
    # низький бампер із фарами в нішах, номерний знак
    parts["bumper"] = merge([box((XF + 0.20, 1.22, 0.0), (0.58, 0.58, 2.84), bevel=0.05), box((XF + 0.08, 1.62, 0.0), (0.22, 0.12, 2.84), bevel=0.03)])
    parts["valance"] = merge([box((XF + 0.18, 0.88, 0.0), (0.46, 0.20, 2.40), bevel=0.04)] +
                             [cyl_between((XF + 0.30, 0.80, s * 0.70), (XF + 0.52, 0.76, s * 0.70), 0.03, 8) for s in (-1, 1)])
    parts["lamp_niches"] = merge([box((XF + 0.46, 1.28, s * 1.10), (0.06, 0.28, 0.42), bevel=0.02) for s in (-1, 1)])
    parts["lamps"] = merge([box((XF + 0.495, 1.28, s * 1.10), (0.03, 0.18, 0.32), bevel=0.01) for s in (-1, 1)])
    parts["plate"] = merge([box((XF + 0.49, 1.20, -0.10), (0.02, 0.15, 0.55), bevel=0.003)])
    parts["lamps_amber"] = merge([box((XF + 0.465, 1.42, s * 0.62), (0.03, 0.10, 0.14), bevel=0.01) for s in (-1, 1)] +
                                 [box((XF - 0.30, CAB_Y1 + 0.05, z), (0.12, 0.07, 0.17), bevel=0.01) for z in (-0.6, -0.2, 0.2, 0.6)])
    # двері, вікна, ручки, підніжки, дзеркала
    doors, dwin, hand, steps, marms, mirs = [], [], [], [], [], []
    for s in (-1, 1):
        zf = s * (CAB_HALF + 0.012)
        doors.append(box((4.30, 2.38, zf), (1.12, 1.52, 0.03), bevel=0.012))
        dwin.append(box((4.28, 2.80, zf + s * 0.014), (0.70, 0.62, 0.02), bevel=0.006))
        hand.append(box((3.92, 2.30, zf + s * 0.03), (0.16, 0.05, 0.05), bevel=0.01))
        steps += k.ladder_steps(4.50, 0.78, s * (CAB_HALF + 0.06), n=3, step=0.30, width=0.56)
        a, m = k.mirror((XF - 0.12, 2.80, s * (CAB_HALF + 0.02)), s, h=0.50, w=0.20)
        marms += a
        mirs.append(m)
        rivets += rivet_row((3.7, 1.75, zf + s * 0.003), (3.7, 3.0, zf + s * 0.003), 0.14, (0, 0, s))
        rivets += rivet_row((4.9, 1.75, zf + s * 0.003), (4.9, 3.0, zf + s * 0.003), 0.14, (0, 0, s))
    parts["doors"], parts["side_windows"], parts["door_handles"] = merge(doors), merge(dwin), merge(hand)
    parts["steps"], parts["mirror_arms"], parts["mirrors"] = merge(steps), merge(marms), merge(mirs)
    # люк на даху
    parts["roof_hatch"] = merge([cyl_between((4.20, CAB_Y1 - 0.02, -0.30), (4.20, CAB_Y1 + 0.16, -0.30), 0.34, 28), cyl_between((4.20, CAB_Y1 + 0.16, -0.30), (4.20, CAB_Y1 + 0.22, -0.30), 0.26, 24),
                                 box((4.20, CAB_Y1 + 0.22, -0.30), (0.20, 0.06, 0.12), bevel=0.01)])
    # відсік двигуна: корпус, жалюзі збоку, похилі повітрозабірники на даху
    b2 = level_hull([(CAB_Y0 - 0.05, CAB_X0 + 0.02, BOX2_X0, CAB_HALF - 0.02, 0.06), (2.70, CAB_X0 + 0.02, BOX2_X0, CAB_HALF - 0.02, 0.06), (CAB_Y1 - 0.20, CAB_X0 + 0.02, BOX2_X0, CAB_HALF - 0.05, 0.08)])
    parts["engine_box"] = b2
    lou = []
    for s in (-1, 1):
        for i in range(8):
            lou.append(box((2.85 - 0.11 * i, 2.62, s * (CAB_HALF - 0.005)), (0.07, 0.03, 0.02), bevel=0.003) if False else
                       box((2.80 - 0.11 * i, 2.40 + 0.0, s * (CAB_HALF + 0.012)), (0.06, 0.55, 0.02), bevel=0.003))
    for i in range(7):
        lou.append(box((2.85 - 0.14 * i, CAB_Y1 - 0.12, 0.0), (0.07, 0.03, 1.10), rot_y=0.0, bevel=0.004))
    parts["louvers"] = merge(lou)
    # контейнер: корпус, пояс жорсткості, корма-ґрати, петлі, номерні таблички
    cx = (CONT_X0 + CONT_X1) / 2
    parts["container"] = box((cx, (CONT_Y0 + CONT_Y1) / 2, 0.0), (CONT_X1 - CONT_X0, CONT_Y1 - CONT_Y0, 2 * CONT_HALF), bevel=0.07)
    ribs = []
    for x in np.linspace(CONT_X0 + 0.5, CONT_X1 - 0.5, 9):
        ribs.append(box((x, CONT_Y1 + 0.012, 0.0), (0.09, 0.025, 2 * CONT_HALF - 0.12), bevel=0.005))
    for s in (-1, 1):
        ribs.append(box((cx, CONT_Y1 - 0.06, s * (CONT_HALF - 0.03)), (CONT_X1 - CONT_X0 + 0.02, 0.10, 0.10), bevel=0.015))
        ribs.append(box((cx, CONT_Y0 + 0.06, s * (CONT_HALF - 0.01)), (CONT_X1 - CONT_X0, 0.12, 0.05), bevel=0.01))
        ribs.append(box((cx, (CONT_Y0 + CONT_Y1) / 2, s * (CONT_HALF + 0.012)), (CONT_X1 - CONT_X0 - 0.4, 0.03, 0.03), bevel=0.004))
    parts["cont_ribs"] = merge(ribs)
    rg = [box((CONT_X0 - 0.06, 2.40, 0.0), (0.10, 1.34, 2.32), bevel=0.02)]
    for i in range(10):
        rg.append(box((CONT_X0 - 0.12, 1.80 + 0.12 * i, 0.0), (0.04, 0.05, 2.20), bevel=0.006))
    parts["rear_grille"] = merge(rg)
    cr = []
    for s in (-1, 1):
        for x in (-5.4, 1.0):
            cr += [box((x, 1.52, s * 1.04), (0.50, 0.20, 0.22), bevel=0.02)]
    parts["cradle"] = merge(cr + [box((0.0, 1.46, s * 0.55), (CONT_X1 - CONT_X0 - 0.6, 0.12, 0.14), bevel=0.01) for s in (-1, 1)])
    parts["cont_rivets"] = merge(rivet_row((CONT_X0 + 0.25, 2.25, CONT_HALF + 0.001), (CONT_X1 - 0.25, 2.25, CONT_HALF + 0.001), 0.17, (0, 0, 1)) +
                                 rivet_row((CONT_X0 + 0.25, 2.25, -CONT_HALF - 0.001), (CONT_X1 - 0.25, 2.25, -CONT_HALF - 0.001), 0.17, (0, 0, -1)))
    parts["cab_rivets"] = merge(rivets)
    # опорні домкрати (підняті) біля задньої осі, вихлоп
    jacks = []
    for s in (-1, 1):
        x = -4.30
        jacks += [box((x, 1.00, s * 1.12), (0.30, 0.22, 0.20), bevel=0.02), cyl_between((x, 1.00, s * 1.26), (x, 0.72, s * 1.26), 0.065, 10),
                  box((x, 0.68, s * 1.26), (0.34, 0.06, 0.34), bevel=0.01)]
    parts["jacks"] = merge(jacks)
    parts["exhaust"] = merge([cyl_between((1.55, 1.30, -1.28), (1.55, 3.30, -1.28), 0.07, 14), cyl_between((1.55, 3.30, -1.28), (1.55, 3.40, -1.28), 0.10, 14)])
    return parts


TILES = {"tyres": TileSpec("rubber", (36, 34, 31), 0.4, 1.0, 1.0), "rims": TileSpec("cast", (68, 80, 56), 0.5, 1.0, 1.0),
         "wheel_bolts": TileSpec("steel", (95, 97, 92), 0.3, 1.0, 1.0)}
OL, OL_DK = v8.OL, v8.OL_DK
DARK = vp.R((28, 29, 26), 0.78, 0.1, 0.8)
SHUTTER = vp.R((46, 36, 30), 0.7, 0.3, 0.5)
CHASSIS_NAMES = v8.CHASSIS_NAMES + ["steps", "jacks", "valance", "exhaust"]
CHASSIS_RECIPES = {**v8.CHASSIS_RECIPES, "steps": vp.R((46, 46, 40), 0.8, 0.5), "jacks": vp.R((52, 54, 44), 0.75, 0.4), "valance": vp.R((40, 42, 36), 0.78, 0.3),
                   "exhaust": vp.R((60, 54, 46), 0.6, 0.5)}
CAB_NAMES = ["cab", "windshield_frames", "windshields", "wipers", "visor", "bumper", "lamp_niches", "lamps", "plate", "lamps_amber", "doors", "side_windows",
             "door_handles", "mirror_arms", "mirrors", "roof_hatch", "engine_box", "louvers", "cab_rivets"]
CAB_RECIPES = {"cab": OL, "windshield_frames": OL_DK, "windshields": SHUTTER, "wipers": vp.BLACK, "visor": OL_DK, "bumper": OL_DK, "lamp_niches": DARK, "lamps": vp.LENS_W,
               "plate": vp.R((186, 188, 178), 0.5, 0.1, 0.4), "lamps_amber": vp.LENS_A, "doors": OL, "side_windows": vp.GLASS, "door_handles": vp.R("camo", 0.6, 0.3, tone=0.6),
               "mirror_arms": OL_DK, "mirrors": DARK, "roof_hatch": OL_DK, "engine_box": OL, "louvers": vp.R("camo", 0.7, 0.3, tone=0.6),
               "cab_rivets": vp.R("camo", 0.7, 0.2, tone=0.75)}
CONT_NAMES = ["container", "cont_ribs", "rear_grille", "cradle", "cont_rivets"]
CONT_RECIPES = {"container": OL, "cont_ribs": OL_DK, "rear_grille": DARK, "cradle": vp.R((50, 52, 42), 0.8, 0.35), "cont_rivets": vp.R("camo", 0.7, 0.2, tone=0.75)}


def post_cab(s, tx, masks):
    Y = (0, 1, 0)
    vp.put(s, tx, vp.plate(["4457 A1"], 0.50, 0.12, bg=(186, 188, 178), px_per_m=900), (XF + 0.502, 1.20, -0.10), (1, 0, 0), Y)


def post_cont(s, tx, masks):
    Y = (0, 1, 0)
    vp.put(s, tx, vp.hazard_stripes(1.2, 0.07), (CONT_X0 - 0.15, 1.72, 0.0), (-1, 0, 0), Y, thick=0.1)


def group_nodes(parts):
    nodes = []
    spec = (("chassis", CHASSIS_NAMES, CHASSIS_RECIPES, 1536, None, ("fenders",)), ("cab", CAB_NAMES, CAB_RECIPES, 2048, post_cab, ("cab", "doors", "engine_box")),
            ("container", CONT_NAMES, CONT_RECIPES, 2048, post_cont, ("container",)))
    for gi, (gname, names, recipes, res, post, seams) in enumerate(spec):
        meshes, ids = [], []
        for i, nme in enumerate(names):
            m = parts.pop(nme)
            meshes.append(m)
            ids.append(np.full(len(m.faces), i, np.int16))
        painter = vp.group_painter(names, recipes, camo="pixel", seed=81 + gi, olive=v8.OLIVE_RGB, camo_colors=v8.PIXEL,
                                   weather=dict(mud=0.7 if gname == "chassis" else 0.3, dust=0.5), seams=seams, post=post)
        nodes.append(node(gname, [(merge(meshes), BakeSpec(painter, res=res, ids=np.concatenate(ids), key=f"sapsan2-{gname}", seed=81 + gi))]))
    for nme, spec in TILES.items():
        nodes.append(node(nme, [(parts.pop(nme), spec)]))
    return nodes


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    parts = build()
    w = GlbWriter("EasyWAR build-sapsan-model.py")
    for nd in group_nodes(parts):
        w.add(nd)
    assert not parts, f"частини без поверхні: {list(parts)}"
    glb = w.glb({"title": "Sapsan (generated)", "generated": True,
                 "note": "Procedural model of an 10x10 wheeled operational-tactical missile launcher with a transport-launch container, built from open "
                         "overall dimensions and a user-supplied reference photo. Not a scan or copy of any other model."})
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(glb)
    print(f"{out.name}: {len(glb) / 1024:.0f} KB, {len(w.doc['nodes'])} nodes, {w.triangles} triangles")
    return 0


if __name__ == "__main__":
    sys.exit(main())
