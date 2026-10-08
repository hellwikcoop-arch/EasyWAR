#!/usr/bin/env python3
"""Генерує спрощену процедурну модель РСЗВ M270 MLRS для довідника (src/models/m270-mlrs.glb).

    pip install numpy scipy trimesh
    python3 script/build-m270-model.py [вихідний.glb]

Модель побудовано за відкритими габаритами (довжина ≈ 7 м, ширина ≈ 3 м, висота в похідному положенні ≈ 2,6 м) і за
довідковими зображеннями, які надав користувач: гусеничне шасі M993 з шістьма здвоєними опорними котками, кабіна з похилим
лобом і жалюзі, відсік двигуна за кабіною, поворотна платформа й пускова установка з двома пакетами по шість труб. Установку
показано піднятою (як на зображеннях), дулами вперед і вгору. Рухомі частини — окремі вузли, а кліп анімації «reload»
схематично показує заряджання за довідковим зображенням: поворот установки торцем до корми, опускання до горизонталі,
висування напрямних із візками лебідок, заміну обох пакетів (виїхав, опустився на землю, новий піднявся й заїхав) і підйом.
Це не скан і не копія чужої моделі, сторонніх текстур немає. Для перегляду, а не для впізнавання чи розрахунків. Одиниці — метри, перед машини дивиться в +x,
«вгору» — +y, права сторона — +z (як у glTF).
"""
import sys
from pathlib import Path

import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial

from glb_rig import GlbWriter, lpc_pod, node, quat_axis, ramp, shifted

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "src" / "models" / "m270-mlrs.glb"

# Ребра мають фаски, тож згладжені нормалі дають м'які відблиски; плоскі нормалі лише для опуклих корпусів-оболонок.
FLAT = {"cab"}

# --- головні розміри, м ---------------------------------------------------------------------------------------------
X_REAR, X_FRONT = -3.45, 3.50         # торці палуби
DECK_Y0, DECK_Y1, DECK_HALF = 1.02, 1.20, 1.45
TRACK_Z, TRACK_W = 1.215, 0.53         # вісь і ширина гусениці
SPROCKET = (2.95, 0.58, 0.46)          # x, y, зовнішній радіус гусениці на ведучому колесі
IDLER = (-3.00, 0.48, 0.48)
ROAD_X = [-2.05, -1.27, -0.49, 0.29, 1.07, 1.85]
ROAD_R, ROAD_Y = 0.335, 0.405
PAD_PITCH = 0.15

LAUNCH_ANGLE = np.radians(52)          # кут підйому установки
HINGE = (-2.60, 1.58)                  # вісь підйому (x, y)
BOX_L, BOX_T, BOX_W = 3.70, 1.15, 2.80


def material(name, rgb, metallic=0.1, roughness=0.65):
    linear = [round(255 * (c / 255) ** 2.2) for c in rgb]  # glTF чекає лінійні кольори
    return PBRMaterial(name=name, baseColorFactor=[*linear, 255], metallicFactor=metallic, roughnessFactor=roughness)


def painted(mesh, mat):
    mesh.visual = trimesh.visual.TextureVisuals(material=mat)
    return mesh


def merge(meshes):
    return trimesh.util.concatenate(meshes)


def bevelled(extents, bevel=None):
    """Паралелепіпед зі сколеними ребрами (фаска ~2,5 см): так грані ловлять світло, як на справжньому металі."""
    ex, ey, ez = (e / 2 for e in extents)
    b = min(0.025, min(extents) * 0.22) if bevel is None else bevel
    if b < 0.004:
        return trimesh.creation.box(extents=extents)
    pts = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                pts += [(sx * ex, sy * (ey - b), sz * (ez - b)), (sx * (ex - b), sy * ey, sz * (ez - b)),
                        (sx * (ex - b), sy * (ey - b), sz * ez)]
    return trimesh.convex.convex_hull(np.array(pts))


def box(center, extents, rot_z=0.0, bevel=None):
    """Паралелепіпед з центром у `center`; його вісь x повернута навколо z на rot_z радіан."""
    m = bevelled(extents, bevel)
    m.apply_transform(trimesh.transformations.rotation_matrix(rot_z, [0, 0, 1]))
    m.apply_translation(center)
    return m


def cyl_z(center, radius, width, sections=28):
    """Циліндр із віссю вздовж z (колесо)."""
    m = trimesh.creation.cylinder(radius=radius, height=width, sections=sections)
    m.apply_translation(center)
    return m


def cyl_between(a, b, radius, sections=14):
    a, b = np.array(a, float), np.array(b, float)
    d = b - a
    m = trimesh.creation.cylinder(radius=radius, height=np.linalg.norm(d), sections=sections)
    m.apply_transform(trimesh.geometry.align_vectors([0, 0, 1], d / np.linalg.norm(d)))
    m.apply_translation((a + b) / 2)
    return m


