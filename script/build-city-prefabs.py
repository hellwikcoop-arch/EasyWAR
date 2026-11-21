#!/usr/bin/env python3
"""Генерує 20 еталонних 3D-префабів забудови України (.glb) та деталізовані текстури фасадів для 3D-карти EasyWAR.

10 архетипів багатоповерхівок та міських споруд (highrise_01..10.glb):
  01 — Панельна 9-поверхівка з лоджіями, парапетом та ліфтовою надбудовою
  02 — Висотна 18-поверхова вежа-«свічка» з технічним поверхом і антеною
  03 — Ступінчаста висотка (setback tower) з терасами у стилі архітектурного макета IMG_9557
  04 — Скляний бізнес-центр із поясами скління та блоками HVAC на даху
  05 — Секційний житловий комплекс із еркерами та ризалітами
  06 — Квартальний корпус із мансардним дахом і внутрішнім карнизом
  07 — Монументальна класична висотка зі шпилем та ярусами у стилі IMG_9556
  08 — Циліндрична/гранчаста сучасна вежа з круговою короною
  09 — Вежа зі скошеним дахом-вітрилом (slanted crown) у стилі IMG_9557
  10 — Промислово-логістичний корпус зі світловими ліхтарями та шедовим профілем

10 архетипів приватних будинків і котеджів (house_01..10.glb):
  01 — Класичний будинок із двосхилим дахом (gabled) і димарем
  02 — Садиба з чотирисхилим вальмовим дахом (hipped)
  03 — Г-подібний заміський котедж із перехресним дахом
  04 — Двоповерховий котедж із мансардою та балконом
  05 — Зблокований двосімейний таунхаус (duplex)
  06 — Будинок із прибудованим гаражем та терасою
  07 — Садиба з ламаним мансардним дахом (gambrel/mansard)
  08 — Сучасний котедж із плоским дахом, парапетом і консоллю
  09 — Сільська садиба з верандою та господарським блоком
  10 — Компактний дачний будинок із крутим А-подібним дахом

Також оновлює текстури фасадів у src/public/map-assets/ (fac_house.jpg, fac_panel.jpg, fac_ind.jpg, fac_pub.jpg, fac_shed.jpg)
із глибокими віконними нішами, рамами, підвіконнями, балконами та швами, що узгоджені з геометрією map-app.js.
"""
import json
import math
import struct
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "src" / "public" / "map-assets"
PREFABS_DIR = ASSETS / "prefabs"


