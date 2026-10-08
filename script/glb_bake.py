"""«Запікання» поверхонь: розгортає сітку (xatlas), для кожного текселя знаходить точку й нормаль на моделі, викликає
малювальник (paint_lib) і збирає три текстури PBR: колір, шорсткість/металевість і карту нормалей із висоти.

    pip install numpy scipy trimesh pillow xatlas

Так само, як у GBU-39 довідника (munition-3d.js, клас Skin), тільки на Python і прямо в GLB: фарба зі старінням,
шви й заклепки, трафарети, потертості на ребрах, пил і бруд знизу, підтіки на вертикалях.
"""
import hashlib
import io
import os

import numpy as np
import trimesh
import xatlas
from PIL import Image
from scipy.ndimage import distance_transform_edt, gaussian_filter
from scipy.spatial import cKDTree

import paint_lib as pl

FAST = os.environ.get('EW_FAST') == '1'      # швидкий чорновий режим: удвічі менші текстури
EDGE_ANGLE = np.radians(24)                  # ребро, яке витирається й підсвічується (від кута між гранями)
SMOOTH_ANGLE = np.radians(38)                # нормалі граней, між якими кут менший, згладжуються


class Texels:
    """Дані про валідні текселі атласу для малювальника."""

    def __init__(self, P, N, FN, ids, uv, ts, edge_cx, edge_cc, size):
        self.P, self.N, self.FN, self.ids, self.uv = P, N, FN, ids, uv
        self.ts = ts                    # розмір текселя, м
        self.edge_cx, self.edge_cc = edge_cx, edge_cc
        self.size = size                # (ширина, висота) атласу
        self.n = len(P)


class BakeSpec:
    """Опис запікання одного вузла: малювальник, розмір атласу, ідентифікатори частин (для груп) і зерно випадковості."""

    def __init__(self, painter, res=2048, ids=None, tpm=None, seed=1, key=None):
        self.painter, self.res, self.ids, self.tpm, self.seed = painter, res, ids, tpm, seed
        self.key = key or getattr(painter, '__name__', 'painter')
        self.baked = True


class TileSpec:
    """Матеріал із тайловою текстурою; UV — проєкція вздовж найближчої осі, 1 тайл = tile_m метрів.
    color — множник кольору (sRGB 0…255), rough/metal — множники ORM-текстури."""

    def __init__(self, kind, color=(255, 255, 255), tile_m=0.6, rough=1.0, metal=1.0, size=1024):
        self.kind, self.color, self.tile_m, self.rough, self.metal, self.size = kind, tuple(color), tile_m, rough, metal, size
        self.tiled = True


def tiled_geometry(mesh, tile_m):
    """Розщеплена сітка з UV-проєкцією вздовж домінантної осі нормалі кожної грані та нормалями кутів."""
    m = trimesh.Trimesh(np.asarray(mesh.vertices, dtype=np.float64), np.asarray(mesh.faces), process=False)
    cn = corner_normals(m)
    F = m.faces
    pos = m.vertices[F]                                   # (f, 3, 3)
    fn = np.abs(m.face_normals)
    axis = np.argmax(fn, axis=1)
    uv = np.zeros((len(F), 3, 2))
    for ax, (a, b) in enumerate(((2, 1), (0, 2), (0, 1))):
        sel = axis == ax
        uv[sel, :, 0] = pos[sel][:, :, a] / tile_m
        uv[sel, :, 1] = pos[sel][:, :, b] / tile_m
    keys = np.concatenate([pos.reshape(-1, 3).round(5), cn.reshape(-1, 3).round(3), uv.reshape(-1, 2).round(5)], 1)
    _, first, inv = np.unique(keys, axis=0, return_index=True, return_inverse=True)
    return (pos.reshape(-1, 3)[first].astype(np.float32), cn.reshape(-1, 3)[first].astype(np.float32),
            uv.reshape(-1, 2)[first].astype(np.float32), inv.reshape(-1, 3).astype(np.uint32))


class Baked:
    def __init__(self, pos, nrm, uv, faces, images, ts):
        self.pos, self.nrm, self.uv, self.faces, self.images, self.ts = pos, nrm, uv, faces, images, ts


