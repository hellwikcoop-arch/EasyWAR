#!/usr/bin/env python3
"""Генерує спрощену процедурну модель РСЗВ M142 HIMARS для довідника (src/models/m142-himars.glb).

    pip install numpy scipy trimesh
    python3 script/build-himars-model.py [вихідний.glb]

Модель побудовано за відкритими габаритами (довжина ≈ 7 м, ширина ≈ 2,4 м, висота ≈ 3 м) і за довідковими зображеннями,
які надав користувач: колісне шасі 6×6 родини FMTV, броньована кабіна з гранчастим лобом, двома вітровими склами, ґратою
й бампером із фарами, паливний бак і ящики за кабіною, поворотна платформа та пусковий модуль з бортовими дверцятами,
одним пакетом із шести труб, що дивиться назад, і сріблястими напрямними зверху. Це не скан і не копія чужої моделі,
сторонніх текстур немає. Для перегляду, а не для впізнавання чи розрахунків. Одиниці — метри, перед машини дивиться в +x,
«вгору» — +y, права сторона — +z (як у glTF).
"""
import json
import struct
import sys
from pathlib import Path

import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "src" / "models" / "m142-himars.glb"

# Ребра мають фаски, тож згладжені нормалі дають м'які відблиски; плоскі нормалі лише для опуклих корпусів-оболонок.
FLAT = {"cab"}

# --- головні розміри, м ---------------------------------------------------------------------------------------------
AXLES = [2.24, -1.22, -2.52]          # передня вісь і задній тандем
WHEEL_R, WHEEL_Y, WHEEL_Z, WHEEL_W = 0.53, 0.53, 1.00, 0.42
FRAME_Y0, FRAME_Y1 = 0.98, 1.22        # низ і верх лонжеронів
CAB_FRONT = 3.30
MODULE = dict(x0=-3.50, x1=0.17, y0=1.34, y1=2.30, half=1.19)


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


def tyre(x, z):
    """Шина: тор із плечима навколо осі z, із грунтозачепами по колу."""
    r_in, r_out, w = 0.31, WHEEL_R, WHEEL_W / 2
    profile = [(r_in, -w), (r_out - 0.05, -w), (r_out, -w + 0.06), (r_out, w - 0.06), (r_out - 0.05, w), (r_in, w)]
    ring = trimesh.creation.revolve(np.array(profile, dtype=float), sections=40)
    ring.apply_translation((x, WHEEL_Y, z))
    lugs = []
    for k in range(34):
        a = 2 * np.pi * k / 34
        for dz, off in ((-0.085, 0.0), (0.085, np.pi / 34)):
            aa = a + off
            lug = trimesh.creation.box(extents=[0.075, 0.05, 0.15])
            lug.apply_transform(trimesh.transformations.rotation_matrix(aa + np.pi / 2, [0, 0, 1]))
            lug.apply_translation((x + (r_out + 0.012) * np.cos(aa), WHEEL_Y + (r_out + 0.012) * np.sin(aa), z + dz))
            lugs.append(lug)
    return ring, merge(lugs)


