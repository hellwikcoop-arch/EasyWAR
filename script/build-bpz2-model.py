#!/usr/bin/env python3
"""Генерує процедурну модель броньованої ремонтно-евакуаційної машини Bergepanzer 2 (БРЕМ на шасі Leopard 1) для довідника
(src/models/bergepanzer2.glb).

    pip install numpy scipy trimesh pillow xatlas   # текстури: script/glb_bake.py, paint_lib.py, vehicle_paint.py
    # EW_FAST=1 — напіврозрізнення для швидкої перевірки; EW_BAKE_CACHE=<тека> — кеш запікань (перед випуском чистити)
    python3 script/build-bpz2-model.py [вихідний.glb]

Форму знято з довідкового зображення, яке надав користувач, і узгоджено з відкритими габаритами (довжина ≈ 7,7 м із відвалом,
ширина ≈ 3,25 м, висота ≈ 2,7 м, 7 опорних катків на борт, ведуче колесо ззаду): низький корпус із похилим лобом, надбудова
з вежкою командира, кран вантажністю ≈ 20 т у транспортному положенні на упорі, бульдозерний відвал спереду, сошник ззаду.
Це не скан і не копія чужої моделі, сторонніх текстур немає. Для перегляду, а не для впізнавання чи розрахунків. Одиниці —
метри, перед машини дивиться в +x, «вгору» — +y, права сторона — +z (як у glTF).
"""
import sys
from pathlib import Path

import numpy as np
import trimesh

from glb_bake import BakeSpec, TileSpec
from glb_rig import GlbWriter, node
import vehicle_kit as k
import vehicle_paint as vp
from vehicle_kit import box, cyl_between, cyl_z, level_hull, merge, rivet_row

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "src" / "models" / "bergepanzer2.glb"
OLIVE_RGB = (80, 86, 60)

TRACK_Z, TRACK_W = 1.375, 0.56
SPROCKET = (-3.02, 0.60, 0.46)
IDLER = (2.92, 0.52, 0.40)
ROAD_X = list(np.linspace(-2.25, 2.25, 7))
ROAD_R, ROAD_Y = 0.345, 0.40
PAD_PITCH = 0.16
HULL_HALF = 1.05
ROOF_Y = 2.10


def prism_side(profile_xy, z0, z1):
    pts = [(x, y, z) for (x, y) in profile_xy for z in (z0, z1)]
    return trimesh.convex.convex_hull(np.array(pts, dtype=float))


def track_loop():
    sx, sy, sr = SPROCKET
    ix, iy, ir = IDLER
    pts, n_arc = [], 24
    for i in range(n_arc + 1):                    # ведуче колесо (ззаду), знизу вгору
        a = -np.pi / 2 - np.pi * i / n_arc
        pts.append((sx + sr * np.cos(a), sy + sr * np.sin(a)))
    for i in range(n_arc + 1):                    # ліниве колесо (спереду), згори вниз
        a = np.pi / 2 - np.pi * i / n_arc
        pts.append((ix + ir * np.cos(a), iy + ir * np.sin(a)))
    pts.append(pts[0])
    return np.array(pts)


def resample(path, pitch):
    seg = np.diff(path, axis=0)
    lens = np.hypot(seg[:, 0], seg[:, 1])
    cum = np.concatenate([[0], np.cumsum(lens)])
    n = int(round(cum[-1] / pitch))
    out = []
    for i in range(n):
        s = cum[-1] * i / n
        j = min(np.searchsorted(cum, s, side="right") - 1, len(seg) - 1)
        p = path[j] + seg[j] * ((s - cum[j]) / lens[j])
        out.append((p[0], p[1], np.arctan2(seg[j][1], seg[j][0])))
    return out