# ---------- Мінімальний чистий генератор GLB (glTF 2.0) без сторонніх залежностей ----------
class MeshBuilder:
    def __init__(self):
        self.pos = []      # (x, y, z)
        self.norm = []     # (nx, ny, nz)
        self.col = []      # (r, g, b) у 0..1
        self.idx = []      # трикутники

    def add_quad(self, p0, p1, p2, p3, color):
        ux, uy, uz = p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]
        vx, vy, vz = p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]
        nx = uy * vz - uz * vy
        ny = uz * vx - ux * vz
        nz = ux * vy - uy * vx
        ln = math.hypot(nx, ny, nz) or 1.0
        n = (nx / ln, ny / ln, nz / ln)
        base = len(self.pos)
        for p in (p0, p1, p2, p3):
            self.pos.append(p)
            self.norm.append(n)
            self.col.append(color)
        self.idx.extend([base, base + 1, base + 2, base, base + 2, base + 3])

    def add_tri(self, p0, p1, p2, color):
        ux, uy, uz = p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]
        vx, vy, vz = p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]
        nx = uy * vz - uz * vy
        ny = uz * vx - ux * vz
        nz = ux * vy - uy * vx
        ln = math.hypot(nx, ny, nz) or 1.0
        n = (nx / ln, ny / ln, nz / ln)
        base = len(self.pos)
        for p in (p0, p1, p2):
            self.pos.append(p)
            self.norm.append(n)
            self.col.append(color)
        self.idx.extend([base, base + 1, base + 2])

    def add_box(self, cx, y0, cz, wx, h, wz, wall_col, roof_col=None, win_cols=0, win_rows=0, win_col=(0.16, 0.22, 0.30)):
        if roof_col is None:
            roof_col = wall_col
        x0, x1 = cx - wx / 2, cx + wx / 2
        z0, z1 = cz - wz / 2, cz + wz / 2
        y1 = y0 + h
        # Стіни (проти годинникової стрілки зовні)
        self.add_quad((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1), wall_col)  # +Z
        self.add_quad((x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0), wall_col)  # -Z
        self.add_quad((x1, y0, z1), (x1, y0, z0), (x1, y1, z0), (x1, y1, z1), wall_col)  # +X
        self.add_quad((x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0), wall_col)  # -X
        # Дах
        self.add_quad((x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y1, z0), roof_col)
        # Віконні стрічки для візуальної деталізації префаба
        if win_cols > 0 and win_rows > 0:
            eps = 0.015
            for r in range(win_rows):
                wy0 = y0 + h * (r + 0.22) / (win_rows + 0.2)
                wy1 = y0 + h * (r + 0.72) / (win_rows + 0.2)
                for c in range(win_cols):
                    u0 = (c + 0.2) / win_cols
                    u1 = (c + 0.8) / win_cols
                    xa, xb = x0 + wx * u0, x0 + wx * u1
                    za, zb = z0 + wz * u0, z0 + wz * u1
                    self.add_quad((xa, wy0, z1 + eps), (xb, wy0, z1 + eps), (xb, wy1, z1 + eps), (xa, wy1, z1 + eps), win_col)
                    self.add_quad((xb, wy0, z0 - eps), (xa, wy0, z0 - eps), (xa, wy1, z0 - eps), (xb, wy1, z0 - eps), win_col)
                    self.add_quad((x1 + eps, wy0, zb), (x1 + eps, wy0, za), (x1 + eps, wy1, za), (x1 + eps, wy1, zb), win_col)
                    self.add_quad((x0 - eps, wy0, za), (x0 - eps, wy0, zb), (x0 - eps, wy1, zb), (x0 - eps, wy1, za), win_col)

    def add_parapet(self, cx, y0, cz, wx, wz, h=0.55, t=0.28, col=(0.76, 0.75, 0.72)):
        self.add_box(cx, y0, cz + wz / 2 - t / 2, wx, h, t, col, col)
        self.add_box(cx, y0, cz - wz / 2 + t / 2, wx, h, t, col, col)
        self.add_box(cx + wx / 2 - t / 2, y0, cz, t, h, wz - 2 * t, col, col)
        self.add_box(cx - wx / 2 + t / 2, y0, cz, t, h, wz - 2 * t, col, col)

    def add_gabled_roof(self, cx, y0, cz, wx, wz, rh, roof_col, gable_col, along_x=True, overhang=0.25):
        x0, x1 = cx - wx / 2 - overhang, cx + wx / 2 + overhang
        z0, z1 = cz - wz / 2 - overhang, cz + wz / 2 + overhang
        ym = y0 + rh
        if along_x:
            self.add_quad((x0, y0, z1), (x1, y0, z1), (x1, ym, cz), (x0, ym, cz), roof_col)
            self.add_quad((x1, y0, z0), (x0, y0, z0), (x0, ym, cz), (x1, ym, cz), roof_col)
            self.add_tri((x1, y0, z1), (x1, y0, z0), (x1, ym, cz), gable_col)
            self.add_tri((x0, y0, z0), (x0, y0, z1), (x0, ym, cz), gable_col)
        else:
            self.add_quad((x1, y0, z1), (x1, y0, z0), (cx, ym, z0), (cx, ym, z1), roof_col)
            self.add_quad((x0, y0, z0), (x0, y0, z1), (cx, ym, z1), (cx, ym, z0), roof_col)
            self.add_tri((x0, y0, z1), (x1, y0, z1), (cx, ym, z1), gable_col)
            self.add_tri((x1, y0, z0), (x0, y0, z0), (cx, ym, z0), gable_col)

    def add_hipped_roof(self, cx, y0, cz, wx, wz, rh, roof_col, overhang=0.25):
        x0, x1 = cx - wx / 2 - overhang, cx + wx / 2 + overhang
        z0, z1 = cz - wz / 2 - overhang, cz + wz / 2 + overhang
        ym = y0 + rh
        ridge = max(0.0, (wx - wz) * 0.45) if wx >= wz else 0.0
        rz = max(0.0, (wz - wx) * 0.45) if wz > wx else 0.0
        ra, rb = cx - ridge / 2, cx + ridge / 2
        za, zb = cz - rz / 2, cz + rz / 2
        if wx >= wz:
            self.add_quad((x0, y0, z1), (x1, y0, z1), (rb, ym, cz), (ra, ym, cz), roof_col)
            self.add_quad((x1, y0, z0), (x0, y0, z0), (ra, ym, cz), (rb, ym, cz), roof_col)
            self.add_tri((x1, y0, z1), (x1, y0, z0), (rb, ym, cz), roof_col)
            self.add_tri((x0, y0, z0), (x0, y0, z1), (ra, ym, cz), roof_col)
        else:
            self.add_quad((x1, y0, z1), (x1, y0, z0), (cx, ym, za), (cx, ym, zb), roof_col)
            self.add_quad((x0, y0, z0), (x0, y0, z1), (cx, ym, zb), (cx, ym, za), roof_col)
            self.add_tri((x0, y0, z1), (x1, y0, z1), (cx, ym, zb), roof_col)
            self.add_tri((x1, y0, z0), (x0, y0, z0), (cx, ym, za), roof_col)

    def add_pyramid_spire(self, cx, y0, cz, w, h, col):
        x0, x1 = cx - w / 2, cx + w / 2
        z0, z1 = cz - w / 2, cz + w / 2
        top = (cx, y0 + h, cz)
        self.add_tri((x0, y0, z1), (x1, y0, z1), top, col)
        self.add_tri((x1, y0, z1), (x1, y0, z0), top, col)
        self.add_tri((x1, y0, z0), (x0, y0, z0), top, col)
        self.add_tri((x0, y0, z0), (x0, y0, z1), top, col)

    def add_cylinder_y(self, cx, y0, cz, rx, rz, h, sides, wall_col, roof_col):
        y1 = y0 + h
        pts = [(cx + rx * math.cos(2 * math.pi * i / sides), cz + rz * math.sin(2 * math.pi * i / sides)) for i in range(sides)]
        for i in range(sides):
            j = (i + 1) % sides
            x0, z0 = pts[i]
            x1, z1 = pts[j]
            self.add_quad((x0, y0, z0), (x0, y1, z0), (x1, y1, z1), (x1, y0, z1), wall_col)
            self.add_tri((cx, y1, cz), (x1, y1, z1), (x0, y1, z0), roof_col)

    def to_glb(self, name, path):
        pos_a = np.array(self.pos, dtype=np.float32)
        norm_a = np.array(self.norm, dtype=np.float32)
        col_a = np.array(self.col, dtype=np.float32)
        idx_a = np.array(self.idx, dtype=np.uint16 if len(self.pos) < 65535 else np.uint32)

        b_pos = pos_a.tobytes()
        b_norm = norm_a.tobytes()
        b_col = col_a.tobytes()
        b_idx = idx_a.tobytes()
        while len(b_idx) % 4 != 0:
            b_idx += b"\x00"

        blob = b_pos + b_norm + b_col + b_idx
        while len(blob) % 4 != 0:
            blob += b"\x00"

        o_pos = 0
        o_norm = len(b_pos)
        o_col = o_norm + len(b_norm)
        o_idx = o_col + len(b_col)

        pmin = pos_a.min(axis=0).tolist()
        pmax = pos_a.max(axis=0).tolist()

        gltf = {
            "asset": {"version": "2.0", "generator": "EasyWAR Prefab Generator", "extras": {"license": "CC0-1.0"}},
            "scene": 0,
            "scenes": [{"nodes": [0]}],
            "nodes": [{"name": name, "mesh": 0}],
            "materials": [{
                "name": "building_mat",
                "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0.08, "roughnessFactor": 0.78},
                "doubleSided": True
            }],
            "meshes": [{
                "name": name,
                "primitives": [{
                    "attributes": {"POSITION": 0, "NORMAL": 1, "COLOR_0": 2},
                    "indices": 3,
                    "material": 0
                }]
            }],
            "bufferViews": [
                {"buffer": 0, "byteOffset": o_pos, "byteLength": len(b_pos), "target": 34962},
                {"buffer": 0, "byteOffset": o_norm, "byteLength": len(b_norm), "target": 34962},
                {"buffer": 0, "byteOffset": o_col, "byteLength": len(b_col), "target": 34962},
                {"buffer": 0, "byteOffset": o_idx, "byteLength": len(idx_a.tobytes()), "target": 34963},
            ],
            "accessors": [
                {"bufferView": 0, "componentType": 5126, "count": len(pos_a), "type": "VEC3", "min": pmin, "max": pmax},
                {"bufferView": 1, "componentType": 5126, "count": len(norm_a), "type": "VEC3"},
                {"bufferView": 2, "componentType": 5126, "count": len(col_a), "type": "VEC3"},
                {"bufferView": 3, "componentType": 5123 if len(self.pos) < 65535 else 5125, "count": len(idx_a), "type": "SCALAR"},
            ],
            "buffers": [{"byteLength": len(blob)}]
        }
        jb = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
        while len(jb) % 4 != 0:
            jb += b" "
        total_len = 12 + 8 + len(jb) + 8 + len(blob)
        with open(path, "wb") as f:
            f.write(struct.pack("<III", 0x46546C67, 2, total_len))
            f.write(struct.pack("<II", len(jb), 0x4E4F534A))
            f.write(jb)
            f.write(struct.pack("<II", len(blob), 0x004E4942))
            f.write(blob)


