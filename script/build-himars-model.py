#!/usr/bin/env python3
"""Генерує процедурну модель РСЗВ M142 HIMARS для довідника (src/models/m142-himars.glb).

    pip install numpy scipy trimesh pillow xatlas   # текстури: script/glb_bake.py, paint_lib.py, vehicle_paint.py
    # EW_FAST=1 — напіврозрізнення для швидкої перевірки; EW_BAKE_CACHE=<тека> — кеш запікань (перед випуском чистити)
    python3 script/build-himars-model.py [вихідний.glb]

Розміри й силует зняті з бокової ортографічної проєкції на довідкових зображеннях, які надав користувач (≈229 пікселів
на метр), і узгоджені з відкритими габаритами (довжина ≈ 7,2 м з бамперами, ширина ≈ 2,4 м). Модель повторює вузли з
довідок: шасі 6×6 родини FMTV з клепаними лонжеронами, броньовану кабіну з похилим лобом, двома вітровими шибами,
ґратою, круглою кришкою, болтами броні, дзеркалами на кронштейнах і бампером із V-вирізом; ящики, бак і вихлоп за
кабіною; арку завантажувача; пусковий модуль із клепаними бортами й дверцятами, пакетом із шести труб, що дивиться
назад, сріблястими штангами й рамою завантажувача зверху; корму з ліхтарями й фаркопом. Кадр 0 — бойове положення (модуль розвернуто
дулами вперед і піднято); кліп анімації «reload» за фото заряджання показує, як модуль опускається, повертається на
180° дулами назад, висувна U-подібна рама виносить порожній пакет за корму, опускає його й затягує новий, а модуль
повертається в бойове положення. Це не скан і не копія чужої
моделі, сторонніх текстур немає. Для перегляду, а не для впізнавання чи розрахунків. Одиниці — метри, перед машини
дивиться в +x, «вгору» — +y, права сторона — +z (як у glTF).
"""
import os
import sys
from pathlib import Path

import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial

from glb_bake import BakeSpec, TileSpec
from glb_rig import GlbWriter, lpc_pod, node, quat_axis, ramp
import vehicle_paint as vp

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "src" / "models" / "m142-himars.glb"

# Ребра мають фаски, тож згладжені нормалі дають м'які відблиски; плоскі нормалі лише для гранчастої оболонки кабіни.
FLAT = {"cab", "module", "module_doors", "lids", "doors", "bumper", "loader_frame"}

def material(name, rgb, metallic=0.08, roughness=0.75):
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


def box(center, extents, rot_z=0.0):
    m = bevelled(extents)
    if rot_z:
        m.apply_transform(trimesh.transformations.rotation_matrix(rot_z, [0, 0, 1]))
    m.apply_translation(center)
    return m


def cyl_z(center, radius, width, sections=24):
    m = trimesh.creation.cylinder(radius=radius, height=width, sections=sections)
    m.apply_translation(center)
    return m


def cyl_between(a, b, radius, sections=12):
    a, b = np.array(a, float), np.array(b, float)
    d = b - a
    m = trimesh.creation.cylinder(radius=radius, height=np.linalg.norm(d), sections=sections)
    m.apply_transform(trimesh.geometry.align_vectors([0, 0, 1], d / np.linalg.norm(d)))
    m.apply_translation((a + b) / 2)
    return m


def cyl_x(x0, x1, y, z, radius, sections=20):
    return cyl_between((x0, y, z), (x1, y, z), radius, sections)


def hull(points):
    return trimesh.convex.convex_hull(np.array(points, dtype=float))


def prism_plan(plan_xz, y0, y1):
    """Опукла призма: план (x, z) витягнуто від y0 до y1."""
    return hull([(x, y, z) for (x, z) in plan_xz for y in (y0, y1)])


# --- головні розміри, м (з бокової проєкції: x = 3,60 − (1745 − px)/229, y = (852 − py)/229) -------------------------
AXLES = [2.31, -1.18, -2.47]          # передня вісь і задній тандем
WHEEL_R, WHEEL_Y, WHEEL_Z, WHEEL_W = 0.53, 0.53, 0.99, 0.40
CAB_FRONT, CAB_REAR = 3.50, 1.68
MOD = dict(x0=-3.50, x1=0.24, y0=1.33, y1=2.33, half=1.19, inner=0.60)
POD = dict(x0=-3.28, x1=-0.05, y0=1.50, y1=2.18, half=0.47)


def rivet(x, y, z, axis, r=0.011, h=0.012):
    """Заклепка на поверхні, звернена вздовж осі `axis` (+-1, 0, 0), (0, 0, +-1) тощо."""
    a = np.array(axis, float)
    p = np.array((x, y, z), float)
    u = np.array([0.0, 1.0, 0.0]) if abs(a[1]) < 0.5 else np.array([1.0, 0.0, 0.0])
    v = np.cross(a, u)
    base = [p + r * (np.cos(k * np.pi / 2) * u + np.sin(k * np.pi / 2) * v) for k in range(4)]
    verts = np.array(base + [p + a * h])
    faces = [[k, (k + 1) % 4, 4] for k in range(4)]
    m = trimesh.Trimesh(verts, faces, process=False)
    if np.dot(m.face_normals[0], a) < 0:    # грані назовні
        m.invert()
    return m  # пірамідка з 4 граней: на відстані перегляду не відрізнити від круглої головки


def tyre(x, z):
    """Шина з закругленими плечима й ялинковим протектором (два ряди скошених грунтозачепів)."""
    r_in, r_out, w = 0.30, WHEEL_R - 0.03, WHEEL_W / 2
    profile = [(r_in, -w + 0.01), (r_out - 0.06, -w), (r_out - 0.015, -w + 0.04), (r_out, -w + 0.09),
               (r_out, w - 0.09), (r_out - 0.015, w - 0.04), (r_out - 0.06, w), (r_in, w - 0.01)]
    ring = trimesh.creation.revolve(np.array(profile, dtype=float), sections=48)
    ring.apply_translation((x, WHEEL_Y, z))
    lugs = []
    n = 26
    for k in range(n):
        a = 2 * np.pi * k / n
        for side in (-1, 1):
            aa = a + (np.pi / n if side > 0 else 0.0)
            lug = trimesh.creation.box(extents=[0.09, 0.034, 0.17])
            lug.apply_transform(trimesh.transformations.rotation_matrix(side * 0.45, [0, 1, 0]))  # «ялинка»
            lug.apply_transform(trimesh.transformations.rotation_matrix(aa + np.pi / 2, [0, 0, 1]))
            r = r_out + 0.012
            lug.apply_translation((x + r * np.cos(aa), WHEEL_Y + r * np.sin(aa), z + side * 0.092))
            lugs.append(lug)
    return ring, merge(lugs)


