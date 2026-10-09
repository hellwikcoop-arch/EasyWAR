"""Спільні частини важких колісних шасі 8×8 білоруського типу (Р-624 «Вільха», ОТРК «Сапсан»): рама, мости, ресори, баки, арки,
великі шини, корма; а також групи запікання з піксельним камуфляжем.

Одиниці — метри; перед машини дивиться в +x, «вгору» — +y, права сторона — +z. Повертає словники призм за назвами частин,
які скрипти build-*-model.py розкладають по групах запікання. Форми будуються з нуля, сторонніх мешів немає.
"""
import numpy as np

import vehicle_kit as k
import vehicle_paint as vp
from vehicle_kit import box, cyl_between, cyl_z, merge

WHEEL_R, WHEEL_W, WHEEL_Z = 0.66, 0.53, 1.12
FRAME_Y = 1.22


def chassis(axles, frame_x0, frame_x1, with_tanks=True, groups=None):
    """groups — які осі разом під однією аркою (за замовчуванням дві пари для 8×8; для 10×10 — пара й трійка)."""
    groups = groups or [(0, 1), (2, 3)]
    p = {}
    L = frame_x1 - frame_x0
    xc = (frame_x0 + frame_x1) / 2
    wy = WHEEL_R
    frame = [box((xc, FRAME_Y, s * 0.50), (L, 0.30, 0.12)) for s in (-1, 1)]
    frame += [box((x, FRAME_Y, 0.0), (0.14, 0.22, 1.02)) for x in np.linspace(frame_x0 + 0.3, frame_x1 - 0.3, 12)]
    p["frame"] = merge(frame)
    axle, springs = [], []
    for x in axles:
        axle.append(cyl_between((x, wy, -WHEEL_Z + 0.16), (x, wy, WHEEL_Z - 0.16), 0.10, 16))
        axle.append(box((x, 0.78, 0.0), (0.56, 0.36, 0.50)))
        for s in (-1, 1):
            springs += k.leaf_spring(x, 0.98, s * 0.52, 0.95)
    for g in groups:
        for ia, ib in zip(g[:-1], g[1:]):
            axle.append(cyl_between((axles[ia], 0.80, 0.0), (axles[ib], 0.80, 0.0), 0.065, 12))
    p["axles"] = merge(axle)
    p["springs"] = merge(springs)
    if with_tanks:
        p["tanks"] = merge([box((axles[1] - 0.95, 1.00, -0.92), (1.40, 0.56, 0.58), bevel=0.04), box((axles[1] - 0.95, 1.00, 0.92), (1.10, 0.50, 0.56), bevel=0.04),
                            box((axles[-1] + 0.9, 0.96, 0.92), (0.80, 0.40, 0.50), bevel=0.03)])
    # арки: плита зверху, зовнішня стінка, передня й задня стінки — як на «МАЗ»-подібних шасі
    top = 2 * WHEEL_R + 0.10
    fenders = []
    for g in groups:
        xa, xb = axles[g[0]], axles[g[-1]]
        xm, w = (xa + xb) / 2, abs(xa - xb) + 1.50
        for s in (-1, 1):
            fenders += [box((xm, top, s * 1.14), (w, 0.05, 0.76), bevel=0.012),
                        box((xm, top - 0.20, s * (WHEEL_Z + 0.36)), (w, 0.40, 0.04), bevel=0.01),
                        box((xm + w / 2, top - 0.30, s * 1.14), (0.05, 0.60, 0.76), bevel=0.01),
                        box((xm - w / 2, top - 0.30, s * 1.14), (0.05, 0.60, 0.76), bevel=0.01)]
    p["fenders"] = merge(fenders)
    tyres, rims, bolts = k.wheel_set(axles, WHEEL_R, wy, WHEEL_Z, WHEEL_W, r_rim=0.38, lug_count=32, r_in=0.36, lug_len=0.20)
    p["tyres"], p["rims"], p["wheel_bolts"] = merge(tyres), merge(rims), merge(bolts)
    p["rear_beam"] = merge([box((frame_x0 - 0.06, 1.14, 0.0), (0.16, 0.28, 2.40)), box((frame_x0 + 0.0, 0.84, 0.0), (0.10, 0.10, 2.0))] +
                           [box((frame_x0 - 0.10, 1.34, s * 1.10), (0.08, 0.34, 0.26)) for s in (-1, 1)])
    p["rear_red"] = merge([cyl_between((frame_x0 - 0.16, 1.38, s * 1.10), (frame_x0 - 0.20, 1.38, s * 1.10), 0.055, 16) for s in (-1, 1)])
    p["rear_amber"] = merge([cyl_between((frame_x0 - 0.16, 1.24, s * 1.10), (frame_x0 - 0.20, 1.24, s * 1.10), 0.035, 12) for s in (-1, 1)])
    p["hitch"] = merge([cyl_between((frame_x0 - 0.06, 1.10, 0.0), (frame_x0 - 0.34, 1.10, 0.0), 0.06, 12), cyl_z((frame_x0 - 0.32, 1.10, 0.0), 0.08, 0.05, 16)])
    return p


# ---------- спільні групи запікання ----------
# Піксельний камуфляж ЗСУ: темно-зелена основа, олива, світла хакі й піщані «пікселі».
PIXEL = (vp.srgb(54, 66, 44), vp.srgb(80, 90, 60), vp.srgb(118, 120, 84), vp.srgb(150, 140, 98))
OLIVE_RGB = (72, 82, 54)
OL = vp.R("camo", 0.74, 0.1)
OL_DK = vp.R("camo", 0.76, 0.12, tone=0.78)
CHASSIS_NAMES = ["frame", "axles", "springs", "tanks", "fenders", "rear_beam", "rear_red", "rear_amber", "hitch"]
CHASSIS_RECIPES = {"frame": vp.R((52, 54, 44), 0.82, 0.3), "axles": vp.R((48, 48, 40), 0.8, 0.4), "springs": vp.R((42, 42, 36), 0.7, 0.6),
                   "tanks": vp.R((38, 40, 36), 0.72, 0.4), "fenders": OL_DK, "rear_beam": vp.R((50, 52, 42), 0.8, 0.35),
                   "rear_red": vp.LENS_R, "rear_amber": vp.LENS_A, "hitch": vp.R((38, 38, 36), 0.5, 0.8)}
