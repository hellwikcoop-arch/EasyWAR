#!/usr/bin/env python3
"""Генерує процедурну модель евакуаційного тягача M984A2 (родина HEMTT 8×8 з заднім краном) для довідника
(src/models/m984a2.glb) — «БРЕМ на базі HEMTT» в одній колоні з HIMARS і M270.

    pip install numpy scipy trimesh pillow xatlas   # текстури: script/glb_bake.py, paint_lib.py, vehicle_paint.py
    # EW_FAST=1 — напіврозрізнення для швидкої перевірки; EW_BAKE_CACHE=<тека> — кеш запікань (перед випуском чистити)
    python3 script/build-m984-model.py [вихідний.glb]

Форму знято з довідкового зображення, яке надав користувач, і узгоджено з відкритими габаритами родини HEMTT (довжина ≈ 10 м,
ширина ≈ 2,44 м, колісна формула 8×8, шини 14.00R20): кабіна над коротким капотом, лебідка в передньому бампері, відсіки
для інструменту вздовж платформи, задній кран із телескопічною стрілою у транспортному положенні на упорі, два задні
сошники. Це не скан і не копія чужої моделі, сторонніх текстур немає. Для перегляду, а не для впізнавання чи розрахунків.
Одиниці — метри, перед машини дивиться в +x, «вгору» — +y, права сторона — +z (як у glTF).
"""
import sys
from pathlib import Path

import numpy as np

from glb_bake import BakeSpec, TileSpec
from glb_rig import GlbWriter, node
import vehicle_kit as k
import vehicle_paint as vp
from vehicle_kit import box, cyl_between, cyl_z, level_hull, merge, rivet_row, slope_box

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "src" / "models" / "m984a2.glb"
OLIVE_RGB = (176, 156, 112)   # піщаний «desert tan» американського парку, як на довідковому фото

AXLES = [3.55, 2.05, -0.30, -1.80]            # дві передні осі, проміжок, дві задні
WHEEL_R, WHEEL_Y, WHEEL_Z, WHEEL_W = 0.56, 0.56, 1.06, 0.44
HOOD_FRONT, CAB_FRONT, CAB_REAR = 5.00, 4.00, 2.80
DECK_Y, DECK_X0, DECK_X1, DECK_HALF = 1.50, -4.55, 2.62, 1.14
CRANE_X = -2.55


