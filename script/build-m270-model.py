#!/usr/bin/env python3
"""Генерує спрощену процедурну модель РСЗВ M270 MLRS для довідника (src/models/m270-mlrs.glb).

    pip install numpy scipy trimesh
    python3 script/build-m270-model.py [вихідний.glb]

Модель побудовано за відкритими габаритами (довжина ≈ 7 м, ширина ≈ 3 м, висота в похідному положенні ≈ 2,6 м) і за
довідковими зображеннями, які надав користувач: гусеничне шасі M993 з шістьма здвоєними опорними котками, кабіна з похилим
лобом і жалюзі, відсік двигуна за кабіною, поворотна платформа й пускова установка з двома пакетами по шість труб. Установку
показано піднятою над кабіною (як на зображеннях), дулом уперед і вгору. Це не скан і не копія чужої моделі, сторонніх
текстур немає. Для перегляду, а не для впізнавання чи розрахунків. Одиниці — метри, перед машини дивиться в +x,
«вгору» — +y, права сторона — +z (як у glTF).
"""
import json
import struct
import sys
from pathlib import Path

import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial

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


def to_world(m):
    """Системи координат установки -> світові: поворот на LAUNCH_ANGLE навколо осі z і зсув до осі підйому."""
    m.apply_transform(trimesh.transformations.rotation_matrix(LAUNCH_ANGLE, [0, 0, 1]))
    m.apply_translation([HINGE[0], HINGE[1], 0.0])
    return m


def pose_point(u, v, z=0.0):
    c, s = np.cos(LAUNCH_ANGLE), np.sin(LAUNCH_ANGLE)
    return np.array([HINGE[0] + u * c - v * s, HINGE[1] + u * s + v * c, z])


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
                hubs.append(cyl_z((x, ROAD_Y, zc + dz + side * 0.07 * np.sign(dz) * side), 0.25, 0.02, 28))
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
            hubs.append(cyl_z((sx, sy, zc + dz), 0.36, 0.08, 32))
            for k in range(12):
                a = 2 * np.pi * k / 12
                teeth.append(box((sx + 0.40 * np.cos(a), sy + 0.40 * np.sin(a), zc + dz), (0.07, 0.08, 0.07), rot_z=a, bevel=0))
        hubs.append(cyl_z((sx, sy, zc + side * 0.18), 0.16, 0.08, 20))
        ix, iy, _ = IDLER
        for dz in (-0.12, 0.12):
            hubs.append(cyl_z((ix, iy, zc + dz), 0.36, 0.09, 32))
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

    # ---------- Поворотна платформа: кругла основа й рамна люлька ----------
    ring = trimesh.creation.cylinder(radius=1.25, height=0.10, sections=48)
    ring.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
    ring.apply_translation([-1.65, DECK_Y1 + 0.05, 0])
    parts["turntable"] = painted(ring, olive_dk)
    cradle = [box((-1.75, 1.40, s * 1.30), (3.20, 0.20, 0.12)) for s in (-1, 1)]
    cradle += [box((x, 1.40, 0.0), (0.12, 0.20, 2.60)) for x in (-3.30, -2.20, -1.20, -0.20)]
    cradle += [box((HINGE[0], HINGE[1] - 0.12, s * 1.15), (0.36, 0.34, 0.26)) for s in (-1, 1)]
    cradle += [box((x, 1.47, s * 0.95), (0.22, 0.10, 0.30)) for x in (-0.70, -2.20) for s in (-1, 1)]  # опори гідроциліндрів
    parts["platform"] = painted(merge(cradle), olive)

    # ---------- Пускова установка: корпус, бандажі, люки, торець із двома пакетами ----------
    parts["launcher"] = painted(to_world(box_pose(0.0, BOX_L, 0.0, BOX_T, -BOX_W / 2, BOX_W / 2)), olive)
    bands = [to_world(box_pose(u0, u0 + 0.06, -0.012, BOX_T + 0.012, -BOX_W / 2 - 0.012, BOX_W / 2 + 0.012)) for u0 in (0.30, BOX_L - 0.35)]
    bands += [to_world(box_pose(0.2, BOX_L - 0.2, -0.05, 0.0, z - 0.07, z + 0.07)) for z in (-1.15, -0.40, 0.40, 1.15)]   # поздовжні балки знизу
    parts["launcher_bands"] = painted(merge(bands), olive_dk)
    hatches = [to_world(box_pose(u - 0.22, u + 0.22, BOX_T, BOX_T + 0.015, z - 0.15, z + 0.15)) for u in (1.2, 2.6) for z in (-0.65, 0.65)]
    hatches += [to_world(box_pose(1.6, 1.62, 0.55, 0.62, BOX_W / 2, BOX_W / 2 + 0.01)), to_world(box_pose(1.6, 1.62, 0.55, 0.62, -BOX_W / 2 - 0.01, -BOX_W / 2))]
    parts["launcher_hatches"] = painted(merge(hatches), olive_dk)
    face_u = BOX_L
    frames, tubes, caps, booms, knuckles = [], [], [], [], []
    for pz in (-0.68, 0.68):
        frames.append(to_world(box_pose(face_u, face_u + 0.03, 0.10, 0.86, pz - 0.54, pz + 0.54)))
        for dz in (-0.33, 0.0, 0.33):
            for v in (0.30, 0.64):
                t = trimesh.creation.cylinder(radius=0.150, height=0.10, sections=28)
                t.apply_transform(trimesh.geometry.align_vectors([0, 0, 1], [1, 0, 0]))
                t.apply_translation([face_u + 0.04, v, pz + dz])
                tubes.append(to_world(t))
                c = trimesh.creation.cylinder(radius=0.125, height=0.03, sections=24)
                c.apply_transform(trimesh.geometry.align_vectors([0, 0, 1], [1, 0, 0]))
                c.apply_translation([face_u + 0.10, v, pz + dz])
                caps.append(to_world(c))
        for dz in (-0.48, 0.48):                                                      # стріли завантажувача
            booms.append(to_world(box_pose(face_u - 0.50, face_u + 0.62, BOX_T - 0.10, BOX_T + 0.02, pz + dz - 0.05, pz + dz + 0.05)))
            k = trimesh.creation.cylinder(radius=0.05, height=0.12, sections=14)
            k.apply_translation([face_u + 0.62, BOX_T - 0.04, pz + dz])
            knuckles.append(to_world(k))
        booms.append(to_world(box_pose(face_u + 0.56, face_u + 0.64, BOX_T - 0.10, BOX_T - 0.02, pz - 0.53, pz + 0.53)))
        booms.append(to_world(box_pose(face_u - 0.05, face_u + 0.02, BOX_T - 0.12, BOX_T + 0.06, pz - 0.55, pz + 0.55)))
    face = to_world(box_pose(face_u - 0.02, face_u + 0.01, 0.02, BOX_T - 0.02, -BOX_W / 2 + 0.03, BOX_W / 2 - 0.03))
    parts["muzzle_face"] = painted(face, olive_dk)
    parts["pod_frames"] = painted(merge(frames), olive_lt)
    parts["tube_mouths"] = painted(merge(tubes), olive_lt)
    parts["tube_caps"] = painted(merge(caps), olive)
    parts["handles"] = painted(merge(booms), olive_dk)
    parts["boom_knuckles"] = painted(merge(knuckles), metal)

    # ---------- Гідроциліндри підйому (Х-подібно, як на довідках) ----------
    struts = []
    for z in (-0.95, 0.95):
        for base, u_top in (((-0.70, 1.48), 1.55), ((-2.20, 1.48), 2.55)):
            top = pose_point(u_top, 0.0, z)
            b3 = np.array([base[0], base[1], z])
            struts.append(cyl_between(b3, top, 0.065))
            struts.append(cyl_between(b3, b3 + (top - b3) * 0.55, 0.09))
            struts.append(cyl_between(b3 - (0, 0, 0.10), b3 + (0, 0, 0.10), 0.06, 12))                  # палець опори
    struts.append(cyl_between((HINGE[0], HINGE[1], -1.32), (HINGE[0], HINGE[1], 1.32), 0.07, 16))      # вісь підйому
    parts["struts"] = painted(merge(struts), metal)

    # ---------- Корма: ліхтарі ----------
    parts["rear_lamps"] = painted(merge([box((X_REAR - 0.02, 0.98, s * 1.05), (0.04, 0.10, 0.16)) for s in (-1, 1)]),
                                  material("Red", (170, 36, 30), metallic=0.0, roughness=0.3))
    return parts


