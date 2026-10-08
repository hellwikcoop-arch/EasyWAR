"""Спільне для генераторів наземних машин (M270, HIMARS): запис GLB з ієрархією вузлів і анімацією та транспортно-
пусковий пакет LP/C (відкрита сталева рама з розкосами, шість труб, кришки або щит з отворами), як на довідкових зображеннях.

Пакет будується в «канонічній» системі: початок — середина низу, дула труб дивляться в +x. Генератор ставить вузол
пакета на місце й за потреби повертає його (у HIMARS дула дивляться назад).
"""
import hashlib
import json
import struct

import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial

from glb_bake import BakeSpec, bake, jpeg as jpeg_bytes, tiled_geometry
from paint_lib import tile_texture


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


ID_FRAME, ID_TUBE, ID_CAP, ID_CAP_DK, ID_BULK, ID_HOLE, ID_BORE, ID_COLLAR = range(8)
BORE_DEPTH = 0.55                                                                  # глибина видимого каналу труби, м


def _torus_x(center, major, minor):
    """Кільце у вертикальній площині вздовж пакета (вісь тора — z)."""
    t = trimesh.creation.torus(major_radius=major, minor_radius=minor, major_sections=14, minor_sections=6)
    t.apply_translation(center)
    return t


def _mesh_oriented(V, F, want):
    """Сітка з гранями, повернутими так, щоб нормаль дивилась у бік want(центр грані) -> вектор."""
    V = np.asarray(V, np.float64); F = np.asarray(F, np.int64)
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    n = np.cross(b - a, c - a)
    w = want((a + b + c) / 3.0)
    flip = (n * w).sum(1) < 0
    F = F.copy(); F[flip] = F[flip][:, ::-1]
    return trimesh.Trimesh(V, F, process=False)


def _shell_x(x0, x1, y, z, radius, sections=40):
    """Труба без торців (лише бічна поверхня), нормалі назовні."""
    m = _cyl_x(x0, x1, y, z, radius, sections)
    nrm = m.face_normals
    keep = np.abs(nrm[:, 0]) < 0.5
    return trimesh.Trimesh(m.vertices, m.faces[keep], process=False)