def build(spare=True):
    parts, rivets, deck_rivets = {}, [], []

    # ---------- Рама, мости, ресори, паливні баки ----------
    frame = [box((-0.35, 1.08, s * 0.46), (9.60, 0.26, 0.11)) for s in (-1, 1)]
    frame += [box((x, 1.08, 0.0), (0.12, 0.20, 0.94)) for x in (4.6, 3.0, 1.0, -1.0, -3.0, -4.5)]
    parts["frame"] = merge(frame)
    axle, springs = [], []
    for x in AXLES:
        axle.append(cyl_between((x, WHEEL_Y, -WHEEL_Z + 0.14), (x, WHEEL_Y, WHEEL_Z - 0.14), 0.09, 16))
        axle.append(box((x, 0.62, 0.0), (0.50, 0.32, 0.44)))
        for s in (-1, 1):
            springs += k.leaf_spring(x, 0.86, s * 0.50, 0.85)
    for xa, xb in ((AXLES[0], AXLES[1]), (AXLES[2], AXLES[3])):
        axle.append(cyl_between((xa, 0.66, 0.0), (xb, 0.66, 0.0), 0.055, 12))
    parts["axles"] = merge(axle)
    parts["springs"] = merge(springs)
    tanks = [cyl_between((-0.20, 0.95, -0.84), (1.95, 0.95, -0.84), 0.27, 24), cyl_between((-0.20, 0.95, 0.84), (1.35, 0.95, 0.84), 0.25, 24)]
    tanks.append(cyl_between((-3.45, 0.92, 0.84), (-2.65, 0.92, 0.84), 0.22, 20))
    for xb in (0.1, 0.9, 1.7):   # стяжні хомути баків
        tanks.append(cyl_between((xb, 0.95, -0.84), (xb + 0.05, 0.95, -0.84), 0.285, 24))
    parts["tanks"] = merge(tanks)
    parts["exhaust"] = merge([cyl_between((2.55, 1.20, 1.04), (2.55, 3.30, 1.04), 0.08, 14),
                              cyl_between((2.55, 3.30, 1.04), (2.55, 3.40, 1.04), 0.11, 14)])
    fenders = []
    for xa, xb in ((AXLES[0], AXLES[1]), (AXLES[2], AXLES[3])):
        xc, w = (xa + xb) / 2, abs(xa - xb) + 1.30
        for s in (-1, 1):
            fenders.append(box((xc, 1.05, s * 1.12), (w, 0.05, 0.54), bevel=0.012))
            fenders.append(box((xc + w / 2, 0.88, s * 1.12), (0.05, 0.36, 0.54), bevel=0.01))
            fenders.append(box((xc - w / 2, 0.88, s * 1.12), (0.05, 0.36, 0.54), bevel=0.01))
    parts["fenders"] = merge(fenders)

    # ---------- Колеса ----------
    tyres, rims, bolts = k.wheel_set(AXLES, WHEEL_R, WHEEL_Y, WHEEL_Z, WHEEL_W, r_rim=0.33, lug_count=28)
    if spare:
        ring, lug = k.spare_wheel_x((-0.95, DECK_Y + 0.78, 0.72), r_out=WHEEL_R, width=WHEEL_W, lug_count=28, axis="z")
        tyres += [ring, lug]
    parts["tyres"] = merge(tyres)
    parts["rims"] = merge(rims)
    parts["wheel_bolts"] = merge(bolts)

    # ---------- Капот і кабіна ----------
    parts["hood"] = level_hull([(1.12, HOOD_FRONT - 0.02, CAB_FRONT, 1.02, 0.12), (1.80, HOOD_FRONT - 0.06, CAB_FRONT, 1.05, 0.12),
                                (2.02, 4.62, CAB_FRONT, 0.94, 0.14)])
    parts["cab"] = level_hull([(1.28, CAB_FRONT, CAB_REAR, 1.20, 0.06), (2.50, CAB_FRONT, CAB_REAR, 1.22, 0.06),
                               (2.98, CAB_FRONT - 0.20, CAB_REAR + 0.04, 1.14, 0.10)])
    ws0, ws1 = (CAB_FRONT, 2.20), (CAB_FRONT - 0.18, 2.88)
    glass, frames, wipers = [], [], []
    for z0 in (-0.54, 0.54):
        glass.append(slope_box(ws0, ws1, 0.5, 0.05, (0.012, 0.66, 0.98), z0))
        frames.append(slope_box(ws0, ws1, 0.5, 0.03, (0.018, 0.72, 1.08), z0))
        wipers.append(slope_box(ws0, ws1, 0.30, 0.07, (0.012, 0.34, 0.02), z0 + 0.1))
    frames.append(slope_box(ws0, ws1, 0.5, 0.035, (0.025, 0.74, 0.05), 0.0))
    parts["windshields"] = merge(glass)
    parts["windshield_frames"] = merge(frames)
    parts["wipers"] = merge(wipers)
    parts["grille_back"] = merge([box((HOOD_FRONT - 0.03, 1.46, 0.0), (0.02, 0.50, 1.44), bevel=0.004)])
    bars = [box((HOOD_FRONT - 0.005, 1.24 + 0.055 * i, 0.0), (0.014, 0.024, 1.46), bevel=0.004) for i in range(9)]
    parts["grille"] = merge([box((HOOD_FRONT - 0.01, 1.46, 0.0), (0.03, 0.56, 1.52), bevel=0.008)] + bars)
    doors, handles, side_win = [], [], []
    for s in (-1, 1):
        doors.append(box(((CAB_FRONT + CAB_REAR) / 2, 1.92, s * 1.225), (1.12, 1.18, 0.025), bevel=0.012))
        side_win.append(box((3.40, 2.36, s * 1.236), (0.92, 0.66, 0.014), bevel=0.004))
        handles.append(box((3.0, 1.98, s * 1.245), (0.14, 0.04, 0.04), bevel=0.008))
        for x in (2.9, 3.9):
            rivets += rivet_row((x, 1.40, s * 1.224), (x, 2.20, s * 1.224), 0.12, (0, 0, s))
    parts["doors"] = merge(doors)
    parts["side_windows"] = merge(side_win)
    parts["door_handles"] = merge(handles)
    lamps, amber = [], []
    for s in (-1, 1):
        lamps.append(cyl_between((HOOD_FRONT - 0.02, 1.62, s * 0.80), (HOOD_FRONT + 0.03, 1.62, s * 0.80), 0.066, 16))
        amber.append(box((HOOD_FRONT - 0.04, 1.62, s * 0.98), (0.03, 0.10, 0.14), bevel=0.006))
    amber += [box((3.40, 3.06, z), (0.12, 0.07, 0.17), bevel=0.01) for z in (-0.5, 0.0, 0.5)]
    parts["lamps"] = merge(lamps)
    parts["lamps_amber"] = merge(amber)
    parts["bumper"] = merge([box((HOOD_FRONT + 0.14, 0.98, 0.0), (0.30, 0.30, 2.44), bevel=0.03),
                             box((HOOD_FRONT + 0.06, 1.20, 0.0), (0.12, 0.08, 2.30), bevel=0.01)]
                            + [cyl_between((HOOD_FRONT + 0.16, 0.78, s * 0.80), (HOOD_FRONT + 0.40, 0.78, s * 0.80), 0.032, 8) for s in (-1, 1)])
    # лебідка в бампері: барабан, трос, гак
    parts["winch"] = merge([cyl_z((HOOD_FRONT + 0.14, 0.98, 0.0), 0.12, 1.30, 20), cyl_z((HOOD_FRONT + 0.14, 0.98, 0.70), 0.17, 0.05, 20),
                            cyl_z((HOOD_FRONT + 0.14, 0.98, -0.70), 0.17, 0.05, 20),
                            cyl_between((HOOD_FRONT + 0.31, 0.98, 0.0), (HOOD_FRONT + 0.50, 0.90, 0.0), 0.012, 6),
                            box((HOOD_FRONT + 0.52, 0.84, 0.0), (0.08, 0.14, 0.10), bevel=0.02)])
    mir_arm, mir = [], []
    for s in (-1, 1):
        a, m = k.mirror((CAB_FRONT - 0.28, 2.40, s * 1.25), s, h=0.54, w=0.26)
        mir_arm += a
        mir.append(m)
    parts["mirror_arms"], parts["mirrors"] = merge(mir_arm), merge(mir)
    steps = []
    for s in (-1, 1):
        steps += k.ladder_steps(3.45, 0.62, s * 1.27, n=3, step=0.32, width=0.56)
    parts["steps"] = merge(steps)

    # ---------- Платформа аварійно-евакуаційного модуля: відсіки, настил, ящики ----------
    L = DECK_X1 - DECK_X0
    xc = (DECK_X0 + DECK_X1) / 2
    deck = [box((xc, DECK_Y, 0.0), (L, 0.12, 2 * DECK_HALF)), box((xc, DECK_Y - 0.10, 0.0), (L - 0.30, 0.10, 1.90))]
    for z0 in (-0.80, -0.27, 0.27, 0.80):
        deck.append(box((xc, DECK_Y - 0.16, z0), (L, 0.10, 0.07)))
    parts["deck"] = merge(deck)
    lockers, doors_l, vents = [], [], []
    for s in (-1, 1):
        # передній і задній відсіки з обох боків, кран і колесо між ними
        for x0, x1 in ((DECK_X1 - 0.08, DECK_X1 - 2.10), (DECK_X1 - 2.20, DECK_X1 - 3.50)):
            cx, ln = (x0 + x1) / 2, abs(x0 - x1)
            lockers.append(box((cx, DECK_Y + 0.58, s * (DECK_HALF - 0.17)), (ln, 1.04, 0.34), bevel=0.02))
            doors_l.append(box((cx, DECK_Y + 0.52, s * (DECK_HALF + 0.005)), (ln - 0.10, 0.82, 0.02), bevel=0.01))
            for i in range(5):
                doors_l.append(box((cx, DECK_Y + 0.15 + i * 0.16, s * (DECK_HALF + 0.015)), (ln - 0.12, 0.018, 0.012), bevel=0.003))
            deck_rivets += rivet_row((x0 - 0.05, DECK_Y + 1.08, s * (DECK_HALF + 0.001)), (x1 + 0.05, DECK_Y + 1.08, s * (DECK_HALF + 0.001)), 0.13, (0, 0, s))
    parts["lockers"] = merge(lockers)
    parts["locker_doors"] = merge(doors_l)
    # обладнання посеред платформи: вертикальний ресивер за кабіною, компресорний блок, ящики, барабан шланга
    eq = [cyl_between((2.02, DECK_Y + 0.06, -0.46), (2.02, DECK_Y + 1.12, -0.46), 0.21, 28),
          cyl_between((2.02, DECK_Y + 1.12, -0.46), (2.02, DECK_Y + 1.18, -0.46), 0.15, 24),
          box((1.30, DECK_Y + 0.42, 0.28), (1.00, 0.72, 0.84), bevel=0.04), box((1.30, DECK_Y + 0.82, 0.28), (0.90, 0.10, 0.74), bevel=0.02),
          box((0.30, DECK_Y + 0.28, -0.40), (0.78, 0.46, 0.62), bevel=0.03), box((0.15, DECK_Y + 0.26, 0.42), (0.60, 0.42, 0.56), bevel=0.03),
          cyl_z((0.70, DECK_Y + 0.40, 0.26), 0.30, 0.34, 24), cyl_z((0.70, DECK_Y + 0.40, 0.26), 0.12, 0.40, 16),
          cyl_between((1.55, DECK_Y + 0.76, -0.10), (2.02, DECK_Y + 0.76, -0.40), 0.035, 8)]
    parts["equipment"] = merge(eq)
    parts["headboard"] = merge([box((DECK_X1 - 0.07, DECK_Y + 0.70, 0.0), (0.12, 1.40, 2 * DECK_HALF - 0.04), bevel=0.02),
                                box((DECK_X1 - 0.07, DECK_Y + 1.44, 0.0), (0.16, 0.08, 2 * DECK_HALF - 0.04), bevel=0.02)])
    tools = []   # лопата, лом, ланцюг — прикріплені до заднього листа платформи
    for z0 in (-0.78, -0.40, 0.40, 0.78):
        tools.append(cyl_between((DECK_X0 + 0.06, DECK_Y + 0.12, z0), (DECK_X0 + 0.06, DECK_Y + 1.00, z0), 0.022, 8))
    tools += [box((DECK_X0 + 0.07, DECK_Y + 0.14, 0.78), (0.03, 0.26, 0.20), bevel=0.006)]
    parts["tools"] = merge(tools)
    tie = []
    for s in (-1, 1):
        for x in (-2.0, -0.6, 0.8, 2.0):
            tie.append(cyl_z((x, DECK_Y + 0.08, s * (DECK_HALF - 0.40)), 0.05, 0.02, 12))
    parts["tie_downs"] = merge(tie)
    parts["deck_rivets"] = merge(deck_rivets)
    parts["cab_rivets"] = merge(rivets)

    # ---------- Задній кран: тумба, стріла в транспортному положенні, циліндри, гак ----------
    cz = 0.0
    base = [box((CRANE_X, DECK_Y + 0.38, cz), (1.30, 0.70, 1.50), bevel=0.04), cyl_z((CRANE_X + 0.20, DECK_Y + 0.80, cz), 0.52, 0.10, 28)]
    base += [box((CRANE_X + 0.40, DECK_Y + 1.05, cz - 0.58), (0.60, 0.70, 0.36), bevel=0.03)]   # кабіна оператора/гідростанція
    parts["crane_base"] = merge(base)
    lift = np.radians(13.0)
    p0 = np.array([CRANE_X, DECK_Y + 1.15])
    d_dir = np.array([-np.cos(lift), np.sin(lift)])
    sections, inner = [], []
    p1 = p0 + d_dir * 2.7
    sections.append(k.beam_between((p0[0], p0[1], cz), (p1[0], p1[1], cz), 0.62, 0.52, bevel=0.03))
    p2 = p0 + d_dir * 5.2
    q1 = p1 - d_dir * 0.7   # висувна секція заходить у нижню
    inner.append(k.beam_between((q1[0], q1[1], cz), (p2[0], p2[1], cz), 0.46, 0.38, bevel=0.025))
    tip = p2 + d_dir * 0.15
    inner.append(box((tip[0], tip[1], cz), (0.34, 0.44, 0.46), bevel=0.03))
    parts["crane_boom"] = merge(sections)
    parts["crane_boom_inner"] = merge(inner)
    ram_a = np.array([CRANE_X + 0.55, DECK_Y + 0.55, 0.0])
    ram_b = p0 + d_dir * 1.20 + np.array([0.0, -0.30])
    rams = [cyl_between((ram_a[0], ram_a[1], z), (ram_b[0], ram_b[1], z), 0.06, 12) for z in (-0.30, 0.30)]
    rams.append(cyl_between((p1[0], p1[1] - 0.15, 0.0), (p1[0] + 0.5 * d_dir[0], p1[1] + 0.5 * d_dir[1] - 0.15, 0.0), 0.04, 10))
    parts["crane_rams"] = merge(rams)
    hook_top = np.array([tip[0] + d_dir[0] * 0.2, tip[1] - 0.22, cz])
    parts["crane_hook"] = merge([cyl_between(hook_top, hook_top + (0.0, -0.95, 0.0), 0.014, 6),
                                 box((hook_top[0], hook_top[1] - 1.02, cz), (0.18, 0.20, 0.16), bevel=0.03),
                                 cyl_z((tip[0] + d_dir[0] * 0.2, tip[1] - 0.05, cz), 0.12, 0.10, 16)])
    # упор стріли на задній балці
    rest_x = DECK_X0 - 0.22
    rest_y = p0[1] + (CRANE_X - rest_x) * np.tan(lift) - 0.50
    parts["boom_rest"] = merge([box((rest_x, (rest_y + 1.14) / 2, s * 0.28), (0.12, rest_y - 1.14 + 0.02, 0.10), bevel=0.01) for s in (-1, 1)]
                               + [box((rest_x, rest_y + 0.04, 0.0), (0.20, 0.10, 0.74), bevel=0.02)])

    # ---------- Корма: балка, ліхтарі, сошники, фаркоп ----------
    stern = [box((DECK_X0 - 0.10, 1.12, 0.0), (0.18, 0.26, 2.40)), box((DECK_X0 - 0.02, 0.80, 0.0), (0.10, 0.10, 2.00))]
    stern += [box((DECK_X0 - 0.12, 1.30, s * 1.06), (0.08, 0.34, 0.26)) for s in (-1, 1)]
    parts["rear_beam"] = merge(stern)
    parts["rear_red"] = merge([cyl_between((DECK_X0 - 0.20, 1.34, s * 1.06), (DECK_X0 - 0.24, 1.34, s * 1.06), 0.055, 16) for s in (-1, 1)]
                              + [cyl_between((DECK_X0 - 0.20, 1.34, s * 0.88), (DECK_X0 - 0.24, 1.34, s * 0.88), 0.044, 16) for s in (-1, 1)])
    parts["rear_amber"] = merge([cyl_between((DECK_X0 - 0.20, 1.20, s * 1.06), (DECK_X0 - 0.24, 1.20, s * 1.06), 0.035, 12) for s in (-1, 1)])
    parts["hitch"] = merge([cyl_between((DECK_X0 - 0.12, 1.08, 0.0), (DECK_X0 - 0.40, 1.08, 0.0), 0.06, 12), cyl_z((DECK_X0 - 0.38, 1.08, 0.0), 0.08, 0.05, 16)])
    spades = []
    for s in (-1, 1):
        x = DECK_X0 - 0.28
        spades.append(box((x, 0.95, s * 0.86), (0.16, 0.20, 0.30), bevel=0.02))
        spades.append(cyl_between((x, 0.90, s * 0.86), (x - 0.18, 0.12, s * 0.86), 0.06, 10))
        spades.append(box((x - 0.22, 0.08, s * 0.86), (0.46, 0.06, 0.56), bevel=0.012))
    parts["spades"] = merge(spades)
    return parts