def himars():
    olive = material("Hull", (96, 100, 82), metallic=0.08, roughness=0.78)
    olive_dk = material("HullDark", (74, 78, 64), metallic=0.1, roughness=0.8)
    olive_lt = material("Pod", (108, 112, 92), metallic=0.1, roughness=0.7)
    rubber = material("Tyres", (52, 48, 44), metallic=0.0, roughness=0.95)
    black = material("Black", (26, 28, 26), metallic=0.1, roughness=0.65)
    glass = material("Glass", (92, 86, 78), metallic=0.5, roughness=0.18)
    amber = material("Amber", (240, 150, 30), metallic=0.0, roughness=0.3)
    white = material("Lamp", (238, 238, 228), metallic=0.0, roughness=0.25)
    red = material("Red", (176, 40, 32), metallic=0.0, roughness=0.35)
    steel = material("Steel", (150, 154, 150), metallic=0.8, roughness=0.3)
    parts = {}

    # Рама, мости, вузли під кабіною й за нею.
    parts["frame"] = painted(merge([
        box((-0.2, (FRAME_Y0 + FRAME_Y1) / 2, 0.0), (6.6, FRAME_Y1 - FRAME_Y0, 1.10)),
        box((-0.2, 1.10, 0.0), (6.6, 0.10, 1.34)),
    ]), olive_dk)
    parts["axles"] = painted(merge([cyl_between((x, WHEEL_Y, -WHEEL_Z + 0.1), (x, WHEEL_Y, WHEEL_Z - 0.1), 0.085) for x in AXLES]
                                    + [box((x, 0.80, 0.0), (0.32, 0.22, 0.34)) for x in AXLES]), olive_dk)
    parts["boxes_low"] = painted(merge([
        box((-0.10, 0.84, s * 0.80), (0.95, 0.46, 0.40)) for s in (-1, 1)
    ] + [
        cyl_between((0.62, 0.86, s * 0.80), (1.60, 0.86, s * 0.80), 0.19, 18) for s in (-1, 1)
    ]), olive)

    # Колеса: шини, обода з болтами.
    tyres, lugs, rims, bolts = [], [], [], []
    for x in AXLES:
        for s in (-1, 1):
            ring, lug = tyre(x, s * WHEEL_Z)
            tyres.append(ring)
            lugs.append(lug)
            rims.append(cyl_z((x, WHEEL_Y, s * (WHEEL_Z + 0.02)), 0.30, 0.34, 28))
            face = s * (WHEEL_Z + 0.195)
            rims.append(cyl_z((x, WHEEL_Y, face), 0.23, 0.04, 28))
            for k in range(12):
                a = 2 * np.pi * k / 12
                bolts.append(cyl_z((x + 0.18 * np.cos(a), WHEEL_Y + 0.18 * np.sin(a), face + s * 0.025), 0.017, 0.03, 8))
            bolts.append(cyl_z((x, WHEEL_Y, face + s * 0.04), 0.045, 0.05, 6))
    parts["tyres"] = painted(merge(tyres + lugs), rubber)
    parts["rims"] = painted(merge(rims), olive)
    parts["wheel_bolts"] = painted(merge(bolts), olive_dk)

    # Кабіна: гранчаста, з сколами верхніх і бічних ребер.
    levels = [(1.22, 3.12, 1.62, 1.10), (1.55, CAB_FRONT, 1.55, 1.12), (2.40, CAB_FRONT, 1.60, 1.12),
              (2.72, 3.22, 1.80, 1.05), (2.90, 3.02, 1.95, 0.95)]
    pts = []
    for y, xf, xr, half in levels:
        c, c2 = 0.36, 0.12
        pts += [(xf - c, y, -half), (xf, y, -(half - c)), (xf, y, half - c), (xf - c, y, half),
                (xr + c2, y, half), (xr, y, half - c2), (xr, y, -(half - c2)), (xr + c2, y, -half)]
    parts["cab"] = painted(hull(pts), olive)
    # Бічні двері з вікном і ручкою; вітрові скла, склоочисники, ґрата, круглий люк, лампи на даху.
    doors, door_glass, handles = [], [], []
    for s in (-1, 1):
        doors.append(box((2.45, 1.95, s * 1.125), (1.15, 1.25, 0.04)))
        door_glass.append(box((2.85, 2.38, s * 1.14), (0.36, 0.28, 0.03)))
        handles.append(box((2.00, 1.80, s * 1.15), (0.14, 0.05, 0.05)))
        handles.append(box((2.00, 2.38, s * 1.15), (0.06, 0.22, 0.05)))
    parts["doors"] = painted(merge(doors), olive_dk)
    parts["side_windows"] = painted(merge(door_glass), glass)
    parts["door_handles"] = painted(merge(handles), black)
    parts["windshields"] = painted(merge([box((CAB_FRONT + 0.012, 2.28, z), (0.03, 0.46, 0.88)) for z in (-0.52, 0.52)]), glass)
    parts["windshield_frames"] = painted(merge([box((CAB_FRONT + 0.004, 2.28, z), (0.02, 0.54, 0.96)) for z in (-0.52, 0.52)]), olive_dk)
    wipers = []
    for z in (-0.52, 0.52):
        wipers.append(cyl_between((CAB_FRONT + 0.03, 2.10, z - 0.35), (CAB_FRONT + 0.03, 2.22, z + 0.35), 0.008, 6))
    parts["wipers"] = painted(merge(wipers), black)
    parts["grille"] = painted(merge([box((CAB_FRONT + 0.012, 1.78, 0.0), (0.03, 0.40, 0.84))]
                                    + [box((CAB_FRONT + 0.03, 1.78 + k * 0.10, 0.0), (0.02, 0.025, 0.84)) for k in (-1, 0, 1)]
                                    + [box((CAB_FRONT + 0.03, 1.78, k * 0.28), (0.02, 0.40, 0.025)) for k in (-1, 0, 1)]), black)
    parts["round_cover"] = painted(cyl_between((CAB_FRONT, 1.82, 0.74), (CAB_FRONT + 0.04, 1.82, 0.74), 0.13, 24), olive_dk)
    parts["roof_hatch"] = painted(merge([box((2.40, 2.93, 0.0), (0.95, 0.06, 0.92)), box((2.40, 2.97, 0.0), (0.75, 0.05, 0.72))]), olive_dk)
    parts["roof_lamps"] = painted(merge([box((3.14, 2.78, z), (0.10, 0.07, 0.14)) for z in (-0.80, -0.40, 0.0, 0.40, 0.80)]), amber)

    # Бампер, фари, буксирні вушка, нижня решітка.
    parts["bumper"] = painted(merge([
        box((CAB_FRONT + 0.20, 1.12, 0.0), (0.30, 0.28, 2.30)),
        prism_plan([(CAB_FRONT + 0.05, -0.55), (CAB_FRONT + 0.34, -0.38), (CAB_FRONT + 0.34, 0.38), (CAB_FRONT + 0.05, 0.55)], 0.94, 1.12),
        box((CAB_FRONT + 0.10, 0.88, 0.0), (0.26, 0.20, 1.10)),
    ]), olive_dk)
    parts["lamps"] = painted(merge([cyl_between((CAB_FRONT + 0.35, 1.14, z), (CAB_FRONT + 0.41, 1.14, z), 0.085, 18) for z in (-0.84, 0.84)]), white)
    parts["lamps_amber"] = painted(merge([cyl_between((CAB_FRONT + 0.35, 1.14, z), (CAB_FRONT + 0.40, 1.14, z), 0.06, 14) for z in (-1.03, -0.62, 0.62, 1.03)]), amber)
    parts["tow_hooks"] = painted(merge([box((CAB_FRONT + 0.37, 1.12, z), (0.05, 0.14, 0.12)) for z in (-0.22, 0.22)]), black)
    parts["lower_vent"] = painted(merge([box((CAB_FRONT + 0.18, 0.86 + k * 0.05, 0.0), (0.18, 0.02, 0.95)) for k in range(4)]), black)

    # Дзеркала на кронштейнах.
    mirrors, arms = [], []
    for s in (-1, 1):
        mirrors.append(box((3.02, 2.10, s * 1.42), (0.07, 0.42, 0.22)))
        arms.append(cyl_between((3.05, 1.78, s * 1.30), (3.05, 2.55, s * 1.30), 0.018, 8))
        arms.append(cyl_between((3.05, 2.50, s * 1.30), (3.05, 2.50, s * 1.15), 0.018, 8))
        arms.append(cyl_between((3.05, 1.82, s * 1.30), (3.05, 1.82, s * 1.15), 0.018, 8))
        arms.append(cyl_between((3.05, 2.00, s * 1.38), (3.05, 2.22, s * 1.38), 0.018, 8))
    parts["mirrors"] = painted(merge(mirrors), black)
    parts["mirror_arms"] = painted(merge(arms), black)

    # Ящики й вихлоп за кабіною, дуга пакета.
    parts["equipment"] = painted(merge([
        box((1.02, 1.95, s * 0.93), (0.78, 1.20, 0.38)) for s in (-1, 1)
    ] + [
        box((1.38, 1.50, s * 0.93), (0.58, 0.55, 0.38)) for s in (-1, 1)
    ] + [
        box((0.50, 2.58, s * 0.74), (0.34, 0.65, 0.26)) for s in (-1, 1)
    ] + [
        box((0.50, 2.88, 0.0), (0.34, 0.14, 1.74)),
    ]), olive)
    parts["exhaust"] = painted(cyl_between((1.55, 2.15, 0.86), (1.55, 2.85, 0.86), 0.075, 14), olive_dk)

    # Поворотна платформа й пусковий модуль: стінки, підлога, передня стінка, дверцята на бортах.
    M = MODULE
    parts["turntable"] = painted(merge([
        box(((M["x0"] + M["x1"]) / 2 + 0.1, 1.28, 0.0), (M["x1"] - M["x0"] + 0.0, 0.12, 2.10)),
        cyl_between((-1.60, 1.34, 0.0), (-1.60, 1.40, 0.0), 1.00, 40),
    ]), olive_dk)
    right_wall = [(M["x0"], 0.60), (M["x0"], M["half"]), (-0.15, M["half"]), (M["x1"], 0.88), (M["x1"], 0.60)]
    left_wall = [(x, -z) for (x, z) in right_wall]
    walls = [prism_plan(right_wall, M["y0"], M["y1"]), prism_plan(left_wall, M["y0"], M["y1"]),
             box((M["x1"] - 0.06, (M["y0"] + M["y1"]) / 2, 0.0), (0.12, M["y1"] - M["y0"], 1.30)),
             box(((M["x0"] + M["x1"]) / 2, M["y0"] + 0.10, 0.0), (M["x1"] - M["x0"], 0.20, 1.30))]
    parts["module"] = painted(merge(walls), olive)
    panels, knobs = [], []
    for s in (-1, 1):
        for xc in (-2.85, -1.75, -0.65):
            panels.append(box((xc, 1.82, s * (M["half"] + 0.012)), (1.00, 0.74, 0.03)))
            knobs.append(box((xc + 0.40, 1.82, s * (M["half"] + 0.035)), (0.04, 0.12, 0.03)))
    parts["module_doors"] = painted(merge(panels), olive_dk)
    parts["module_handles"] = painted(merge(knobs), black)
    # Пакет: шість труб (3 × 2), що дивляться назад, і темні кільця-торці.
    tubes, caps = [], []
    for dz in (-0.31, 0.0, 0.31):
        for y in (1.72, 2.04):
            tubes.append(cyl_x(-3.28, 0.00, y, dz, 0.145, 24))
            caps.append(cyl_x(-3.295, -3.27, y, dz, 0.128, 24))
    parts["pod_tubes"] = painted(merge(tubes), olive_lt)
    parts["pod_caps"] = painted(merge(caps), olive_dk)
    # «Вуха» й перемичка на задньому торці, поперечки зверху.
    parts["module_rear"] = painted(merge([
        box((M["x0"] + 0.06, 2.22, s * 0.72), (0.14, 0.34, 0.28)) for s in (-1, 1)
    ] + [
        box((M["x0"] + 0.04, 1.44, 0.0), (0.12, 0.18, 1.30)),
        box((-1.60, 2.33, 0.0), (0.10, 0.06, 1.28)), box((-2.55, 2.33, 0.0), (0.10, 0.06, 1.28)),
        box((-0.55, 2.33, 0.0), (0.10, 0.06, 1.28)),
    ]), olive_dk)
    # Срібні напрямні по краях пакета, що виходять уперед до кабіни.
    parts["rails"] = painted(merge([cyl_x(-3.25, 0.95, 2.30, s * 0.56, 0.042, 14) for s in (-1, 1)]
                                   + [cyl_x(0.17, 0.95, 2.04, s * 0.30, 0.050, 14) for s in (-1, 1)]), steel)

    # Корма: бампер, ліхтарі, фаркоп.
    parts["rear_beam"] = painted(merge([
        box((-3.55, 1.05, 0.0), (0.26, 0.24, 2.30)),
        box((-3.40, 0.82, 0.0), (0.12, 0.10, 2.10)),
    ]), olive_dk)
    parts["rear_red"] = painted(merge([box((-3.69, 1.12, s * 0.90), (0.04, 0.16, 0.20)) for s in (-1, 1)]
                                      + [box((-3.69, 1.18, s * 0.60), (0.04, 0.10, 0.12)) for s in (-1, 1)]), red)
    parts["rear_amber"] = painted(merge([box((-3.69, 1.00, s * 0.90), (0.04, 0.08, 0.10)) for s in (-1, 1)]), amber)
    parts["hitch"] = painted(cyl_between((-3.68, 0.98, 0.0), (-3.90, 0.98, 0.0), 0.05, 12), black)
    # Заклепки: ряди по краях бортів пускового модуля та по лонжеронах рами (як на довідкових знімках).
    rivets = []
    def rivet(x, y, z, s):
        return cyl_between((x, y, z), (x, y, z + s * 0.012), 0.011, 6)
    for s in (-1, 1):
        zf = s * (M["half"] + 0.002)
        for x in np.arange(M["x0"] + 0.08, -0.15, 0.14):
            for y in (M["y0"] + 0.05, M["y1"] - 0.05):
                rivets.append(rivet(x, y, zf, s))
        for xc in (-3.37, -2.30, -1.20, -0.10):
            for y in np.arange(M["y0"] + 0.15, M["y1"] - 0.1, 0.12):
                rivets.append(rivet(xc, y, zf, s))
        for x in np.arange(-3.25, 1.45, 0.11):
            for y in (1.07, 1.15):
                rivets.append(rivet(x, y, s * 0.672, s))
    parts["rivets"] = painted(merge(rivets), olive_dk)
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
    for name, mesh in himars().items():
        if name in FLAT:
            mesh.unmerge_vertices()  # плоске освітлення лише для великих гранчастих корпусів без фасок
        scene.add_geometry(mesh, node_name=name, geom_name=name)
    glb = scene.export(file_type="glb", include_normals=True)
    glb = with_extras(glb, {"title": "M142 HIMARS (generated)", "generated": True,
                            "note": "Simplified procedural model from public overall dimensions (about 7 m long, 2.4 m wide, 6x6 FMTV chassis, armoured cab, one six-tube pod facing aft). Not a scan or copy of any other model."})
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(glb)
    size = np.ptp(np.array(scene.bounds), axis=0)
    print(f"{out.name}: {len(glb) / 1024:.0f} KB, {sum(len(m.faces) for m in scene.geometry.values())} triangles, extent {size[0]:.2f} x {size[1]:.2f} x {size[2]:.2f} m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
