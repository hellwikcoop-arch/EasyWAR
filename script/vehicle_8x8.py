"""Спільні частини важких колісних шасі 8×8 з кабіною над передніми мостами (Р-624 «Вільха», ОТРК «Сапсан»).

Одиниці — метри; перед машини дивиться в +x, «вгору» — +y, права сторона — +z. Повертає словники призм за назвами частин,
які скрипти build-*-model.py розкладають по групах запікання. Форми будуються з нуля, сторонніх мешів немає.
"""
import numpy as np

import vehicle_kit as k
from vehicle_kit import box, cyl_between, cyl_z, level_hull, merge, rivet_row, slope_box

AXLES = [3.85, 2.35, -0.15, -1.65]
WHEEL_R, WHEEL_Y, WHEEL_Z, WHEEL_W = 0.60, 0.60, 1.07, 0.46
CAB_FRONT, CAB_REAR = 5.12, 3.30
FRAME_X0, FRAME_X1 = -5.60, 4.90
DECK_Y = 1.42


def chassis():
    p = {}
    L = FRAME_X1 - FRAME_X0
    xc = (FRAME_X0 + FRAME_X1) / 2
    frame = [box((xc, 1.10, s * 0.46), (L, 0.26, 0.11)) for s in (-1, 1)]
    frame += [box((x, 1.10, 0.0), (0.12, 0.20, 0.94)) for x in np.linspace(FRAME_X0 + 0.3, FRAME_X1 - 0.3, 11)]
    p["frame"] = merge(frame)
    axle, springs = [], []
    for x in AXLES:
        axle.append(cyl_between((x, WHEEL_Y, -WHEEL_Z + 0.14), (x, WHEEL_Y, WHEEL_Z - 0.14), 0.095, 16))
        axle.append(box((x, 0.66, 0.0), (0.52, 0.34, 0.46)))
        for s in (-1, 1):
            springs += k.leaf_spring(x, 0.90, s * 0.50, 0.90)
    for xa, xb in ((AXLES[0], AXLES[1]), (AXLES[2], AXLES[3])):
        axle.append(cyl_between((xa, 0.70, 0.0), (xb, 0.70, 0.0), 0.06, 12))
    p["axles"] = merge(axle)
    p["springs"] = merge(springs)
    p["tanks"] = merge([box((1.35, 0.95, -0.88), (2.0, 0.54, 0.54), bevel=0.04), box((1.1, 0.95, 0.88), (1.4, 0.48, 0.52), bevel=0.04),
                        box((-3.1, 0.92, 0.88), (0.9, 0.38, 0.46), bevel=0.03)])
    p["exhaust"] = merge([cyl_between((3.0, 1.25, 1.06), (3.0, 3.50, 1.06), 0.08, 14), cyl_between((3.0, 3.50, 1.06), (3.0, 3.60, 1.06), 0.11, 14)])
    fenders = []
    for xa, xb in ((AXLES[0], AXLES[1]), (AXLES[2], AXLES[3])):
        xm, w = (xa + xb) / 2, abs(xa - xb) + 1.40
        for s in (-1, 1):
            fenders += [box((xm, 1.12, s * 1.14), (w, 0.05, 0.58), bevel=0.012), box((xm + w / 2, 0.92, s * 1.14), (0.05, 0.40, 0.58), bevel=0.01),
                        box((xm - w / 2, 0.92, s * 1.14), (0.05, 0.40, 0.58), bevel=0.01)]
    p["fenders"] = merge(fenders)
    tyres, rims, bolts = k.wheel_set(AXLES, WHEEL_R, WHEEL_Y, WHEEL_Z, WHEEL_W, r_rim=0.35, lug_count=30)
    p["tyres"], p["rims"], p["wheel_bolts"] = merge(tyres), merge(rims), merge(bolts)
    # корма: балка, ліхтарі, фаркоп, буксирувальні вушка
    p["rear_beam"] = merge([box((FRAME_X0 - 0.06, 1.12, 0.0), (0.16, 0.26, 2.40)), box((FRAME_X0 + 0.0, 0.80, 0.0), (0.10, 0.10, 2.0))] +
                           [box((FRAME_X0 - 0.10, 1.30, s * 1.10), (0.08, 0.34, 0.26)) for s in (-1, 1)])
    p["rear_red"] = merge([cyl_between((FRAME_X0 - 0.16, 1.34, s * 1.10), (FRAME_X0 - 0.20, 1.34, s * 1.10), 0.055, 16) for s in (-1, 1)])
    p["rear_amber"] = merge([cyl_between((FRAME_X0 - 0.16, 1.20, s * 1.10), (FRAME_X0 - 0.20, 1.20, s * 1.10), 0.035, 12) for s in (-1, 1)])
    p["hitch"] = merge([cyl_between((FRAME_X0 - 0.06, 1.08, 0.0), (FRAME_X0 - 0.34, 1.08, 0.0), 0.06, 12), cyl_z((FRAME_X0 - 0.32, 1.08, 0.0), 0.08, 0.05, 16)])
    return p