def wheel_rim(x, s):
    """Глибокий обід: тарілка, кільце з 20 болтів, маточина з шестигранником."""
    face = s * (WHEEL_Z + 0.17)
    rim, bolts = [], []
    rim.append(cyl_z((x, WHEEL_Y, s * (WHEEL_Z + 0.04)), 0.31, 0.24, 36))
    rim.append(cyl_z((x, WHEEL_Y, face), 0.26, 0.03, 36))
    rim.append(cyl_z((x, WHEEL_Y, face + s * 0.025), 0.12, 0.04, 24))
    for k in range(20):
        a = 2 * np.pi * k / 20
        bolts.append(cyl_z((x + 0.19 * np.cos(a), WHEEL_Y + 0.19 * np.sin(a), face + s * 0.02), 0.016, 0.03, 5))
    for k in range(8):
        a = 2 * np.pi * k / 8
        bolts.append(cyl_z((x + 0.085 * np.cos(a), WHEEL_Y + 0.085 * np.sin(a), face + s * 0.05), 0.011, 0.02, 6))
    bolts.append(cyl_z((x, WHEEL_Y, face + s * 0.06), 0.045, 0.05, 6))
    return rim, bolts


def on_slope(p0, p1, t, offset, extents, z):
    """Пластина на похилій площині лобового скла: p0→p1 у площині (x, y), t — частка довжини, offset — назовні."""
    p0, p1 = np.array(p0, float), np.array(p1, float)
    d = p1 - p0
    L = np.linalg.norm(d)
    d /= L
    n = np.array([d[1], -d[0]])          # зовнішня нормаль (уперед-угору)
    c = p0 + d * (t * L) + n * offset
    return box((c[0], c[1], z), extents, rot_z=np.arctan2(d[1], d[0]))