# ---------------------------------------------------------------------------------------------------- нормалі
def corner_normals(mesh, angle=SMOOTH_ANGLE):
    """Нормалі кутів граней: усереднюємо нормалі сусідніх граней, що сходяться у вершині, якщо кут між ними малий.
    Великі пласкі грані лишаються пласкими, а фаски й циліндри — гладкими."""
    F = mesh.faces
    fn = mesh.face_normals.astype(np.float64)
    area = mesh.area_faces.astype(np.float64)
    out = np.zeros((len(F), 3, 3))
    flat_v = F.reshape(-1)
    order = np.argsort(flat_v, kind='stable')
    sorted_v = flat_v[order]
    bounds = np.flatnonzero(np.diff(sorted_v)) + 1
    cos_t = np.cos(angle)
    for grp in np.split(order, bounds):
        faces = grp // 3
        nn = fn[faces]
        w = area[faces]
        d = nn @ nn.T
        m = (d >= cos_t) * w[None, :]
        res = m @ nn
        res /= np.maximum(np.linalg.norm(res, axis=1, keepdims=True), 1e-12)
        for k, g in enumerate(grp):
            out[g // 3, g % 3] = res[k]
    return out


# ---------------------------------------------------------------------------------------------------- розгортка
def unwrap(V, F, res, tpm):
    atlas = xatlas.Atlas()
    atlas.add_mesh(V.astype(np.float32), F.astype(np.uint32))
    co = xatlas.ChartOptions()
    po = xatlas.PackOptions()
    po.resolution = res
    po.padding = 3
    po.bilinear = True
    po.rotate_charts = True
    if tpm:
        po.texels_per_unit = float(tpm)
    atlas.generate(co, po)
    vmap, idx, uvs = atlas[0]
    return vmap, idx, uvs, atlas.width, atlas.height


# ---------------------------------------------------------------------------------------------------- растеризація
def rasterize(pos_f, nrm_f, uv_pix, faces_id, W, H, face_n):
    """Для кожного текселя: світова точка, згладжена нормаль, нормаль грані, id частини, індекс грані."""
    P = np.zeros((H, W, 3), np.float32)
    N = np.zeros((H, W, 3), np.float32)
    FN = np.zeros((H, W, 3), np.float32)
    ID = np.full((H, W), -1, np.int16)
    TRI = np.full((H, W), -1, np.int32)
    for t in range(len(uv_pix)):
        a, b, c = uv_pix[t]
        x0 = max(int(np.floor(min(a[0], b[0], c[0]) - 0.5)), 0)
        x1 = min(int(np.ceil(max(a[0], b[0], c[0]) + 0.5)), W - 1)
        y0 = max(int(np.floor(min(a[1], b[1], c[1]) - 0.5)), 0)
        y1 = min(int(np.ceil(max(a[1], b[1], c[1]) + 0.5)), H - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs = np.arange(x0, x1 + 1) + 0.5
        ys = np.arange(y0, y1 + 1) + 0.5
        gx, gy = np.meshgrid(xs, ys)
        det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(det) < 1e-12:
            continue
        l0 = ((b[1] - c[1]) * (gx - c[0]) + (c[0] - b[0]) * (gy - c[1])) / det
        l1 = ((c[1] - a[1]) * (gx - c[0]) + (a[0] - c[0]) * (gy - c[1])) / det
        l2 = 1 - l0 - l1
        eps = -0.02
        inside = (l0 >= eps) & (l1 >= eps) & (l2 >= eps)
        if not inside.any():
            continue
        ly, lx = np.nonzero(inside)
        w0, w1, w2 = l0[ly, lx][:, None], l1[ly, lx][:, None], l2[ly, lx][:, None]
        yy, xx = ly + y0, lx + x0
        P[yy, xx] = w0 * pos_f[t, 0] + w1 * pos_f[t, 1] + w2 * pos_f[t, 2]
        n = w0 * nrm_f[t, 0] + w1 * nrm_f[t, 1] + w2 * nrm_f[t, 2]
        N[yy, xx] = n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
        FN[yy, xx] = face_n[t]
        ID[yy, xx] = faces_id[t]
        TRI[yy, xx] = t
    return P, N, FN, ID, TRI


def edge_points(mesh, angle=EDGE_ANGLE, step=0.008):
    """Точки вздовж гострих ребер: випуклих (потертості) і ввігнутих (бруд). Повертає два масиви (n, 3)."""
    adj = mesh.face_adjacency
    if len(adj) == 0:
        return np.zeros((0, 3)), np.zeros((0, 3))
    ang = mesh.face_adjacency_angles
    conv = mesh.face_adjacency_convex
    seg = mesh.vertices[mesh.face_adjacency_edges]
    keep = ang > angle
    out = {}
    for name, sel in (('convex', keep & conv), ('concave', keep & ~conv)):
        s = seg[sel]
        if len(s) == 0:
            out[name] = np.zeros((0, 3))
            continue
        L = np.linalg.norm(s[:, 1] - s[:, 0], axis=1)
        n = np.maximum(2, np.ceil(L / step).astype(int) + 1)
        pts = []
        for (p0, p1), k in zip(s, n):
            t = np.linspace(0, 1, k)[:, None]
            pts.append(p0 + (p1 - p0) * t)
        out[name] = np.concatenate(pts)
    return out['convex'], out['concave']


def nearest_dist(points, Q, cap=0.4):
    if len(points) == 0:
        return np.full(len(Q), cap, np.float32)
    d, _ = cKDTree(points).query(Q, k=1, distance_upper_bound=cap, workers=-1)
    d = np.where(np.isfinite(d), d, cap)
    return d.astype(np.float32)


# ---------------------------------------------------------------------------------------------------- вихідні картинки
def fill_gutters(arrs, valid):
    """Заповнює невалідні текселі значеннями найближчих валідних (щоб не було швів на межах острівців)."""
    _, (iy, ix) = distance_transform_edt(~valid, return_indices=True)
    return [a[iy, ix] for a in arrs]


def normal_map(height, ts, strength=1.0):
    """Карта нормалей (RGB uint8) із висоти в метрах: нахил = dh / розмір текселя."""
    h = gaussian_filter(height.astype(np.float32), 0.55)
    dy, dx = np.gradient(h, ts)
    nx, ny = -dx * strength, dy * strength
    nz = np.ones_like(nx)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    rgb = np.stack([nx / ln, ny / ln, nz / ln], -1) * 0.5 + 0.5
    return (np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)


def jpeg(arr, q=84, sub=2):
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, 'JPEG', quality=q, subsampling=sub, optimize=True)
    return buf.getvalue()


def png(arr):
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, 'PNG', compress_level=6)
    return buf.getvalue()


