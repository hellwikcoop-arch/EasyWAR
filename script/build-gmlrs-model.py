#!/usr/bin/env python3
"""Генерує спрощену процедурну модель ракети GMLRS M31 для довідника (src/models/gmlrs-m31.glb).

    pip install numpy scipy trimesh
    python3 script/build-gmlrs-model.py [вихідний.glb]

Модель побудовано за відкритими габаритами (довжина ≈ 3,94 м, діаметр 0,227 м) і за довідковими зображеннями, які надав
користувач: загострений обтічник із чотирма малими стабілізаторами-«канардами», світлий корпус бойової частини з заклепками
й білими лючками, жовтогаряча смуга, оливковий двигун із темною панеллю та шість вигнутих хвостових стабілізаторів навколо
сопла. Це не скан і не копія чужої моделі, сторонніх текстур немає. Для перегляду, а не для впізнавання чи розрахунків.
Одиниці — метри, носова частина дивиться в +x, «вгору» — +y (як у glTF).
"""
import json
import struct
import sys
from pathlib import Path

import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "src" / "models" / "gmlrs-m31.glb"

L, R = 3.94, 0.1135          # довжина й радіус корпусу, м
X0, X1 = -L / 2, L / 2        # хвіст і ніс

OGIVE = 0.60                  # довжина обтічника від кінчика
TIP = 0.08                    # темний кінчик
D_BAND_A, D_BAND_B = 2.50, 2.62  # смуга між бойовою частиною й двигуном (відстань від кінчика)
SKIRT = 0.14                  # довжина кормової юбки з соплом
R_SKIRT = 0.095


def material(name, rgb, metallic=0.15, roughness=0.55):
    linear = [round(255 * (c / 255) ** 2.2) for c in rgb]  # glTF чекає лінійні кольори
    return PBRMaterial(name=name, baseColorFactor=[*linear, 255], metallicFactor=metallic, roughnessFactor=roughness)


def painted(mesh, mat):
    mesh.visual = trimesh.visual.TextureVisuals(material=mat)
    return mesh


def body(profile, sections=48):
    """Тіло обертання навколо осі x за точками (x, радіус)."""
    line = np.array(profile, dtype=float)
    mesh = trimesh.creation.revolve(line[:, ::-1], sections=sections)
    mesh.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0]))
    return mesh


def plate(points):
    return trimesh.convex.convex_hull(np.array(points, dtype=float))


def radial(azimuth_deg):
    a = np.radians(azimuth_deg)
    return np.array([0.0, np.cos(a), np.sin(a)])


def ogive_radius(d):
    """Дотичний огів довжиною OGIVE: радіус на відстані d від кінчика."""
    rho = (R * R + OGIVE * OGIVE) / (2 * R)
    return np.sqrt(max(rho * rho - (OGIVE - d) ** 2, 0.0)) + R - rho


def ogive_profile(d_a, d_b, n=22):
    """Точки обтічника за зростанням x (від d_b до d_a, бо d рахується від кінчика)."""
    ds = np.linspace(d_b, d_a, n)
    return [(X1 - d, ogive_radius(d)) for d in ds]


def stud(x, azimuth_deg, r_surface, radius, height, sections=8):
    """Заклепка, що стирчить із поверхні вздовж радіуса."""
    cyl = trimesh.creation.cylinder(radius=radius, height=height, sections=sections)
    cyl.apply_transform(trimesh.geometry.align_vectors([0, 0, 1], radial(azimuth_deg)))
    cyl.apply_translation(radial(azimuth_deg) * (r_surface + height / 2 - 0.001) + [x, 0, 0])
    return cyl


def rivet_ring(d, count=30, r=R, radius=0.0034, height=0.0045):
    return [stud(X1 - d, az, r, radius, height, 6) for az in np.arange(0, 360, 360 / count)]