def himars():
    olive = material("Hull", (104, 106, 86), metallic=0.1, roughness=0.72)
    olive_dk = material("HullDark", (82, 84, 68), metallic=0.12, roughness=0.78)
    olive_lt = material("Pod", (118, 120, 98), metallic=0.1, roughness=0.7)
    grime = material("Chassis", (70, 70, 58), metallic=0.15, roughness=0.85)
    rubber = material("Tyres", (66, 58, 50), metallic=0.0, roughness=0.95)
    black = material("Black", (30, 31, 29), metallic=0.1, roughness=0.6)
    glass = material("Glass", (118, 112, 102), metallic=0.55, roughness=0.12)
    amber = material("Amber", (236, 140, 30), metallic=0.0, roughness=0.3)
    white = material("Lamp", (236, 236, 226), metallic=0.3, roughness=0.15)
    red = material("Red", (170, 36, 30), metallic=0.0, roughness=0.3)
    steel = material("Steel", (176, 180, 178), metallic=0.85, roughness=0.22)
    parts = {}
    rivets = []

    # ---------- Рама: лонжерони, клепані бічні листи, мости, ресори ----------
    frame = [box((-0.10, 1.00, s * 0.43), (6.90, 0.26, 0.10)) for s in (-1, 1)]
    frame += [box((x, 1.00, 0.0), (0.10, 0.20, 0.86)) for x in (-3.35, -2.0, -0.6, 0.9, 2.9)]
    frame += [box((-1.60, 1.17, s * 0.60), (3.80, 0.20, 0.06)) for s in (-1, 1)]       # підрамник модуля
    for s in (-1, 1):
        for x in np.arange(-3.40, 0.25, 0.115):
            for y in (1.10, 1.24):
                rivets.append(rivet(x, y, s * 0.63, (0, 0, s)))
        for xc in (-2.55, -1.15, 0.0):                                                    # групи заклепок на накладках
            for x in (xc - 0.06, xc, xc + 0.06):
                for y in (1.12, 1.17, 1.22):
                    rivets.append(rivet(x, y, s * 0.635, (0, 0, s)))
    parts["frame"] = painted(merge(frame), grime)
    axle = []
    for x in AXLES:
        axle.append(cyl_between((x, WHEEL_Y, -WHEEL_Z + 0.12), (x, WHEEL_Y, WHEEL_Z - 0.12), 0.085, 16))
        axle.append(box((x, 0.56, 0.0), (0.42, 0.30, 0.40)))                               # редуктор моста
        for s in (-1, 1):
            axle.append(box((x, 0.80, s * 0.43), (0.95 if x < 0 else 0.80, 0.07, 0.10)))   # ресора
    axle.append(cyl_between((-1.18, 0.56, 0.0), (2.31, 0.62, 0.0), 0.05, 12))             # карданний вал
    axle.append(cyl_between((-2.47, 0.56, 0.0), (-1.18, 0.56, 0.0), 0.05, 12))
    parts["axles"] = painted(merge(axle), grime)

    # ---------- Колеса ----------
    tyres, rims, bolts = [], [], []
    for x in AXLES:
        for s in (-1, 1):
            ring, lug = tyre(x, s * WHEEL_Z)
            tyres += [ring, lug]
            r, b = wheel_rim(x, s)
            rims += r
            bolts += b
    parts["tyres"] = painted(merge(tyres), rubber)
    parts["rims"] = painted(merge(rims), olive)
    parts["wheel_bolts"] = painted(merge(bolts), olive_dk)

    # ---------- Кабіна: опукла гранчаста оболонка ----------
    # Рівні (y, лоб x, зад x, півширина, скіс кутів спереду).
    levels = [(1.10, 3.38, 1.78, 1.08, 0.22), (1.48, CAB_FRONT, CAB_REAR, 1.18, 0.30), (2.18, CAB_FRONT, CAB_REAR, 1.18, 0.30),
              (2.58, 3.12, 1.72, 1.13, 0.30), (2.66, 3.04, 1.80, 1.07, 0.26)]
    pts = []
    for y, xf, xr, half, c in levels:
        c2 = 0.10
        pts += [(xf - c, y, -half), (xf, y, -(half - c)), (xf, y, half - c), (xf - c, y, half),
                (xr + c2, y, half), (xr, y, half - c2), (xr, y, -(half - c2)), (xr + c2, y, -half)]
    parts["cab"] = painted(hull(pts), olive)
    slope = ((CAB_FRONT, 2.18), (3.12, 2.58))
    parts["windshields"] = painted(merge([on_slope(*slope, 0.48, 0.012, (0.40, 0.025, 0.72), z) for z in (-0.47, 0.47)]), glass)
    parts["windshield_frames"] = painted(merge([on_slope(*slope, 0.48, 0.004, (0.48, 0.02, 0.80), z) for z in (-0.47, 0.47)]), olive_dk)
    wipers = []
    for z in (-0.47, 0.47):
        a = np.array(slope[0]) + (np.array(slope[1]) - np.array(slope[0])) * 0.2
        b = np.array(slope[0]) + (np.array(slope[1]) - np.array(slope[0])) * 0.62
        wipers.append(cyl_between((a[0] + 0.03, a[1], z + 0.30), (b[0] + 0.03, b[1], z - 0.25), 0.008, 6))
    parts["wipers"] = painted(merge(wipers), black)
    # Ґрата радіатора (рамка з перегородками), кругла кришка, болти броні на лобі й бортах.
    grille = [box((CAB_FRONT + 0.010, 1.73, -0.10), (0.03, 0.46, 0.86))]
    parts["grille_back"] = painted(merge(grille), black)
    gbars = [box((CAB_FRONT + 0.03, 1.73, -0.10 + k * 0.215), (0.04, 0.46, 0.035)) for k in (-2, -1, 0, 1, 2)]
    gbars += [box((CAB_FRONT + 0.03, 1.73 + k * 0.115, -0.10), (0.04, 0.035, 0.86)) for k in (-2, -1, 0, 1, 2)]
    gbars += [box((CAB_FRONT + 0.05, 1.40 + k * 0.045, -0.10), (0.03, 0.018, 0.80)) for k in range(4)]   # нижні ламелі
    parts["grille"] = painted(merge(gbars), olive_dk)
    parts["round_cover"] = painted(merge([cyl_between((CAB_FRONT, 1.80, 0.70), (CAB_FRONT + 0.035, 1.80, 0.70), 0.14, 28),
                                          cyl_between((CAB_FRONT + 0.03, 1.80, 0.70), (CAB_FRONT + 0.05, 1.80, 0.70), 0.11, 28)]), olive_dk)
    armour = []
    for z in (-0.95, -0.55, 0.0, 0.55, 0.95):
        for y in (1.25, 2.08):
            armour.append(cyl_between((CAB_FRONT, y, z * 0.92), (CAB_FRONT + 0.025, y, z * 0.92), 0.032, 10))
    for y in (1.45, 1.95):
        for z in (-0.82, 0.38):
            armour.append(cyl_between((CAB_FRONT, y, z), (CAB_FRONT + 0.025, y, z), 0.032, 10))
    for s in (-1, 1):
        for x in (1.85, 2.15, 3.20):
            for y in (1.25, 1.75, 2.30):
                armour.append(cyl_between((x, y, s * 1.18), (x, y, s * 1.205), 0.032, 10))
    parts["armour_bolts"] = painted(merge(armour), olive_dk)
    # Двері з вікном, ручками й завісами; дах із люком і лампами.
    doors, door_glass, handles = [], [], []
    for s in (-1, 1):
        doors.append(hull([(2.30, 1.22, s * 1.19), (3.28, 1.22, s * 1.19), (3.28, 2.40, s * 1.19), (2.55, 2.50, s * 1.19),
                           (2.30, 2.50, s * 1.19), (2.30, 1.22, s * 1.205), (3.28, 1.22, s * 1.205), (3.28, 2.40, s * 1.205),
                           (2.55, 2.50, s * 1.205), (2.30, 2.50, s * 1.205)]))
        door_glass.append(box((2.86, 2.10, s * 1.21), (0.24, 0.20, 0.02)))
        handles += [box((2.42, 1.88, s * 1.225), (0.14, 0.04, 0.04)), box((3.18, 1.75, s * 1.225), (0.05, 0.30, 0.04)),
                    box((2.42, 2.25, s * 1.225), (0.05, 0.14, 0.04))]
        for y in (1.40, 2.25):
            handles.append(cyl_between((3.30, y - 0.08, s * 1.21), (3.30, y + 0.08, s * 1.21), 0.022, 8))   # завіси
    parts["doors"] = painted(merge(doors), olive)
    parts["side_windows"] = painted(merge(door_glass), glass)
    parts["door_handles"] = painted(merge(handles), olive_dk)
    parts["roof_hatch"] = painted(merge([box((2.32, 2.69, 0.0), (0.92, 0.05, 0.92)), box((2.32, 2.73, 0.0), (0.74, 0.04, 0.74)),
                                         box((2.32, 2.76, 0.0), (0.10, 0.03, 0.55))]), olive_dk)
    parts["roof_lamps"] = painted(merge([box((3.02, 2.69, z), (0.08, 0.06, 0.12)) for z in (-0.95, -0.18, 0.0, 0.18, 0.95)]), amber)
    # Дзеркала на трубчастих кронштейнах і поручні.
    mirrors, arms = [], []
    for s in (-1, 1):
        mirrors.append(box((3.30, 2.28, s * 1.46), (0.06, 0.44, 0.20)))
        arms += [cyl_between((3.30, 2.02, s * 1.46), (3.30, 2.58, s * 1.46), 0.016, 8),
                 cyl_between((3.30, 2.58, s * 1.46), (3.30, 2.58, s * 1.16), 0.016, 8),
                 cyl_between((3.30, 2.02, s * 1.46), (3.30, 2.02, s * 1.16), 0.016, 8),
                 cyl_between((2.40, 2.60, s * 1.17), (3.10, 2.60, s * 1.17), 0.014, 8)]
    parts["mirrors"] = painted(merge(mirrors), black)
    parts["mirror_arms"] = painted(merge(arms), olive_dk)

    # ---------- Бампер із V-вирізом, фари, буксирні скоби, нижня решітка, сходинки ----------
    bump = [box((CAB_FRONT + 0.12, 1.06, s * 0.78), (0.24, 0.22, 0.84)) for s in (-1, 1)]
    bump.append(hull([(CAB_FRONT, 0.96, -0.36), (CAB_FRONT + 0.24, 0.98, -0.36), (CAB_FRONT + 0.24, 1.17, -0.36),
                      (CAB_FRONT, 1.17, -0.36), (CAB_FRONT, 0.96, 0.36), (CAB_FRONT + 0.24, 0.98, 0.36),
                      (CAB_FRONT + 0.24, 1.17, 0.36), (CAB_FRONT, 1.17, 0.36), (CAB_FRONT + 0.24, 0.90, 0.0), (CAB_FRONT, 0.90, 0.0)]))
    bump.append(box((CAB_FRONT - 0.05, 0.82, 0.0), (0.30, 0.22, 1.10)))
    bump += [box((CAB_FRONT - 0.10, 0.88, s * 1.05), (0.36, 0.40, 0.05)) for s in (-1, 1)]
    parts["bumper"] = painted(merge(bump), olive)
    parts["lamps"] = painted(merge([cyl_between((CAB_FRONT + 0.24, 1.07, z), (CAB_FRONT + 0.29, 1.07, z), 0.075, 20) for z in (-0.70, 0.70)]), white)
    parts["lamps_amber"] = painted(merge([cyl_between((CAB_FRONT + 0.24, 1.07, z), (CAB_FRONT + 0.28, 1.07, z), 0.055, 16) for z in (-0.98, 0.98)]
                                         + [box((CAB_FRONT + 0.02, 1.29, s * 1.21), (0.06, 0.06, 0.10)) for s in (-1, 1)]), amber)
    parts["lamp_rings"] = painted(merge([cyl_between((CAB_FRONT + 0.23, 1.07, z), (CAB_FRONT + 0.27, 1.07, z), 0.09, 20) for z in (-0.70, 0.70)]), black)
    hooks = []
    for z in (-0.30, 0.30):
        t = trimesh.creation.torus(major_radius=0.055, minor_radius=0.016, major_sections=16, minor_sections=8) \
            if hasattr(trimesh.creation, "torus") else cyl_z((0, 0, 0), 0.06, 0.03)
        t.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0]))
        t.apply_translation((CAB_FRONT + 0.27, 1.02, z))
        hooks.append(t)
    parts["tow_hooks"] = painted(merge(hooks), olive_dk)
    vent = [box((CAB_FRONT + 0.11, 0.76 + k * 0.04, 0.0), (0.03, 0.016, 0.95)) for k in range(4)]
    for s in (-1, 1):                                            # сходинки під дверима
        for k in range(3):
            vent.append(box((3.15, 0.66 + k * 0.16, s * 1.10), (0.24, 0.025, 0.16)))
    parts["vents_steps"] = painted(merge(vent), black)

    # ---------- За кабіною: ящики, бак, акумуляторний ящик, вихлоп, арка завантажувача ----------
    eq = []
    for s in (-1, 1):
        eq.append(box((1.46, 1.64, s * 0.90), (0.48, 1.13, 0.52)))           # високий ящик
        eq.append(box((0.88, 1.66, s * 0.88), (0.66, 0.63, 0.48)))           # середній ящик
        eq.append(box((-0.04, 0.92, s * 0.95), (0.99, 0.50, 0.46)))          # акумуляторний ящик
    parts["equipment"] = painted(merge(eq), olive)
    lids = []
    for s in (-1, 1):
        lids += [box((1.46, 1.70, s * 1.165), (0.38, 0.90, 0.02)), box((0.88, 1.66, s * 1.13), (0.54, 0.52, 0.02)),
                 box((1.36, 1.70, s * 1.18), (0.03, 0.10, 0.02)), box((0.70, 1.66, s * 1.145), (0.03, 0.10, 0.02))]
    parts["lids"] = painted(merge(lids), olive_dk)
    tank = bevelled([1.03, 0.37, 0.42], 0.09)
    tank.apply_translation((1.15, 0.85, -0.92))
    tank2 = bevelled([1.03, 0.37, 0.42], 0.09)
    tank2.apply_translation((1.15, 0.85, 0.92))
    parts["fuel_tanks"] = painted(merge([tank, tank2, cyl_between((1.45, 1.03, -0.92), (1.45, 1.07, -0.92), 0.06, 12)]), olive_dk)
    parts["exhaust"] = painted(merge([cyl_between((1.30, 2.10, 0.70), (1.30, 2.45, 0.70), 0.07, 16),
                                      cyl_between((1.30, 2.45, 0.70), (1.30, 2.50, 0.70), 0.085, 16)]), grime)
    arch = [box((0.96, 1.92, s * 0.78), (0.10, 1.24, 0.14)) for s in (-1, 1)]
    arch.append(box((0.96, 2.50, 0.0), (0.12, 0.12, 1.70)))
    arch += [box((0.90, 2.40, s * 0.55), (0.18, 0.18, 0.14)) for s in (-1, 1)]
    parts["loader_arch"] = painted(merge(arch), olive)

    # ---------- Поворотна платформа й пусковий модуль ----------
    M = MOD
    cradle = [box(((M["x0"] + M["x1"]) / 2, 1.29, 0.0), (M["x1"] - M["x0"] - 0.1, 0.08, 1.90))]
    cradle += [box((x, 1.24, s * 0.80), (0.20, 0.12, 0.18)) for x in (-3.20, -1.60, 0.0) for s in (-1, 1)]
    cradle.append(cyl_between((-1.50, 1.27, 0.0), (-1.50, 1.33, 0.0), 0.95, 40))
    turret_parts = {"cradle": painted(merge(cradle), olive_dk)}
    mod, mod_rivets = {}, []
    walls = []
    for s in (-1, 1):
        plan = [(M["x0"], s * M["inner"]), (M["x0"], s * M["half"]), (-0.28, s * M["half"]), (M["x1"], s * 0.92), (M["x1"], s * M["inner"])]
        walls.append(prism_plan(plan, M["y0"], M["y1"]))
    walls.append(box((M["x1"] - 0.06, 1.70, 0.0), (0.12, 0.74, 1.26)))            # передня стінка
    walls.append(box(((M["x0"] + M["x1"]) / 2, M["y0"] + 0.08, 0.0), (M["x1"] - M["x0"], 0.16, 1.26)))
    mod["module"] = painted(merge(walls), olive)
    panels, knobs = [], []
    for s in (-1, 1):
        zf = s * (M["half"] + 0.008)
        for x0, x1 in ((-2.45, -1.57), (-1.48, -0.75), (-0.66, -0.30)):
            panels.append(box(((x0 + x1) / 2, 1.98, zf), (x1 - x0, 0.56, 0.016)))
            knobs.append(box((x1 - 0.06, 2.00, s * (M["half"] + 0.025)), (0.025, 0.08, 0.025)))
        panels.append(box((-3.00, 1.98, zf), (0.85, 0.56, 0.016)))
        for x in np.arange(M["x0"] + 0.06, -0.30, 0.10):                            # ряди заклепок
            for y in (M["y0"] + 0.04, 1.63, M["y1"] - 0.04):
                mod_rivets.append(rivet(x, y, s * (M["half"] + 0.002), (0, 0, s)))
        for xc in (-3.45, -2.50, -1.52, -0.70):
            for y in np.arange(1.40, 2.30, 0.09):
                mod_rivets.append(rivet(xc, y, s * (M["half"] + 0.002), (0, 0, s)))
        for x in np.arange(M["x0"] + 0.1, -0.3, 0.16):                              # заклепки на кришці борту
            mod_rivets.append(rivet(x, M["y1"], s * (M["half"] - 0.06), (0, 1, 0)))
            mod_rivets.append(rivet(x, M["y1"], s * (M["inner"] + 0.06), (0, 1, 0)))
    mod["module_doors"] = painted(merge(panels), olive)
    mod["module_handles"] = painted(merge(knobs), black)
    # Задній торець: плоский зріз корпусу (як на фото) і нижня поперечина; виступних «вух» на кутах немає.
    rear = [box((M["x0"] + 0.04, 1.42, 0.0), (0.12, 0.16, 1.26))]
    mod["module_rear"] = painted(merge(rear), olive)
    # Зверху: нерухома основа рами завантажувача (штанги, поперечки, барабан лебідки). Висувна рама, візок, троси й
    # пакети — рухомі вузли, див. loader_rig().
    top = [box((-1.50, 2.40, s * 0.36), (2.80, 0.07, 0.07)) for s in (-1, 1)]
    top += [box((x, 2.40, 0.0), (0.07, 0.07, 0.72)) for x in (-2.85, -2.2, -1.5, -0.8, -0.15)]
    top.append(cyl_between((-0.78, 2.47, -0.12), (-0.78, 2.47, 0.12), 0.07, 16))
    mod["loader_frame"] = painted(merge(top), olive_dk)
    mod["module_rails"] = painted(merge([cyl_x(-3.30, 0.20, 2.28, s * 0.54, 0.040, 16) for s in (-1, 1)]), steel)
    mod["module_rivets"] = painted(merge(mod_rivets), olive_dk)
    # Опори-ложементи на арці, на які модуль лягає в похідному положенні.
    parts["rails"] = painted(merge([cyl_x(0.40, 0.95, 2.14, s * 0.28, 0.055, 16) for s in (-1, 1)]), steel)

    # ---------- Корма: балка, ліхтарі, фаркоп, кронштейни ----------
    stern = [box((-3.50, 1.06, 0.0), (0.16, 0.20, 2.10)), box((-3.38, 0.70, 0.0), (0.10, 0.08, 1.80))]
    stern += [box((-3.42, 0.86, s * 0.85), (0.06, 0.36, 0.06)) for s in (-1, 1)]
    stern += [box((-3.60, 1.07, s * 0.86), (0.06, 0.22, 0.36)) for s in (-1, 1)]
    parts["rear_beam"] = painted(merge(stern), grime)
    lights = []
    for s in (-1, 1):
        lights.append(cyl_between((-3.63, 1.10, s * 0.96), (-3.66, 1.10, s * 0.96), 0.055, 16))
        lights.append(cyl_between((-3.63, 1.10, s * 0.76), (-3.66, 1.10, s * 0.76), 0.045, 16))
        lights.append(box((-3.535, 1.14, s * 0.45), (0.02, 0.05, 0.16)))
    parts["rear_red"] = painted(merge(lights), red)
    parts["rear_amber"] = painted(merge([cyl_between((-3.63, 0.99, s * 0.96), (-3.66, 0.99, s * 0.96), 0.035, 12) for s in (-1, 1)]
                                        + [box((-3.30, 1.10, s * 1.18), (0.08, 0.06, 0.04)) for s in (-1, 1)]), amber)
    parts["hitch"] = painted(merge([cyl_between((-3.58, 0.98, 0.0), (-3.82, 0.98, 0.0), 0.05, 12),
                                    cyl_z((-3.80, 0.98, 0.0), 0.07, 0.04, 16)]), black)

    parts["rivets"] = painted(merge(rivets), olive_dk)
    return parts, launcher_rig(turret_parts, mod)


