#!/usr/bin/env python3
"""Генерує спрощену процедурну модель MGM-140 ATACMS для довідника (src/models/mgm-140-atacms.glb).

    pip install numpy scipy trimesh
    python3 script/build-atacms-model.py [вихідний.glb]

Модель побудовано за відкритими габаритами (довжина ≈ 3,96 м, діаметр 0,61 м) і за довідковими зображеннями,
які надав користувач: чорний обтічник із жовтим пояском, срібляста обичайка, чорне кільце-перехідник, напрямна зверху
й чотири стабілізатори хрестом. Дрібні деталі (сопло з центральним конусом, кишені й болти на кормовому торці,
циліндричні кронштейни приводів стабілізаторів, шви-пояски корпусу, ряд кріпильних зірочок) додано за каркасними
знімками. Це не скан і не копія чужої моделі, сторонніх текстур немає. Для перегляду, а не для
впізнавання чи розрахунків. Одиниці — метри, носова частина дивиться в +x, «вгору» — +y (як у glTF).
"""
import json
import struct
import sys
from pathlib import Path

import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "src" / "models" / "mgm-140-atacms.glb"

L, R = 3.96, 0.305          # довжина й радіус корпусу, м
X0, X1 = -L / 2, L / 2       # хвіст і ніс


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


def stud(x, azimuth_deg, r_surface, radius, height, sections=10):
    """Круглий болт/кріпильна зірочка, що стирчить із поверхні вздовж радіуса."""
    a = np.radians(azimuth_deg)
    cyl = trimesh.creation.cylinder(radius=radius, height=height, sections=sections)
    cyl.apply_transform(trimesh.geometry.align_vectors([0, 0, 1], [0, np.cos(a), np.sin(a)]))
    r = r_surface + height / 2 - 0.0015
    cyl.apply_translation([x, r * np.cos(a), r * np.sin(a)])
    return cyl


def axial_bolt(x, azimuth_deg, r, radius=0.0085, height=0.012, sections=8):
    """Болт на кормовому торці: вісь уздовж −x, на радіусі r."""
    a = np.radians(azimuth_deg)
    cyl = trimesh.creation.cylinder(radius=radius, height=height, sections=sections)
    cyl.apply_transform(trimesh.geometry.align_vectors([0, 0, 1], [-1, 0, 0]))
    cyl.apply_translation([x - height / 2 + 0.002, r * np.cos(a), r * np.sin(a)])
    return cyl


def pad(x, azimuth_deg, r_surface, along, across, height):
    """Прямокутна накладка на кормовому торці (кишеня навколо сопла): along — по радіусу, across — по дузі."""
    a = np.radians(azimuth_deg)
    box = trimesh.creation.box(extents=[height, along, across])
    box.apply_transform(trimesh.transformations.rotation_matrix(a, [1, 0, 0]))
    box.apply_translation([x, r_surface * np.cos(a), r_surface * np.sin(a)])
    return box


def fin(x_root_le, chord_root, chord_tip, span, sweep, thick, roll_deg, y0):
    t = thick / 2
    pts = []
    for z in (-t, t):
        pts += [(x_root_le, y0, z), (x_root_le - chord_root, y0, z),
                (x_root_le - sweep - chord_tip, y0 + span, z), (x_root_le - sweep, y0 + span, z)]
    mesh = plate(pts)
    # Зовнішня частина стабілізатора товща — «коробчастий» кінець, як на каркасних знімках.
    t2 = t * 2.0
    y_cut = y0 + span * 0.62
    f = (y_cut - y0) / span
    le_cut = x_root_le - sweep * f
    te_cut = x_root_le - chord_root - ((sweep + chord_tip) - chord_root) * f
    tip = []
    for z in (-t2, t2):
        tip += [(le_cut, y_cut, z), (te_cut, y_cut, z),
                (x_root_le - sweep - chord_tip, y0 + span, z), (x_root_le - sweep, y0 + span, z)]
    mesh = trimesh.util.concatenate([mesh, plate(tip)])
    # Циліндричний кронштейн приводу на корені стабілізатора (вздовж розмаху, збоку від пластини).
    pod = trimesh.creation.capsule(height=span * 0.62, radius=0.016, count=[8, 12])
    pod.apply_transform(trimesh.geometry.align_vectors([0, 0, 1], [0, 1, 0]))
    pod.apply_translation([x_root_le - chord_root * 0.36, y0 + span * 0.30, t + 0.011])
    mesh = trimesh.util.concatenate([mesh, pod])
    mesh.apply_transform(trimesh.transformations.rotation_matrix(np.radians(roll_deg), [1, 0, 0]))
    return mesh