# ---------------------------------------------------------------------------------------------------- головна функція
_CACHE = {}
_SRC = None


def _sources_hash():
    global _SRC
    if _SRC is None:
        h = hashlib.sha1()
        for name in ("paint_lib.py", "glb_bake.py", "vehicle_paint.py"):
            h.update(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), name), "rb").read())
        _SRC = h.hexdigest()
    return _SRC


def bake(mesh, spec):
    """Запікає сітку за описом spec. Повертає Baked (вершини з UV, грані, словник картинок).
    Якщо задано EW_BAKE_CACHE, готові запікання лежать на диску (для швидкого підбору рецептів; перед випуском кеш чистимо)."""
    cache_dir = os.environ.get("EW_BAKE_CACHE")
    if cache_dir:
        import pickle
        digest0 = hashlib.md5(np.ascontiguousarray(mesh.vertices, dtype=np.float32).tobytes()
                              + np.ascontiguousarray(mesh.faces, dtype=np.int32).tobytes()
                              + (spec.ids.tobytes() if spec.ids is not None else b"")).hexdigest()
        sig = repr((spec.key, spec.res, spec.tpm, spec.seed, FAST, getattr(spec.painter, "sig", ""), digest0, _sources_hash()))
        path = os.path.join(cache_dir, hashlib.sha1(sig.encode()).hexdigest() + ".pkl")
        if os.path.exists(path):
            return pickle.load(open(path, "rb"))
        baked = _bake(mesh, spec)
        os.makedirs(cache_dir, exist_ok=True)
        pickle.dump(baked, open(path, "wb"))
        return baked
    return _bake(mesh, spec)


