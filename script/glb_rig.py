"""Спільне для генераторів наземних машин (M270, HIMARS): запис GLB з ієрархією вузлів і анімацією та транспортно-
пусковий пакет LP/C (відкрита сталева рама з розкосами, шість труб, кришки або щит з отворами), як на довідкових зображеннях.

Пакет будується в «канонічній» системі: початок — середина низу, дула труб дивляться в +x. Генератор ставить вузол
пакета на місце й за потреби повертає його (у HIMARS дула дивляться назад).
"""
import json
import struct

import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial


def ramp(t, span):
    """Плавний перехід 0 → 1 на відрізку span = (a, b)."""
    a, b = span
    k = np.clip((t - a) / (b - a), 0.0, 1.0)
    return k * k * (3 - 2 * k)


def quat_axis(axis, angle):
    s = np.sin(angle / 2)
    return np.array([axis[0] * s, axis[1] * s, axis[2] * s, np.cos(angle / 2)])


def node(name, prims=(), t=(0.0, 0.0, 0.0), r=(0.0, 0.0, 0.0, 1.0), s=(1.0, 1.0, 1.0), children=()):
    """Опис вузла: prims — пари (сітка, матеріал), t/r/s — початкова поза (кадр 0 анімації)."""
    return {"name": name, "prims": list(prims), "t": [float(x) for x in t], "r": [float(x) for x in r],
            "s": [float(x) for x in s], "children": list(children)}


def shifted(m, dx=0.0, dy=0.0, dz=0.0):
    m.apply_translation([dx, dy, dz])
    return m


def _box(center, extents, rot_z=0.0, bevel=0.0):
    ex, ey, ez = (e / 2 for e in extents)
    b = bevel
    if b <= 0:
        m = trimesh.creation.box(extents=extents)
    else:
        pts = []
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    pts += [(sx * ex, sy * (ey - b), sz * (ez - b)), (sx * (ex - b), sy * ey, sz * (ez - b)),
                            (sx * (ex - b), sy * (ey - b), sz * ez)]
        m = trimesh.convex.convex_hull(np.array(pts))
    m.apply_transform(trimesh.transformations.rotation_matrix(rot_z, [0, 0, 1]))
    m.apply_translation(center)
    return m


def _cyl_x(x0, x1, y, z, radius, sections=24):
    m = trimesh.creation.cylinder(radius=radius, height=x1 - x0, sections=sections)
    m.apply_transform(trimesh.geometry.align_vectors([0, 0, 1], [1, 0, 0]))
    m.apply_translation([(x0 + x1) / 2, y, z])
    return m


def pbr(name, rgb, metallic=0.1, roughness=0.65):
    """PBR-матеріал; колір задано в sRGB (0–255), glTF чекає лінійні значення."""
    linear = [round(255 * (c / 255) ** 2.2) for c in rgb]
    return PBRMaterial(name=name, baseColorFactor=[*linear, 255], metallicFactor=metallic, roughnessFactor=roughness)


# Матеріали пакета — спільні для обох машин, кольори за довідковим зображенням пакета M26.
POD_MATS = {
    "frame": pbr("PodFrame", (110, 112, 78), metallic=0.25, roughness=0.6),
    "tubes": pbr("PodTube", (140, 140, 106), metallic=0.15, roughness=0.45),
    "cap": pbr("PodCap", (164, 160, 114), metallic=0.1, roughness=0.55),
    "cap_dk": pbr("PodCapRing", (120, 118, 84), metallic=0.1, roughness=0.6),
    "bulkhead": pbr("PodBulkhead", (126, 128, 122), metallic=0.35, roughness=0.5),
    "hole": pbr("PodHole", (20, 21, 20), metallic=0.2, roughness=0.8),
    "stencil": pbr("Stencil", (214, 210, 196), metallic=0.0, roughness=0.8),
}


def _torus_x(center, major, minor):
    """Кільце у вертикальній площині вздовж пакета (вісь тора — z)."""
    t = trimesh.creation.torus(major_radius=major, minor_radius=minor, major_sections=14, minor_sections=6)
    t.apply_translation(center)
    return t