def hermite(x, xa, xb, ya, yb, ma, mb):
    """Кубічний сплайн Ерміта між (xa, ya) і (xb, yb) із нахилами ma, mb на кінцях."""
    d = xb - xa
    u = (x - xa) / d
    h00, h10, h01, h11 = 2 * u**3 - 3 * u**2 + 1, u**3 - 2 * u**2 + u, -2 * u**3 + 3 * u**2, u**3 - u**2
    return h00 * ya + h10 * d * ma + h01 * yb + h11 * d * mb


# Поздовжня розмітка від носа (х, м): кінчик 0,30, обтічник 1,25, срібляста вставка до 1,55, чорне кільце до 1,80.
NOSE_LEN, TIP_LEN = 1.25, 0.30
R_FWD = 0.285                # передня частина трохи вужча за кормову
X_NOSE_BASE = X1 - NOSE_LEN  # де обтічник переходить у циліндр
X_COLLAR_FWD = X1 - 1.55
X_COLLAR_AFT = X1 - 1.80


def nose_radius(x):
    """Радіус обтічника на відстані x від осі координат (кінчик — тонкий конус, далі плавна огіва)."""
    d = X1 - x                                   # відстань від кінчика
    tip_r = 0.0 + d * np.tan(np.radians(10.5))  # тонкий конус
    if d <= TIP_LEN:
        return tip_r
    r_a = TIP_LEN * np.tan(np.radians(10.5))
    return hermite(d, TIP_LEN, NOSE_LEN, r_a, R_FWD, 0.46, 0.0)


def ring(x_a, x_b, grow=0.0, n=14):
    xs = np.linspace(x_a, x_b, n)
    return [(x, nose_radius(x) + grow) for x in xs]