# ---------- групи для запікання ----------
OL = vp.R("camo", 0.72, 0.1)
OL_DK = vp.R("camo", 0.74, 0.12, tone=0.8)
CHASSIS_NAMES = ["frame", "axles", "springs", "tanks", "exhaust", "fenders", "rear_beam", "rear_red", "rear_amber", "hitch", "spades", "steps", "winch"]
CHASSIS_RECIPES = {"frame": vp.R((78, 70, 54), 0.82, 0.3), "axles": vp.R((66, 60, 48), 0.8, 0.4), "springs": vp.R((44, 44, 38), 0.7, 0.6),
                   "tanks": vp.R("camo", 0.7, 0.2, tone=0.8), "exhaust": vp.R((74, 62, 50), 0.6, 0.5), "fenders": OL_DK, "rear_beam": vp.R((120, 106, 80), 0.8, 0.35),
                   "rear_red": vp.LENS_R, "rear_amber": vp.LENS_A, "hitch": vp.R((38, 38, 36), 0.5, 0.8), "spades": vp.R((60, 58, 44), 0.7, 0.4),
                   "steps": vp.R((46, 46, 40), 0.8, 0.5), "winch": vp.R((40, 40, 36), 0.55, 0.7)}
CAB_NAMES = ["hood", "cab", "windshields", "windshield_frames", "wipers", "grille_back", "grille", "doors", "side_windows", "door_handles",
             "lamps", "lamps_amber", "bumper", "mirror_arms", "mirrors", "cab_rivets"]