def hull(points):
    return trimesh.convex.convex_hull(np.array(points, dtype=float))


def prism_side(profile_xy, z0, z1):
    """Опукла призма: бічний профіль (x, y) витягнуто від z0 до z1."""
    pts = [(x, y, z) for (x, y) in profile_xy for z in (z0, z1)]
    return trimesh.convex.convex_hull(np.array(pts, dtype=float))


def box_pose(u0, u1, v0, v1, z0, z1):
    """Паралелепіпед у системі координат установки: u — уздовж корпусу від осі підйому, v — «вгору» від його низу."""
    m = bevelled([u1 - u0, v1 - v0, z1 - z0])
    m.apply_translation([(u0 + u1) / 2, (v0 + v1) / 2, (z0 + z1) / 2])
    return m


def track_loop():
    """Замкнений контур гусениці в площині (x, y): знизу вперед, навколо ведучого колеса, назад по верху, навколо ліниво колеса."""
    sx, sy, sr = SPROCKET
    ix, iy, ir = IDLER
    pts = []
    n_arc = 24
    for k in range(n_arc + 1):  # ведуче колесо, від низу (−90°) до верху (+90°)
        a = -np.pi / 2 + np.pi * k / n_arc
        pts.append((sx + sr * np.cos(a), sy + sr * np.sin(a)))
    for k in range(n_arc + 1):  # ліниве колесо, від верху (+90°) до низу (+270°)
        a = np.pi / 2 + np.pi * k / n_arc
        pts.append((ix + ir * np.cos(a), iy + ir * np.sin(a)))
    return np.array(pts + [pts[0]])


def resample(path, pitch):
    seg = np.diff(path, axis=0)
    lens = np.hypot(seg[:, 0], seg[:, 1])
    cum = np.concatenate([[0], np.cumsum(lens)])
    n = int(round(cum[-1] / pitch))
    out = []
    for k in range(n):
        s = cum[-1] * k / n
        i = min(np.searchsorted(cum, s, side="right") - 1, len(seg) - 1)
        f = (s - cum[i]) / lens[i]
        p = path[i] + seg[i] * f
        out.append((p[0], p[1], np.arctan2(seg[i][1], seg[i][0])))
    return out


def track_pads(z_center):
    """Ланки гусениці: пластина з грунтозачепом зовні й напрямним гребенем усередині (між здвоєними котками)."""
    pads, horns = [], []
    for x, y, a in resample(track_loop(), PAD_PITCH):
        n = np.array([np.sin(a), -np.cos(a)])           # зовнішня нормаль контуру (контур іде проти годинникової)
        pads.append(box((x, y, z_center), (PAD_PITCH * 0.84, 0.055, TRACK_W), rot_z=a, bevel=0))
        g = np.array([x, y]) + n * 0.035
        pads.append(box((g[0], g[1], z_center), (0.035, 0.03, TRACK_W * 0.92), rot_z=a, bevel=0))      # грунтозачеп
        h = np.array([x, y]) - n * 0.065
        horns.append(box((h[0], h[1], z_center), (0.07, 0.08, 0.05), rot_z=a, bevel=0))                 # напрямний гребінь
        for side in (-1, 1):                                                                    # кінцеві з'єднувачі
            horns.append(box((x, y, z_center + side * (TRACK_W / 2 + 0.02)), (0.06, 0.06, 0.04), rot_z=a, bevel=0))
    return pads, horns