def _bake(mesh, spec):
    digest = hashlib.md5(np.ascontiguousarray(mesh.vertices, dtype=np.float32).tobytes()
                         + np.ascontiguousarray(mesh.faces, dtype=np.int32).tobytes()
                         + (spec.ids.tobytes() if spec.ids is not None else b'')).hexdigest()
    key = (spec.key, spec.res, spec.tpm, spec.seed, digest, FAST)
    if key in _CACHE:
        return _CACHE[key]
    res = spec.res // 2 if FAST else spec.res
    V = np.asarray(mesh.vertices, dtype=np.float64)
    F = np.asarray(mesh.faces, dtype=np.int64)
    ids = spec.ids if spec.ids is not None else np.zeros(len(F), np.int16)
    m = trimesh.Trimesh(V, F, process=False)
    cn = corner_normals(m)
    vmap, idx, uvs, W, H = unwrap(V, F, res, (spec.tpm / (2 if FAST else 1)) if spec.tpm else None)
    # Зіставлення нових граней зі старими за трійкою старих вершин.
    old = vmap[idx]
    lookup = {}
    for fi, f in enumerate(F):
        lookup.setdefault(tuple(sorted(f)), []).append(fi)
    f_old = np.empty(len(idx), np.int64)
    corner = np.empty((len(idx), 3), np.int64)
    for j, tri in enumerate(old):
        cand = lookup[tuple(sorted(tri))]
        fi = cand.pop(0) if len(cand) > 1 else cand[0]
        f_old[j] = fi
        for k in range(3):
            corner[j, k] = int(np.flatnonzero(F[fi] == tri[k])[0])
    pos_f = V[old]                                             # (m, 3, 3)
    nrm_f = cn[f_old[:, None], corner]                         # (m, 3, 3)
    uv_pix = np.stack([uvs[idx][:, :, 0] * W, uvs[idx][:, :, 1] * H], -1)
    face_n = m.face_normals[f_old]
    P, N, FN, ID, TRI = rasterize(pos_f, nrm_f, uv_pix, ids[f_old], W, H, face_n)
    valid = TRI >= 0
    area_world = float(m.area_faces.sum())
    a2 = 0.5 * np.abs((uv_pix[:, 1, 0] - uv_pix[:, 0, 0]) * (uv_pix[:, 2, 1] - uv_pix[:, 0, 1])
                      - (uv_pix[:, 2, 0] - uv_pix[:, 0, 0]) * (uv_pix[:, 1, 1] - uv_pix[:, 0, 1]))
    ts = float(np.sqrt(area_world / max(a2.sum(), 1)))
    ys, xs = np.nonzero(valid)
    Pv, Nv, FNv, IDv = P[ys, xs], N[ys, xs], FN[ys, xs], ID[ys, xs].astype(np.int32)
    ec, ek = edge_points(m)
    tx = Texels(Pv, Nv, FNv, IDv, np.stack([xs, ys], 1), ts, nearest_dist(ec, Pv), nearest_dist(ek, Pv), (W, H))
    s = spec.painter(tx)
    color = np.zeros((H, W, 3), np.float32)
    orm = np.zeros((H, W, 3), np.float32)
    hgt = np.zeros((H, W), np.float32)
    color[ys, xs] = s.color
    orm[ys, xs, 0] = 1.0
    orm[ys, xs, 1] = s.rough
    orm[ys, xs, 2] = s.metal
    hgt[ys, xs] = s.height
    color, orm, hgt = fill_gutters([color, orm, hgt], valid)
    c8 = (np.clip(color, 0, 1) * 255 + 0.5).astype(np.uint8)
    o8 = (np.clip(orm, 0, 1) * 255 + 0.5).astype(np.uint8)
    n8 = normal_map(hgt, ts)
    # Остаточні вершини: розщеплюємо за (вершина атласу, нормаль).
    n_f = nrm_f.reshape(-1, 3)
    keys = np.concatenate([idx.reshape(-1, 1), np.round(n_f * 1000).astype(np.int64)], 1)
    uniq, first, inv = np.unique(keys, axis=0, return_index=True, return_inverse=True)
    pos = pos_f.reshape(-1, 3)[first].astype(np.float32)
    nrm = n_f[first].astype(np.float32)
    uvo = uvs[idx.reshape(-1)][first].astype(np.float32)
    faces = inv.reshape(-1).reshape(-1, 3).astype(np.uint32)
    baked = Baked(pos, nrm, uvo, faces, {'color': jpeg(c8, 84, 2), 'orm': jpeg(o8, 80, 0), 'normal': jpeg(n8, 88, 0)}, ts)
    _CACHE[key] = baked
    return baked
