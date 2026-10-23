# Ko'rinish tekshiruvi (fix199-layout)

`check_layout.py` ilovani uzun nomlar va katta summalar bilan ochadi va har bir ekranda
yozuvlar ustma-ust chiqmadimi, qutidan chiqib ketmadimi, ekran yonga aylanmadimi — tekshiradi.

    pip install playwright
    python3 -m playwright install chromium
    python3 tests/ui/check_layout.py --tez     # 412 px, o'zbek va rus (~2 daqiqa)
    python3 tests/ui/check_layout.py           # hammasi: 3 kenglik, 6 til, 2 shrift (~15 daqiqa)

Muammo topilsa, qaysi ekran, til va kenglikda ekani yoziladi va dastur 1 kodi bilan tugaydi.
`detect.js` — sahifa ichida ishlaydigan tekshirgich.