def m270():
    olive = material("Hull", (88, 92, 62), metallic=0.1, roughness=0.72)
    olive_dk = material("HullDark", (66, 70, 48), metallic=0.12, roughness=0.78)
    olive_lt = material("Pods", (102, 108, 78), metallic=0.1, roughness=0.68)
    rubber = material("Tyres", (30, 30, 30), metallic=0.0, roughness=0.9)
    trackmat = material("Track", (52, 50, 46), metallic=0.55, roughness=0.5)
    hub = material("Hubs", (70, 80, 58), metallic=0.2, roughness=0.6)
    black = material("Black", (24, 26, 24), metallic=0.1, roughness=0.6)
    glass = material("Glass", (40, 46, 48), metallic=0.5, roughness=0.15)
    amber = material("Amber", (236, 140, 28), metallic=0.0, roughness=0.3)
    white = material("Lamp", (240, 240, 232), metallic=0.3, roughness=0.15)
    metal = material("Metal", (150, 154, 150), metallic=0.8, roughness=0.3)
    wood = material("Handle", (176, 140, 86), metallic=0.0, roughness=0.7)
    parts = {}

    # ---------- Корпус: нижній корпус між гусеницями, похилий лоб, палуба з надгусеничними полицями ----------
    hull_low = prism_side([(-3.10, 0.36), (2.95, 0.36), (3.55, 0.92), (3.55, 1.04), (-3.45, 1.04), (-3.45, 0.66)], -0.94, 0.94)
    deck = box(((X_REAR + X_FRONT) / 2, (DECK_Y0 + DECK_Y1) / 2, 0), (X_FRONT - X_REAR, DECK_Y1 - DECK_Y0, 2 * DECK_HALF))
    lips = [box(((X_REAR + X_FRONT) / 2, DECK_Y0 + 0.01, s * (DECK_HALF - 0.01)), (X_FRONT - X_REAR, 0.05, 0.06)) for s in (-1, 1)]
    parts["deck"] = painted(merge([hull_low, deck] + lips), olive)
    front = [box((X_FRONT + 0.06, 0.78, s * 1.20), (0.05, 0.60, 0.52)) for s in (-1, 1)]            # брудозахисні щитки
    rear_flaps = [box((X_REAR - 0.04, 0.80, s * 1.20), (0.05, 0.48, 0.50)) for s in (-1, 1)]
    parts["flaps"] = painted(merge(front + rear_flaps), black)
    shackles = []
    for x, y, z in ((3.28, 0.70, -0.42), (3.28, 0.70, 0.42), (-3.47, 0.80, -0.55), (-3.47, 0.80, 0.55)):
        t = trimesh.creation.torus(major_radius=0.07, minor_radius=0.02, major_sections=16, minor_sections=8)
        t.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0]))
        t.apply_translation((x + (0.12 if x > 0 else -0.04), y, z))
        shackles.append(t)
        shackles.append(box((x + (0.05 if x > 0 else 0.0), y + 0.08, z), (0.10, 0.08, 0.12)))
    parts["shackles"] = painted(merge(shackles), olive_dk)

    # ---------- Ходова: ланки, котки, ведуче й ліниве колеса, підтримувальні котки, балансири ----------
    tyres, hubs, pads, horns, rollers, arms, teeth = [], [], [], [], [], [], []
    for side in (-1, 1):
        zc = side * TRACK_Z
        p_, h_ = track_pads(zc)
        pads += p_
        horns += h_
        for x in ROAD_X:
            for dz in (-0.135, 0.135):
                tyres.append(cyl_z((x, ROAD_Y, zc + dz), ROAD_R, 0.13, 30))
                hubs.append(cyl_z((x, ROAD_Y, zc + dz + side * 0.07 * np.sign(dz) * side), 0.25, 0.02, 20))
            hubs.append(cyl_z((x, ROAD_Y, zc), 0.20, 0.16, 20))
            for k in range(8):
                a = 2 * np.pi * k / 8
                hubs.append(cyl_z((x + 0.15 * np.cos(a), ROAD_Y + 0.15 * np.sin(a), zc + side * 0.215), 0.018, 0.03, 6))
            hubs.append(cyl_z((x, ROAD_Y, zc + side * 0.22), 0.07, 0.04, 12))
            arms.append(cyl_between((x + 0.42, 0.66, side * 0.92), (x, ROAD_Y, side * 0.98), 0.055, 10))   # балансир
        for x in (-1.60, -0.30, 1.00):
            rollers.append(cyl_z((x, 0.86, zc), 0.08, 0.22, 16))
            rollers.append(cyl_between((x, 0.86, side * 0.92), (x, 0.86, zc), 0.03, 8))
        sx, sy, _ = SPROCKET
        for dz in (-0.12, 0.12):
            hubs.append(cyl_z((sx, sy, zc + dz), 0.36, 0.08, 24))
            for k in range(12):
                a = 2 * np.pi * k / 12
                teeth.append(box((sx + 0.40 * np.cos(a), sy + 0.40 * np.sin(a), zc + dz), (0.07, 0.08, 0.07), rot_z=a, bevel=0))
        hubs.append(cyl_z((sx, sy, zc + side * 0.18), 0.16, 0.08, 20))
        ix, iy, _ = IDLER
        for dz in (-0.12, 0.12):
            hubs.append(cyl_z((ix, iy, zc + dz), 0.36, 0.09, 24))
        hubs.append(cyl_z((ix, iy, zc + side * 0.18), 0.12, 0.08, 20))
        arms.append(cyl_between((ix + 0.30, 0.66, side * 0.92), (ix, iy, side * 1.0), 0.06, 10))
    parts["tracks"] = painted(merge(pads), trackmat)
    parts["track_horns"] = painted(merge(horns + teeth), trackmat)
    parts["tyres"] = painted(merge(tyres), rubber)
    parts["hubs"] = painted(merge(hubs), hub)
    parts["rollers"] = painted(merge(rollers), hub)
    parts["suspension"] = painted(merge(arms), olive_dk)

    # ---------- Кабіна: прямий низ, похилий верх із броньованими жалюзі, скоси кутів ----------
    levels = [(DECK_Y1, 3.42, 1.18, 1.40, 0.16), (1.80, 3.42, 1.18, 1.40, 0.16), (2.52, 2.66, 1.18, 1.36, 0.12),
              (2.60, 2.56, 1.24, 1.30, 0.08)]
    pts = []
    for y, xf, xr, half, c in levels:
        pts += [(xf - c, y, -half), (xf, y, -(half - c)), (xf, y, half - c), (xf - c, y, half),
                (xr, y, half), (xr, y, -half)]
    parts["cab"] = painted(hull(pts), olive)
    slope = np.arctan2(2.52 - 1.80, 2.66 - 3.42)            # кут похилої частини лоба
    d = np.array([np.cos(slope), np.sin(slope)])
    n_out = np.array([d[1], -d[0]])
    louvers, frames = [], []
    for z in (-0.86, 0.0, 0.86):
        base = np.array([3.04, 2.16])
        c0 = base + n_out * 0.03
        frames.append(box((c0[0], c0[1], z), (0.92, 0.03, 0.80), rot_z=slope))      # темна ніша
        for k in range(-3, 4):                                                        # планки решітки
            cc = base + n_out * 0.13 + d * (k * 0.12)
            louvers.append(box((cc[0], cc[1], z), (0.035, 0.05, 0.78), rot_z=slope))
        for zz in (z - 0.39, z + 0.39):                                               # бічні стійки решітки
            cc = base + n_out * 0.09
            louvers.append(box((cc[0], cc[1], zz), (0.86, 0.10, 0.03), rot_z=slope))
    parts["louver_backs"] = painted(merge(frames), black)
    parts["louvers"] = painted(merge(louvers), olive_dk)
    lamps_w, lamps_a, recess = [], [], []
    for s in (-1, 1):
        recess.append(box((3.44, 1.55, s * 0.98), (0.10, 0.24, 0.44)))
        lamps_w.append(cyl_between((3.47, 1.55, s * 0.92), (3.51, 1.55, s * 0.92), 0.06, 16))
        lamps_a.append(cyl_between((3.47, 1.55, s * 1.12), (3.51, 1.55, s * 1.12), 0.045, 14))
        lamps_w.append(cyl_between((3.47, 1.55, s * 0.78), (3.50, 1.55, s * 0.78), 0.04, 12))
    parts["lamp_recesses"] = painted(merge(recess), black)
    parts["lamps"] = painted(merge(lamps_w), white)
    parts["lamps_amber"] = painted(merge(lamps_a), amber)
    det = [box((3.43, 1.48, 0.0), (0.04, 0.30, 0.07)), box((3.43, 1.35, 0.0), (0.05, 0.05, 0.22))]   # скоба по центру
    for s in (-1, 1):
        det.append(box((2.50, 1.80, s * 1.405), (0.95, 1.10, 0.03)))                 # двері
        det.append(box((2.05, 1.85, s * 1.425), (0.06, 0.06, 0.04)))
        det.append(cyl_between((2.10, 1.62, s * 1.43), (2.60, 1.62, s * 1.43), 0.02, 8))   # поручень
        det.append(box((1.55, 1.75, s * 1.405), (0.42, 0.85, 0.03)))                 # бічний лючок
    parts["doors"] = painted(merge(det), olive_dk)
    parts["windows"] = painted(merge([box((2.70, 2.28, s * 1.425), (0.42, 0.09, 0.02)) for s in (-1, 1)]), glass)
    rail = [cyl_between((1.45, 2.60, -0.85), (1.45, 2.80, -0.85), 0.016), cyl_between((1.45, 2.60, 0.85), (1.45, 2.80, 0.85), 0.016),
            cyl_between((2.30, 2.58, -0.85), (2.30, 2.80, -0.85), 0.016), cyl_between((2.30, 2.58, 0.85), (2.30, 2.80, 0.85), 0.016),
            cyl_between((1.45, 2.80, -0.85), (2.30, 2.80, -0.85), 0.016), cyl_between((1.45, 2.80, 0.85), (2.30, 2.80, 0.85), 0.016),
            cyl_between((1.45, 2.80, -0.85), (1.45, 2.80, 0.85), 0.016), cyl_between((2.30, 2.80, -0.85), (2.30, 2.80, 0.85), 0.016),
            cyl_between((1.32, 2.60, -1.05), (1.32, 3.55, -1.05), 0.010, 8)]
    parts["rails"] = painted(merge(rail), metal)
    mirror = [box((3.10, 2.20, s * 1.58), (0.08, 0.36, 0.22)) for s in (-1, 1)]
    mirror += [cyl_between((3.10, 2.05, s * 1.40), (3.10, 2.05, s * 1.58), 0.014, 8) for s in (-1, 1)]
    parts["mirrors"] = painted(merge(mirror), black)
    parts["roof"] = painted(merge([box((1.85, 2.63, 0.35), (0.62, 0.05, 0.62)), cyl_between((1.55, 2.60, -0.55), (1.55, 2.86, -0.55), 0.08, 14),
                                   box((1.55, 2.88, -0.55), (0.22, 0.06, 0.22))]), olive_dk)

    # ---------- За кабіною: ящик із лопатою (ліво), блок радіатора з решіткою (право), ящики зверху ----------
    rb = [box((0.62, 1.70, -0.98), (1.05, 1.00, 0.82)), box((0.62, 1.62, 0.98), (1.05, 0.84, 0.82)),
          box((0.62, 1.55, 0.0), (1.05, 0.70, 1.20)), box((0.75, 2.27, -0.98), (0.55, 0.14, 0.40)),
          box((0.40, 2.12, 0.98), (0.36, 0.16, 0.30))]
    parts["engine"] = painted(merge(rb), olive)
    grille = [box((0.62, 1.60, 1.395), (0.92, 0.70, 0.02))]
    grille += [box((0.18 + k * 0.045, 1.60, 1.41), (0.014, 0.66, 0.02)) for k in range(21)]
    parts["grille"] = painted(merge(grille), black)
    shovel = [cyl_between((0.30, 2.15, -1.405), (0.85, 1.35, -1.405), 0.018, 8)]
    blade = hull([(0.80, 1.38, -1.40), (0.98, 1.20, -1.40), (0.86, 1.08, -1.40), (0.70, 1.26, -1.40),
                  (0.80, 1.38, -1.43), (0.98, 1.20, -1.43), (0.86, 1.08, -1.43), (0.70, 1.26, -1.43)])
    parts["shovel"] = painted(shovel[0], wood)
    parts["shovel_blade"] = painted(blade, black)
    parts["box_doors"] = painted(merge([box((0.62, 1.70, -1.395), (0.85, 0.80, 0.02)), box((0.20, 1.70, -1.41), (0.05, 0.10, 0.03))]), olive_dk)

    # ---------- Корма: ліхтарі ----------
    parts["rear_lamps"] = painted(merge([box((X_REAR - 0.02, 0.98, s * 1.05), (0.04, 0.10, 0.16)) for s in (-1, 1)]),
                                  material("Red", (170, 36, 30), metallic=0.0, roughness=0.3))

    # ---------- Рухома частина: платформа, установка, стійки й висувні напрямні, візки, пакети, троси, гідроциліндри ----------
    mats = dict(olive=olive, olive_dk=olive_dk, olive_lt=olive_lt, black=black, metal=metal,
                steel_dk=material("SteelDark", (58, 60, 58), metallic=0.6, roughness=0.45))
    return parts, launcher_rig(mats)


