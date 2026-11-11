# Логотип easyWAR → матеріали для 3D-тризуба (src/start-logo-3d.js).
#   python3 logo.py cut src/index.html out/        — витягує вбудований логотип (.start-brand-art), вирізає
#                                                     золотий тризуб (trident.png — вхід для prep.py), заповнює
#                                                     його місце сусідніми пікселями (logo-base.png/.webp) і
#                                                     пише рамку тризуба (bbox.txt) у пікселях логотипа
#   python3 logo.py box out/bbox.txt frames/logo    — рамка кадру смуги (після strip.py) у пікселях логотипа
#                                                     для LOGO.box у src/start-logo-3d-core.js
import sys, os, re, glob, base64
from PIL import Image
import numpy as np

def logo_image(path):
    if path.endswith('.html'):
        html = open(path, encoding='utf-8').read()
        m = re.search(r'class="start-brand-art"[^>]*src="data:image/png;base64,([^"]+)"', html)
        if not m: raise SystemExit('start-brand-art не знайдено')
        from io import BytesIO
        return Image.open(BytesIO(base64.b64decode(m.group(1)))).convert('RGBA')
    return Image.open(path).convert('RGBA')

def trident_mask(im):
    import cv2
    arr = np.asarray(im); a = arr[..., 3]
    hsv = np.asarray(im.convert('RGB').convert('HSV')).astype(int)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    gold = ((h >= 14) & (h <= 52) & (s >= 70) & (v >= 55) & (a > 10)).astype(np.uint8)
    # лише центр кільця: дуги кільця теж золоті
    win = np.zeros_like(gold); win[int(im.height * .2):int(im.height * .71), int(im.width * .29):int(im.width * .72)] = 1
    gold &= win
    n, lab, stats, _ = cv2.connectedComponentsWithStats(gold, 8)
    m = (lab == 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    ff = m.copy(); mask = np.zeros((m.shape[0] + 2, m.shape[1] + 2), np.uint8)
    cv2.floodFill(ff, mask, (0, 0), 1)
    return m | (1 - ff)

def cut(src, out):
    import cv2
    os.makedirs(out, exist_ok=True)
    im = logo_image(src); arr = np.asarray(im).copy(); m = trident_mask(im)
    ys, xs = np.where(m); x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    soft = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 0.8)
    piece = arr.copy(); piece[..., 3] = (piece[..., 3] * soft).astype(np.uint8)
    pad = 6
    Image.fromarray(piece[y0 - pad:y1 + pad + 1, x0 - pad:x1 + pad + 1]).save(f'{out}/trident.png')
    dil = cv2.dilate(m, np.ones((17, 17), np.uint8))
    base = np.stack([cv2.inpaint(np.ascontiguousarray(arr[..., c]), dil, 9, cv2.INPAINT_TELEA) for c in range(4)], -1)
    Image.fromarray(base).save(f'{out}/logo-base.png')
    Image.fromarray(base).save(f'{out}/logo-base.webp', 'WEBP', quality=90, method=6)
    open(f'{out}/bbox.txt', 'w').write(f'{x0} {y0} {x1 + 1} {y1 + 1} {im.width} {im.height}\n')
    print('тризуб', x0, y0, x1 + 1, y1 + 1, 'логотип', im.size, 'основа', os.path.getsize(f'{out}/logo-base.webp'))

def bbox(frame):
    a = np.asarray(frame.getchannel('A')) > 8; ys, xs = np.where(a)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1

def box(bbox_txt, frames_dir):
    x0, y0, x1, y1, W, H = map(int, open(bbox_txt).read().split())
    files = sorted(glob.glob(os.path.join(frames_dir, 'f*.png')))
    frames = [Image.open(f).convert('RGBA') for f in files]
    boxes = [bbox(f) for f in frames]
    # та сама спільна рамка з полем 4 %, що й у strip.py
    cx0 = min(b[0] for b in boxes); cy0 = min(b[1] for b in boxes); cx1 = max(b[2] for b in boxes); cy1 = max(b[3] for b in boxes)
    mx = round((cx1 - 1 - cx0) * 0.04); my = round((cy1 - 1 - cy0) * 0.04)
    cx0, cy0 = max(0, cx0 - mx), max(0, cy0 - my); cx1, cy1 = min(frames[0].width, cx1 + mx), min(frames[0].height, cy1 + my)
    fx0, fy0, fx1, fy1 = boxes[len(frames) // 2]          # центральний кадр = плоский тризуб
    s = ((x1 - x0) / (fx1 - fx0) + (y1 - y0) / (fy1 - fy0)) / 2
    left = x0 + (cx0 - fx0) * s; top = y0 + (cy0 - fy0) * s; width = (cx1 - cx0) * s; height = (cy1 - cy0) * s
    print(f'box: Object.freeze({{ left: {left:.1f}, top: {top:.1f}, width: {width:.1f}, height: {height:.1f} }}),')
    print('масштаб', round(s, 4), 'рамка кадру', cx0, cy0, cx1, cy1, 'пропорції', round((cx1 - cx0) / (cy1 - cy0), 4))

if __name__ == '__main__':
    {'cut': lambda: cut(sys.argv[2], sys.argv[3]), 'box': lambda: box(sys.argv[2], sys.argv[3])}[sys.argv[1]]()
