import os, glob, json, sys
from PIL import Image, ImageDraw, ImageFont
os.chdir('/workspaces/savdo-pos-android'); os.makedirs('store-assets', exist_ok=True)
# 1) eng katta ikonkani topish
c=[p for pat in ['www/**/*icon*.png','www/**/*logo*.png','android/app/src/main/res/mipmap-*/ic_launcher.png','android/app/src/main/res/mipmap-*/ic_launcher_round.png'] for p in glob.glob(pat, recursive=True) if 'vendor' not in p]
if not c: sys.exit('XATO: ikonka topilmadi')
src=max(c, key=lambda p: Image.open(p).size[0]); im=Image.open(src).convert('RGBA')
print('Manba:', src, im.size)
if im.size[0]<512: print('DIQQAT: manba', im.size[0], 'px — kattalashtiriladi, biroz xira bo\'lishi mumkin')
# 2) brend rangi
color='#2563eb'
for m in ['www/manifest.json','www/manifest.webmanifest']:
    if os.path.exists(m):
        try: color=json.load(open(m)).get('theme_color',color)
        except Exception: pass
print('Rang:', color)
bg=Image.new('RGBA',(512,512),'white')
icon=im.resize((512,512),Image.LANCZOS); bg.alpha_composite(icon)
bg.convert('RGB').save('store-assets/icon-512.png', optimize=True)
# 3) feature graphic
def font(sz, bold=True):
    for f in (['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'] if bold else [])+['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']+glob.glob('/usr/share/fonts/**/*.ttf',recursive=True):
        try: return ImageFont.truetype(f, sz)
        except Exception: pass
    return ImageFont.load_default(size=sz)
fg=Image.new('RGB',(1024,500),color); d=ImageDraw.Draw(fg)
card=Image.new('RGBA',(300,300),(0,0,0,0)); ImageDraw.Draw(card).rounded_rectangle((0,0,299,299),60,fill='white')
ic=im.resize((250,250),Image.LANCZOS); card.alpha_composite(ic,(25,25)); fg.paste(card,(70,100),card)
d.text((420,140),'Savdo Pos',font=font(92),fill='white')
d.text((424,270),'Касса · Склад · Долги · Отчёты',font=font(38,False),fill='white')
d.text((424,330),'Работает без интернета',font=font(34,False),fill=(255,255,255,200))
fg.save('store-assets/feature-1024x500.png', optimize=True)
for f in ['icon-512.png','feature-1024x500.png']:
    p='store-assets/'+f; print('OK', p, Image.open(p).size, os.path.getsize(p)//1024,'KB')
