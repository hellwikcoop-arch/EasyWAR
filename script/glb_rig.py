"""Спільне для генераторів наземних машин (M270, HIMARS): запис GLB з ієрархією вузлів і анімацією та транспортно-
пусковий пакет LP/C (відкрита сталева рама з розкосами, шість труб, вушка й трафаретні написи), як на довідкових фото.

Пакет будується в «канонічній» системі: початок — середина низу, дула труб дивляться в +x. Генератор ставить вузол
пакета на місце й за потреби повертає його (у HIMARS дула дивляться назад).
"""
import json
import struct

import numpy as np
import trimesh


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


def lpc_pod(length, height, half, fresh, mats, lugs):
    """Пакет: рама з кутових поздовжніх балок, торцевих рамок, стійок і розкосів; шість труб; на дульному торці
    кришки (новий пакет) або порожні отвори (після пуску); вушка для підйому на відстанях lugs від середини."""
    L2, H, W = length / 2, height, half
    frame, tubes, plate, ends, stencil, red = [], [], [], [], [], []
    for y in (0.03, H - 0.03):                                                     # кутові балки
        for s in (-1, 1):
            frame.append(_box((0.0, y, s * (W - 0.03)), (length, 0.06, 0.06), bevel=0.008))
    for x in (-L2 + 0.03, L2 - 0.03):                                              # торцеві рамки
        for s in (-1, 1):
            frame.append(_box((x, H / 2, s * (W - 0.03)), (0.06, H, 0.06)))
        for y in (0.03, H - 0.03):
            frame.append(_box((x, y, 0.0), (0.06, 0.06, 2 * W)))
    bays = 5
    bay = length / bays
    for k in range(1, bays):                                                       # стійки
        x = -L2 + k * bay
        for s in (-1, 1):
            frame.append(_box((x, H / 2, s * (W - 0.02)), (0.05, H - 0.08, 0.04)))
    diag = np.hypot(bay - 0.06, H - 0.10)
    for k in range(bays):                                                          # розкоси, по черзі в різні боки
        xc = -L2 + (k + 0.5) * bay
        ang = np.arctan2(H - 0.10, bay - 0.06) * (1 if k % 2 == 0 else -1)
        for s in (-1, 1):
            frame.append(_box((xc, H / 2, s * (W - 0.015)), (diag, 0.045, 0.03), rot_z=ang))
    for lx in lugs:                                                                # поперечки з вушками зверху
        frame.append(_box((lx, H - 0.02, 0.0), (0.07, 0.04, 2 * W)))
        frame.append(_box((lx, H + 0.03, 0.0), (0.09, 0.07, 0.05)))
    r = min(0.15, (H - 0.10) / 4.2, (2 * W - 0.08) / 6.4)
    rows = (0.05 + (H - 0.10) * 0.26, 0.05 + (H - 0.10) * 0.74)
    cols = (-(2 * W) / 3.2, 0.0, (2 * W) / 3.2)
    for y in rows:
        for z in cols:
            tubes.append(_cyl_x(-L2 + 0.06, L2, y, z, r, 24))
            if fresh:                                                              # кришка нової труби
                ends.append(_cyl_x(L2, L2 + 0.025, y, z, r - 0.012, 22))
                ends.append(_cyl_x(L2 + 0.025, L2 + 0.035, y, z, r * 0.55, 16))
            else:                                                                  # порожня труба після пуску
                ends.append(_cyl_x(L2 - 0.002, L2 + 0.004, y, z, r - 0.025, 22))
    plate.append(_box((-L2 + 0.035, H / 2, 0.0), (0.03, H - 0.06, 2 * W - 0.06)))    # глухий задній торець
    for s in (-1, 1):                                                              # трафарети на балках
        for x in (-L2 * 0.62, -L2 * 0.12, L2 * 0.42):
            stencil.append(_box((x, H - 0.03, s * (W + 0.0015)), (0.30, 0.03, 0.003)))
            stencil.append(_box((x + 0.1, 0.03, s * (W + 0.0015)), (0.26, 0.03, 0.003)))
        red.append(_box((L2 - 0.30, H - 0.03, s * (W + 0.002)), (0.14, 0.032, 0.003)))
    m = mats
    return [(trimesh.util.concatenate(frame), m["frame"]), (trimesh.util.concatenate(tubes), m["tubes"]),
            (trimesh.util.concatenate(plate), m["plate"]), (trimesh.util.concatenate(ends), m["cap"] if fresh else m["hole"]),
            (trimesh.util.concatenate(stencil), m["stencil"]), (trimesh.util.concatenate(red), m["red"])]


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
            v_acc = self.accessor(np.asarray(values, dtype=np.float32), kind)
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
