#!/usr/bin/env python3
"""Генерує процедурну модель оперативно-тактичного ракетного комплексу «Сапсан» (колісне шасі 8×8, два транспортно-пускові
контейнери) для довідника (src/models/sapsan.glb).

    pip install numpy scipy trimesh pillow xatlas   # текстури: script/glb_bake.py, paint_lib.py, vehicle_paint.py
    # EW_FAST=1 — напіврозрізнення для швидкої перевірки; EW_BAKE_CACHE=<тека> — кеш запікань (перед випуском чистити)
    python3 script/build-sapsan-model.py [вихідний.glb]

Форму знято з довідкового зображення, яке надав користувач, і узгоджено з відкритими габаритами (шасі 8×8 з кабіною над
передніми мостами, два прямокутні контейнери завдовжки ≈ 7,6 м поруч): кабіна, рама, 8 коліс, контейнери у транспортному
положенні з ребрами жорсткості, передніми кришками й кільцями для стропування, люлька з гідроциліндрами підйому, стабілізатори в
кормі, ящики розрахунку по бортах. Це не скан і не копія чужих моделей, сторонніх текстур немає. Для перегляду, а не для
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
from vehicle_kit import box, cyl_between, hull, merge, rivet_row

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "src" / "models" / "sapsan.glb"
CX0, CX1 = -4.70, 2.95
CZ, CW, CH, CY = 0.56, 1.00, 1.04, 2.46          # смуга контейнера: центр по z, ширина, висота, висота осі
DECK_X0, DECK_X1 = v8.FRAME_X0 + 0.1, 3.05


def container(z):
    """Контейнер: гранчастий корпус із фасками, пояси жорсткості, передня кришка з пірамідою, задня заглушка."""
    body = box(((CX0 + CX1) / 2, CY, z), (CX1 - CX0, CH, CW), bevel=0.05)
    ribs = []
    for x in np.linspace(CX0 + 0.35, CX1 - 0.45, 9):
        ribs.append(box((x, CY, z), (0.09, CH + 0.06, CW + 0.06), bevel=0.012))
    for s in (-1, 1):
        ribs.append(box(((CX0 + CX1) / 2, CY + CH / 2 + 0.01, z + s * (CW / 2 - 0.08)), (CX1 - CX0 - 0.1, 0.03, 0.05), bevel=0.006))
    nose = hull([(CX1, CY - CH / 2 + 0.06, z - CW / 2 + 0.06), (CX1, CY - CH / 2 + 0.06, z + CW / 2 - 0.06), (CX1, CY + CH / 2 - 0.06, z - CW / 2 + 0.06),
                 (CX1, CY + CH / 2 - 0.06, z + CW / 2 - 0.06), (CX1 + 0.26, CY - 0.18, z - 0.20), (CX1 + 0.26, CY - 0.18, z + 0.20),
                 (CX1 + 0.26, CY + 0.18, z - 0.20), (CX1 + 0.26, CY + 0.18, z + 0.20)])
    rear = box((CX0 - 0.05, CY, z), (0.10, CH + 0.08, CW + 0.08), bevel=0.02)
    rings = [k.cyl_between((x, CY + CH / 2 + 0.02, z + dz), (x, CY + CH / 2 + 0.10, z + dz), 0.035, 8) for x in (CX0 + 0.5, CX1 - 0.6) for dz in (-0.25, 0.25)]
    return body, merge(ribs), nose, rear, merge(rings)


def build():
    parts = v8.chassis()
    parts.update(v8.cab_over())
    L = DECK_X1 - DECK_X0
    xc = (DECK_X0 + DECK_X1) / 2
    parts["deck"] = merge([box((xc, v8.DECK_Y, 0.0), (L, 0.12, 2.36)), box((xc, v8.DECK_Y - 0.10, 0.0), (L - 0.3, 0.10, 1.90))] +
                          [box((xc, v8.DECK_Y - 0.14, z), (L, 0.08, 0.07)) for z in (-0.80, -0.27, 0.27, 0.80)])
    lockers, ldoors = [], []
    for s in (-1, 1):
        for x0, x1 in ((2.9, 1.5), (0.2, -2.4)):
            cx, ln = (x0 + x1) / 2, abs(x0 - x1)
            lockers.append(box((cx, v8.DECK_Y + 0.34, s * 1.10), (ln, 0.62, 0.30), bevel=0.02))
            ldoors.append(box((cx, v8.DECK_Y + 0.32, s * 1.255), (ln - 0.12, 0.48, 0.02), bevel=0.01))
    parts["lockers"], parts["locker_doors"] = merge(lockers), merge(ldoors)
    bodies, ribs, noses, rears, rings = zip(*(container(z) for z in (-CZ, CZ)))
    parts["containers"], parts["ribs"], parts["noses"], parts["rear_plugs"], parts["lifting_rings"] = (merge(bodies), merge(ribs), merge(noses), merge(rears), merge(rings))
    cradle = [box(((CX0 + CX1) / 2, 1.80, s * 0.95), (CX1 - CX0, 0.14, 0.20), bevel=0.015) for s in (-1, 0, 1)]
    cradle += [box((x, 1.82, 0.0), (0.14, 0.10, 2.24), bevel=0.012) for x in np.linspace(CX0 + 0.3, CX1 - 0.4, 8)]
    cradle += [box((CX0 + 0.10, 1.75, s * 0.95), (0.30, 0.50, 0.24), bevel=0.02) for s in (-1, 1)]
    for x in np.linspace(CX0 + 0.4, CX1 - 0.5, 4):
        for s in (-1, 1):
            cradle.append(box((x, 1.64, s * 0.95), (0.10, 0.34, 0.12), bevel=0.01))
    parts["cradle"] = merge(cradle)
    parts["rams"] = merge([cyl_between((-0.30, v8.DECK_Y + 0.05, s * 0.55), (0.90, 1.74, s * 0.55), 0.065, 12) for s in (-1, 1)] +
                          [cyl_between((-0.30, v8.DECK_Y + 0.05, s * 0.55), (-0.30, v8.DECK_Y + 0.35, s * 0.55), 0.095, 12) for s in (-1, 1)])
    jacks = []
    for s in (-1, 1):
        for x in (-4.95, -0.85):
            jacks += [box((x, 1.12, s * 1.08), (0.30, 0.24, 0.20), bevel=0.02), cyl_between((x, 1.12, s * 1.22), (x, 0.78, s * 1.22), 0.07, 10),
                      box((x, 0.74, s * 1.22), (0.34, 0.06, 0.34), bevel=0.01)]
    parts["jacks"] = merge(jacks)
    parts["deck_rivets"] = merge(rivet_row((DECK_X0 + 0.2, v8.DECK_Y + 0.34, 1.261), (DECK_X1 - 0.2, v8.DECK_Y + 0.34, 1.261), 0.14, (0, 0, 1)) +
                                 rivet_row((DECK_X0 + 0.2, v8.DECK_Y + 0.34, -1.261), (DECK_X1 - 0.2, v8.DECK_Y + 0.34, -1.261), 0.14, (0, 0, -1)))
    return parts


TILES = {"tyres": TileSpec("rubber", (36, 34, 31), 0.4, 1.0, 1.0), "rims": TileSpec("cast", (70, 74, 56), 0.5, 1.0, 1.0),
         "wheel_bolts": TileSpec("steel", (95, 97, 92), 0.3, 1.0, 1.0)}
OL, OL_DK = v8.OL, v8.OL_DK
LAUNCH_NAMES = ["deck", "lockers", "locker_doors", "deck_rivets", "containers", "ribs", "noses", "rear_plugs", "lifting_rings", "cradle", "rams", "jacks"]
LAUNCH_RECIPES = {"deck": vp.R((70, 66, 52), 0.8, 0.3), "lockers": OL, "locker_doors": OL_DK, "deck_rivets": vp.R("camo", 0.7, 0.2, tone=0.75),
                  "containers": vp.R("camo", 0.7, 0.15, tone=1.05), "ribs": vp.R("camo", 0.72, 0.25, tone=0.85), "noses": vp.R((74, 78, 56), 0.7, 0.2),
                  "rear_plugs": OL_DK, "lifting_rings": vp.R((58, 58, 48), 0.6, 0.6), "cradle": vp.R((54, 54, 44), 0.8, 0.35), "rams": vp.STEEL,
                  "jacks": vp.R((56, 56, 46), 0.75, 0.4)}


def post_launcher(s, tx, masks):
    Y = (0, 1, 0)
    for z in (-CZ, CZ):
        vp.put(s, tx, vp.hazard_stripes(0.9, 0.07), (CX0 - 0.1, CY - 0.30, z), (-1, 0, 0), Y, thick=0.1)
        vp.put(s, tx, vp.plate(["TLC"], 0.14, 0.08, bg=(176, 178, 170), px_per_m=900), (CX1 - 1.6, CY + 0.15, z + (CW / 2 + 0.002) * np.sign(z)), (0, 0, np.sign(z)), Y)


def group_nodes(parts):
    nodes = []
    spec = (("chassis", v8.CHASSIS_NAMES, v8.CHASSIS_RECIPES, 1536, None, ("fenders",)), ("cab", v8.CAB_NAMES, v8.CAB_RECIPES, 1536, v8.post_cab, ("cab", "doors", "bumper")),
            ("launcher", LAUNCH_NAMES, LAUNCH_RECIPES, 2048, post_launcher, ("lockers", "containers")))
    for gi, (gname, names, recipes, res, post, seams) in enumerate(spec):
        meshes, ids = [], []
        for i, nme in enumerate(names):
            m = parts.pop(nme)
            meshes.append(m)
            ids.append(np.full(len(m.faces), i, np.int16))
        painter = vp.group_painter(names, recipes, camo=False, seed=81 + gi, olive=v8.OLIVE_RGB, weather=dict(mud=0.65 if gname == "chassis" else 0.35, dust=0.5),
                                   seams=seams, post=post)
        nodes.append(node(gname, [(merge(meshes), BakeSpec(painter, res=res, ids=np.concatenate(ids), key=f"sapsan-{gname}", seed=81 + gi))]))
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
                 "note": "Procedural model of an 8x8 wheeled operational-tactical missile launcher with two transport-launch containers, built from open "
                         "overall dimensions and a user-supplied reference view. Not a scan or copy of any other model."})
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(glb)
    print(f"{out.name}: {len(glb) / 1024:.0f} KB, {len(w.doc['nodes'])} nodes, {w.triangles} triangles")
    return 0


if __name__ == "__main__":
    sys.exit(main())