def _muzzle(x, cy, cz, rh, rect, depth, n=56, collar=0.012, lip=0.007):
    """Дульний отвір у щиті: плоска грань щита з круглим вирізом (розгортка кола в прямокутник комірки), бортик-кільце,
    канал труби вглиб і дно. Повертає {id: сітка}. rect = (y0, y1, z0, z1) — комірка щита навколо отвору."""
    y0, y1, z0, z1 = rect
    corners = [np.arctan2(yy - cy, zz - cz) for yy in (y0, y1) for zz in (z0, z1)]   # кут задано від +z до +y
    ang = np.unique(np.concatenate([np.linspace(0, 2 * np.pi, n, endpoint=False), np.mod(corners, 2 * np.pi)]))
    ang = ang[np.concatenate([[True], np.diff(ang) > 1e-6])]
    def hit(a):
        dy, dz = np.sin(a), np.cos(a)
        ts = []
        if dy > 1e-9: ts.append((y1 - cy) / dy)
        if dy < -1e-9: ts.append((y0 - cy) / dy)
        if dz > 1e-9: ts.append((z1 - cz) / dz)
        if dz < -1e-9: ts.append((z0 - cz) / dz)
        t = min(ts)
        return cy + t * dy, cz + t * dz
    rc = rh + collar
    k = len(ang)
    out = {}
    # плоска грань щита між бортиком (rc) і краєм комірки
    V = [(x, cy + rc * np.sin(a), cz + rc * np.cos(a)) for a in ang] + [(x, *hit(a)) for a in ang]
    F = []
    for i in range(k):
        j = (i + 1) % k
        F += [(i, j, k + j), (i, k + j, k + i)]
    out[ID_BULK] = _mesh_oriented(V, F, lambda c: np.tile([1.0, 0, 0], (len(c), 1)))
    # бортик: зовнішня стінка й кільцева верхня грань
    xt = x + lip
    V = [(x, cy + rc * np.sin(a), cz + rc * np.cos(a)) for a in ang] + [(xt, cy + rc * np.sin(a), cz + rc * np.cos(a)) for a in ang] \
        + [(xt, cy + rh * np.sin(a), cz + rh * np.cos(a)) for a in ang]
    F = []
    for i in range(k):
        j = (i + 1) % k
        F += [(i, j, k + j), (i, k + j, k + i)]               # стінка
        F += [(k + i, k + j, 2 * k + j), (k + i, 2 * k + j, 2 * k + i)]   # торець бортика
    def want(c):
        w = np.zeros_like(c)
        top = np.abs(c[:, 0] - xt) < 1e-6
        w[top, 0] = 1.0
        side = ~top
        w[side, 1] = c[side, 1] - cy; w[side, 2] = c[side, 2] - cz
        return w
    out[ID_COLLAR] = _mesh_oriented(V, F, want)
    # канал: бічна стінка (нормаль до осі) і дно
    nb = 48
    ab = np.linspace(0, 2 * np.pi, nb, endpoint=False)
    xs = np.linspace(xt, xt - depth, 7)                       # кілька кілець — для плавного затемнення за глибиною
    V = [(xx, cy + rh * np.sin(a), cz + rh * np.cos(a)) for xx in xs for a in ab]
    F = []
    for r_ in range(len(xs) - 1):
        for i in range(nb):
            j = (i + 1) % nb
            a0, a1, b0, b1 = r_ * nb + i, r_ * nb + j, (r_ + 1) * nb + i, (r_ + 1) * nb + j
            F += [(a0, a1, b1), (a0, b1, b0)]
    base = len(V)
    V.append((xt - depth, cy, cz))
    last = (len(xs) - 1) * nb
    for i in range(nb):
        F.append((last + i, last + (i + 1) % nb, base))
    def want_b(c):
        w = np.zeros_like(c)
        bottom = np.abs(c[:, 0] - (xt - depth)) < 1e-6
        w[bottom, 0] = 1.0
        side = ~bottom
        w[side, 1] = cy - c[side, 1]; w[side, 2] = cz - c[side, 2]
        return w
    out[ID_BORE] = _mesh_oriented(V, F, want_b)
    return out