CAB_RECIPES = {"hood": OL, "cab": OL, "windshields": vp.GLASS, "windshield_frames": OL_DK, "wipers": vp.BLACK, "grille_back": vp.BLACK,
               "grille": vp.R("camo", 0.7, 0.2, tone=0.75), "doors": OL, "side_windows": vp.GLASS, "door_handles": vp.R("camo", 0.6, 0.3, tone=0.7),
               "lamps": vp.LENS_W, "lamps_amber": vp.LENS_A, "bumper": vp.R("camo", 0.7, 0.2, tone=0.85), "mirror_arms": OL_DK, "mirrors": vp.BLACK,
               "cab_rivets": vp.R("camo", 0.7, 0.2, tone=0.75)}
BODY_NAMES = ["deck", "equipment", "lockers", "locker_doors", "headboard", "tools", "tie_downs", "deck_rivets", "crane_base", "crane_boom", "crane_boom_inner",
              "crane_rams", "crane_hook", "boom_rest"]
BODY_RECIPES = {"deck": vp.R((98, 88, 66), 0.8, 0.3), "equipment": OL_DK, "lockers": OL, "locker_doors": OL_DK, "headboard": OL, "tools": vp.R((90, 76, 54), 0.7, 0.5),
                "tie_downs": vp.R((60, 62, 52), 0.6, 0.6), "deck_rivets": vp.R("camo", 0.7, 0.2, tone=0.75), "crane_base": OL,
                "crane_boom": vp.R("camo", 0.68, 0.2, tone=0.9), "crane_boom_inner": vp.R("camo", 0.7, 0.25, tone=0.8), "crane_rams": vp.STEEL,
                "crane_hook": vp.R((40, 40, 38), 0.5, 0.8), "boom_rest": vp.R((120, 106, 80), 0.8, 0.35)}