def build_10_highrises():
    specs = []
    # 1. Панельна 9-поверхівка з лоджіями, парапетом та ліфтовою надбудовою
    m = MeshBuilder()
    m.add_box(0, 0, 0, 36, 1.4, 13.5, (0.52, 0.50, 0.48), (0.48, 0.46, 0.44))  # цоколь
    m.add_box(0, 1.4, 0, 35.6, 26.5, 13.0, (0.82, 0.79, 0.73), (0.44, 0.43, 0.41), win_cols=10, win_rows=9)
    for bx in (-11.5, 0.0, 11.5):
        m.add_box(bx, 2.0, 6.8, 5.2, 25.2, 0.9, (0.76, 0.73, 0.67), (0.50, 0.48, 0.45), win_cols=2, win_rows=9)
    m.add_parapet(0, 27.9, 0, 35.6, 13.0, h=0.75, t=0.35, col=(0.74, 0.72, 0.68))
    m.add_box(-8.0, 27.9, 0, 4.8, 2.8, 4.2, (0.72, 0.70, 0.66), (0.38, 0.37, 0.35))
    m.add_box(8.0, 27.9, 0, 4.8, 2.8, 4.2, (0.72, 0.70, 0.66), (0.38, 0.37, 0.35))
    specs.append(("highrise_01_panel9", "Панельна 9-поверхівка з лоджіями та ліфтовими шахтами", m))

    # 2. Висотна 18-поверхова вежа-«свічка» з техповерхом
    m = MeshBuilder()
    m.add_box(0, 0, 0, 20, 3.8, 20, (0.64, 0.63, 0.60), (0.50, 0.49, 0.47), win_cols=5, win_rows=1)
    m.add_box(0, 3.8, 0, 17.5, 50.0, 17.5, (0.85, 0.86, 0.88), (0.46, 0.47, 0.49), win_cols=6, win_rows=16)
    m.add_parapet(0, 53.8, 0, 17.5, 17.5, h=0.9, t=0.4, col=(0.78, 0.79, 0.82))
    m.add_box(0, 53.8, 0, 9.5, 4.2, 9.5, (0.74, 0.75, 0.78), (0.42, 0.43, 0.45))
    m.add_box(0, 58.0, 0, 0.5, 6.0, 0.5, (0.60, 0.62, 0.65))
    specs.append(("highrise_02_monolith_tower", "Монолітна 18-поверхова вежа з техповерхом", m))

    # 3. Ступінчаста висотка (setback tower, як у центрі на IMG_9557)
    m = MeshBuilder()
    m.add_box(0, 0, 0, 26, 22, 22, (0.86, 0.85, 0.82), (0.55, 0.54, 0.52), win_cols=8, win_rows=6)
    m.add_parapet(0, 22, 0, 26, 22, h=0.65, t=0.35)
    m.add_box(0, 22, 0, 20, 20, 17, (0.89, 0.88, 0.85), (0.53, 0.52, 0.50), win_cols=6, win_rows=6)
    m.add_parapet(0, 42, 0, 20, 17, h=0.6, t=0.32)
    m.add_box(0, 42, 0, 14, 16, 12, (0.91, 0.90, 0.88), (0.50, 0.49, 0.47), win_cols=4, win_rows=5)
    m.add_box(0, 58, 0, 7.5, 3.5, 6.5, (0.76, 0.75, 0.73), (0.45, 0.44, 0.42))
    specs.append(("highrise_03_setback_tower", "Ступінчаста висотка з терасами (IMG_9557)", m))

    # 4. Скляний бізнес-центр із горизонтальними поясами та HVAC
    m = MeshBuilder()
    m.add_box(0, 0, 0, 28, 4.5, 18, (0.55, 0.58, 0.62), (0.45, 0.47, 0.50), win_cols=7, win_rows=1)
    m.add_box(0, 4.5, 0, 26, 38.0, 16.5, (0.68, 0.75, 0.82), (0.38, 0.42, 0.46), win_cols=9, win_rows=11, win_col=(0.14, 0.24, 0.34))
    m.add_parapet(0, 42.5, 0, 26, 16.5, h=0.8, t=0.35, col=(0.62, 0.67, 0.72))
    for hx in (-6.5, 0.0, 6.5):
        m.add_box(hx, 42.5, 0, 3.8, 2.2, 4.5, (0.58, 0.60, 0.63), (0.42, 0.44, 0.46))
    specs.append(("highrise_04_glass_office", "Скляний бізнес-центр із блоками HVAC", m))

    # 5. Секційний житловий комплекс із еркерами
    m = MeshBuilder()
    m.add_box(0, 0, 0, 32, 34, 14, (0.84, 0.77, 0.68), (0.48, 0.43, 0.39), win_cols=9, win_rows=10)
    for ex in (-10.0, 0.0, 10.0):
        m.add_box(ex, 0, 7.6, 4.5, 35.2, 1.4, (0.88, 0.82, 0.74), (0.52, 0.47, 0.43), win_cols=2, win_rows=10)
    m.add_parapet(0, 34, 0, 32, 14, h=0.7, t=0.35, col=(0.78, 0.72, 0.64))
    m.add_box(0, 34, 0, 8.0, 3.0, 5.0, (0.75, 0.69, 0.61), (0.44, 0.40, 0.36))
    specs.append(("highrise_05_bay_residential", "Житлова багатоповерхівка з еркерами", m))

    # 6. Квартальний корпус із мансардним дахом
    m = MeshBuilder()
    m.add_box(0, 0, 0, 28, 20, 14, (0.86, 0.78, 0.66), (0.55, 0.46, 0.38), win_cols=8, win_rows=6)
    m.add_hipped_roof(0, 20, 0, 28, 14, 3.6, (0.46, 0.36, 0.30), overhang=0.35)
    for dx in (-8.0, 0.0, 8.0):
        m.add_box(dx, 20.6, 5.5, 2.4, 2.0, 2.2, (0.84, 0.76, 0.64), (0.44, 0.34, 0.28))
    specs.append(("highrise_06_courtyard_mansard", "Міський корпус із мансардним дахом", m))

    # 7. Монументальна класична висотка зі шпилем (як на IMG_9556)
    m = MeshBuilder()
    m.add_box(0, 0, 0, 30, 14, 26, (0.87, 0.76, 0.60), (0.52, 0.46, 0.38), win_cols=9, win_rows=4)
    m.add_box(0, 14, 0, 20, 26, 18, (0.89, 0.78, 0.62), (0.50, 0.45, 0.38), win_cols=6, win_rows=8)
    for cx_w in (-12.5, 12.5):
        for cz_w in (-10.5, 10.5):
            m.add_box(cx_w, 14, cz_w, 5.5, 10, 5.5, (0.86, 0.75, 0.59), (0.40, 0.52, 0.44), win_cols=2, win_rows=3)
    m.add_box(0, 40, 0, 12, 12, 12, (0.91, 0.80, 0.64), (0.38, 0.54, 0.45), win_cols=3, win_rows=4)
    m.add_pyramid_spire(0, 52, 0, 11.0, 6.5, (0.36, 0.54, 0.44))
    m.add_pyramid_spire(0, 58.5, 0, 1.4, 11.0, (0.78, 0.66, 0.38))
    specs.append(("highrise_07_monumental_spire", "Монументальна класична висотка зі шпилем (IMG_9556)", m))

    # 8. Циліндрична/12-гранна сучасна вежа (як ліворуч на IMG_9557)
    m = MeshBuilder()
    m.add_box(0, 0, 0, 22, 4.0, 22, (0.76, 0.77, 0.79), (0.52, 0.53, 0.55))
    m.add_cylinder_y(0, 4.0, 0, 8.8, 8.8, 44.0, 12, (0.82, 0.84, 0.87), (0.48, 0.50, 0.53))
    m.add_cylinder_y(0, 48.0, 0, 6.2, 6.2, 4.5, 12, (0.74, 0.76, 0.79), (0.42, 0.44, 0.47))
    specs.append(("highrise_08_cylindrical_tower", "Циліндрична висотна вежа з короною (IMG_9557)", m))

    # 9. Вежа зі скошеним дахом-вітрилом (як дальня вежа на IMG_9557)
    m = MeshBuilder()
    m.add_box(0, 0, 0, 20, 42, 16, (0.84, 0.85, 0.88), (0.50, 0.52, 0.55), win_cols=6, win_rows=12)
    # Скошена корона зверху
    x0, x1, z0, z1, y0, y1 = -10.0, 10.0, -8.0, 8.0, 42.0, 52.0
    col_w, col_r = (0.86, 0.87, 0.90), (0.48, 0.52, 0.58)
    m.add_quad((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y0 + 2.5, z1), col_w)
    m.add_quad((x1, y0, z0), (x0, y0, z0), (x0, y0 + 2.5, z0), (x1, y1, z0), col_w)
    m.add_quad((x1, y0, z1), (x1, y0, z0), (x1, y1, z0), (x1, y1, z1), col_w)
    m.add_quad((x0, y0, z0), (x0, y0, z1), (x0, y0 + 2.5, z1), (x0, y0 + 2.5, z0), col_w)
    m.add_quad((x0, y0 + 2.5, z1), (x1, y1, z1), (x1, y1, z0), (x0, y0 + 2.5, z0), col_r)
    specs.append(("highrise_09_slanted_crown", "Висотка зі скошеним дахом-вітрилом (IMG_9557)", m))

    # 10. Промислово-логістичний корпус зі світловими ліхтарями на даху
    m = MeshBuilder()
    m.add_box(0, 0, 0, 42, 12.5, 24, (0.72, 0.74, 0.76), (0.52, 0.54, 0.56), win_cols=10, win_rows=2)
    m.add_parapet(0, 12.5, 0, 42, 24, h=0.6, t=0.35, col=(0.64, 0.66, 0.68))
    for sx in (-12.0, 0.0, 12.0):
        m.add_gabled_roof(sx, 12.5, 0, 8.5, 18.0, 2.2, (0.46, 0.50, 0.55), (0.66, 0.68, 0.70), along_x=False, overhang=0.1)
    specs.append(("highrise_10_industrial_hall", "Промисловий корпус зі світловими ліхтарями", m))
    return specs