def lpc_pod(length, height, half, fresh, lugs):
    """Пакет за довідковим зображенням (M26 rocket pod): шість щільно покладених труб у два ряди, кутові балки, полози
    знизу з упорами на торцях, поперечні смуги й центральна плита з ручкою зверху, D-кільця на верхніх кутах, по три
    стійки на борт із розкосами лише в крайніх прольотах. На дульному торці — сірий щит із шістьма отворами
    (після пуску) або кришки з кільцем і чотирма виступами (новий пакет). lugs — вушка для підйому від середини.
    Повертає список призм [(сітка, BakeSpec)]: усе запікається в одну текстуру, частини розрізняються за id."""
    from vehicle_paint import pod_painter
    L2, H, W = length / 2, height, half
    parts = {k: [] for k in range(8)}
    frame = parts[ID_FRAME]
    for y in (0.035, H - 0.03):                                                    # кутові балки
        for s in (-1, 1):
            frame.append(_box((0.0, y, s * (W - 0.03)), (length, 0.06, 0.06), bevel=0.008))
    for s in (-1, 1):                                                              # полози з упорами
        frame.append(_box((0.0, 0.02, s * (W - 0.05)), (length + 0.10, 0.04, 0.10), bevel=0.006))
    for x in (-L2 + 0.03, L2 - 0.03):                                              # торцеві рамки
        for s in (-1, 1):
            frame.append(_box((x, H / 2, s * (W - 0.03)), (0.06, H, 0.06)))
        for y in (0.035, H - 0.03):
            frame.append(_box((x, y, 0.0), (0.06, 0.06, 2 * W)))
    for x in [-L2 + length * f for f in (0.25, 0.5, 0.75)]:                        # стійки
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
            frame.append(_torus_x((x, H + 0.02, s * (W - 0.03)), 0.035, 0.008))
    frame.append(_box((-L2 + 0.035, H / 2, 0.0), (0.03, H - 0.06, 2 * W - 0.06)))  # глухий задній торець
    r = min((H - 0.06) / 4, (2 * W - 0.06) / 6)                                     # труби впритул одна до одної
    rows = (0.03 + (H - 0.06) * 0.25, 0.03 + (H - 0.06) * 0.75)
    cols = (-2 * r, 0.0, 2 * r)
    for y in rows:
        for z in cols:
            if fresh:
                parts[ID_TUBE].append(_cyl_x(-L2 + 0.06, L2 - 0.01, y, z, r - 0.004, 40))
            else:                                                                  # порожня труба: лише стінка, канал видно крізь отвір
                parts[ID_TUBE].append(_shell_x(-L2 + 0.06, L2 - 0.01, y, z, r - 0.004, 40))
    if fresh:                                                                      # кришки: диск, кільце, чотири виступи
        for y in rows:
            for z in cols:
                parts[ID_CAP].append(_cyl_x(L2 - 0.01, L2 + 0.025, y, z, r - 0.012, 40))
                parts[ID_CAP_DK].append(_cyl_x(L2 + 0.025, L2 + 0.032, y, z, r * 0.78, 32))
                parts[ID_CAP].append(_cyl_x(L2 + 0.032, L2 + 0.036, y, z, r * 0.70, 32))
                for k in range(4):
                    q = np.pi / 4 + k * np.pi / 2
                    parts[ID_CAP_DK].append(_box((L2 + 0.03, y + 0.82 * r * np.sin(q), z + 0.82 * r * np.cos(q)), (0.02, 0.035, 0.035)))
    else:                                                                          # щит із шістьма реальними отворами
        y_cut = [0.025, 0.03 + (H - 0.06) * 0.5, H - 0.025]
        z_cut = [-(W - 0.025), -r, r, W - 0.025]
        for ri, y in enumerate(rows):
            for ci, z in enumerate(cols):
                rect = (y_cut[ri], y_cut[ri + 1], z_cut[ci], z_cut[ci + 1])
                for k, m in _muzzle(L2 + 0.005, y, z, r - 0.028, rect, BORE_DEPTH).items():
                    parts[k].append(m)
    meshes, ids = [], []
    for k, lst in parts.items():
        for m in lst:
            meshes.append(m)
            ids.append(np.full(len(m.faces), k, np.int16))
    mesh = trimesh.util.concatenate(meshes)
    return [(mesh, BakeSpec(pod_painter(length, height, half, fresh, lugs), res=2048, ids=np.concatenate(ids),
                            key=f"pod-{fresh}-{length:.2f}-{height:.2f}-{half:.2f}"))]


