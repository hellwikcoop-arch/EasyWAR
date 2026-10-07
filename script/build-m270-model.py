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

# --- головні розміри, м ---------------------------------------------------------------------------------------------
X_REAR, X_FRONT = -3.45, 3.50         # торці палуби
DECK_Y0, DECK_Y1, DECK_HALF = 1.02, 1.20, 1.45
TRACK_Z, TRACK_W = 1.215, 0.53         # вісь і ширина гусениці
SPROCKET = (3.05, 0.50, 0.50)          # x, y, зовнішній радіус гусениці на ведучому колесі
IDLER = (-3.00, 0.48, 0.48)
ROAD_X = [-1.95, -1.17, -0.39, 0.39, 1.17, 1.95]
ROAD_R, ROAD_Y = 0.335, 0.405
PAD_PITCH = 0.15

LAUNCH_ANGLE = np.radians(52)          # кут підйому установки
HINGE = (-2.60, 1.58)                  # вісь підйому (x, y)
BOX_L, BOX_T, BOX_W = 3.50, 1.05, 2.85


def material(name, rgb, metallic=0.1, roughness=0.65):
    linear = [round(255 * (c / 255) ** 2.2) for c in rgb]  # glTF чекає лінійні кольори
    return PBRMaterial(name=name, baseColorFactor=[*linear, 255], metallicFactor=metallic, roughnessFactor=roughness)


def painted(mesh, mat):
    mesh.visual = trimesh.visual.TextureVisuals(material=mat)
    return mesh


def merge(meshes):
    return trimesh.util.concatenate(meshes)


def box(center, extents, rot_z=0.0):
    """Паралелепіпед з центром у `center`; його вісь x повернута навколо z на rot_z радіан."""
    m = trimesh.creation.box(extents=extents)
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


def prism_side(profile_xy, z0, z1):
    """Опукла призма: бічний профіль (x, y) витягнуто від z0 до z1."""
    pts = [(x, y, z) for (x, y) in profile_xy for z in (z0, z1)]
    return trimesh.convex.convex_hull(np.array(pts, dtype=float))


def box_pose(u0, u1, v0, v1, z0, z1):
    """Паралелепіпед у системі координат установки: u — уздовж корпусу від осі підйому, v — «вгору» від його низу."""
    m = trimesh.creation.box(extents=[u1 - u0, v1 - v0, z1 - z0])
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
    pads = []
    for x, y, a in resample(track_loop(), PAD_PITCH):
        pads.append(box((x, y, z_center), (PAD_PITCH * 0.86, 0.065, TRACK_W), rot_z=a))
    return pads