# Групи нерухомих частин для запікання (id = номер у списку) і їхні рецепти.
CAMO = os.environ.get("HIMARS_CAMO", "0") == "1"
OL = vp.R("camo", 0.72, 0.1)
OL_DK = vp.R("camo", 0.72, 0.12, tone=0.8)
CHASSIS_NAMES = ["frame", "axles", "rear_beam", "rear_red", "rear_amber", "hitch", "tow_hooks", "vents_steps", "fuel_tanks", "exhaust",
                 "equipment", "lids", "loader_arch", "rails", "rivets"]
CHASSIS_RECIPES = {"frame": vp.R((56, 56, 46), 0.82, 0.3), "axles": vp.R((50, 50, 42), 0.8, 0.4), "rear_beam": vp.R((54, 54, 44), 0.8, 0.35),
                   "rear_red": vp.LENS_R, "rear_amber": vp.LENS_A, "hitch": vp.R((38, 38, 36), 0.5, 0.8), "tow_hooks": vp.R((60, 62, 46), 0.6, 0.4),
                   "vents_steps": vp.BLACK, "fuel_tanks": vp.R((60, 64, 46), 0.7, 0.2), "exhaust": vp.R((74, 62, 50), 0.6, 0.5),
                   "equipment": OL, "lids": vp.R("camo", 0.72, 0.12, tone=0.85), "loader_arch": vp.R("camo", 0.7, 0.15, tone=0.9),
                   "rails": vp.STEEL, "rivets": vp.R("camo", 0.7, 0.2, tone=0.75)}
