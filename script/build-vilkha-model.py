#!/usr/bin/env python3
"""Генерує процедурну модель реактивної системи залпового вогню Р-624 «Вільха» (колісне шасі 8×8, 12 труб калібру 300 мм)
для довідника (src/models/vilkha.glb).

    pip install numpy scipy trimesh pillow xatlas   # текстури: script/glb_bake.py, paint_lib.py, vehicle_paint.py
    # EW_FAST=1 — напіврозрізнення для швидкої перевірки; EW_BAKE_CACHE=<тека> — кеш запікань (перед випуском чистити)
    python3 script/build-vilkha-model.py [вихідний.glb]

Форму знято з довідкового зображення, яке надав користувач, і узгоджено з відкритими габаритами (шасі 8×8 з кабіною над передніми
мостами, пакет із 12 труб у два ряди по шість, довжина труб ≈ 7,4 м): кабіна, рама, 8 коліс, пакет труб у транспортному
положенні з хомутами, дульними кришками, кареткою підйому й гідроциліндрами, стабілізатори в кормі, ящики розрахунку по бортах.
Це не скан і не копія чужих моделей, сторонніх текстур немає. Для перегляду, а не для впізнавання чи розрахунків. Одиниці —
метри, перед машини дивиться в +x, «вгору» — +y, права сторона — +z (як у glTF).
"""
import sys
from pathlib import Path

import numpy as np

from glb_bake import BakeSpec, TileSpec
from glb_rig import GlbWriter, node
import vehicle_8x8 as v8
import vehicle_kit as k
import vehicle_paint as vp
from vehicle_kit import box, cyl_between, cyl_x, merge, rivet_row

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "src" / "models" / "vilkha.glb"
TUBE_X0, TUBE_X1 = -4.60, 2.85
TUBE_R, PITCH = 0.165, 0.36
ROW_Y = (2.20, 2.56)
COLS = [(-2.5 + i) * PITCH for i in range(6)]
DECK_X0, DECK_X1 = v8.FRAME_X0 + 0.1, 3.05


def build():
    parts = v8.chassis()
    parts.update(v8.cab_over())
    parts["steps"] = merge([parts["steps"]])
    L = DECK_X1 - DECK_X0
    xc = (DECK_X0 + DECK_X1) / 2
    parts["deck"] = merge([box((xc, v8.DECK_Y, 0.0), (L, 0.12, 2.36)), box((xc, v8.DECK_Y - 0.10, 0.0), (L - 0.3, 0.10, 1.90))] +
                          [box((xc, v8.DECK_Y - 0.14, z), (L, 0.08, 0.07)) for z in (-0.80, -0.27, 0.27, 0.80)])
    # ящики розрахунку по бортах і сходи
    lockers, ldoors = [], []
    for s in (-1, 1):
        for x0, x1 in ((2.9, 1.3), (-0.2, -2.2)):
            cx, ln = (x0 + x1) / 2, abs(x0 - x1)
            lockers.append(box((cx, v8.DECK_Y + 0.38, s * 1.10), (ln, 0.70, 0.30), bevel=0.02))
            ldoors.append(box((cx, v8.DECK_Y + 0.36, s * 1.255), (ln - 0.12, 0.54, 0.02), bevel=0.01))
    parts["lockers"], parts["locker_doors"] = merge(lockers), merge(ldoors)

    # ---------- пакет з 12 труб у транспортному положенні ----------
    tubes, caps, ring_caps = [], [], []
    for y in ROW_Y:
        for z in COLS:
            tubes.append(cyl_x(TUBE_X0, TUBE_X1, y, z, TUBE_R, 28))
            caps.append(cyl_x(TUBE_X1, TUBE_X1 + 0.05, y, z, TUBE_R - 0.012, 28))
            ring_caps.append(cyl_x(TUBE_X1 + 0.05, TUBE_X1 + 0.07, y, z, TUBE_R * 0.62, 20))
    parts["tubes"], parts["muzzle_caps"], parts["cap_centers"] = merge(tubes), merge(caps), merge(ring_caps)
    ymid = sum(ROW_Y) / 2
    hw, hh = 3 * PITCH + 0.03, PITCH + 0.03
    straps = []
    for x in np.linspace(TUBE_X0 + 0.25, TUBE_X1 - 0.25, 8):
        straps += [box((x, ymid + hh + 0.02, 0.0), (0.10, 0.045, 2 * hw + 0.08), bevel=0.008), box((x, ymid - hh - 0.02, 0.0), (0.10, 0.045, 2 * hw + 0.08), bevel=0.008)]
        straps += [box((x, ymid, s * (hw + 0.02)), (0.10, 2 * hh + 0.08, 0.045), bevel=0.008) for s in (-1, 1)]
    for x in (TUBE_X0 + 0.02, TUBE_X1 - 0.02):
        straps += [box((x, ymid, 0.0), (0.06, 2 * hh + 0.12, 2 * hw + 0.12), bevel=0.012)]
    parts["bands"] = merge(straps)
    # люлька: два поздовжні лонжерони, поперечини, цапфи, задній відкидний щит, гідроциліндри підйому
    cradle = [box(((TUBE_X0 + TUBE_X1) / 2, 1.78, s * 0.80), (TUBE_X1 - TUBE_X0, 0.14, 0.18), bevel=0.015) for s in (-1, 1)]
    cradle += [box((x, 1.80, 0.0), (0.14, 0.10, 1.84), bevel=0.012) for x in np.linspace(TUBE_X0 + 0.3, TUBE_X1 - 0.4, 7)]
    cradle += [box((TUBE_X0 + 0.10, 1.75, s * 0.80), (0.30, 0.50, 0.24), bevel=0.02) for s in (-1, 1)]
    for x in np.linspace(TUBE_X0 + 0.4, TUBE_X1 - 0.5, 4):
        for s in (-1, 1):
            cradle.append(box((x, 1.64, s * 0.80), (0.10, 0.34, 0.12), bevel=0.01))
    parts["cradle"] = merge(cradle)
    parts["rams"] = merge([cyl_between((-0.30, v8.DECK_Y + 0.05, s * 0.55), (0.90, 1.72, s * 0.55), 0.06, 12) for s in (-1, 1)] +
                          [cyl_between((-0.30, v8.DECK_Y + 0.05, s * 0.55), (-0.30, v8.DECK_Y + 0.35, s * 0.55), 0.09, 12) for s in (-1, 1)])
    parts["rear_shield"] = merge([box((TUBE_X0 - 0.12, ymid, 0.0), (0.10, 2 * hh + 0.30, 2 * hw + 0.30), bevel=0.02)] +
                                 [box((TUBE_X0 - 0.19, ymid, z), (0.05, 2 * hh + 0.20, 0.06), bevel=0.01) for z in np.linspace(-hw, hw, 5)])
    # стабілізатори (підняті): два домкрати в кормі й два посередині
    jacks = []
    for s in (-1, 1):
        for x in (-4.95, -0.85):
            jacks += [box((x, 1.12, s * 1.08), (0.30, 0.24, 0.20), bevel=0.02), cyl_between((x, 1.12, s * 1.22), (x, 0.78, s * 1.22), 0.07, 10),
                      box((x, 0.74, s * 1.22), (0.34, 0.06, 0.34), bevel=0.01)]
    parts["jacks"] = merge(jacks)
    parts["deck_rivets"] = merge(rivet_row((DECK_X0 + 0.2, v8.DECK_Y + 0.38, 1.261), (DECK_X1 - 0.2, v8.DECK_Y + 0.38, 1.261), 0.14, (0, 0, 1)) +
                                 rivet_row((DECK_X0 + 0.2, v8.DECK_Y + 0.38, -1.261), (DECK_X1 - 0.2, v8.DECK_Y + 0.38, -1.261), 0.14, (0, 0, -1)))
    return parts