def surface_slab(x, azimuth_deg, r_surface, along, across, thick):
    """Плоска накладка на циліндричній поверхні: along — уздовж осі, across — по дузі."""
    box = trimesh.creation.box(extents=[along, thick, across])
    box.apply_transform(trimesh.transformations.rotation_matrix(np.radians(azimuth_deg), [1, 0, 0]))
    box.apply_translation(radial(azimuth_deg) * (r_surface + thick / 2 - 0.0008) + [x, 0, 0])
    return box


def oval(x, azimuth_deg, r_surface, rx, rt, thick):
    """Плаский овал на поверхні: rx — піввісь уздовж ракети, rt — піввісь по дузі."""
    cyl = trimesh.creation.cylinder(radius=1.0, height=thick, sections=28)  # вісь уздовж z
    cyl.apply_scale([rx, rt, 1.0])
    cyl.apply_transform(trimesh.geometry.align_vectors([0, 0, 1], radial(azimuth_deg)))
    cyl.apply_translation(radial(azimuth_deg) * (r_surface + thick / 2) + [x, 0, 0])
    return cyl


def canard(d_root_le, chord_root, chord_tip, span, sweep, thick, roll_deg):
    """Маленький стрілоподібний стабілізатор на обтічнику (кореневий переріз заглиблений у корпус)."""
    t = thick / 2
    x_le = X1 - d_root_le
    y0 = ogive_radius(d_root_le) * 0.82
    pts = []
    for z in (-t, t):
        pts += [(x_le, y0, z), (x_le - chord_root, y0, z),
                (x_le - sweep - chord_tip, y0 + span, z), (x_le - sweep, y0 + span, z)]
    mesh = plate(pts)
    mesh.apply_transform(trimesh.transformations.rotation_matrix(np.radians(roll_deg), [1, 0, 0]))
    return mesh


def tail_fin(azimuth_deg, half_width_deg=15.0, steps=3, thick=0.0045):
    """Вигнутий хвостовий стабілізатор: сегмент конічної оболонки навколо сопла, що відходить від кільця назад і назовні."""
    x_h, r_h = X0 + SKIRT + 0.01, R_SKIRT          # шарнір на кормовій юбці
    x_t, r_t = X0 - 0.005, R_SKIRT + 0.078          # вільний кінець: розкрито назовні
    angles = np.radians(np.linspace(azimuth_deg - half_width_deg, azimuth_deg + half_width_deg, steps + 1))

    def pt(x, r, a):
        return (x, r * np.cos(a), r * np.sin(a))

    pieces = []
    for a_a, a_b in zip(angles[:-1], angles[1:]):
        pts = []
        for a in (a_a, a_b):
            pts += [pt(x_h, r_h, a), pt(x_h, r_h + thick, a), pt(x_t, r_t, a), pt(x_t, r_t + thick, a)]
        pieces.append(plate(pts))
    return trimesh.util.concatenate(pieces)


