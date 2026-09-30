import os, glob
from PIL import Image, ImageDraw, ImageFont
os.chdir('/workspaces/savdo-pos-android')
def font(sz, bold=True):
    for f in (['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'] if bold else [])+['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']+glob.glob('/usr/share/fonts/**/*.ttf',recursive=True):
        try: return ImageFont.truetype(f, sz)
        except Exception: pass
    return ImageFont.load_default(size=sz)
X, MAXW = 420, 1024-420-50   # matn uchun joy: 554 px, o'ngda 50 px bo'sh
def fit(d, text, sz, bold):
    while sz > 14:
        f = font(sz, bold)
        if d.textlength(text, font=f) <= MAXW: return f, sz
        sz -= 2
    return font(sz, bold), sz
im = Image.open('www/icon-512.png').convert('RGBA')
fg = Image.new('RGB', (1024,500), '#1F4FB8'); d = ImageDraw.Draw(fg)
card = Image.new('RGBA',(300,300),(0,0,0,0)); ImageDraw.Draw(card).rounded_rectangle((0,0,299,299),60,fill='white')
card.alpha_composite(im.resize((250,250),Image.LANCZOS),(25,25)); fg.paste(card,(70,100),card)
lines = [('Savdo Pos',92,True,130,'white'), ('Касса · Склад · Долги · Отчёты',38,False,262,'white'), ('Работает без интернета',34,False,322,(220,230,255))]
for t, sz, b, y, col in lines:
    f, s = fit(d, t, sz, b); w = d.textlength(t, font=f)
    d.text((X, y), t, font=f, fill=col)
    print('OK', repr(t), 'shrift', s, 'kenglik', int(w), '/', MAXW)
fg.save('store-assets/feature-1024x500.png', optimize=True)
print('OK saqlandi', Image.open('store-assets/feature-1024x500.png').size)