# --- рухома частина ------------------------------------------------------------------------------------------------
# Вузли: turret (поворот навколо вертикалі) → launcher (підйом навколо осі HINGE) → напрямні, візки й пакети;
# гідроциліндри — діти turret, що щокадру дивляться на точку кріплення до установки.
TURRET_X = -1.65                        # вісь поворотної платформи (x)
HX, HY = HINGE[0] - TURRET_X, HINGE[1]  # вісь підйому в системі платформи
POD_Z = (-0.68, 0.68)                   # центри двох пакетів поперек установки
POD_U0, POD_U1, POD_V0, POD_V1, POD_HALF = 0.10, BOX_L + 0.02, 0.10, 0.92, 0.52
POD_UC = (POD_U0 + POD_U1) / 2
SLIDE = BOX_L + 0.05                    # на скільки пакет виїжджає з установки
GROUND_Y = 0.0
DROP = HY + POD_V0 - GROUND_Y           # на скільки пакет опускається до землі
BOOM_STEP = 1.80                        # висування кожної з двох секцій напрямних
RAIL_V = 1.00                           # низ висувних напрямних під дахом установки
CABLE_TOP = RAIL_V - 0.01               # троси звисають з візків на напрямних
LUG_U = 1.31                            # вушка для тросів від центру пакета
# Гідроциліндри: (назва, основа в системі платформи (x, y), точка кріплення вздовж установки u, довжина циліндра, штока)
STRUTS = [("a", (-0.25 - TURRET_X, 1.36), 1.25, 1.00, 1.00),
          ("b", (-2.45 - TURRET_X, 1.36), 2.65, 1.50, 1.40)]
