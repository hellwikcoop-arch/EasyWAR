# Складає кадри рендеру в одну горизонтальну смугу webp для start-emblems.js.
# Аргументи: <frames dir> <out.webp> [width_per_frame=320] [quality=86]
import sys, os, glob
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
fw = int(sys.argv[3]) if len(sys.argv) > 3 else 320
q = int(sys.argv[4]) if len(sys.argv) > 4 else 86
files = sorted(glob.glob(os.path.join(src, 'f*.png')))
frames = [Image.open(f).convert('RGBA') for f in files]
# обрізаємо спільну рамку всіх кадрів з полем 4 %, щоб емблема заповнювала кадр
import numpy as np
boxes = [np.argwhere(np.asarray(f.getchannel('A')) > 8) for f in frames]
y0 = min(b[:, 0].min() for b in boxes); y1 = max(b[:, 0].max() for b in boxes)
x0 = min(b[:, 1].min() for b in boxes); x1 = max(b[:, 1].max() for b in boxes)
mx = round((x1 - x0) * 0.04); my = round((y1 - y0) * 0.04)
box = (max(0, x0 - mx), max(0, y0 - my), min(frames[0].width, x1 + mx + 1), min(frames[0].height, y1 + my + 1))
frames = [f.crop(box) for f in frames]
w0, h0 = frames[0].size
fh = round(h0 * fw / w0)
frames = [f.resize((fw, fh), Image.LANCZOS) for f in frames]
strip = Image.new('RGBA', (fw * len(frames), fh), (0, 0, 0, 0))
for i, f in enumerate(frames): strip.paste(f, (i * fw, 0), f)
strip.save(out, 'WEBP', quality=q, method=6, exact=False)
print(out, strip.size, os.path.getsize(out), 'aspect', round(fw / fh, 4))