def lpc_pod(length, height, half, fresh, lugs):
    """Пакет за довідковим зображенням (M26 rocket pod): шість щільно покладених труб у два ряди, кутові балки, полози
    знизу з упорами на торцях, поперечні смуги й центральна плита з ручкою зверху, D-кільця на верхніх кутах, по три
    стійки на борт із розкосами лише в крайніх прольотах. На дульному торці — сірий щит із шістьма отворами
    (після пуску) або кришки з кільцем і чотирма виступами (новий пакет). lugs — вушка для підйому від середини."""
    L2, H, W = length / 2, height, half
    frame, tubes, ends, rings, skids, stencil = [], [], [], [], [], []
    for y in (0.035, H - 0.03):                                                    # кутові балки
        for s in (-1, 1):
            frame.append(_box((0.0, y, s * (W - 0.03)), (length, 0.06, 0.06), bevel=0.008))
    for s in (-1, 1):                                                              # полози з упорами
        skids.append(_box((0.0, 0.02, s * (W - 0.05)), (length + 0.10, 0.04, 0.10), bevel=0.006))
    for x in (-L2 + 0.03, L2 - 0.03):                                              # торцеві рамки
        for s in (-1, 1):
            frame.append(_box((x, H / 2, s * (W - 0.03)), (0.06, H, 0.06)))
        for y in (0.035, H - 0.03):
            frame.append(_box((x, y, 0.0), (0.06, 0.06, 2 * W)))
    posts = [-L2 + length * f for f in (0.25, 0.5, 0.75)]
    for x in posts:                                                                # стійки
        for s in (-1, 1):
            frame.append(_box((x, H / 2, s * (W - 0.02)), (0.05, H - 0.08, 0.035)))
    bay = length * 0.25
    diag, ang = np.hypot(bay - 0.06, H - 0.12), np.arctan2(H - 0.12, bay - 0.06)
    for xc, a in ((-L2 + bay / 2, ang), (L2 - bay / 2, -ang)):                     # розкоси в крайніх прольотах
        for s in (-1, 1):
            frame.append(_box((xc, H / 2, s * (W - 0.012)), (diag, 0.04, 0.02), rot_z=a))
    for f in (0.10, 0.30, 0.70, 0.90):                                             # поперечні смуги зверху
        frame.append(_box((-L2 + length * f, H - 0.005, 0.0), (0.05, 0.015, 2 * W)))
    frame.append(_box((0.0, H - 0.004, 0.0), (length * 0.20, 0.02, 2 * W - 0.02)))   # центральна плита
    frame.append(_box((0.0, H + 0.025, 0.0), (0.26, 0.03, 0.05)))                     # ручка
    frame += [_box((x, H + 0.015, 0.0), (0.03, 0.03, 0.05)) for x in (-0.13, 0.13)]
    for lx in lugs:                                                                # вушка для підйому
        frame.append(_box((lx, H + 0.02, 0.0), (0.08, 0.05, 0.05)))
    for x in (-L2 + 0.18, L2 - 0.18):                                              # D-кільця на верхніх кутах
        for s in (-1, 1):
            rings.append(_torus_x((x, H + 0.02, s * (W - 0.03)), 0.035, 0.008))
    r = min((H - 0.06) / 4, (2 * W - 0.06) / 6)                                     # труби впритул одна до одної
    rows = (0.03 + (H - 0.06) * 0.25, 0.03 + (H - 0.06) * 0.75)
    cols = (-2 * r, 0.0, 2 * r)
    for y in rows:
        for z in cols:
            tubes.append(_cyl_x(-L2 + 0.06, L2 - 0.01, y, z, r - 0.004, 32))
    if fresh:                                                                      # кришки: диск, кільце, чотири виступи
        caps, caps_dk = [], []
        for y in rows:
            for z in cols:
                caps.append(_cyl_x(L2 - 0.01, L2 + 0.025, y, z, r - 0.012, 32))
                caps_dk.append(_cyl_x(L2 + 0.025, L2 + 0.032, y, z, r * 0.78, 28))
                caps.append(_cyl_x(L2 + 0.032, L2 + 0.036, y, z, r * 0.70, 28))
                for k in range(4):
                    q = np.pi / 4 + k * np.pi / 2
                    caps_dk.append(_box((L2 + 0.03, y + 0.82 * r * np.sin(q), z + 0.82 * r * np.cos(q)), (0.02, 0.035, 0.035)))
        end_prims = [(trimesh.util.concatenate(caps), POD_MATS["cap"]), (trimesh.util.concatenate(caps_dk), POD_MATS["cap_dk"])]
    else:                                                                          # щит із шістьма отворами
        plate = [_box((L2 - 0.005, H / 2, 0.0), (0.02, H - 0.05, 2 * W - 0.05))]
        holes = [_cyl_x(L2 + 0.005, L2 + 0.009, y, z, r - 0.03, 32) for y in rows for z in cols]
        end_prims = [(trimesh.util.concatenate(plate), POD_MATS["bulkhead"]), (trimesh.util.concatenate(holes), POD_MATS["hole"])]
    ends.append(_box((-L2 + 0.035, H / 2, 0.0), (0.03, H - 0.06, 2 * W - 0.06)))      # глухий задній торець
    for s in (-1, 1):                                                              # кілька трафаретів на балках
        for x in (-L2 * 0.62, L2 * 0.42):
            stencil.append(_box((x, H - 0.03, s * (W + 0.0015)), (0.30, 0.03, 0.003)))
    cat = trimesh.util.concatenate
    return ([(cat(frame), POD_MATS["frame"]), (cat(skids), POD_MATS["frame"]), (cat(rings), POD_MATS["frame"]),
             (cat(tubes), POD_MATS["tubes"]), (cat(ends), POD_MATS["frame"]), (cat(stencil), POD_MATS["stencil"])] + end_prims)