TILES = {"tyres": TileSpec("rubber", (36, 34, 31), 0.4, 1.0, 1.0), "rims": TileSpec("cast", (168, 148, 104), 0.5, 1.0, 1.0),
         "wheel_bolts": TileSpec("steel", (95, 97, 92), 0.3, 1.0, 1.0)}


def post_cab(s, tx, masks):
    Y = (0, 1, 0)
    vp.put(s, tx, vp.mlc_disc(60, 0.075), (HOOD_FRONT + 0.0, 1.30, -0.62), (1, 0, 0), Y)
    for sg in (-1, 1):
        vp.put(s, tx, vp.plate(["DATA"], 0.14, 0.09, bg=(176, 178, 170), px_per_m=900), (3.0, 1.40, sg * 1.238), (0, 0, sg), Y)


def post_body(s, tx, masks):
    Y = (0, 1, 0)
    for sg in (-1, 1):
        vp.put(s, tx, vp.stencil_text("M984A2", 0.07), (0.6, DECK_Y + 0.98, sg * (DECK_HALF + 0.02)), (0, 0, sg), Y, thick=0.04)
        vp.put(s, tx, vp.stencil_text("NO STEP", 0.05), (CRANE_X + 0.55, DECK_Y + 0.65, sg * 0.755), (0, 0, sg), Y, thick=0.04)
    vp.put(s, tx, vp.hazard_stripes(1.0, 0.07), (DECK_X0 - 0.0, DECK_Y + 0.15, 0.0), (-1, 0, 0), Y, thick=0.1)