def build_10_houses():
    specs = []
    # 1. Класична хата з двосхилим дахом і димарем
    m = MeshBuilder()
    m.add_box(0, 0, 0, 11.0, 3.6, 8.5, (0.90, 0.84, 0.74), (0.85, 0.79, 0.69), win_cols=3, win_rows=1)
    m.add_gabled_roof(0, 3.6, 0, 11.0, 8.5, 2.6, (0.56, 0.34, 0.25), (0.86, 0.80, 0.70), along_x=True)
    m.add_box(2.8, 4.5, -1.2, 0.75, 2.1, 0.75, (0.48, 0.30, 0.24), (0.30, 0.20, 0.18))
    specs.append(("house_01_gabled_cottage", "Класичний будинок із двосхилим дахом і димарем", m))

    # 2. Будинок із чотирисхилим вальмовим дахом
    m = MeshBuilder()
    m.add_box(0, 0, 0, 12.0, 3.8, 10.0, (0.88, 0.82, 0.72), (0.82, 0.76, 0.66), win_cols=3, win_rows=1)
    m.add_hipped_roof(0, 3.8, 0, 12.0, 10.0, 2.7, (0.48, 0.36, 0.28))
    m.add_box(-2.5, 4.6, 1.0, 0.8, 2.0, 0.8, (0.45, 0.33, 0.26))
    specs.append(("house_02_hipped_manor", "Садиба з чотирисхилим вальмовим дахом", m))

    # 3. Г-подібний заміський котедж із перехресним дахом
    m = MeshBuilder()
    m.add_box(0, 0, -1.5, 13.0, 4.0, 7.5, (0.91, 0.86, 0.77), win_cols=4, win_rows=1)
    m.add_gabled_roof(0, 4.0, -1.5, 13.0, 7.5, 2.5, (0.52, 0.33, 0.25), (0.87, 0.82, 0.73), along_x=True)
    m.add_box(3.2, 0, 3.0, 6.5, 4.0, 6.0, (0.91, 0.86, 0.77), win_cols=2, win_rows=1)
    m.add_gabled_roof(3.2, 4.0, 3.0, 6.5, 6.0, 2.3, (0.52, 0.33, 0.25), (0.87, 0.82, 0.73), along_x=False)
    specs.append(("house_03_l_shaped_villa", "Г-подібний котедж із перехресним дахом", m))

    # 4. Двоповерховий котедж із мансардою
    m = MeshBuilder()
    m.add_box(0, 0, 0, 11.5, 6.4, 9.5, (0.87, 0.81, 0.72), win_cols=3, win_rows=2)
    m.add_gabled_roof(0, 6.4, 0, 11.5, 9.5, 2.8, (0.42, 0.35, 0.32), (0.84, 0.78, 0.69), along_x=True)
    m.add_box(0, 6.8, 2.8, 3.2, 1.8, 2.4, (0.86, 0.80, 0.71), (0.40, 0.33, 0.30))
    specs.append(("house_04_two_story_dormer", "Двоповерховий котедж із мансардним вікном", m))

    # 5. Таунхаус / зблокований двосімейний будинок
    m = MeshBuilder()
    m.add_box(0, 0, 0, 16.0, 6.2, 9.0, (0.85, 0.78, 0.69), win_cols=6, win_rows=2)
    m.add_gabled_roof(0, 6.2, 0, 16.0, 9.0, 2.5, (0.50, 0.35, 0.28), (0.82, 0.75, 0.66), along_x=True)
    m.add_box(-4.0, 7.0, 0, 0.7, 2.0, 0.7, (0.44, 0.32, 0.26))
    m.add_box(4.0, 7.0, 0, 0.7, 2.0, 0.7, (0.44, 0.32, 0.26))
    specs.append(("house_05_duplex_townhouse", "Зблокований двосімейний таунхаус", m))

    # 6. Будинок із прибудованим гаражем
    m = MeshBuilder()
    m.add_box(-2.2, 0, 0, 10.0, 5.6, 9.0, (0.89, 0.84, 0.75), win_cols=3, win_rows=2)
    m.add_hipped_roof(-2.2, 5.6, 0, 10.0, 9.0, 2.4, (0.46, 0.36, 0.30))
    m.add_box(5.0, 0, 0.4, 5.2, 3.2, 7.2, (0.83, 0.79, 0.71), (0.48, 0.44, 0.40))
    specs.append(("house_06_garage_cottage", "Котедж із прибудованим гаражем", m))

    # 7. Садиба з ламаним мансардним дахом
    m = MeshBuilder()
    m.add_box(0, 0, 0, 10.5, 3.5, 8.5, (0.88, 0.80, 0.68), win_cols=3, win_rows=1)
    m.add_box(0, 3.5, 0, 8.8, 2.2, 7.2, (0.54, 0.37, 0.28), win_cols=2, win_rows=1)
    m.add_gabled_roof(0, 5.7, 0, 8.8, 7.2, 1.5, (0.50, 0.34, 0.25), (0.84, 0.76, 0.64), along_x=True, overhang=0.15)
    specs.append(("house_07_mansard_homestead", "Садиба з ламаним мансардним дахом", m))

    # 8. Сучасний котедж із плоским дахом і терасою
    m = MeshBuilder()
    m.add_box(0, 0, 0, 12.0, 3.6, 9.5, (0.90, 0.89, 0.86), (0.52, 0.51, 0.49), win_cols=3, win_rows=1)
    m.add_box(-1.5, 3.6, -0.8, 8.0, 3.2, 7.0, (0.84, 0.82, 0.78), (0.46, 0.45, 0.43), win_cols=2, win_rows=1)
    m.add_parapet(0, 3.6, 0, 12.0, 9.5, h=0.45, t=0.25, col=(0.82, 0.81, 0.78))
    m.add_parapet(-1.5, 6.8, -0.8, 8.0, 7.0, h=0.45, t=0.25, col=(0.78, 0.77, 0.74))
    specs.append(("house_08_modern_flat", "Сучасний двоярусний котедж із плоским дахом", m))

    # 9. Сільська садиба з верандою
    m = MeshBuilder()
    m.add_box(0, 0, 0, 12.5, 3.4, 7.5, (0.92, 0.87, 0.78), win_cols=4, win_rows=1)
    m.add_hipped_roof(0, 3.4, 0, 12.5, 7.5, 2.3, (0.55, 0.38, 0.27))
    m.add_box(-2.0, 0, 4.6, 5.5, 2.7, 2.4, (0.88, 0.82, 0.73))
    m.add_gabled_roof(-2.0, 2.7, 4.6, 5.5, 2.4, 1.1, (0.53, 0.36, 0.26), (0.86, 0.80, 0.71), along_x=False, overhang=0.15)
    specs.append(("house_09_rural_veranda", "Сільська садиба з верандою", m))

    # 10. Компактний дачний будинок із високим дахом
    m = MeshBuilder()
    m.add_box(0, 0, 0, 8.5, 3.2, 7.5, (0.86, 0.78, 0.67), win_cols=2, win_rows=1)
    m.add_gabled_roof(0, 3.2, 0, 8.5, 7.5, 3.4, (0.45, 0.31, 0.24), (0.83, 0.75, 0.64), along_x=True, overhang=0.3)
    specs.append(("house_10_steep_dacha", "Компактний будинок із крутим дахом", m))
    return specs