CAB_NAMES = ["cab", "windshields", "windshield_frames", "wipers", "grille_back", "grille", "round_cover", "armour_bolts", "doors", "side_windows",
             "door_handles", "roof_hatch", "roof_lamps", "mirrors", "mirror_arms", "bumper", "lamps", "lamps_amber", "lamp_rings"]
CAB_RECIPES = {"cab": OL, "windshields": vp.GLASS, "windshield_frames": OL_DK, "wipers": vp.BLACK, "grille_back": vp.BLACK,
               "grille": vp.R("camo", 0.7, 0.2, tone=0.75), "round_cover": OL, "armour_bolts": vp.R("camo", 0.65, 0.3, tone=0.7), "doors": OL,
               "side_windows": vp.GLASS, "door_handles": vp.R("camo", 0.6, 0.3, tone=0.7), "roof_hatch": vp.R("camo", 0.7, 0.12, tone=0.9),
               "roof_lamps": vp.LENS_A, "mirrors": vp.BLACK, "mirror_arms": OL_DK, "bumper": vp.R("camo", 0.7, 0.2, tone=0.85),
               "lamps": vp.LENS_W, "lamps_amber": vp.LENS_A, "lamp_rings": vp.BLACK}
TILES = {"tyres": TileSpec("rubber", (36, 34, 31), 0.4, 1.0, 1.0), "rims": TileSpec("cast", (70, 74, 56), 0.5, 1.0, 1.0),
         "wheel_bolts": TileSpec("steel", (95, 97, 92), 0.3, 1.0, 1.0)}