STRUT_Z = 0.95
CLIP_SECONDS = 24.0
SAMPLES = 161
TINY = 1e-4                             # «сховано»: масштаб майже нуль

# Етапи заряджання за часткою кліпу t ∈ [0, 1] (за довідковим зображенням: установка лежить горизонтально відкритим
# торцем назад, з її торця висуваються напрямні з візками, пакет висить під ними за кормою й опускається на землю)
TRAVERSE = (0.00, 0.10)                 # поворот платформи на 180°: торець установки — до корми
LOWER = (0.10, 0.18)                    # опускання установки до горизонталі
BOOM_OUT = (0.18, 0.25)
CYCLES = {"pod_r": (0.25, 0.52), "pod_l": (0.52, 0.79)}   # спершу один пакет, потім другий
BOOM_IN = (0.79, 0.86)
RAISE = (0.86, 0.93)
TRAVERSE_BACK = (0.93, 1.00)


def yaw_at(t):
    return -np.pi * (ramp(t, TRAVERSE) - ramp(t, TRAVERSE_BACK))


def elev_at(t):
    return LAUNCH_ANGLE * (1 - ramp(t, LOWER) + ramp(t, RAISE))


def boom_at(t):
    return BOOM_STEP * (ramp(t, BOOM_OUT) - ramp(t, BOOM_IN))