def track_pads(zc):
    pads, horns = [], []
    # контур обходиться проти годинникової стрілки, якщо дивитися з +z: зовнішня нормаль — праворуч від напряму руху
    loop = track_loop()
    area = 0.5 * np.sum(loop[:-1, 0] * loop[1:, 1] - loop[1:, 0] * loop[:-1, 1])
    sign = 1.0 if area > 0 else -1.0
    for x, y, a in resample(loop, PAD_PITCH):
        n = sign * np.array([np.sin(a), -np.cos(a)])
        pads.append(box((x, y, zc), (PAD_PITCH * 0.86, 0.06, TRACK_W), rot_z=a))
        g = np.array([x, y]) + n * 0.038
        pads.append(box((g[0], g[1], zc), (0.04, 0.032, TRACK_W * 0.92), rot_z=a))
        h = np.array([x, y]) - n * 0.07
        horns.append(box((h[0], h[1], zc), (0.07, 0.08, 0.05), rot_z=a))
        for side in (-1, 1):
            horns.append(box((x, y, zc + side * (TRACK_W / 2 + 0.02)), (0.06, 0.06, 0.04), rot_z=a))
    return pads, horns


def build():
    parts, rivets = {}, []

    # ---------- Корпус, надбудова, броньовані щитки ----------
    parts["hull"] = prism_side([(-3.55, 0.50), (-3.55, 1.55), (2.65, 1.60), (3.45, 1.00), (3.45, 0.62), (2.90, 0.42), (-3.20, 0.42)], -HULL_HALF, HULL_HALF)
    guards = []
    for s in (-1, 1):
        guards.append(box((-0.2, 1.30, s * 1.40), (6.50, 0.06, 0.60), bevel=0.012))
        guards.append(box((3.05, 1.18, s * 1.40), (0.90, 0.06, 0.60), rot_z=-0.35, bevel=0.012))
        guards.append(box((-3.60, 1.15, s * 1.40), (0.16, 0.34, 0.60), bevel=0.01))
        for x in np.linspace(-3.0, 2.6, 8):
            guards.append(box((x, 1.20, s * 1.11), (0.06, 0.20, 0.16), bevel=0.01))          # кронштейни
    parts["guards"] = merge(guards)
    parts["super"] = level_hull([(1.58, 2.55, -1.60, 1.02, 0.20), (ROOF_Y - 0.15, 2.45, -1.55, 1.00, 0.20), (ROOF_Y, 2.10, -1.45, 0.92, 0.22)])
    skirts = []
    for s in (-1, 1):
        skirts.append(box((0.2, 0.78, s * 1.04), (6.30, 0.50, 0.04), bevel=0.01))
        for x in np.linspace(-2.8, 3.0, 9):
            skirts.append(box((x, 0.82, s * 1.075), (0.05, 0.40, 0.04), bevel=0.006))
    parts["skirts"] = merge(skirts)
    lou = []
    for i in range(10):
        lou.append(box((-2.55 + i * 0.12 - 0.5, 1.595, 0.0), (0.07, 0.03, 1.55), bevel=0.006))
    lou += [box((-3.00, 1.60, s * 0.62), (1.30, 0.04, 0.46), bevel=0.01) for s in (-1, 1)]
    lou += [cyl_between((-3.30, 1.60, s * 0.62), (-3.30, 1.76, s * 0.62), 0.12, 14) for s in (-1, 1)]       # вихлопні коліна
    parts["louvers"] = merge(lou)
    parts["rear_plate"] = merge([box((-3.585, 1.0, 0.0), (0.05, 1.0, 2.0), bevel=0.01)] + [box((-3.62, 0.62, s * 0.7), (0.10, 0.06, 0.2), bevel=0.01) for s in (-1, 1)])
    parts["tow_eyes"] = merge([cyl_between((3.45, 0.82, s * 0.62), (3.62, 0.82, s * 0.62), 0.045, 10) for s in (-1, 1)] +
                              [box((3.62, 0.82, s * 0.62), (0.04, 0.17, 0.17), bevel=0.01) for s in (-1, 1)])
    parts["hatches"] = merge([cyl_between((1.95, ROOF_Y, -0.40), (1.95, ROOF_Y + 0.07, -0.40), 0.30, 24),                # люк механіка-водія
                              cyl_between((0.0, ROOF_Y, 0.55), (0.0, ROOF_Y + 0.07, 0.55), 0.34, 24)] +
                             [box((1.0 + 0.5 * i, ROOF_Y + 0.02, 0.62), (0.12, 0.04, 0.12), bevel=0.01) for i in range(2)])
    cup = [cyl_between((0.95, ROOF_Y, -0.55), (0.95, ROOF_Y + 0.38, -0.55), 0.36, 28),                                    # вежка командира
           cyl_between((0.95, ROOF_Y + 0.38, -0.55), (0.95, ROOF_Y + 0.46, -0.55), 0.40, 28)]
    for i in range(8):
        a = 2 * np.pi * i / 8
        cup.append(box((0.95 + 0.38 * np.cos(a), ROOF_Y + 0.30, -0.55 + 0.38 * np.sin(a)), (0.10, 0.12, 0.10), bevel=0.01))
    cup.append(cyl_between((1.20, ROOF_Y + 0.40, -0.80), (1.55, ROOF_Y + 0.44, -0.86), 0.025, 8))                          # ствол кулемета
    cup.append(box((1.05, ROOF_Y + 0.46, -0.78), (0.36, 0.14, 0.12), bevel=0.02))
    cup.append(cyl_between((1.95, ROOF_Y + 0.07, -0.40), (1.95, ROOF_Y + 0.14, -0.40), 0.20, 16))                         # перископи водія
    parts["cupola"] = merge(cup)
    parts["periscopes"] = merge([box((0.95 + 0.38 * np.cos(a), ROOF_Y + 0.32, -0.55 + 0.38 * np.sin(a)), (0.03, 0.06, 0.10), rot_z=0.0)
                                 for a in np.linspace(0.4, 2.7, 5)])
    smoke = []
    for s in (-1, 1):
        for i in range(4):
            smoke.append(cyl_between((2.20, 1.72 + 0.08 * i, s * (0.88 + 0.07 * i)), (2.20 + 0.28, 1.72 + 0.08 * i, s * (0.88 + 0.07 * i) + s * 0.04), 0.04, 8))
    parts["smoke"] = merge(smoke)
    parts["lights"] = merge([cyl_between((3.18, 1.30, s * 0.92), (3.24, 1.28, s * 0.92), 0.075, 16) for s in (-1, 1)])
    parts["lights_amber"] = merge([cyl_between((3.18, 1.30, s * 0.74), (3.22, 1.28, s * 0.74), 0.04, 12) for s in (-1, 1)])
    parts["rear_red"] = merge([cyl_between((-3.62, 1.35, s * 1.38), (-3.67, 1.35, s * 1.38), 0.06, 14) for s in (-1, 1)])
    stowage = [cyl_between((-3.2 + 0.04 * i, 1.38, 1.22 + 0.0), (0.2 + 0.04 * i, 1.38, 1.22), 0.025, 6) for i in range(2)]   # трос, лопата
    stowage += [box((-1.8, 1.44, 1.36), (1.0, 0.14, 0.16), bevel=0.02), box((0.6, 1.44, -1.36), (1.1, 0.14, 0.16), bevel=0.02),
                box((1.6, 1.44, 1.36), (0.8, 0.14, 0.40), bevel=0.02)]
    parts["stowage"] = merge(stowage)
    rivets += rivet_row((-3.3, 1.0, HULL_HALF + 0.001), (2.4, 1.0, HULL_HALF + 0.001), 0.16, (0, 0, 1)) + \
        rivet_row((-3.3, 1.0, -HULL_HALF - 0.001), (2.4, 1.0, -HULL_HALF - 0.001), 0.16, (0, 0, -1))
    parts["rivets"] = merge(rivets)

    # ---------- Ходова ----------
    tyres, hubs, pads, horns, rollers, arms, teeth = [], [], [], [], [], [], []
    for side in (-1, 1):
        zc = side * TRACK_Z
        p_, h_ = track_pads(zc)
        pads += p_
        horns += h_
        for x in ROAD_X:
            for dz in (-0.125, 0.125):
                tyres.append(cyl_z((x, ROAD_Y, zc + dz), ROAD_R, 0.12, 30))
                hubs.append(cyl_z((x, ROAD_Y, zc + dz * 1.55), 0.24, 0.02, 28))
            hubs.append(cyl_z((x, ROAD_Y, zc), 0.19, 0.15, 20))
            for i in range(8):
                a = 2 * np.pi * i / 8
                hubs.append(cyl_z((x + 0.14 * np.cos(a), ROAD_Y + 0.14 * np.sin(a), zc + side * 0.20), 0.017, 0.03, 6))
            hubs.append(cyl_z((x, ROAD_Y, zc + side * 0.21), 0.06, 0.04, 12))
            arms.append(cyl_between((x, ROAD_Y, side * 1.02), (x - 0.30, 0.62, side * 0.80), 0.05, 10))
        for x in (-1.9, -0.65, 0.65, 1.9):
            rollers.append(cyl_z((x, 0.92, zc), 0.09, 0.22, 16))
            rollers.append(cyl_between((x, 0.92, side * 1.02), (x, 0.92, zc), 0.03, 8))
        sx, sy, _ = SPROCKET
        for dz in (-0.12, 0.12):
            hubs.append(cyl_z((sx, sy, zc + dz), 0.36, 0.08, 32))
            for i in range(13):
                a = 2 * np.pi * i / 13
                teeth.append(box((sx + 0.40 * np.cos(a), sy + 0.40 * np.sin(a), zc + dz), (0.07, 0.08, 0.07), rot_z=a))
        hubs.append(cyl_z((sx, sy, zc + side * 0.18), 0.17, 0.08, 20))
        ix, iy, _ = IDLER
        for dz in (-0.12, 0.12):
            hubs.append(cyl_z((ix, iy, zc + dz), 0.34, 0.09, 32))
        hubs.append(cyl_z((ix, iy, zc + side * 0.18), 0.13, 0.08, 20))
        arms.append(cyl_between((ix - 0.4, 0.66, side * 0.98), (ix, iy, side * 1.04), 0.06, 10))
    parts["tracks"] = merge(pads)
    parts["track_horns"] = merge(horns + teeth)
    parts["tyres"] = merge(tyres)
    parts["hubs"] = merge(hubs)
    parts["rollers"] = merge(rollers)
    parts["suspension"] = merge(arms)

    # ---------- Бульдозерний відвал із гідроциліндрами ----------
    bx = 3.66
    blade = [box((bx, 0.92, 0.0), (0.12, 1.00, 3.22), rot_z=-0.10, bevel=0.02),
             box((bx + 0.05, 1.45, 0.0), (0.16, 0.10, 3.22), bevel=0.02),             # верхня кромка
             box((bx - 0.10, 0.45, 0.0), (0.18, 0.08, 3.22), rot_z=-0.10, bevel=0.015)]   # ніж
    for z0 in np.linspace(-1.45, 1.45, 7):
        blade.append(box((bx - 0.09, 0.95, z0), (0.08, 0.90, 0.06), rot_z=-0.10, bevel=0.01))
    parts["blade"] = merge(blade)
    frame = []
    for s in (-1, 1):
        frame.append(cyl_between((2.90, 0.62, s * 0.95), (3.60, 0.70, s * 1.30), 0.075, 12))
        frame.append(cyl_between((2.90, 1.45, s * 0.95), (3.60, 1.25, s * 1.30), 0.06, 12))
        frame.append(cyl_between((3.20, 1.20, s * 1.12), (3.58, 1.00, s * 1.30), 0.04, 10))
    parts["blade_arms"] = merge(frame)

    # ---------- Кран у транспортному положенні, упор, сошник ----------
    cx, cz = 0.85, 0.62
    parts["crane_base"] = merge([cyl_between((cx, ROOF_Y, cz), (cx, ROOF_Y + 0.14, cz), 0.52, 28),
                                 box((cx - 0.05, ROOF_Y + 0.38, cz), (0.95, 0.40, 0.80), bevel=0.04)])
    tip_x = -2.85
    b0, b1 = np.array([cx - 0.35, ROOF_Y + 0.50]), np.array([tip_x, ROOF_Y + 0.36])
    parts["crane_boom"] = merge([k.beam_between((b0[0], b0[1], cz), (b1[0], b1[1], cz), 0.42, 0.46, bevel=0.03),
                                 box((tip_x - 0.15, ROOF_Y + 0.35, cz), (0.30, 0.38, 0.40), bevel=0.03)])
    parts["crane_rams"] = merge([cyl_between((cx - 0.25, ROOF_Y + 0.30, cz + s * 0.18), (cx - 1.40, ROOF_Y + 0.38, cz + s * 0.18), 0.045, 12) for s in (-1, 1)])
    parts["crane_hook"] = merge([cyl_between((tip_x - 0.28, ROOF_Y + 0.28, cz), (tip_x - 0.28, ROOF_Y - 0.12, cz), 0.014, 6),
                                 box((tip_x - 0.28, ROOF_Y - 0.20, cz), (0.16, 0.18, 0.14), bevel=0.03)])
    parts["boom_rest"] = merge([box((-2.55, (1.58 + ROOF_Y + 0.15) / 2, cz + s * 0.30), (0.10, ROOF_Y - 1.58 + 0.13, 0.08), bevel=0.01) for s in (-1, 1)]
                               + [box((-2.55, ROOF_Y + 0.17, cz), (0.18, 0.08, 0.72), bevel=0.02)])
    spade = [box((-3.88, 1.12, 0.0), (0.10, 0.90, 2.60), rot_z=0.0, bevel=0.015),
             box((-3.88, 0.62, 0.0), (0.12, 0.12, 2.60), bevel=0.015)]
    for s in (-1, 1):
        spade.append(cyl_between((-3.60, 1.30, s * 1.0), (-3.84, 1.30, s * 1.0), 0.07, 10))
        spade.append(cyl_between((-3.70, 0.95, s * 0.65), (-3.88, 1.2, s * 0.65), 0.05, 10))
    parts["spade"] = merge(spade)
    return parts