def with_extras(glb: bytes, extras: dict) -> bytes:
    json_len, _ = struct.unpack("<I4s", glb[12:20])
    doc = json.loads(glb[20:20 + json_len])
    doc["asset"]["extras"] = extras
    raw = json.dumps(doc, separators=(",", ":")).encode()
    raw += b" " * (-len(raw) % 4)
    rest = glb[20 + json_len:]
    total = 12 + 8 + len(raw) + len(rest)
    return glb[:8] + struct.pack("<I", total) + struct.pack("<I4s", len(raw), b"JSON") + raw + rest


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    scene = trimesh.Scene()
    for name, mesh in m270().items():
        if name in FLAT:
            mesh.unmerge_vertices()  # плоске освітлення лише для великих гранчастих корпусів без фасок
        scene.add_geometry(mesh, node_name=name, geom_name=name)
    glb = scene.export(file_type="glb", include_normals=True)
    glb = with_extras(glb, {"title": "M270 MLRS (generated)", "generated": True,
                            "note": "Simplified procedural model from public overall dimensions (about 7 m long, 3 m wide, tracked carrier, cab with louvers, raised launcher with two six-tube pods). Not a scan or copy of any other model."})
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(glb)
    size = np.ptp(np.array(scene.bounds), axis=0)
    print(f"{out.name}: {len(glb) / 1024:.0f} KB, {sum(len(m.faces) for m in scene.geometry.values())} triangles, extent {size[0]:.2f} x {size[1]:.2f} x {size[2]:.2f} m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