def cycle_at(t, pod):
    a, b = CYCLES[pod]
    return float(np.clip((t - a) / (b - a), 0.0, 1.0))


def hoist(c):
    """Зсув пакета вздовж установки й униз протягом циклу c ∈ [0, 1]: виїхав, опустився, (заміна), піднявся, заїхав."""
    out = ramp(c, (0.00, 0.20)) - ramp(c, (0.76, 1.00))
    down = ramp(c, (0.20, 0.36)) - ramp(c, (0.56, 0.76))
    return SLIDE * out, -DROP * down


def pod_tracks(t, pod):
    """Поточні translation/scale старого (порожнього) і нового пакета та тросів."""
    c = cycle_at(t, pod)
    du, dv = hoist(c)
    spent_s = max(TINY, 1 - ramp(c, (0.36, 0.46)))
    new_s = max(TINY, ramp(c, (0.46, 0.56)))
    spent_t = (du, dv, 0.0) if c < 0.5 else (SLIDE, -DROP, 0.0)
    new_t = (du, dv, 0.0) if c >= 0.40 else (0.0, 0.0, 0.0)
    shown = 0.18 <= c <= 0.80
    length = CABLE_TOP - (POD_V1 + 0.06 + dv)
    cable_t = (POD_UC + du, CABLE_TOP, 0.0)
    cable_s = (1.0, max(length, TINY), 1.0) if shown else (TINY, TINY, TINY)
    return spent_t, spent_s, new_t, new_s, cable_t, cable_s, (du, 0.0, 0.0)


def strut_pose(t, base, u_top):
    th = elev_at(t)
    top = np.array([HX + u_top * np.cos(th), HY + u_top * np.sin(th)])
    d = top - np.array(base)
    return np.arctan2(-d[0], d[1]), float(np.hypot(*d))


def pod_node(name, pz, fresh):
    """Транспортно-пусковий пакет (спільна модель LP/C). Початок координат — середина низу пакета, щоб масштаб «виростав» із землі."""
    prims = lpc_pod(POD_U1 - POD_U0, POD_V1 - POD_V0, POD_HALF, fresh, (-LUG_U, LUG_U))
    return node(name, prims, t=(POD_UC, POD_V0, pz), s=(TINY,) * 3 if fresh else (1.0, 1.0, 1.0))