# ---------- групи для запікання ----------
OL = vp.R("camo", 0.74, 0.1)
OL_DK = vp.R("camo", 0.76, 0.12, tone=0.8)
HULL_NAMES = ["hull", "guards", "super", "skirts", "louvers", "rear_plate", "tow_eyes", "hatches", "cupola", "periscopes", "smoke", "lights",
              "lights_amber", "rear_red", "stowage", "rivets", "suspension"]
HULL_RECIPES = {"hull": OL, "guards": OL_DK, "super": OL, "skirts": vp.R("camo", 0.8, 0.1, tone=0.7), "louvers": vp.R("camo", 0.72, 0.3, tone=0.65),
                "rear_plate": OL_DK, "tow_eyes": vp.R((52, 52, 44), 0.7, 0.4), "hatches": OL_DK, "cupola": OL, "periscopes": vp.GLASS,
                "smoke": vp.R((40, 42, 36), 0.7, 0.4), "lights": vp.LENS_W, "lights_amber": vp.LENS_A, "rear_red": vp.LENS_R,
                "stowage": vp.R((82, 78, 58), 0.8, 0.3), "rivets": vp.R("camo", 0.7, 0.2, tone=0.75), "suspension": vp.R((50, 52, 42), 0.8, 0.4)}
WORK_NAMES = ["blade", "blade_arms", "crane_base", "crane_boom", "crane_rams", "crane_hook", "boom_rest", "spade"]
WORK_RECIPES = {"blade": vp.R("camo", 0.7, 0.4, tone=0.8), "blade_arms": vp.R((54, 54, 44), 0.7, 0.4), "crane_base": OL,
                "crane_boom": vp.R("camo", 0.7, 0.2, tone=0.9), "crane_rams": vp.STEEL, "crane_hook": vp.R((40, 40, 38), 0.5, 0.8),
                "boom_rest": vp.R((54, 54, 44), 0.8, 0.35), "spade": vp.R("camo", 0.72, 0.4, tone=0.75)}