def group_nodes(parts):
    nodes = []
    for gname, names, recipes in (("chassis", CHASSIS_NAMES, CHASSIS_RECIPES), ("cab", CAB_NAMES, CAB_RECIPES)):
        meshes, ids = [], []
        for i, nme in enumerate(names):
            m = parts.pop(nme)
            meshes.append(m)
            ids.append(np.full(len(m.faces), i, np.int16))
        painter = vp.group_painter(names, recipes, camo=CAMO, seed=21 if gname == "chassis" else 23, olive=OLIVE_RGB,
                                   weather=dict(mud=0.65 if gname == "chassis" else 0.4, dust=0.5),
                                   seams=("cab", "doors", "equipment", "bumper") if gname == "cab" else ("equipment",),
                                   post=vp.post_himars_cab if gname == "cab" else vp.post_himars_chassis)
        nodes.append(node(gname, [(merge(meshes), BakeSpec(painter, res=2048, ids=np.concatenate(ids), key=f"himars-{gname}-{CAMO}", seed=21))]))
    for nme, spec in TILES.items():
        nodes.append(node(nme, [(parts.pop(nme), spec)]))
    return nodes


OLIVE_RGB = (84, 90, 62)


# --- рухома частина ---------------------------------------------------------------------------------------------
# Вузли: turret (поворот навколо вертикалі) → module (підйом навколо осі HINGE) → рама завантажувача, візок, пакети;
# гідроциліндри підйому — діти turret. Кадр 0 — бойове положення: модуль розвернуто на 180° (дулами вперед) і піднято.
# Заряджання за фото: модуль опускається, повертається на 180° назад (у похідне положення, дулами до корми), U-подібна
# рама виносить пакет за корму, міняє його, і модуль повертається в бойове положення.
TURRET = np.array([-1.50, 0.0, 0.0])     # вісь поворотної платформи
HINGE = np.array([0.12, 1.36, 0.0])      # вісь підйому модуля (передній нижній край у похідному положенні)
HM = HINGE - TURRET                      # вісь підйому в системі платформи
ELEV = -np.radians(45)                   # бойовий кут: задній (дульний) торець модуля піднято
POD_X0, POD_X1, POD_Y0, POD_Y1, POD_HALF = -3.28, -0.05, 1.49, 2.19, 0.50
POD_XC = (POD_X0 + POD_X1) / 2
POD_LUGS = (-0.40, 0.40)
SLIDE = 3.80                             # на скільки рама виносить пакет назад (щоб він минув ліхтарі й фаркоп)
BOOM_Y = 2.52
SPREADER_Y = POD_Y1 + 0.10               # низ траверси, що чіпляє вушка пакета
# Гідроциліндри: (назва, основа у світових координатах похідного положення (x, y), відстань кріплення від осі підйому,
# довжина циліндра, штока)
STRUTS = [("a", (-2.60, 1.30), 1.20, 1.10, 1.00)]
STRUT_Z = 0.45
CLIP_SECONDS = 28.0
SAMPLES = 281
TINY = 1e-4
LOWER, TURN = (0.00, 0.07), (0.07, 0.16)
OUT, DOWN, SHRINK, GROW, UP, IN = (0.18, 0.31), (0.31, 0.41), (0.41, 0.47), (0.47, 0.53), (0.53, 0.64), (0.64, 0.78)
TURN_BACK, RAISE = (0.80, 0.90), (0.91, 1.00)
AFT = quat_axis((0, 1, 0), np.pi)        # пакет у модулі дивиться дулами до відкритого торця


