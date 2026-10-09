"""Спільні деталі для скриптів, що генерують колісні й гусеничні машини довідника (build-*-model.py).

Одиниці — метри; перед машини дивиться в +x, «вгору» — +y, права сторона — +z (як у glTF). Усі форми будуються з нуля
(коробки зі сколеними ребрами, циліндри, опуклі оболонки), сторонніх мешів немає.
"""
import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial


def material(name, rgb, metallic=0.08, roughness=0.75):
    linear = [round(255 * (c / 255) ** 2.2) for c in rgb]  # glTF чекає лінійні кольори
    return PBRMaterial(name=name, baseColorFactor=[*linear, 255], metallicFactor=metallic, roughnessFactor=roughness)


def painted(mesh, mat):
    mesh.visual = trimesh.visual.TextureVisuals(material=mat)
    return mesh


def merge(meshes):
    return trimesh.util.concatenate(meshes)


def bevelled(extents, bevel=None):
    """Паралелепіпед зі сколеними ребрами (фаска ~2,5 см): грані ловлять світло, як на справжньому металі."""
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


def box(center, extents, rot_z=0.0, rot_y=0.0, bevel=None):
    m = bevelled(extents, bevel)
    if rot_z:
        m.apply_transform(trimesh.transformations.rotation_matrix(rot_z, [0, 0, 1]))
    if rot_y:
        m.apply_transform(trimesh.transformations.rotation_matrix(rot_y, [0, 1, 0]))
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


def level_hull(levels):
    """Опукла оболонка за рівнями (y, x_перед, x_зад, півширина, скіс кутів спереду)."""
    pts = []
    for y, xf, xr, hw, ch in levels:
        pts += [(xf - ch, y, -hw), (xf - ch, y, hw), (xf, y, -hw + ch), (xf, y, hw - ch), (xr, y, -hw), (xr, y, hw)]
    return hull(pts)


def rivet(x, y, z, axis, r=0.011, h=0.012):
    """Заклепка на поверхні, звернена вздовж осі `axis` (+-1, 0, 0), (0, 0, +-1) тощо: пірамідка з 4 граней."""
    a = np.array(axis, float)
    p = np.array((x, y, z), float)
    u = np.array([0.0, 1.0, 0.0]) if abs(a[1]) < 0.5 else np.array([1.0, 0.0, 0.0])
    v = np.cross(a, u)
    base = [p + r * (np.cos(k * np.pi / 2) * u + np.sin(k * np.pi / 2) * v) for k in range(4)]
    verts = np.array(base + [p + a * h])
    faces = [[k, (k + 1) % 4, 4] for k in range(4)]
    m = trimesh.Trimesh(verts, faces, process=False)
    if np.dot(m.face_normals[0], a) < 0:
        m.invert()
    return m


def rivet_row(p0, p1, step, axis, **kw):
    """Ряд заклепок від p0 до p1 з кроком step."""
    p0, p1 = np.array(p0, float), np.array(p1, float)
    n = max(2, int(np.linalg.norm(p1 - p0) / step) + 1)
    return [rivet(*(p0 + (p1 - p0) * k / (n - 1)), axis, **kw) for k in range(n)]


def tyre(x, y, z, r_out=0.53, width=0.40, r_in=0.30, lug_count=26, lug_len=0.17, tilt=0.45):
    """Шина з закругленими плечима й ялинковим протектором (два ряди скошених грунтозачепів). z — центр шини по ширині."""
    w = width / 2
    profile = [(r_in, -w + 0.01), (r_out - 0.06, -w), (r_out - 0.015, -w + 0.04), (r_out, -w + 0.09),
               (r_out, w - 0.09), (r_out - 0.015, w - 0.04), (r_out - 0.06, w), (r_in, w - 0.01)]
    ring = trimesh.creation.revolve(np.array(profile, dtype=float), sections=48)
    ring.apply_translation((x, y, z))
    lugs = []
    for k in range(lug_count):
        a = 2 * np.pi * k / lug_count
        for side in (-1, 1):
            aa = a + (np.pi / lug_count if side > 0 else 0.0)
            lug = trimesh.creation.box(extents=[0.09, 0.034, lug_len])
            lug.apply_transform(trimesh.transformations.rotation_matrix(side * tilt, [0, 1, 0]))
            lug.apply_transform(trimesh.transformations.rotation_matrix(aa + np.pi / 2, [0, 0, 1]))
            r = r_out + 0.012
            lug.apply_translation((x + r * np.cos(aa), y + r * np.sin(aa), z + side * width * 0.23))
            lugs.append(lug)
    return ring, merge(lugs)