TILES = {"tracks": TileSpec("track", (255, 255, 255), 0.5, 1.0, 1.0), "track_horns": TileSpec("track", (235, 235, 235), 0.5, 1.0, 1.0),
         "tyres": TileSpec("rubber", (36, 34, 31), 0.4, 1.0, 1.0), "hubs": TileSpec("cast", (70, 74, 56), 0.5, 1.0, 1.0),
         "rollers": TileSpec("cast", (66, 70, 54), 0.5, 1.0, 1.0)}


def post_hull(s, tx, masks):
    Y = (0, 1, 0)
    vp.put(s, tx, vp.plate(["BPZ 2"], 0.20, 0.09, bg=(176, 178, 170), px_per_m=900), (2.2, 1.30, 0.4), (0.7, 0.7, 0), Y)
    for sg in (-1, 1):
        vp.put(s, tx, vp.stencil_text("BERGEPANZER 2", 0.07), (-0.8, 1.22, sg * (HULL_HALF + 0.003)), (0, 0, sg), Y, thick=0.04)


def post_work(s, tx, masks):
    Y = (0, 1, 0)
    vp.put(s, tx, vp.hazard_stripes(1.0, 0.07), (3.74, 1.45, 0.0), (1, 0, 0), Y, thick=0.1)


def group_nodes(parts):
    nodes = []
    spec = (("hull", HULL_NAMES, HULL_RECIPES, 2048, post_hull, ("hull", "super")), ("work", WORK_NAMES, WORK_RECIPES, 1536, post_work, ("blade", "crane_boom")))
    for gi, (gname, names, recipes, res, post, seams) in enumerate(spec):
        meshes, ids = [], []
        for i, nme in enumerate(names):
            m = parts.pop(nme)
            meshes.append(m)
            ids.append(np.full(len(m.faces), i, np.int16))
        painter = vp.group_painter(names, recipes, camo=False, seed=51 + gi, olive=OLIVE_RGB, weather=dict(mud=0.6, dust=0.55), seams=seams, post=post)
        nodes.append(node(gname, [(merge(meshes), BakeSpec(painter, res=res, ids=np.concatenate(ids), key=f"bpz2-{gname}", seed=51 + gi))]))
    for nme, spec in TILES.items():
        nodes.append(node(nme, [(parts.pop(nme), spec)]))
    return nodes


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    parts = build()
    w = GlbWriter("EasyWAR build-bpz2-model.py")
    for nd in group_nodes(parts):
        w.add(nd)
    assert not parts, f"частини без поверхні: {list(parts)}"
    glb = w.glb({"title": "Bergepanzer 2 (generated)", "generated": True,
                 "note": "Procedural model of a tracked armoured recovery vehicle on a Leopard 1 chassis with a crane and a dozer blade, built from open "
                         "overall dimensions and a user-supplied reference view. Not a scan or copy of any other model."})
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(glb)
    print(f"{out.name}: {len(glb) / 1024:.0f} KB, {len(w.doc['nodes'])} nodes, {w.triangles} triangles")
    return 0


if __name__ == "__main__":
    sys.exit(main())