class GlbWriter:
    """Мінімальний запис glTF 2.0: вершини, нормалі, індекси, PBR-матеріали, ієрархія вузлів із TRS і один анімаційний кліп."""

    def __init__(self, generator):
        self.bin = bytearray()
        self.doc = {"asset": {"version": "2.0", "generator": generator}, "scene": 0, "scenes": [{"nodes": []}],
                    "nodes": [], "meshes": [], "materials": [], "accessors": [], "bufferViews": [], "buffers": []}
        self.mat_index = {}
        self.tex_index = {}
        self.tiles = {}
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

    def image(self, data, mime="image/jpeg", repeat=False):
        """Додає картинку й текстуру (з дедуплікацією за вмістом). Повертає індекс текстури."""
        key = (hashlib.md5(data).hexdigest(), repeat)
        if key not in self.tex_index:
            self.bin += b"\0" * (-len(self.bin) % 4)
            view = {"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(data)}
            self.bin += data
            self.doc["bufferViews"].append(view)
            self.doc.setdefault("images", []).append({"bufferView": len(self.doc["bufferViews"]) - 1, "mimeType": mime})
            self.doc.setdefault("samplers", [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071},
                                             {"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}])
            self.doc.setdefault("textures", []).append({"source": len(self.doc["images"]) - 1, "sampler": 1 if repeat else 0})
            self.tex_index[key] = len(self.doc["textures"]) - 1
        return self.tex_index[key]

    def baked_material(self, baked, name):
        key = hashlib.md5(baked.images["color"] + baked.images["orm"] + baked.images["normal"]).hexdigest()
        if key not in self.mat_index:
            self.doc["materials"].append({
                "name": name,
                "pbrMetallicRoughness": {
                    "baseColorTexture": {"index": self.image(baked.images["color"])},
                    "metallicRoughnessTexture": {"index": self.image(baked.images["orm"])},
                    "baseColorFactor": [1.0, 1.0, 1.0, 1.0], "metallicFactor": 1.0, "roughnessFactor": 1.0},
                "normalTexture": {"index": self.image(baked.images["normal"]), "scale": 1.0}})
            self.mat_index[key] = len(self.doc["materials"]) - 1
        return self.mat_index[key]

    def tiled_material(self, spec):
        key = ("tile", spec.kind, spec.color, spec.rough, spec.metal, spec.tile_m, spec.size)
        if key not in self.mat_index:
            if spec.kind not in self.tiles:
                c, o, n = tile_texture(spec.kind, spec.size, spec.tile_m)
                self.tiles[spec.kind] = (self.image(jpeg_bytes(c, 86, 2), repeat=True), self.image(jpeg_bytes(o, 82, 0), repeat=True),
                                         self.image(jpeg_bytes(n, 90, 0), repeat=True))
            tc, to, tn = self.tiles[spec.kind]
            lin = [round((v / 255) ** 2.2, 6) for v in spec.color]
            self.doc["materials"].append({
                "name": f"{spec.kind}-{'-'.join(str(v) for v in spec.color)}",
                "pbrMetallicRoughness": {"baseColorTexture": {"index": tc}, "baseColorFactor": [*lin, 1.0],
                                         "metallicRoughnessTexture": {"index": to}, "metallicFactor": spec.metal, "roughnessFactor": spec.rough},
                "normalTexture": {"index": tn, "scale": 1.0}})
            self.mat_index[key] = len(self.doc["materials"]) - 1
        return self.mat_index[key]

    def mesh(self, name, prims):
        out = []
        for m, mat in prims:
            if getattr(mat, "tiled", False):
                pos, nrm, uv, faces = tiled_geometry(m, mat.tile_m)
                attrs = {"POSITION": self.accessor(pos, "VEC3", 34962, True), "NORMAL": self.accessor(nrm, "VEC3", 34962),
                         "TEXCOORD_0": self.accessor(uv, "VEC2", 34962)}
                idx = faces.reshape(-1).astype(np.uint16 if len(pos) < 65536 else np.uint32)
                self.triangles += len(faces)
                out.append({"attributes": attrs, "indices": self.accessor(idx, "SCALAR", 34963), "material": self.tiled_material(mat)})
                continue
            if getattr(mat, "baked", False):
                b = bake(m, mat)
                attrs = {"POSITION": self.accessor(b.pos, "VEC3", 34962, True), "NORMAL": self.accessor(b.nrm, "VEC3", 34962),
                         "TEXCOORD_0": self.accessor(b.uv, "VEC2", 34962)}
                faces = b.faces.reshape(-1)
                idx = faces.astype(np.uint16 if len(b.pos) < 65536 else np.uint32)
                self.triangles += len(b.faces)
                out.append({"attributes": attrs, "indices": self.accessor(idx, "SCALAR", 34963), "material": self.baked_material(b, name)})
                continue
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