# ---------- Процедурна генерація фотореалістичних/архітектурних текстур фасадів ----------
def noisy_canvas(w, h, base_rgb, amp=8, seed=42):
    rng = np.random.default_rng(seed)
    arr = np.zeros((h, w, 3), dtype=np.float32)
    for c in range(3):
        arr[:, :, c] = base_rgb[c]
    n1 = rng.normal(0, amp, (h, w, 1))
    n2 = np.repeat(np.repeat(rng.normal(0, amp * 0.6, ((h + 3) // 4, (w + 3) // 4, 1)), 4, axis=0), 4, axis=1)[:h, :w, :]
    arr = np.clip(arr + n1 + n2, 0, 255).astype(np.uint8)
    return Image.fromarray(arr, mode="RGB")


def draw_window(draw, x0, y0, x1, y1, frame_rgb=(235, 232, 224), glass_top=(54, 72, 92), glass_bot=(28, 38, 52), mullion=True, sill=True):
    # Зовнішня тінь ніші вікна (верхній та лівий укіс темніші, як на IMG_9557 і IMG_9556)
    draw.rectangle([x0 - 3, y0 - 3, x1 + 2, y1 + 2], fill=(68, 62, 56))
    draw.rectangle([x0 - 1, y0 - 1, x1 + 2, y1 + 2], fill=(125, 118, 108))
    # Рама
    draw.rectangle([x0, y0, x1, y1], fill=frame_rgb)
    # Скло (верхня та нижня зони з легким відблиском неба)
    gx0, gy0, gx1, gy1 = x0 + 4, y0 + 4, x1 - 4, y1 - 4
    ym = gy0 + (gy1 - gy0) * 2 // 5
    draw.rectangle([gx0, gy0, gx1, ym], fill=glass_top)
    draw.rectangle([gx0, ym, gx1, gy1], fill=glass_bot)
    # Відблиск на склі
    draw.rectangle([gx0 + 2, gy0 + 2, gx0 + max(3, (gx1 - gx0) // 4), ym - 2], fill=tuple(min(255, c + 24) for c in glass_top))
    if mullion:
        xm = (gx0 + gx1) // 2
        draw.rectangle([xm - 2, y0 + 2, xm + 1, y1 - 2], fill=frame_rgb)
        draw.rectangle([gx0, ym - 1, gx1, ym + 1], fill=frame_rgb)
    if sill:
        draw.rectangle([x0 - 4, y1 + 1, x1 + 4, y1 + 6], fill=(198, 192, 182))
        draw.rectangle([x0 - 4, y1 + 6, x1 + 4, y1 + 9], fill=(85, 78, 70))


def generate_facades():
    # 1. fac_panel.jpg (512x458): 5 поверхів × 5 панельних секцій (з лоджіями, міжпанельними швами, кондиціонерами)
    W, H = 512, 458
    im = noisy_canvas(W, H, (198, 184, 162), amp=9, seed=101)
    d = ImageDraw.Draw(im)
    rows, cols = 5, 4
    rh = H / rows
    cw = W / cols
    for r in range(rows):
        y0 = int(r * rh)
        y1 = int((r + 1) * rh)
        # Міжповерховий шов і карнизний поясок
        d.rectangle([0, y0, W, y0 + 2], fill=(112, 102, 90))
        d.rectangle([0, y0 + 3, W, y0 + 5], fill=(224, 214, 196))
        for c in range(cols):
            x0 = int(c * cw)
            x1 = int((c + 1) * cw)
            d.rectangle([x0, y0, x0 + 2, y1], fill=(116, 106, 94))
            # Кожна 4-та колонка — засклена лоджія з парапетом
            if c == 2:
                lx0, ly0, lx1, ly1 = x0 + 10, y0 + 10, x1 - 10, y1 - 6
                draw_window(d, lx0, ly0, lx1, ly0 + int((ly1 - ly0) * 0.56), frame_rgb=(228, 224, 216), glass_top=(66, 86, 108), glass_bot=(36, 48, 64))
                # Бетонна плита балкона
                d.rectangle([lx0 - 2, ly0 + int((ly1 - ly0) * 0.58), lx1 + 2, ly1], fill=(176, 166, 148), outline=(105, 96, 84))
            else:
                wx0, wy0 = x0 + int(cw * 0.22), y0 + int(rh * 0.20)
                wx1, wy1 = x1 - int(cw * 0.22), y1 - int(rh * 0.22)
                gt = (74, 96, 118) if (r + c) % 3 != 0 else (95, 108, 115)
                gb = (34, 46, 62) if (r + c) % 2 == 0 else (48, 56, 64)
                draw_window(d, wx0, wy0, wx1, wy1, glass_top=gt, glass_bot=gb)
    im.save(ASSETS / "fac_panel.jpg", quality=92)

    # 2. fac_house.jpg (512x272): приватний будинок — теплий тинькований фасад, цоколь, карниз, 2 вікна з віконницями/ лиштвою
    W, H = 512, 272
    im = noisy_canvas(W, H, (226, 208, 178), amp=7, seed=202)
    d = ImageDraw.Draw(im)
    # Карниз зверху і кам'яний цоколь знизу
    d.rectangle([0, 0, W, 16], fill=(132, 108, 86))
    d.rectangle([0, 16, W, 24], fill=(184, 164, 138))
    d.rectangle([0, H - 46, W, H], fill=(116, 104, 92))
    d.rectangle([0, H - 50, W, H - 46], fill=(164, 150, 132))
    for cx in (128, 384):
        wx0, wy0, wx1, wy1 = cx - 54, 56, cx + 54, 186
        # Світла лиштва навколо вікна
        d.rectangle([wx0 - 8, wy0 - 8, wx1 + 8, wy1 + 8], fill=(242, 235, 222), outline=(168, 152, 130))
        draw_window(d, wx0, wy0, wx1, wy1, frame_rgb=(245, 242, 236), glass_top=(68, 90, 112), glass_bot=(34, 46, 62))
    im.save(ASSETS / "fac_house.jpg", quality=92)

    # 3. fac_ind.jpg (512x256): промисловий/комерційний фасад із пілястрами та стрічковим склінням
    W, H = 512, 256
    im = noisy_canvas(W, H, (186, 190, 194), amp=7, seed=303)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 14], fill=(118, 122, 126))
    d.rectangle([0, H - 36, W, H], fill=(112, 116, 120))
    d.rectangle([0, 160, W, 166], fill=(136, 140, 144))
    for c in range(4):
        x0 = c * 128
        d.rectangle([x0, 0, x0 + 10, H], fill=(144, 148, 152))
        d.rectangle([x0 + 10, 0, x0 + 14, H], fill=(208, 212, 216))
        draw_window(d, x0 + 22, 34, x0 + 114, 138, frame_rgb=(210, 214, 218), glass_top=(64, 84, 104), glass_bot=(34, 46, 60))
    im.save(ASSETS / "fac_ind.jpg", quality=92)

    # 4. fac_pub.jpg (512x306): класична громадська/міська будівля (теплий пісковик як на IMG_9556, пілястри, високі вікна з карнизами)
    W, H = 512, 306
    im = noisy_canvas(W, H, (222, 190, 144), amp=7, seed=404)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 18], fill=(154, 126, 92))
    d.rectangle([0, 18, W, 28], fill=(240, 216, 178))
    d.rectangle([0, H - 34, W, H], fill=(142, 118, 88))
    for c in range(3):
        cx = int((c + 0.5) * W / 3)
        # Пілястри між вікнами
        px = int(c * W / 3)
        d.rectangle([px, 28, px + 14, H - 34], fill=(234, 206, 164))
        d.rectangle([px + 14, 28, px + 18, H - 34], fill=(166, 138, 102))
        wx0, wy0, wx1, wy1 = cx - 46, 52, cx + 46, 232
        # Сандрик (карниз над вікном)
        d.rectangle([wx0 - 10, wy0 - 16, wx1 + 10, wy0 - 6], fill=(242, 220, 184), outline=(148, 120, 86))
        draw_window(d, wx0, wy0, wx1, wy1, frame_rgb=(242, 234, 218), glass_top=(62, 82, 104), glass_bot=(28, 38, 52))
    im.save(ASSETS / "fac_pub.jpg", quality=92)

    # 5. fac_shed.jpg (512x384): господарська/складська споруда з профнастилом, воротами та вентиляційними ґратами
    W, H = 512, 384
    im = noisy_canvas(W, H, (158, 150, 138), amp=6, seed=505)
    d = ImageDraw.Draw(im)
    for x in range(0, W, 32):
        d.rectangle([x, 0, x + 3, H], fill=(118, 110, 100))
        d.rectangle([x + 3, 0, x + 6, H], fill=(182, 174, 162))
    d.rectangle([0, 0, W, 16], fill=(104, 98, 88))
    d.rectangle([196, 104, 328, H], fill=(98, 90, 80), outline=(72, 66, 58), width=4)
    for y in range(124, H, 28):
        d.line([202, y, 322, y], fill=(78, 72, 64), width=2)
    im.save(ASSETS / "fac_shed.jpg", quality=92)


def main():
    PREFABS_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {"highrises": [], "houses": []}

    for slug, title, builder in build_10_highrises():
        fn = f"{slug}.glb"
        builder.to_glb(slug, PREFABS_DIR / fn)
        manifest["highrises"].append({"id": slug, "file": f"prefabs/{fn}", "title": title, "vertices": len(builder.pos), "triangles": len(builder.idx) // 3})

    for slug, title, builder in build_10_houses():
        fn = f"{slug}.glb"
        builder.to_glb(slug, PREFABS_DIR / fn)
        manifest["houses"].append({"id": slug, "file": f"prefabs/{fn}", "title": title, "vertices": len(builder.pos), "triangles": len(builder.idx) // 3})

    with open(PREFABS_DIR / "index.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    generate_facades()
    print(f"Згенеровано {len(manifest['highrises'])} багатоповерхівок і {len(manifest['houses'])} приватних будинків у {PREFABS_DIR}")


if __name__ == "__main__":
    main()