TILES = {"tyres": TileSpec("rubber", (36, 34, 31), 0.4, 1.0, 1.0), "rims": TileSpec("cast", (70, 74, 56), 0.5, 1.0, 1.0),
         "wheel_bolts": TileSpec("steel", (95, 97, 92), 0.3, 1.0, 1.0)}
OL = v8.OL
LAUNCH_NAMES = ["deck", "lockers", "locker_doors", "deck_rivets", "tubes", "muzzle_caps", "cap_centers", "bands", "cradle", "rams", "rear_shield", "jacks"]
LAUNCH_RECIPES = {"deck": vp.R((70, 66, 52), 0.8, 0.3), "lockers": OL, "locker_doors": v8.OL_DK, "deck_rivets": vp.R("camo", 0.7, 0.2, tone=0.75),
                  "tubes": vp.R("camo", 0.68, 0.15, tone=1.05), "muzzle_caps": vp.R((74, 78, 56), 0.7, 0.15), "cap_centers": vp.R((42, 44, 36), 0.7, 0.3),
                  "bands": vp.R((52, 54, 44), 0.7, 0.45), "cradle": vp.R((54, 54, 44), 0.8, 0.35), "rams": vp.STEEL, "rear_shield": OL,
                  "jacks": vp.R((56, 56, 46), 0.75, 0.4)}


def post_launcher(s, tx, masks):
    Y = (0, 1, 0)
    vp.put(s, tx, vp.hazard_stripes(1.0, 0.07), (TUBE_X0 - 0.24, 2.0, 0.0), (-1, 0, 0), Y, thick=0.1)
    for sg in (-1, 1):
        vp.put(s, tx, vp.stencil_text("DANGER", 0.07), (0.8, v8.DECK_Y + 0.50, sg * 1.268), (0, 0, sg), Y, thick=0.04)


def group_nodes(parts):
    nodes = []
    spec = (("chassis", v8.CHASSIS_NAMES, v8.CHASSIS_RECIPES, 1536, None, ("fenders",)), ("cab", v8.CAB_NAMES, v8.CAB_RECIPES, 1536, v8.post_cab, ("cab", "doors", "bumper")),
            ("launcher", LAUNCH_NAMES, LAUNCH_RECIPES, 2048, post_launcher, ("lockers", "rear_shield", "tubes")))
    for gi, (gname, names, recipes, res, post, seams) in enumerate(spec):
        meshes, ids = [], []
        for i, nme in enumerate(names):
            m = parts.pop(nme)
            meshes.append(m)
            ids.append(np.full(len(m.faces), i, np.int16))
        painter = vp.group_painter(names, recipes, camo=False, seed=71 + gi, olive=v8.OLIVE_RGB, weather=dict(mud=0.65 if gname == "chassis" else 0.35, dust=0.5),
                                   seams=seams, post=post)
        nodes.append(node(gname, [(merge(meshes), BakeSpec(painter, res=res, ids=np.concatenate(ids), key=f"vilkha-{gname}", seed=71 + gi))]))
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
                         "user-supplied reference view. Not a scan or copy of any other model."})
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(glb)
    print(f"{out.name}: {len(glb) / 1024:.0f} KB, {len(w.doc['nodes'])} nodes, {w.triangles} triangles")
    return 0


if __name__ == "__main__":
    sys.exit(main())