class GlbWriter:
    """Мінімальний запис glTF 2.0: вершини, нормалі, індекси, PBR-матеріали, ієрархія вузлів із TRS і один анімаційний кліп."""

    def __init__(self, generator):
        self.bin = bytearray()
        self.doc = {"asset": {"version": "2.0", "generator": generator}, "scene": 0, "scenes": [{"nodes": []}],
                    "nodes": [], "meshes": [], "materials": [], "accessors": [], "bufferViews": [], "buffers": []}
        self.mat_index = {}
        self.triangles = 0

    def view(self, data: bytes, target=None):
        self.bin += b"\0" * (-len(self.bin) % 4)
        v = {"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(data)}
        if target:
            v["target"] = target
        self.bin += data
        self.doc["bufferViews"].append(v)
        return len(self.doc["bufferViews"]) - 1

    def accessor(self, arr, kind, target=None, minmax=False):
        arr = np.ascontiguousarray(arr)
        comp = {np.dtype("float32"): 5126, np.dtype("uint16"): 5123, np.dtype("uint32"): 5125}[arr.dtype]
        a = {"bufferView": self.view(arr.tobytes(), target), "componentType": comp, "count": int(arr.shape[0]), "type": kind}
        if minmax:
            flat = arr.reshape(arr.shape[0], -1)
            a["min"] = [float(x) for x in flat.min(axis=0)]
            a["max"] = [float(x) for x in flat.max(axis=0)]
        self.doc["accessors"].append(a)
        return len(self.doc["accessors"]) - 1

    def material(self, mat):
        if mat.name not in self.mat_index:
            r, g, b, a = (c / 255 for c in mat.baseColorFactor)
            self.doc["materials"].append({"name": mat.name, "pbrMetallicRoughness": {
                "baseColorFactor": [round(r, 6), round(g, 6), round(b, 6), round(a, 6)],
                "metallicFactor": float(mat.metallicFactor), "roughnessFactor": float(mat.roughnessFactor)}})
            self.mat_index[mat.name] = len(self.doc["materials"]) - 1
        return self.mat_index[mat.name]

    def mesh(self, name, prims):
        out = []
        for m, mat in prims:
            pos = np.asarray(m.vertices, dtype=np.float32)
            nrm = np.asarray(m.vertex_normals, dtype=np.float32)
            idx = np.asarray(m.faces, dtype=np.uint16 if len(pos) < 65536 else np.uint32).reshape(-1)
            self.triangles += len(m.faces)
            out.append({"attributes": {"POSITION": self.accessor(pos, "VEC3", 34962, True), "NORMAL": self.accessor(nrm, "VEC3", 34962)},
                        "indices": self.accessor(idx, "SCALAR", 34963), "material": self.material(mat)})
        self.doc["meshes"].append({"name": name, "primitives": out})
        return len(self.doc["meshes"]) - 1

    def add(self, spec, parent=None):
        n = {"name": spec["name"]}
        if spec["prims"]:
            n["mesh"] = self.mesh(spec["name"], spec["prims"])
        if any(spec["t"]):
            n["translation"] = spec["t"]
        if spec["r"] != [0.0, 0.0, 0.0, 1.0]:
            n["rotation"] = spec["r"]
        if spec["s"] != [1.0, 1.0, 1.0]:
            n["scale"] = spec["s"]
        self.doc["nodes"].append(n)
        i = len(self.doc["nodes"]) - 1
        if parent is None:
            self.doc["scenes"][0]["nodes"].append(i)
        else:
            self.doc["nodes"][parent].setdefault("children", []).append(i)
        for c in spec["children"]:
            self.add(c, i)
        return i

    def animation(self, name, times, tracks):
        """tracks — (назва вузла, 'translation' | 'rotation' | 'scale', значення для кожного моменту times)."""
        index = {n["name"]: i for i, n in enumerate(self.doc["nodes"])}
        t_acc = self.accessor(np.asarray(times, dtype=np.float32), "SCALAR", minmax=True)
        samplers, channels = [], []
        for node_name, path, values in tracks:
            kind = "VEC4" if path == "rotation" else "VEC3"
            v_acc = self.accessor(np.asarray(values, dtype=np.float32), kind, minmax=True)
            samplers.append({"input": t_acc, "output": v_acc, "interpolation": "LINEAR"})
            channels.append({"sampler": len(samplers) - 1, "target": {"node": index[node_name], "path": path}})
        self.doc["animations"] = [{"name": name, "samplers": samplers, "channels": channels}]

    def glb(self, extras):
        self.doc["asset"]["extras"] = extras
        self.bin += b"\0" * (-len(self.bin) % 4)
        self.doc["buffers"] = [{"byteLength": len(self.bin)}]
        raw = json.dumps(self.doc, separators=(",", ":"), ensure_ascii=False).encode()
        raw += b" " * (-len(raw) % 4)
        total = 12 + 8 + len(raw) + 8 + len(self.bin)
        return (struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(raw), b"JSON") + raw
                + struct.pack("<I4s", len(self.bin), b"BIN\0") + bytes(self.bin))
