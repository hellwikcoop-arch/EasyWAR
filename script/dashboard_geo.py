#!/usr/bin/env python3
"""Створює src/dashboard-module-geo.js — спрощений контур України для картки «Карта подій».

Джерело: src/public/map-assets/coast.json (geoBoundaries, © OpenStreetMap contributors, ODbL).
Беруться два найбільші кільця (материк і Крим), спрощені алгоритмом Дугласа–Пекера з
допуском 0,06°. Запуск: python3 script/dashboard_geo.py (із кореня репозиторію).
"""
import json
import math
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "src" / "public" / "map-assets" / "coast.json"
TARGET = ROOT / "src" / "dashboard-module-geo.js"
TOLERANCE = 0.06


def rdp(points, eps):
    if len(points) < 3:
        return points

    def dist(p, a, b):
        (x, y), (x1, y1), (x2, y2) = p, a, b
        dx, dy = x2 - x1, y2 - y1
        if dx == dy == 0:
            return math.hypot(x - x1, y - y1)
        t = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
        return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))

    dmax, idx = 0, 0
    for i in range(1, len(points) - 1):
        d = dist(points[i], points[0], points[-1])
        if d > dmax:
            dmax, idx = d, i
    if dmax > eps:
        return rdp(points[: idx + 1], eps)[:-1] + rdp(points[idx:], eps)
    return [points[0], points[-1]]


def main():
    rings = sorted(json.loads(SOURCE.read_text()), key=len, reverse=True)[:2]
    simplified = [[[round(x, 2), round(y, 2)] for x, y in rdp(ring, TOLERANCE)] for ring in rings]
    xs = [x for ring in rings for x, _ in ring]
    ys = [y for ring in rings for _, y in ring]
    bounds = {
        "west": math.floor(min(xs) * 100) / 100,
        "east": math.ceil(max(xs) * 100) / 100,
        "south": math.floor(min(ys) * 100) / 100,
        "north": math.ceil(max(ys) * 100) / 100,
    }
    text = (
        "// Спрощений контур України (материк і Крим) для картки «Карта подій»: довгота, широта.\n"
        "// Джерело — src/public/map-assets/coast.json (geoBoundaries, © OpenStreetMap contributors, ODbL),\n"
        "// спрощено алгоритмом Дугласа–Пекера (0,06°) скриптом script/dashboard_geo.py. Мережі не потребує.\n"
        f"export const UKRAINE_OUTLINE = {json.dumps(simplified, separators=(',', ':'))};\n"
        "export const UKRAINE_BOUNDS = { "
        + ", ".join(f"{key}: {value}" for key, value in bounds.items())
        + " };\n"
    )
    TARGET.write_text(text)
    print(f"{TARGET.relative_to(ROOT)}: {[len(ring) for ring in simplified]} точок")


if __name__ == "__main__":
    main()