def launcher_rig(mats):
    olive, olive_dk, metal = mats["olive"], mats["olive_dk"], mats["metal"]
    # Платформа (в системі платформи: x відносно TURRET_X)
    ring = trimesh.creation.cylinder(radius=1.25, height=0.10, sections=48)
    ring.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
    ring.apply_translation([0.0, DECK_Y1 + 0.05, 0])
    cradle = [box((-1.75 - TURRET_X, 1.40, s * 1.30), (3.20, 0.20, 0.12)) for s in (-1, 1)]
    cradle += [box((x - TURRET_X, 1.40, 0.0), (0.12, 0.20, 2.60)) for x in (-3.30, -2.20, -1.20, -0.20)]
    cradle += [box((HX, HY - 0.12, s * 1.15), (0.36, 0.34, 0.26)) for s in (-1, 1)]
    cradle += [box((base[0], base[1] + 0.06, s * STRUT_Z), (0.26, 0.12, 0.30)) for _, base, *_ in STRUTS for s in (-1, 1)]
    pin = cyl_between((HX, HY, -1.32), (HX, HY, 1.32), 0.07, 16)

    # Установка (в системі установки: u, v, z)
    W2 = BOX_W / 2
    cage = [box_pose(0.0, BOX_L, 0.0, 0.06, -W2, W2), box_pose(0.0, BOX_L, BOX_T - 0.06, BOX_T, -W2, W2),
            box_pose(0.0, BOX_L, 0.0, BOX_T, -W2, -W2 + 0.04), box_pose(0.0, BOX_L, 0.0, BOX_T, W2 - 0.04, W2),
            box_pose(0.0, 0.06, 0.0, BOX_T, -W2, W2), box_pose(0.06, BOX_L, 0.06, RAIL_V - 0.04, -0.03, 0.03)]
    bands = [box_pose(u0, u0 + 0.06, -0.012, BOX_T + 0.012, -W2 - 0.012, W2 + 0.012) for u0 in (0.30, BOX_L - 0.35)]
    bands += [box_pose(0.2, BOX_L - 0.2, -0.05, 0.0, z - 0.07, z + 0.07) for z in (-1.15, -0.40, 0.40, 1.15)]
    bands += [box_pose(BOX_L - 0.04, BOX_L + 0.02, 0.0, BOX_T, -W2, -W2 + 0.08), box_pose(BOX_L - 0.04, BOX_L + 0.02, 0.0, BOX_T, W2 - 0.08, W2)]
    hatches = [box_pose(u - 0.22, u + 0.22, BOX_T, BOX_T + 0.015, z - 0.15, z + 0.15) for u in (1.2, 2.6) for z in (-0.65, 0.65)]
    hatches += [box_pose(1.6, 1.62, 0.55, 0.62, W2, W2 + 0.01), box_pose(1.6, 1.62, 0.55, 0.62, -W2 - 0.01, -W2)]
    # Дві П-подібні стійки завантажувача на даху біля відкритого торця (по одній над кожним пакетом).
    posts = []
    for pz in POD_Z:
        for dz in (-0.46, 0.46):
            posts.append(box_pose(BOX_L - 0.34, BOX_L - 0.26, BOX_T, BOX_T + 0.66, pz + dz - 0.04, pz + dz + 0.04))
            posts.append(cyl_between((BOX_L - 0.30, BOX_T + 0.40, pz + dz), (BOX_L - 0.80, BOX_T + 0.02, pz + dz), 0.025, 8))
        posts.append(box_pose(BOX_L - 0.35, BOX_L - 0.25, BOX_T + 0.60, BOX_T + 0.68, pz - 0.50, pz + 0.50))
        posts.append(box_pose(BOX_L - 0.42, BOX_L - 0.18, BOX_T, BOX_T + 0.03, pz - 0.52, pz + 0.52))
    # Висувні напрямні (дві секції), сховані під дахом: темна зовнішня рама й сріблясті внутрішні штанги з поперечкою.
    sec1, sec2, cross = [], [], []
    for pz in POD_Z:
        for dz in (-0.54, 0.54):
            sec1.append(box_pose(0.35, BOX_L - 0.06, RAIL_V, RAIL_V + 0.07, pz + dz - 0.035, pz + dz + 0.035))
        sec1.append(box_pose(BOX_L - 0.14, BOX_L - 0.06, RAIL_V, RAIL_V + 0.07, pz - 0.57, pz + 0.57))
        for dz in (-0.42, 0.42):
            sec2.append(box_pose(0.45, BOX_L - 0.10, RAIL_V + 0.005, RAIL_V + 0.065, pz + dz - 0.03, pz + dz + 0.03))
    cross.append(box_pose(BOX_L - 0.18, BOX_L - 0.10, RAIL_V - 0.01, RAIL_V + 0.07, -1.26, 1.26))
    boom_2 = node("boom_2", [(merge(sec2), metal), (merge(cross), mats["steel_dk"])])
    boom_1 = node("boom_1", [(merge(sec1), mats["steel_dk"])], children=[boom_2])
    pods = [pod_node(name, pz, fresh) for pz, pod in zip(POD_Z, ("pod_l", "pod_r"))
            for name, fresh in ((pod, False), (pod + "_new", True))]
    hoists = []
    for pz, pod in zip(POD_Z, ("pod_l", "pod_r")):
        lines = [shifted(cyl_between((0, 0, 0), (0, -1, 0), 0.012, 6), du, 0, pz + dz) for du in (-LUG_U, LUG_U) for dz in (-0.05, 0.05)]
        hooks = [box((du, -1.0, pz), (0.08, 0.05, 0.12)) for du in (-LUG_U, LUG_U)]
        hoists.append(node(pod + "_cable", [(merge(lines), metal), (merge(hooks), olive_dk)],
                           t=(POD_UC, CABLE_TOP, 0.0), s=(TINY, TINY, TINY)))
        carts = []                                                                     # візки лебідок на штангах
        for du in (-LUG_U, LUG_U):
            u = POD_UC + du
            carts.append(box_pose(u - 0.16, u + 0.16, RAIL_V - 0.03, RAIL_V + 0.04, pz - 0.40, pz + 0.40))
            carts.append(box_pose(u - 0.08, u + 0.08, RAIL_V - 0.06, RAIL_V - 0.02, pz - 0.10, pz + 0.10))
        hoists.append(node(pod + "_trolley", [(merge(carts), mats["steel_dk"])]))
    launcher = node("launcher", [(merge(cage), olive), (merge(bands), olive_dk), (merge(hatches), olive_dk), (merge(posts), olive)],
                    t=(HX, HY, 0.0), r=quat_axis((0, 0, 1), elev_at(0.0)), children=[boom_1] + pods + hoists)

    struts = []
    for name, base, u_top, lb, lr in STRUTS:
        ang, length = strut_pose(0.0, base, u_top)
        for side, z in (("l", -STRUT_Z), ("r", STRUT_Z)):
            barrel = [cyl_between((0, 0, 0), (0, lb, 0), 0.09, 14), cyl_between((0, 0, -0.10), (0, 0, 0.10), 0.06, 12)]
            rod = [cyl_between((0, 0, 0), (0, lr, 0), 0.055, 12), cyl_between((0, lr, -0.08), (0, lr, 0.08), 0.05, 12)]
            rod_node = node(f"rod_{name}_{side}", [(merge(rod), metal)], t=(0.0, length - lr, 0.0))
            struts.append(node(f"strut_{name}_{side}", [(merge(barrel), metal)], t=(base[0], base[1], z),
                               r=quat_axis((0, 0, 1), ang), children=[rod_node]))
    return node("turret", [(ring, olive_dk), (merge(cradle), olive), (pin, metal)], t=(TURRET_X, 0.0, 0.0),
                children=[launcher] + struts)