def cab_over():
    """Кабіна над передніми мостами: пряме чоло зі скошеним верхом, два вітрила, висока ґрата, поріг і підніжки."""
    p, rivets = {}, []
    p["cab"] = level_hull([(1.34, CAB_FRONT, CAB_REAR, 1.20, 0.10), (2.50, CAB_FRONT + 0.02, CAB_REAR, 1.22, 0.08), (3.06, CAB_FRONT - 0.12, CAB_REAR + 0.05, 1.18, 0.12),
                           (3.34, CAB_FRONT - 0.40, CAB_REAR + 0.10, 1.10, 0.14)])
    ws0, ws1 = (CAB_FRONT - 0.10, 2.48), (CAB_FRONT - 0.32, 3.20)
    glass, frames, wipers = [], [], []
    for z0 in (-0.58, 0.58):
        glass.append(slope_box(ws0, ws1, 0.5, 0.012, (0.012, 0.72, 1.02), z0))
        frames.append(slope_box(ws0, ws1, 0.5, 0.020, (0.018, 0.78, 1.12), z0))
        wipers.append(slope_box(ws0, ws1, 0.28, 0.03, (0.012, 0.36, 0.02), z0 + 0.1))
    frames.append(slope_box(ws0, ws1, 0.5, 0.025, (0.025, 0.80, 0.05), 0.0))
    p["windshields"], p["windshield_frames"], p["wipers"] = merge(glass), merge(frames), merge(wipers)
    p["grille_back"] = merge([box((CAB_FRONT + 0.012, 1.84, 0.0), (0.02, 0.62, 1.56), bevel=0.004)])
    bars = [box((CAB_FRONT + 0.04, 1.58 + 0.06 * i, 0.0), (0.014, 0.026, 1.52), bevel=0.004) for i in range(10)]
    p["grille"] = merge([box((CAB_FRONT + 0.03, 1.84, 0.0), (0.03, 0.68, 1.64), bevel=0.008)] + bars)
    doors, handles, side_win = [], [], []
    for s in (-1, 1):
        doors.append(box(((CAB_FRONT + CAB_REAR) / 2 - 0.1, 2.10, s * 1.225), (1.28, 1.40, 0.025), bevel=0.012))
        side_win.append(box((4.42, 2.70, s * 1.236), (0.86, 0.62, 0.014), bevel=0.004))
        handles.append(box((3.78, 2.18, s * 1.246), (0.14, 0.04, 0.04), bevel=0.008))
        for x in (3.5, 4.9):
            rivets += rivet_row((x, 1.50, s * 1.226), (x, 2.55, s * 1.226), 0.13, (0, 0, s))
    p["doors"], p["side_windows"], p["door_handles"] = merge(doors), merge(side_win), merge(handles)
    p["lamps"] = merge([cyl_between((CAB_FRONT + 0.03, 1.46, s * 0.92), (CAB_FRONT + 0.08, 1.46, s * 0.92), 0.07, 16) for s in (-1, 1)])
    p["lamps_amber"] = merge([box((CAB_FRONT + 0.04, 1.46, s * 1.08), (0.03, 0.10, 0.14), bevel=0.006) for s in (-1, 1)] +
                             [box((CAB_FRONT - 0.40, 3.46, z), (0.12, 0.07, 0.17), bevel=0.01) for z in (-0.5, 0.0, 0.5)])
    p["bumper"] = merge([box((CAB_FRONT + 0.14, 1.04, 0.0), (0.30, 0.30, 2.46), bevel=0.03), box((CAB_FRONT + 0.06, 1.26, 0.0), (0.12, 0.08, 2.30), bevel=0.01)] +
                        [cyl_between((CAB_FRONT + 0.16, 0.84, s * 0.80), (CAB_FRONT + 0.42, 0.84, s * 0.80), 0.032, 8) for s in (-1, 1)])
    arms, mirs = [], []
    for s in (-1, 1):
        a, m = k.mirror((CAB_FRONT - 0.30, 2.80, s * 1.26), s, h=0.56, w=0.26)
        arms += a
        mirs.append(m)
    p["mirror_arms"], p["mirrors"] = merge(arms), merge(mirs)
    steps = []
    for s in (-1, 1):
        steps += k.ladder_steps(4.20, 0.66, s * 1.28, n=3, step=0.34, width=0.60)
    p["steps"] = merge(steps)
    p["cab_rivets"] = merge(rivets)
    return p