def atacms():
    silver = material("Body", (168, 173, 181), metallic=0.45, roughness=0.42)
    black = material("Nose", (22, 23, 27), metallic=0.1, roughness=0.22)
    tipmat = material("Tip", (40, 42, 48), metallic=0.5, roughness=0.3)
    collar = material("Collar", (34, 35, 40), metallic=0.2, roughness=0.3)
    yellow = material("Band", (238, 188, 38), metallic=0.0, roughness=0.5)
    finmat = material("Fins", (118, 124, 133), metallic=0.4, roughness=0.45)
    dark = material("Nozzle", (20, 22, 26), metallic=0.0, roughness=0.8)
    bell_mat = material("Bell", (74, 77, 84), metallic=0.55, roughness=0.38)

    parts = {}
    # Сопло: розтруб, що звужується до горла, і центральний конус; всередині темне.
    bell = [(X0 + 0.44, 0.0), (X0 + 0.44, 0.07), (X0 + 0.37, 0.085), (X0 + 0.28, 0.135), (X0 + 0.18, 0.18),
            (X0 + 0.08, 0.215), (X0 + 0.015, 0.235)]
    bell_mat.doubleSided = True
    parts["nozzle"] = painted(body(bell, sections=56), bell_mat)
    parts["plug"] = painted(body([(X0 + 0.30, 0.0), (X0 + 0.36, 0.022), (X0 + 0.43, 0.06)]), tipmat)
    # Кормова обичайка із заокругленим плечем до торця й кільцевою «сходинкою» навколо сопла.
    x_aft_end = X_COLLAR_AFT
    parts["aft"] = painted(body([(X0, 0.246), (X0, 0.262), (X0 + 0.012, 0.284), (X0 + 0.04, 0.3), (X0 + 0.09, R), (x_aft_end, R)], sections=56), silver)
    parts["lip"] = painted(body([(X0 - 0.004, 0.236), (X0 - 0.004, 0.252), (X0 + 0.02, 0.252)], sections=56), collar)
    # Кишені навколо сопла (темні накладки) і болти на торці.
    pads = [pad(X0 - 0.003, az, 0.272, 0.034, 0.075, 0.012) for az in range(0, 360, 45)]
    parts["pads"] = painted(trimesh.util.concatenate(pads), dark)
    parts["bolts"] = painted(trimesh.util.concatenate(
        [axial_bolt(X0 - 0.002, 22.5 + az, 0.272) for az in range(0, 360, 45)]), tipmat)
    # Шви-пояски на стиках секцій і ряд кріпильних зірочок навколо кормової обичайки.
    seam_x = [(X1 - TIP_LEN, nose_radius(X1 - TIP_LEN)), (X_NOSE_BASE, R_FWD), (X_COLLAR_FWD, R_FWD),
              (X_COLLAR_AFT, R), (X0 + 0.55, R)]
    seams = [body([(x - 0.007, r + 0.003), (x + 0.007, r + 0.003)], sections=56) for x, r in seam_x]
    parts["seams"] = painted(trimesh.util.concatenate(seams), tipmat)
    studs = [stud(X0 + 0.72, az, R, 0.0085, 0.011) for az in np.arange(0, 360, 360 / 20)]
    parts["studs"] = painted(trimesh.util.concatenate(studs), tipmat)
    # Ряд зірочок уздовж корпусу збоку від напрямної.
    stars = [stud(x, 32, R, 0.0075, 0.007, 8) for x in np.linspace(X0 + 0.95, X_COLLAR_AFT - 0.08, 16)]
    stars += [stud(x, 32, R_FWD, 0.0075, 0.007, 8) for x in np.linspace(X_COLLAR_FWD + 0.06, X_NOSE_BASE - 0.05, 4)]
    parts["stars"] = painted(trimesh.util.concatenate(stars), tipmat)
    # Чорне кільце-перехідник: від радіуса R до R_FWD.
    cx = np.linspace(X_COLLAR_AFT, X_COLLAR_FWD, 8)
    parts["collar"] = painted(body([(x, R + (R_FWD - R) * ((x - X_COLLAR_AFT) / (X_COLLAR_FWD - X_COLLAR_AFT)) ** 1.5) for x in cx]), collar)
    # Срібляста вставка між кільцем і обтічником.
    parts["fwd"] = painted(body([(X_COLLAR_FWD, R_FWD), (X_NOSE_BASE, R_FWD)]), silver)
    # Чорний обтічник і жовтий поясок.
    parts["nose"] = painted(body(ring(X_NOSE_BASE, X1 - TIP_LEN)), black)
    parts["tip"] = painted(body(ring(X1 - TIP_LEN, X1) + [(X1, 0.0)]), tipmat)
    parts["band"] = painted(body(ring(X1 - 0.95, X1 - 0.87, grow=0.004)), yellow)
    # Напрямна зверху (+y) із косинкою на передньому кінці.
    rail = trimesh.creation.box(extents=[X_COLLAR_AFT - X0 - 0.10, 0.04, 0.11])
    rail.apply_translation([(X_COLLAR_AFT + X0 + 0.10) / 2, R + 0.012, 0.0])
    bracket = plate([(X_COLLAR_AFT - 0.02, R + 0.022, -0.045), (X_COLLAR_AFT - 0.02, R + 0.022, 0.045),
                     (X_COLLAR_AFT + 0.13, R - 0.004, -0.05), (X_COLLAR_AFT + 0.13, R - 0.004, 0.05),
                     (X_COLLAR_AFT - 0.12, R + 0.022, -0.045), (X_COLLAR_AFT - 0.12, R + 0.022, 0.045)])
    parts["rail"] = painted(rail, silver)
    parts["bracket"] = painted(bracket, silver)
    # Чотири стабілізатори хрестом (під 45°, щоб не збігатися з напрямною).
    for i, roll in enumerate((45, 135, 225, 315)):
        parts[f"fin_{i}"] = painted(fin(X0 + 0.64, 0.62, 0.20, 0.30, 0.34, 0.022, roll, R * 0.96), finmat)
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
    for name, mesh in atacms().items():
        scene.add_geometry(mesh, node_name=name, geom_name=name)
    glb = scene.export(file_type="glb", include_normals=True)
    glb = with_extras(glb, {"title": "MGM-140 ATACMS (generated)", "generated": True,
                            "note": "Simplified procedural model from public overall dimensions (about 3.96 m long, 0.61 m diameter, black nose with yellow band, rail on top, four tail fins). Not a scan or copy of any other model."})
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(glb)
    size = np.ptp(np.array(scene.bounds), axis=0)
    print(f"{out.name}: {len(glb) / 1024:.0f} KB, {sum(len(m.faces) for m in scene.geometry.values())} triangles, extent {size[0]:.2f} x {size[1]:.2f} x {size[2]:.2f} m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