def m270():
    olive = material("Hull", (82, 90, 64), metallic=0.1, roughness=0.7)
    olive_dk = material("HullDark", (62, 70, 50), metallic=0.1, roughness=0.75)
    olive_lt = material("Pods", (98, 106, 78), metallic=0.1, roughness=0.65)
    rubber = material("Tyres", (28, 28, 30), metallic=0.0, roughness=0.9)
    trackmat = material("Track", (44, 44, 42), metallic=0.45, roughness=0.55)
    hub = material("Hubs", (66, 76, 56), metallic=0.2, roughness=0.6)
    black = material("Black", (24, 26, 24), metallic=0.1, roughness=0.6)
    glass = material("Glass", (34, 42, 46), metallic=0.4, roughness=0.18)
    amber = material("Amber", (236, 148, 28), metallic=0.0, roughness=0.3)
    white = material("Lamp", (240, 240, 232), metallic=0.0, roughness=0.25)
    metal = material("Metal", (120, 124, 120), metallic=0.6, roughness=0.4)

    parts = {}

    # Палуба й корпус між гусеницями.
    parts["deck"] = painted(merge([
        box(((X_REAR + X_FRONT) / 2, (DECK_Y0 + DECK_Y1) / 2, 0), (X_FRONT - X_REAR, DECK_Y1 - DECK_Y0, 2 * DECK_HALF)),
        prism_side([(-3.05, 0.34), (3.05, 0.34), (3.55, 0.95), (3.55, 1.04), (-3.40, 1.04), (-3.40, 0.70)], -0.95, 0.95),
    ]), olive)
    # Гусениці: звена-пластини по контуру, опорні котки, ведуче й ліниве колеса.
    rubber_parts, hub_parts, pad_parts, roller_parts = [], [], [], []
    for side in (-1, 1):
        zc = side * TRACK_Z
        pad_parts += track_pads(zc)
        for x in ROAD_X:
            for dz in (-0.135, 0.135):
                rubber_parts.append(cyl_z((x, ROAD_Y, zc + dz), ROAD_R, 0.14))
            hub_parts.append(cyl_z((x, ROAD_Y, zc), 0.22, 0.34))
            hub_parts.append(cyl_z((x, ROAD_Y, zc + side * 0.215), 0.255, 0.036, 28))
            hub_parts.append(cyl_z((x, ROAD_Y, zc + side * 0.236), 0.075, 0.024, 12))
        for x in (-1.05, 0.05, 1.15):
            roller_parts.append(cyl_z((x, 0.82, zc), 0.075, 0.2, 16))
        hub_parts.append(cyl_z((SPROCKET[0], SPROCKET[1], zc), 0.40, 0.30, 32))
        hub_parts.append(cyl_z((SPROCKET[0], SPROCKET[1], zc + side * 0.17), 0.14, 0.06, 20))
        hub_parts.append(cyl_z((IDLER[0], IDLER[1], zc), 0.38, 0.30, 32))
        hub_parts.append(cyl_z((IDLER[0], IDLER[1], zc + side * 0.17), 0.12, 0.06, 20))
    parts["tracks"] = painted(merge(pad_parts), trackmat)
    parts["tyres"] = painted(merge(rubber_parts), rubber)
    parts["hubs"] = painted(merge(hub_parts), hub)
    parts["rollers"] = painted(merge(roller_parts), hub)
    # Крила гусениць і брудозахисні щитки спереду.
    parts["flaps"] = painted(merge([box((3.62, 0.70, s * 1.18), (0.05, 0.62, 0.95)) for s in (-1, 1)]), black)

    # Кабіна: прямий низ спереду, похилий верх; бічні двері, вікна, фари, жалюзі, поручні й антена.
    cab_profile = [(1.15, DECK_Y1), (3.40, DECK_Y1), (3.40, 1.78), (2.62, 2.58), (1.15, 2.58)]
    parts["cab"] = painted(prism_side(cab_profile, -1.38, 1.38), olive)
    side_plates = []
    for s in (-1, 1):
        side_plates.append(box((2.45, 1.80, s * 1.395), (1.05, 1.10, 0.03)))        # двері
        side_plates.append(box((1.60, 1.60, s * 1.395), (0.80, 0.65, 0.03)))        # бічний люк
    parts["doors"] = painted(merge(side_plates), olive_dk)
    parts["windows"] = painted(merge([box((2.75, 2.25, s * 1.40), (0.34, 0.26, 0.03)) for s in (-1, 1)]), glass)
    slope = np.arctan2(2.58 - 1.78, 2.62 - 3.40)  # напрямок схилу в площині (x, y), > 90°
    n_out = np.array([np.sin(slope) * -1, np.cos(slope) * -1])  # зовнішня нормаль до схилу
    louvers = []
    for z in (-0.88, 0.0, 0.88):
        mid = np.array([3.01, 2.18])
        c = mid + n_out * 0.02
        louvers.append(box((c[0], c[1], z), (1.05, 0.03, 0.78), rot_z=slope))
        for k in range(-3, 4):  # планки жалюзі
            cc = mid + n_out * 0.05 + np.array([np.cos(slope), np.sin(slope)]) * (k * 0.13)
            louvers.append(box((cc[0], cc[1], z), (0.025, 0.04, 0.78), rot_z=slope))
    parts["louvers"] = painted(merge(louvers), black)
    parts["lamps"] = painted(merge([cyl_between((3.41, 1.50, s * 1.05), (3.47, 1.50, s * 1.05), 0.055, 14) for s in (-1, 1)]), white)
    parts["lamps_amber"] = painted(merge([cyl_between((3.41, 1.50, s * 1.22), (3.47, 1.50, s * 1.22), 0.04, 14) for s in (-1, 1)]), amber)
    parts["lamp_housings"] = painted(merge([box((3.42, 1.50, s * 1.14), (0.06, 0.20, 0.50)) for s in (-1, 1)]), black)
    rail = [cyl_between((1.45, 2.58, -0.9), (1.45, 2.80, -0.9), 0.015), cyl_between((1.45, 2.58, 0.9), (1.45, 2.80, 0.9), 0.015),
            cyl_between((1.45, 2.80, -0.9), (1.45, 2.80, 0.9), 0.015), cyl_between((2.15, 2.58, -0.9), (2.15, 2.80, -0.9), 0.015),
            cyl_between((2.15, 2.58, 0.9), (2.15, 2.80, 0.9), 0.015), cyl_between((2.15, 2.80, -0.9), (2.15, 2.80, 0.9), 0.015),
            cyl_between((1.45, 2.80, -0.9), (2.15, 2.80, -0.9), 0.015), cyl_between((1.45, 2.80, 0.9), (2.15, 2.80, 0.9), 0.015),
            cyl_between((1.30, 2.58, 1.12), (1.30, 3.55, 1.12), 0.011, 8)]
    parts["rails"] = painted(merge(rail), metal)
    parts["mirrors"] = painted(merge([box((3.04, 2.12, s * 1.50), (0.08, 0.38, 0.16)) for s in (-1, 1)]), black)

    # Відсік двигуна за кабіною й панель з решіткою радіатора.
    parts["engine"] = painted(box((0.62, 1.62, 0), (1.05, 0.84, 2.76)), olive)
    parts["grille"] = painted(merge([box((0.62, 1.55, 1.395), (0.82, 0.66, 0.03))]
                                    + [box((0.62, 1.55, -1.395), (0.82, 0.66, 0.03))]), black)

    # Поворотна платформа й пусковий кронштейн.
    parts["platform"] = painted(box((-1.65, 1.30, 0), (3.60, 0.20, 2.90)), olive)
    ring = trimesh.creation.cylinder(radius=1.22, height=0.10, sections=48)
    ring.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
    ring.apply_translation([-1.70, 1.45, 0])
    parts["turntable"] = painted(ring, olive_dk)
    parts["hinge"] = painted(merge([box((HINGE[0] + 0.05, HINGE[1] - 0.12, z), (0.34, 0.30, 0.28)) for z in (-1.15, 1.15)]), olive_dk)

    # Пускова установка: корпус пакетів, піднятий на LAUNCH_ANGLE.
    parts["launcher"] = painted(to_world(box_pose(0.0, BOX_L, 0.0, BOX_T, -BOX_W / 2, BOX_W / 2)), olive)
    parts["launcher_bands"] = painted(merge([to_world(box_pose(u0, u0 + 0.05, -0.012, BOX_T + 0.012, -BOX_W / 2 - 0.012, BOX_W / 2 + 0.012))
                                             for u0 in (0.55, 1.65, 2.75)]), olive_dk)
    hatches = [to_world(box_pose(u - 0.22, u + 0.22, BOX_T, BOX_T + 0.02, z - 0.16, z + 0.16)) for u in (1.0, 2.4) for z in (-0.6, 0.6)]
    parts["launcher_hatches"] = painted(merge(hatches), olive_dk)

    # Дульна торцева частина: дві рамки пакетів, по шість труб у кожній, і два поручні.
    face_u = BOX_L
    frames, tubes, handles = [], [], []
    for pz in (-0.68, 0.68):
        frames.append(to_world(box_pose(face_u, face_u + 0.04, 0.12, 0.98, pz - 0.52, pz + 0.52)))
        for dz in (-0.31, 0.0, 0.31):
            for v in (0.34, 0.66):
                t = trimesh.creation.cylinder(radius=0.125, height=0.06, sections=24)
                t.apply_transform(trimesh.geometry.align_vectors([0, 0, 1], [1, 0, 0]))
                t.apply_translation([face_u + 0.05, v, pz + dz])
                tubes.append(to_world(t))
        for dz in (-0.55, 0.55):
            handles.append(to_world(box_pose(face_u, face_u + 0.46, BOX_T - 0.14, BOX_T - 0.08, pz + dz - 0.03, pz + dz + 0.03)))
        handles.append(to_world(box_pose(face_u + 0.40, face_u + 0.46, BOX_T - 0.14, BOX_T - 0.08, pz - 0.58, pz + 0.58)))
    parts["pod_frames"] = painted(merge(frames), olive_lt)
    parts["tube_mouths"] = painted(merge(tubes), black)
    parts["handles"] = painted(merge(handles), olive_dk)

    # Гідроциліндри підйому.
    struts = []
    for z in (-0.95, 0.95):
        base = (-2.30, 1.48, z)
        top = pose_point(2.45, 0.0, z)
        struts.append(cyl_between(base, top, 0.075))
        struts.append(cyl_between(base, np.array(base) + (np.array(top) - np.array(base)) * 0.55, 0.095))
    parts["struts"] = painted(merge(struts), metal)

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