def yaw_at(t):
    return np.pi * (1 - ramp(t, TURN) + ramp(t, TURN_BACK))


def elev_at(t):
    return ELEV * (1 - ramp(t, LOWER) + ramp(t, RAISE))


def boom_at(t):
    return -SLIDE / 2 * (ramp(t, OUT) - ramp(t, IN))


def drop_at(t):
    return -POD_Y0 * (ramp(t, DOWN) - ramp(t, UP))


def strut_pose(t, base_tl, dist):
    """Поворот циліндра (навколо z, щоб його вісь +y дивилась на точку кріплення) і відстань до неї; усе в системі платформи."""
    ph = elev_at(t)
    top = np.array([HM[0] - dist * np.cos(ph), HM[1] - dist * np.sin(ph)])
    d = top - np.array(base_tl)
    return np.arctan2(-d[0], d[1]), float(np.hypot(*d))


def local(mesh, origin):
    mesh.apply_translation(-np.asarray(origin, dtype=float))
    return mesh


def launcher_rig(turret_parts, mod):
    metal = material("Metal", (150, 154, 150), metallic=0.8, roughness=0.3)
    steel_dk = TileSpec("steel", (70, 72, 70), 0.5, 1.0, 1.0)
    steel_br = TileSpec("steel", (205, 207, 204), 0.5, 1.0, 1.0)
    olive_t = TileSpec("paint", (84, 90, 62), 0.6, 1.0, 1.0)
    # Платформа: люлька, проушини осі підйому, опори гідроциліндрів.
    cr = [turret_parts["cradle"]]
    lugs = [box((HINGE[0], HINGE[1] - 0.06, s * 0.70), (0.26, 0.20, 0.10)) for s in (-1, 1)]
    lugs += [box((base[0], base[1] + 0.02, s * STRUT_Z), (0.26, 0.10, 0.26)) for _, base, *_ in STRUTS for s in (-1, 1)]
    pin = cyl_between((HINGE[0], HINGE[1], -0.80), (HINGE[0], HINGE[1], 0.80), 0.06, 16)
    tparts = [local(cr[0], TURRET), local(merge(lugs), TURRET), local(pin, TURRET)]
    tnames = ["cradle", "lugs", "pin"]
    T_RECIPES = {"cradle": vp.R((50, 54, 40), 0.7, 0.2), "lugs": vp.R((50, 54, 40), 0.65, 0.25), "pin": vp.STEEL}
    tids = np.concatenate([np.full(len(g.faces), i, np.int16) for i, g in enumerate(tparts)])
    turret_prims = [(merge(tparts), BakeSpec(vp.group_painter(tnames, T_RECIPES, camo=False, seed=31, weather=dict(mud=0.2, dust=0.45), olive=(52, 58, 40)),
                                             res=1024, ids=tids, key="himars-turret", seed=31))]

    # Внутрішня секція рами: дві балки з поперечками.
    b1 = [box((-1.85, BOOM_Y - 0.02, s * 0.44), (3.10, 0.08, 0.08)) for s in (-1, 1)]
    b1 += [box((x, BOOM_Y - 0.02, 0.0), (0.08, 0.06, 0.88)) for x in (-3.36, -0.34)]
    # Зовнішня U-подібна секція: ширші балки, на кінці — опущена П-подібна рамка, як на фото; посередині візок лебідки.
    b2 = [box((-2.00, BOOM_Y + 0.06, s * 0.54), (3.10, 0.10, 0.10)) for s in (-1, 1)]
    b2 += [box((-0.50, BOOM_Y + 0.06, 0.0), (0.10, 0.08, 1.18))]
    b2 += [box((-3.52, BOOM_Y - 0.08, s * 0.54), (0.10, 0.38, 0.10)) for s in (-1, 1)]          # ноги П-рамки
    b2 += [box((-3.52, BOOM_Y - 0.26, 0.0), (0.12, 0.10, 1.18)), box((-3.52, BOOM_Y + 0.08, 0.0), (0.12, 0.10, 1.18))]
    b2 += [box((x, BOOM_Y + 0.02, s * 0.54), (0.30, 0.06, 0.13)) for x in (-3.0, -1.0) for s in (-1, 1)]
    trolley = [hull([(POD_XC - 0.30, BOOM_Y - 0.05, -0.40), (POD_XC + 0.30, BOOM_Y - 0.05, -0.40), (POD_XC - 0.30, BOOM_Y - 0.05, 0.40),
                     (POD_XC + 0.30, BOOM_Y - 0.05, 0.40), (POD_XC - 0.22, BOOM_Y + 0.10, -0.30), (POD_XC + 0.22, BOOM_Y + 0.10, -0.30),
                     (POD_XC - 0.22, BOOM_Y + 0.10, 0.30), (POD_XC + 0.22, BOOM_Y + 0.10, 0.30)])]
    trolley.append(box((POD_XC, BOOM_Y - 0.10, 0.0), (0.24, 0.10, 0.20)))                       # блок лебідки
    # Троси: чотири нитки від блока вниз; вузол масштабується по висоті.
    lines = [cyl_between((POD_XC + dx, 0.0, dz), (POD_XC + dx, -1.0, dz), 0.010, 6) for dx in (-0.08, 0.08) for dz in (-0.05, 0.05)]
    cable_top = BOOM_Y - 0.15
    cables = node("hoist_cables", [(local(merge(lines), (HINGE[0], 0, 0)), metal)], t=(0.0, cable_top - HINGE[1], 0.0),
                  s=(1.0, cable_top - (SPREADER_Y + 0.06), 1.0))
    # Траверса: балка вздовж пакета з гаками на вушках.
    sp = [box((POD_XC, 0.04, 0.0), (0.95, 0.07, 0.10)), box((POD_XC, 0.10, 0.0), (0.16, 0.06, 0.16))]
    sp += [box((POD_XC + lx, -0.01, 0.0), (0.05, 0.10, 0.08)) for lx in POD_LUGS]
    spreader = node("spreader", [(local(merge(sp), (HINGE[0], 0, 0)), steel_dk)], t=(0.0, SPREADER_Y - HINGE[1], 0.0))
    pods = []
    for name, fresh in (("pod", False), ("pod_new", True)):
        prims = lpc_pod(POD_X1 - POD_X0, POD_Y1 - POD_Y0, POD_HALF, fresh, POD_LUGS)
        pods.append(node(name, prims, t=np.array([POD_XC, POD_Y0, 0.0]) - HINGE, r=AFT, s=(TINY,) * 3 if fresh else (1.0, 1.0, 1.0)))
    boom_2 = node("boom_2", [(local(merge(b2), HINGE), steel_br), (local(merge(trolley), HINGE), steel_dk)], children=[cables, spreader] + pods)
    boom_1 = node("boom_1", [(local(merge(b1), HINGE), steel_dk)], children=[boom_2])

    # Модуль: корпус, дверцята, ручки, задній торець, штанги, заклепки; нерухома основа рами — окремий вузол.
    mnames = ["module", "module_doors", "module_handles", "module_rear", "loader_frame", "module_rails", "module_rivets"]
    M_RECIPES = {"module": vp.R("camo", 0.72, 0.1), "module_doors": vp.R("camo", 0.7, 0.12, tone=0.92), "module_handles": vp.BLACK,
                 "module_rear": vp.R("camo", 0.72, 0.15, tone=0.85), "loader_frame": vp.R("camo", 0.66, 0.25, tone=0.7), "module_rails": vp.STEEL,
                 "module_rivets": vp.R("camo", 0.7, 0.2, tone=0.75)}
    mmeshes = [local(mod[n], HINGE) for n in mnames]
    mids = np.concatenate([np.full(len(g.faces), i, np.int16) for i, g in enumerate(mmeshes)])
    mspec = BakeSpec(vp.group_painter(mnames, M_RECIPES, camo=CAMO, seed=41, weather=dict(mud=0.1, dust=0.5), olive=OLIVE_RGB, seams=("module",), post=vp.post_himars_module),
                     res=2048, ids=mids, key=f"himars-module-{CAMO}", seed=41)
    module = node("module", [(merge(mmeshes), mspec)], t=HM, r=quat_axis((0, 0, 1), elev_at(0.0)), children=[boom_1])

    struts = []
    for name, base_w, dist, lb, lr in STRUTS:
        base = (base_w[0] - TURRET[0], base_w[1])
        ang, length = strut_pose(0.0, base, dist)
        for side, z in (("l", -STRUT_Z), ("r", STRUT_Z)):
            barrel = [cyl_between((0, 0, 0), (0, lb, 0), 0.085, 24), cyl_between((0, 0, -0.10), (0, 0, 0.10), 0.06, 20)]
            rod = [cyl_between((0, 0, 0), (0, lr, 0), 0.05, 24), cyl_between((0, lr, -0.08), (0, lr, 0.08), 0.05, 20)]
            rod_node = node(f"rod_{name}_{side}", [(merge(rod), steel_br)], t=(0.0, length - lr, 0.0))
            struts.append(node(f"strut_{name}_{side}", [(merge(barrel), olive_t)], t=(base[0], base[1], z),
                               r=quat_axis((0, 0, 1), ang), children=[rod_node]))
    return node("turret", turret_prims, t=TURRET, r=quat_axis((0, 1, 0), yaw_at(0.0)), children=[module] + struts)