def wheel_rim(x, y, z, s, r_rim=0.31, bolts_r=0.19, n_bolts=20, depth=0.17):
    """Глибокий обід: тарілка, кільце болтів, маточина. s = ±1 — сторона, z — вісь шини."""
    face = z + s * depth
    rim, bolts = [], []
    rim.append(cyl_z((x, y, z + s * 0.04), r_rim, 0.24, 36))
    rim.append(cyl_z((x, y, face), r_rim - 0.05, 0.03, 36))
    rim.append(cyl_z((x, y, face + s * 0.025), 0.12, 0.04, 24))
    for k in range(n_bolts):
        a = 2 * np.pi * k / n_bolts
        bolts.append(cyl_z((x + bolts_r * np.cos(a), y + bolts_r * np.sin(a), face + s * 0.02), 0.016, 0.03, 5))
    for k in range(8):
        a = 2 * np.pi * k / 8
        bolts.append(cyl_z((x + 0.085 * np.cos(a), y + 0.085 * np.sin(a), face + s * 0.05), 0.011, 0.02, 6))
    bolts.append(cyl_z((x, y, face + s * 0.06), 0.045, 0.05, 6))
    return rim, bolts


def wheel_set(axles, wheel_r, wheel_y, wheel_z, width, r_rim=None, **tyre_kw):
    """Усі колеса машини: (шини, обіди, болти) — три списки призм."""
    tyres, rims, bolts = [], [], []
    for x in axles:
        for s in (-1, 1):
            ring, lug = tyre(x, wheel_y, s * wheel_z, r_out=wheel_r, width=width, **tyre_kw)
            tyres += [ring, lug]
            r, b = wheel_rim(x, wheel_y, s * (wheel_z - 0.0), s, r_rim=r_rim or wheel_r * 0.58, depth=width * 0.42)
            rims += r
            bolts += b
    return tyres, rims, bolts


def leaf_spring(x, y, z, length=0.9):
    """Ресора з трьох листів, що розходяться."""
    return [box((x, y - 0.012 * k, z), (length - 0.16 * k, 0.018, 0.09)) for k in range(3)]


def jerrycan(center, axis_z=0.0):
    """Каністра 20 л: коробка з ручкою й горловиною."""
    cx, cy, cz = center
    return [box((cx, cy, cz), (0.34, 0.46, 0.16), bevel=0.02), box((cx, cy + 0.26, cz), (0.14, 0.05, 0.10), bevel=0.01),
            cyl_between((cx - 0.12, cy + 0.25, cz), (cx + 0.12, cy + 0.25, cz), 0.015, 8)]


def mirror(center, side, h=0.42, w=0.22):
    """Дзеркало на двох кронштейнах (side = ±1)."""
    cx, cy, cz = center
    arms = [cyl_between((cx, cy + 0.15, cz), (cx - 0.04, cy + 0.15, cz + side * 0.22), 0.012, 8),
            cyl_between((cx, cy - 0.15, cz), (cx - 0.04, cy - 0.15, cz + side * 0.22), 0.012, 8)]
    return arms, box((cx - 0.04, cy, cz + side * 0.24), (0.05, h, w), bevel=0.012)


def lamp_pair(x, y, z, r=0.05, depth=0.03, facing=1):
    return cyl_between((x, y, z), (x + facing * depth, y, z), r, 16)


def ladder_steps(x, y_bot, z, n=3, step=0.26, width=0.30):
    return [box((x, y_bot + k * step, z), (0.10, 0.03, width), bevel=0.005) for k in range(n)]


def stripes(x, y, z, count, pitch, size):
    """Ряд плоских ребер (жалюзі, ґрати): count коробок із кроком pitch вздовж y."""
    return [box((x, y + k * pitch, z), size, bevel=0.004) for k in range(count)]


def slope_box(p0, p1, t, offset, extents, z, rot_extra=0.0):
    """Пластина на похилій площині (p0→p1 у площині x–y); t — частка довжини, offset — назовні."""
    p0, p1 = np.array(p0, float), np.array(p1, float)
    d = p1 - p0
    length = np.linalg.norm(d)
    d /= length
    n = np.array([d[1], -d[0]])
    c = p0 + d * (t * length) + n * offset
    # extents = (товщина вздовж нормалі, довжина вздовж схилу, ширина по z)
    return box((c[0], c[1], z), (extents[1], extents[0], extents[2]), rot_z=np.arctan2(d[1], d[0]) + rot_extra)


def beam_between(a, b, thick_y, thick_z, bevel=None):
    """Прямокутна балка між двома точками площини x–y (стріла крана, розкоси); z-центр береться з a."""
    a, b = np.array(a, float), np.array(b, float)
    d = b - a
    length = float(np.linalg.norm(d[:2]))
    c = (a + b) / 2
    return box((c[0], c[1], a[2]), (length, thick_y, thick_z), rot_z=float(np.arctan2(d[1], d[0])), bevel=bevel)


def spare_wheel_x(center, r_out=0.53, width=0.40, lug_count=26, axis="x"):
    """Запасне колесо, що стоїть на ребрі: axis='x' — вісь уздовж x (впритул до стінки), 'z' — уздовж z (збоку)."""
    ring, lug = tyre(0.0, 0.0, 0.0, r_out=r_out, width=width, lug_count=lug_count)
    for m in (ring, lug):
        if axis == "x":
            m.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0]))
        m.apply_translation(center)
    return ring, lug
