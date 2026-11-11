# Готує карти для рельєфу емблем: колір (4x LANCZOS), висота (альфа з фаскою + деталі яскравості), альфа.
import sys, os
from PIL import Image, ImageFilter, ImageOps
import numpy as np
src, out, scale = sys.argv[1], sys.argv[2], 4
os.makedirs(out, exist_ok=True)
im = Image.open(src).convert('RGBA')
im = im.resize((im.width*scale, im.height*scale), Image.LANCZOS)
pad = 32
canvas = Image.new('RGBA', (im.width+2*pad, im.height+2*pad), (0,0,0,0))
canvas.paste(im, (pad,pad), im); im = canvas
a = np.asarray(im.getchannel('A')).astype(np.float32)/255
rgb = np.asarray(im.convert('RGB')).astype(np.float32)/255
lum = 0.3*rgb[...,0]+0.59*rgb[...,1]+0.11*rgb[...,2]
# фаска: розмита альфа дає плавний підйом країв
A = Image.fromarray((a*255).astype(np.uint8))
bevel = np.asarray(A.filter(ImageFilter.GaussianBlur(scale*2.8))).astype(np.float32)/255
bevel = np.clip((bevel-0.5)*2, 0, 1)**0.6
detail = np.asarray(Image.fromarray((lum*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(scale*0.6))).astype(np.float32)/255
h = bevel*(0.72+0.28*detail)*a + bevel*(1-a)*0.0
h16 = (np.clip(h,0,1)*65535).astype(np.uint16)
Image.fromarray(h16).save(f'{out}/height.png')
# колір: заповнюємо прозорі пікселі кольором сусідів, щоб не було темних обводок
col = im.copy(); 
col_np = np.asarray(col.convert('RGB')).astype(np.float32)
for _ in range(6):
    blurred = np.asarray(Image.fromarray(col_np.astype(np.uint8)).filter(ImageFilter.BoxBlur(3))).astype(np.float32)
    mask = (a<0.6)[...,None]
    col_np = np.where(mask, blurred, col_np)
Image.fromarray(col_np.astype(np.uint8)).save(f'{out}/color.png')
Image.fromarray((a*255).astype(np.uint8)).save(f'{out}/alpha.png')
print(src, im.size)