def reload_tracks():
    ts = np.linspace(0.0, 1.0, SAMPLES)
    cable_top = BOOM_Y - 0.15
    pod0 = np.array([POD_XC, POD_Y0, 0.0]) - HINGE
    out = [("turret", "rotation", [quat_axis((0, 1, 0), yaw_at(t)) for t in ts]),
           ("module", "rotation", [quat_axis((0, 0, 1), elev_at(t)) for t in ts]),
           ("boom_1", "translation", [(boom_at(t), 0.0, 0.0) for t in ts]),
           ("boom_2", "translation", [(boom_at(t), 0.0, 0.0) for t in ts]),
           ("spreader", "translation", [(0.0, SPREADER_Y - HINGE[1] + drop_at(t), 0.0) for t in ts]),
           ("hoist_cables", "scale", [(1.0, cable_top - (SPREADER_Y + 0.06 + drop_at(t)), 1.0) for t in ts]),
           ("pod", "translation", [pod0 + (0.0, drop_at(t), 0.0) for t in ts]),
           ("pod", "scale", [(max(TINY, 1 - ramp(t, SHRINK)),) * 3 for t in ts]),
           ("pod_new", "translation", [pod0 + (0.0, drop_at(t) if t >= SHRINK[0] else 0.0, 0.0) for t in ts]),
           ("pod_new", "scale", [(max(TINY, ramp(t, GROW)),) * 3 for t in ts])]
    for name, base_w, dist, lb, lr in STRUTS:
        base = (base_w[0] - TURRET[0], base_w[1])
        poses = [strut_pose(t, base, dist) for t in ts]
        for side in ("l", "r"):
            out += [(f"strut_{name}_{side}", "rotation", [quat_axis((0, 0, 1), a) for a, _ in poses]),
                    (f"rod_{name}_{side}", "translation", [(0.0, length - lr, 0.0) for _, length in poses])]
    return ts * CLIP_SECONDS, out


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    parts, rig = himars()
    w = GlbWriter("EasyWAR build-himars-model.py")
    for nd in group_nodes(parts):
        w.add(nd)
    assert not parts, f"частини без поверхні: {list(parts)}"
    w.add(rig)
    times, tracks = reload_tracks()
    w.animation("reload", times, tracks)
    glb = w.glb({"title": "M142 HIMARS (generated)", "generated": True,
                 "note": "Procedural model traced from an orthographic side view and public overall dimensions (about 7.2 m long, 2.4 m wide, 6x6 FMTV chassis, "
                         "armoured cab, one six-tube pod facing aft). The 'reload' clip schematically shows the built-in loader swapping the pod. "
                         "Not a scan or copy of any other model."})
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(glb)
    print(f"{out.name}: {len(glb) / 1024:.0f} KB, {len(w.doc['nodes'])} nodes, {w.triangles} triangles, {len(tracks)} channels")
    return 0


if __name__ == "__main__":
    sys.exit(main())