def reload_tracks():
    """Канали анімації: (вузол, властивість, значення для кожного кадру)."""
    ts = np.linspace(0.0, 1.0, SAMPLES)
    out = [("turret", "rotation", [quat_axis((0, 1, 0), yaw_at(t)) for t in ts]),
           ("launcher", "rotation", [quat_axis((0, 0, 1), elev_at(t)) for t in ts]),
           ("boom_1", "translation", [(boom_at(t), 0.0, 0.0) for t in ts]),
           ("boom_2", "translation", [(boom_at(t), 0.0, 0.0) for t in ts])]
    for pod, pz in zip(("pod_l", "pod_r"), POD_Z):
        rows = [pod_tracks(t, pod) for t in ts]
        base = np.array([POD_UC, POD_V0, pz])
        out += [(pod, "translation", [base + r[0] for r in rows]),
                (pod, "scale", [(r[1],) * 3 for r in rows]),
                (pod + "_new", "translation", [base + r[2] for r in rows]),
                (pod + "_new", "scale", [(r[3],) * 3 for r in rows]),
                (pod + "_cable", "translation", [r[4] for r in rows]),
                (pod + "_cable", "scale", [r[5] for r in rows]),
                (pod + "_trolley", "translation", [r[6] for r in rows])]
    for name, base, u_top, lb, lr in STRUTS:
        poses = [strut_pose(t, base, u_top) for t in ts]
        for side in ("l", "r"):
            out += [(f"strut_{name}_{side}", "rotation", [quat_axis((0, 0, 1), a) for a, _ in poses]),
                    (f"rod_{name}_{side}", "translation", [(0.0, length - lr, 0.0) for _, length in poses])]
    return ts * CLIP_SECONDS, out


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    parts, rig = m270()
    w = GlbWriter("EasyWAR build-m270-model.py")
    tris = 0
    for name, mesh in parts.items():
        if name in FLAT:
            mesh.unmerge_vertices()  # плоске освітлення лише для великих гранчастих корпусів без фасок
        w.add(node(name, [(mesh, mesh.visual.material)]))
        tris += len(mesh.faces)
    w.add(rig)
    times, tracks = reload_tracks()
    w.animation("reload", times, tracks)
    glb = w.glb({"title": "M270 MLRS (generated)", "generated": True,
                 "note": "Simplified procedural model from public overall dimensions (about 7 m long, 3 m wide, tracked carrier, cab with louvers, "
                         "launcher with two six-tube pods). The 'reload' clip is a schematic demonstration of pod reloading. Not a scan or copy of any other model."})
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(glb)
    print(f"{out.name}: {len(glb) / 1024:.0f} KB, {len(w.doc['nodes'])} nodes, {len(tracks)} channels, static {tris} triangles")
    return 0


if __name__ == "__main__":
    sys.exit(main())
