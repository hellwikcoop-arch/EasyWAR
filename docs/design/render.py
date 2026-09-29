import math, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np
F='/root/.claude/skills/synced/f1fcb31a-c9e9-43f2-a1c4-f49a5430761d_d9b9cdc0-f90c-4057-8e43-9333273c3447/canvas-design/canvas-fonts/'
W,H=3840,2160; S=2; w,h=W*S,H*S
random.seed(7); np.random.seed(7)
# background: deep maroon with lifted claret glow
yy,xx=np.mgrid[0:h//4,0:w//4].astype(np.float32)
cx,cy=0.68*w/4,0.30*h/4
d=np.sqrt(((xx-cx)/(w/4))**2+((yy-cy)/(h/4))**2)
t=np.clip(1-d*1.25,0,1)**1.6
base=np.array([34,9,15],np.float32); hi=np.array([104,26,38],np.float32)
img=base+(hi-base)*t[...,None]
vig=np.clip(1-((xx/(w/4)-.5)**2+(yy/(h/4)-.5)**2)*0.9,0.55,1)
img*=vig[...,None]
bg=Image.fromarray(np.clip(img,0,255).astype(np.uint8)).resize((w,h),Image.BICUBIC)
# grain
g=np.random.normal(0,2.2,(h//2,w//2)).astype(np.float32)
gi=Image.fromarray(np.clip(g+128,0,255).astype(np.uint8)).resize((w,h),Image.BICUBIC)
arr=np.array(bg).astype(np.float32)+(np.array(gi).astype(np.float32)-128)[...,None]
bg=Image.fromarray(np.clip(arr,0,255).astype(np.uint8)).convert('RGBA')
lay=Image.new('RGBA',(w,h),(0,0,0,0)); dr=ImageDraw.Draw(lay)
bone=(232,220,203)
def canopy(x,y,r,alpha,line=1.0,lines=True):
    a=int(255*alpha); col=bone+(a,)
    lw=max(2,int(S*1.1*line))
    box=[x-r,y-r,x+r,y+r]
    dr.arc(box,180,360,fill=col,width=lw)
    # scalloped hem
    n=5; 
    for i in range(n):
        a0=math.pi+i*math.pi/n; a1=a0+math.pi/n
        p0=(x+r*math.cos(a0),y+r*math.sin(a0)*0+ 0); 
        x0=x-r+ (2*r)*i/n; x1=x-r+(2*r)*(i+1)/n
        dr.arc([x0,y-r*0.16,x1,y+r*0.16],0,180,fill=col,width=lw)
    if lines:
        for k in (-1,-.5,0,.5,1):
            xs=x+k*r
            dr.line([xs,y,x,y+r*2.15],fill=bone+(int(a*0.55),),width=max(1,lw//2))
        dr.ellipse([x-r*.05,y+r*2.1,x+r*.05,y+r*2.2],fill=col)
# field
cols,rows=44,24
mx,my=250*S,250*S
gw=(w-2*mx)/(cols-1); gh=(h-2*my)/(rows-1)
big=(0.68*w,0.36*h)
for j in range(rows):
    for i in range(cols):
        x=mx+i*gw+ math.sin(j*.55+i*.11)*gw*.10*(j/rows) + random.uniform(-1,1)*gw*.006*j
        y=my+j*gh
        dist=math.hypot((x-big[0])/w,(y-big[1])/h)
        fade=0.16+0.5*max(0,1-dist*1.6)
        fade*= (0.55+0.45*(1-j/rows))
        gyc=big[1]+140*S; RR=560*S
        if abs(x-big[0])<RR*1.12 and gyc-RR*1.12<y<gyc+RR*1.62: continue  # negative space around the great canopy
        r=gw*0.24*(0.85+0.3*(1-j/rows))
        canopy(x,y,r,min(0.85,fade),line=0.9,lines=(i+j)%3==0)
# great canopy (tonal architecture)
R=560*S; gx,gy=big[0],big[1]+140*S
for k,(sc,al) in enumerate([(1,.55),(.86,.22),(.72,.14),(.58,.10)]):
    r=R*sc; dr.arc([gx-r,gy-r,gx+r,gy+r],180,360,fill=bone+(int(255*al),),width=S*(3 if k==0 else 2))
n=9
for i in range(n):
    x0=gx-R+2*R*i/n; x1=gx-R+2*R*(i+1)/n
    dr.arc([x0,gy-R*.09,x1,gy+R*.09],0,180,fill=bone+(140,),width=S*3)
for k in range(-4,5):
    xs=gx+k*R/4
    dr.line([xs,gy,gx,gy+R*1.5],fill=bone+(60,),width=S*2)
dr.ellipse([gx-9*S,gy+R*1.5-9*S,gx+9*S,gy+R*1.5+9*S],fill=bone+(200,))
# registration ticks + altitude scale
def tick(x,y,l,vertical=False,al=110,wd=2):
    dr.line([x,y,x,y+l] if vertical else [x,y,x+l,y],fill=bone+(al,),width=wd*S)
for i in range(0,61):
    x=mx+ (w-2*mx)*i/60
    tick(x,h-150*S,(26 if i%5==0 else 12)*S,True,120 if i%5==0 else 70)
for j in range(0,41):
    y=my+(h-2*my)*j/40
    tick(150*S,y,(26 if j%5==0 else 12)*S,False,120 if j%5==0 else 70)
mono=ImageFont.truetype(F+'IBMPlexMono-Regular.ttf',15*S)
jura=ImageFont.truetype(F+'Jura-Light.ttf',26*S)
def txt(x,y,s,f,al=170,anchor='la',sp=0):
    if sp:
        for ch in s:
            dr.text((x,y),ch,font=f,fill=bone+(al,),anchor=anchor); x+=f.getlength(ch)+sp
    else: dr.text((x,y),s,font=f,fill=bone+(al,),anchor=anchor)
for i in range(0,61,10):
    txt(mx+(w-2*mx)*i/60,h-100*S,f'{i*50:04d}',mono,140,'ma')
for j in range(0,41,10):
    txt(120*S,my+(h-2*my)*j/40,f'{4000-j*100:04d}',mono,140,'rm')
txt(mx,110*S,'ДШВ',jura,230,sp=14*S)
txt(mx,165*S,'СПУСК · ПОЛЕ 01',mono,130,sp=4*S)
txt(w-mx,110*S,'ЗАВЖДИ ПЕРШІ',jura,200,'ra')
txt(w-mx,h-58*S,'h, м  /  x, м',mono,110,'ra')
out=Image.alpha_composite(bg,lay).convert('RGB').resize((W,H),Image.LANCZOS)
out.save('maroon-descent.png',optimize=True)