def gmlrs():
    steel = material("Nose", (88, 100, 118), metallic=0.5, roughness=0.38)
    tip_mat = material("Tip", (52, 56, 64), metallic=0.5, roughness=0.35)
    tan = material("Warhead", (150, 147, 128), metallic=0.12, roughness=0.6)
    plate_mat = material("Access", (224, 226, 224), metallic=0.1, roughness=0.5)
    hole = material("Hole", (32, 34, 36), metallic=0.1, roughness=0.6)
    yellow = material("Band", (240, 172, 30), metallic=0.0, roughness=0.5)
    olive = material("Motor", (158, 156, 78), metallic=0.1, roughness=0.55)
    panel = material("Panel", (36, 38, 36), metallic=0.1, roughness=0.5)
    metal = material("Rivets", (88, 90, 92), metallic=0.6, roughness=0.4)
    skirt_mat = material("Skirt", (74, 76, 74), metallic=0.45, roughness=0.45)
    bell_mat = material("Bell", (58, 60, 64), metallic=0.5, roughness=0.4)
    fins_mat = material("Fins", (120, 122, 118), metallic=0.45, roughness=0.42)
    canard_mat = material("Canards", (146, 142, 124), metallic=0.3, roughness=0.5)
    bell_mat.doubleSided = True

    parts = {}
    # Обтічник і темний кінчик.
    tip_pts = [(X1 - d, ogive_radius(d)) for d in np.linspace(TIP, 0.0, 8)]
    parts["tip"] = painted(body(tip_pts), tip_mat)
    parts["nose"] = painted(body(ogive_profile(TIP, OGIVE)), steel)
    # Корпус бойової частини, смуга, двигун.
    x_wh_fwd, x_wh_aft = X1 - OGIVE, X1 - D_BAND_A
    x_band_aft = X1 - D_BAND_B
    parts["warhead"] = painted(body([(x_wh_aft, R), (x_wh_fwd, R)]), tan)
    parts["band"] = painted(body([(x_band_aft, R * 1.004), (x_wh_aft, R * 1.004)]), yellow)
    parts["motor"] = painted(body([(X0 + SKIRT + 0.03, R), (x_band_aft, R)]), olive)
    # Кормова юбка з соплом.
    parts["skirt"] = painted(body([(X0, R_SKIRT), (X0 + SKIRT, R_SKIRT), (X0 + SKIRT + 0.03, R * 0.99)]), skirt_mat)
    parts["bell"] = painted(body([(X0 + 0.11, 0.0), (X0 + 0.11, 0.035), (X0 + 0.05, 0.058), (X0 + 0.0, 0.088)]), bell_mat)
    # Заклепки на стиках секцій.
    rivets = []
    for d in (OGIVE + 0.02, D_BAND_A - 0.03, D_BAND_B + 0.03, L - SKIRT - 0.01):
        rivets += rivet_ring(d)
    parts["rivets"] = painted(trimesh.util.concatenate(rivets), metal)
    # Білі лючки з темним овалом у центрі (на бойовій частині).
    slabs, holes = [], []
    for d, az in ((1.15, 38), (1.62, 76)):
        slabs.append(surface_slab(X1 - d, az, R, 0.14, 0.105, 0.007))
        holes.append(oval(X1 - d, az, R + 0.0062, 0.035, 0.026, 0.004))
    parts["hatches"] = painted(trimesh.util.concatenate(slabs), plate_mat)
    parts["hatch_holes"] = painted(trimesh.util.concatenate(holes), hole)
    # Темна прямокутна панель на двигуні.
    parts["panel"] = painted(surface_slab(X1 - 3.22, 62, R, 0.30, 0.075, 0.005), panel)
    # Чотири «канарди» на обтічнику (Х-подібно) і шість вигнутих хвостових стабілізаторів навколо сопла.
    for i, roll in enumerate((45, 135, 225, 315)):
        parts[f"canard_{i}"] = painted(canard(0.44, 0.15, 0.06, 0.105, 0.075, 0.008, roll), canard_mat)
    for i in range(6):
        parts[f"tail_fin_{i}"] = painted(tail_fin(30 + 60 * i), fins_mat)
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
    for name, mesh in gmlrs().items():
        scene.add_geometry(mesh, node_name=name, geom_name=name)
    glb = scene.export(file_type="glb", include_normals=True)
    glb = with_extras(glb, {"title": "GMLRS M31 (generated)", "generated": True,
                            "note": "Simplified procedural model from public overall dimensions (about 3.94 m long, 0.227 m diameter, ogive nose with four canards, olive motor, six curved tail fins). Not a scan or copy of any other model."})
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(glb)
    size = np.ptp(np.array(scene.bounds), axis=0)
    print(f"{out.name}: {len(glb) / 1024:.0f} KB, {sum(len(m.faces) for m in scene.geometry.values())} triangles, extent {size[0]:.2f} x {size[1]:.2f} x {size[2]:.2f} m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