# ---------- спільні групи запікання для обох машин ----------
import vehicle_paint as vp  # noqa: E402

OLIVE_RGB = (82, 88, 60)
OL = vp.R("camo", 0.72, 0.1)
OL_DK = vp.R("camo", 0.74, 0.12, tone=0.8)
CHASSIS_NAMES = ["frame", "axles", "springs", "tanks", "exhaust", "fenders", "rear_beam", "rear_red", "rear_amber", "hitch", "steps"]
CHASSIS_RECIPES = {"frame": vp.R((56, 56, 46), 0.82, 0.3), "axles": vp.R((50, 50, 42), 0.8, 0.4), "springs": vp.R((44, 44, 38), 0.7, 0.6),
                   "tanks": vp.R("camo", 0.7, 0.2, tone=0.8), "exhaust": vp.R((74, 62, 50), 0.6, 0.5), "fenders": OL_DK,
                   "rear_beam": vp.R((54, 54, 44), 0.8, 0.35), "rear_red": vp.LENS_R, "rear_amber": vp.LENS_A, "hitch": vp.R((38, 38, 36), 0.5, 0.8),
                   "steps": vp.R((46, 46, 40), 0.8, 0.5)}
CAB_NAMES = ["cab", "windshields", "windshield_frames", "wipers", "grille_back", "grille", "doors", "side_windows", "door_handles", "lamps",
             "lamps_amber", "bumper", "mirror_arms", "mirrors", "cab_rivets"]
CAB_RECIPES = {"cab": OL, "windshields": vp.GLASS, "windshield_frames": OL_DK, "wipers": vp.BLACK, "grille_back": vp.BLACK,
               "grille": vp.R("camo", 0.7, 0.2, tone=0.75), "doors": OL, "side_windows": vp.GLASS, "door_handles": vp.R("camo", 0.6, 0.3, tone=0.7),
               "lamps": vp.LENS_W, "lamps_amber": vp.LENS_A, "bumper": vp.R("camo", 0.7, 0.2, tone=0.85), "mirror_arms": OL_DK, "mirrors": vp.BLACK,
               "cab_rivets": vp.R("camo", 0.7, 0.2, tone=0.75)}


def post_cab(s, tx, masks):
    Y = (0, 1, 0)
    vp.put(s, tx, vp.mlc_disc(40, 0.075), (CAB_FRONT + 0.0, 1.50, -0.66), (1, 0, 0), Y)
    for sg in (-1, 1):
        vp.put(s, tx, vp.plate(["DATA"], 0.14, 0.09, bg=(176, 178, 170), px_per_m=900), (3.9, 1.55, sg * 1.240), (0, 0, sg), Y)