def group_nodes(parts):
    nodes = []
    spec = (("chassis", CHASSIS_NAMES, CHASSIS_RECIPES, 1024, None, ("fenders",)), ("cab", CAB_NAMES, CAB_RECIPES, 1536, post_cab, ("cab", "doors", "bumper")),
            ("body", BODY_NAMES, BODY_RECIPES, 2048, post_body, ("lockers", "crane_base", "crane_boom")))
    for gi, (gname, names, recipes, res, post, seams) in enumerate(spec):
        meshes, ids = [], []
        for i, nme in enumerate(names):
            m = parts.pop(nme)
            meshes.append(m)
            ids.append(np.full(len(m.faces), i, np.int16))
        painter = vp.group_painter(names, recipes, camo=False, seed=41 + gi, olive=OLIVE_RGB, weather=dict(mud=0.65 if gname == "chassis" else 0.35, dust=0.5),
                                   seams=seams, post=post)
        nodes.append(node(gname, [(merge(meshes), BakeSpec(painter, res=res, ids=np.concatenate(ids), key=f"m984-{gname}", seed=41 + gi))]))
    for nme, spec in TILES.items():
        nodes.append(node(nme, [(parts.pop(nme), spec)]))
    return nodes


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    parts = build()
    w = GlbWriter("EasyWAR build-m984-model.py")
    for nd in group_nodes(parts):
        w.add(nd)
    assert not parts, f"частини без поверхні: {list(parts)}"
    glb = w.glb({"title": "M984A2 (generated)", "generated": True,
                 "note": "Procedural model of a HEMTT 8x8 wrecker with a rear crane, built from open overall dimensions and a user-supplied reference "
                         "view. Not a scan or copy of any other model."})
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(glb)
    print(f"{out.name}: {len(glb) / 1024:.0f} KB, {len(w.doc['nodes'])} nodes, {w.triangles} triangles")
    return 0


if __name__ == "__main__":
    sys.exit(main())
