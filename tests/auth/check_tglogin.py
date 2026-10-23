#!/usr/bin/env python3
# Savdo Pos — Telegram orqali kirish (fix206-tglogin) avtomatik tekshiruvi, soxta Firebase va soxta server bilan (tests/auth/fake_firebase.js).
# Asosiy talab: ikkinchi akkaunt va bo'sh do'kon o'z-o'zidan ochilmaydi; tasdiqsiz kirib bo'lmaydi; boshqa kirish usullari buzilmaydi.
# Ishga tushirish:  python3 tests/auth/check_tglogin.py      Kerak: pip install playwright va python3 -m playwright install chromium
import sys, os, threading, http.server, socketserver, functools
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); WWW = os.path.join(HERE, '..', '..', 'www')
FAKE = open(os.path.join(HERE, 'fake_firebase.js'), encoding='utf-8').read()
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(H, directory=WWW)); PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://127.0.0.1:%d/index.html" % PORT
R = {"ok": 0, "bad": 0}
def ok(n, c, x=None):
    if c: R["ok"] += 1; print("  OK  ", n)
    else: R["bad"] += 1; print("  XATO", n, "" if x is None else str(x)[:500])
NATIVE_NOPLUGIN = """window.androidBridge = { postMessage: function(){} };
window.Capacitor = { isNativePlatform: ()=>true, getPlatform: ()=>'android', isPluginAvailable: (n)=>n === 'App', PluginHeaders: [{name: 'App', methods: []}], Plugins: { App: { addListener: ()=>({remove(){}}), minimizeApp: ()=>Promise.resolve() } } };"""
def route(r):
    u = r.request.url
    if '/vendor/firebase-app-compat.js' in u: return r.fulfill(status=200, content_type='application/javascript', body=FAKE)
    if '/vendor/firebase-' in u and '-compat.js' in u: return r.fulfill(status=200, content_type='application/javascript', body='/* soxta */')
    if u.startswith("http://127.0.0.1"): return r.continue_()
    return r.abort()
SEED = """(o)=>{ (o.users || []).forEach(u=>{ window.__FA.users[u.uid] = Object.assign({created: Date.now() - 864e5, providers: []}, u); });
  Object.assign(window.__FDB.docs, o.docs || {}); (o.map || []).forEach(m=>window.__tglMap(m[0], m[1], m[2])); window.__TS.off = !!o.off; }"""
BIZ = "()=>Object.keys(window.__FDB.docs).filter(p=>/^businesses\\/[^/]+$/.test(p)).sort()"
USERS = "()=>Object.keys(window.__FA.users).sort()"
def txt(pg, sel): return pg.evaluate("(s)=>{ const e=document.querySelector(s); return e ? e.innerText.trim() : null; }", sel)
def opened(pg): return pg.evaluate("()=>document.getElementById('auth-root').innerHTML.trim() === '' && !!fbUser && state.businessId === fbUser.uid && (document.getElementById('login-root').innerHTML.trim() !== '' || document.getElementById('bottom-nav').innerHTML.trim() !== '')")
def boot(br, init=None, w=412, h=900):
    ctx = br.new_context(viewport={"width": w, "height": h}); ctx.route("**/*", route)
    if init: ctx.add_init_script(init)
    ctx.add_init_script("try{ localStorage.setItem('sardor_lang', 'uz'); }catch(e){}")
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200])); pg.on("dialog", lambda d: d.dismiss())
    pg.goto(URL); pg.wait_for_selector('#auth-form', timeout=15000); pg.wait_for_timeout(300)
    return ctx, pg, errs
OWNER_A = {'uid': 'ownerA1', 'email': 'ali@gmail.com', 'providers': ['password'], 'pw': 'parol1'}
OWNER_B = {'uid': 'ownerB2', 'email': 'vali@mail.uz', 'providers': ['password'], 'pw': 'parol2'}
DOCS = {'businesses/ownerA1': {'ownerEmail': 'ali@gmail.com', 'businessName': 'Ali dokoni', 'schemaVersion': 2, 'subscriptionExpiresAtMs': 4102444800000},
        'businesses/ownerB2': {'ownerEmail': 'vali@mail.uz', 'businessName': 'Vali dokoni', 'schemaVersion': 2, 'subscriptionExpiresAtMs': 4102444800000}}
TWO = ['businesses/ownerA1', 'businesses/ownerB2']
def start_tg(pg):
    pg.click('#auth-telegram-btn'); pg.wait_for_selector('[data-au-mode="tgwait"]', timeout=5000); pg.wait_for_timeout(200)
def acct(pg):
    pg.evaluate("()=>{ document.getElementById('login-root').innerHTML = ''; renderSettingsAccount(document.getElementById('view-container')); }"); pg.wait_for_timeout(600)
with sync_playwright() as p:
    br = p.chromium.launch(args=["--no-sandbox"])
    # 1) kirish ekrani: tugma; kutish ekrani; bekor qilish
    ctx, pg, errs = boot(br)
    pg.evaluate(SEED, {'users': [OWNER_A, OWNER_B], 'docs': DOCS})
    ok("kirish ekranida «Telegram orqali davom etish» tugmasi bor (Google bilan birga)", pg.locator('#auth-telegram-btn').count() == 1 and 'Telegram orqali' in txt(pg, '#auth-telegram-btn') and pg.locator('#auth-google-btn').count() == 1)
    start_tg(pg)
    ok("kutish ekrani: katta raqam (47), qadamlar, «Telegram'ni ochish» havolasi botga", txt(pg, '#tgl-num') == '47' and pg.get_attribute('#tgl-open', 'href').startswith('https://t.me/savdo_pos_bot?start=l_rid') and pg.get_attribute('#tgl-open', 'target') == '_blank' and pg.locator('.tgl-steps li').count() == 2)
    ok("teskari sanoq ko'rinadi (5 daqiqa)", (txt(pg, '#tgl-left') or '').startswith('4:') or txt(pg, '#tgl-left') == '5:00', txt(pg, '#tgl-left'))
    ok("sir (poll) va kalit qurilma xotirasiga yozilmadi", pg.evaluate("()=>JSON.stringify(Object.assign({}, localStorage)).indexOf('poll1') === -1 && JSON.stringify(Object.assign({}, sessionStorage)).indexOf('poll1') === -1"))
    pg.wait_for_timeout(2600)
    ok("tasdiqsiz — kirilmaydi, so'rov kutilyapti (poll chaqirilmoqda)", not opened(pg) and pg.evaluate("()=>window.__TS.calls.filter(c=>c==='poll').length") >= 1 and pg.locator('[data-au-mode="tgwait"]').count() == 1)
    pg.click('.auth-lang-current, [data-auth-lang-toggle]', timeout=2000) if pg.locator('.auth-lang-current').count() else None
    pg.evaluate("()=>{ state.lang = 'ru'; renderAuthGate('login'); }"); pg.wait_for_timeout(300)
    ok("til almashsa ham kutish ekrani va raqam saqlanadi (ruscha)", pg.locator('[data-au-mode="tgwait"]').count() == 1 and txt(pg, '#tgl-num') == '47' and 'Открыть Telegram' in txt(pg, '#tgl-open'))
    pg.evaluate("()=>{ state.lang = 'uz'; renderAuthGate('login'); }"); pg.wait_for_timeout(200)
    pg.click('#tgl-cancel'); pg.wait_for_timeout(300)
    n0 = pg.evaluate("()=>window.__TS.calls.filter(c=>c==='poll').length"); pg.wait_for_timeout(2500)
    ok("«Bekor qilish» — kirish ekraniga qaytdi va so'rash to'xtadi", pg.locator('#auth-form').count() == 1 and pg.evaluate("()=>window.__TS.calls.filter(c=>c==='poll').length") == n0 and pg.evaluate("()=>!window.__auPending"))
    # 2) ulangan Telegram → o'sha akkaunt
    pg.evaluate("()=>window.__tglMap('900001', 'ownerA1', 'Ali')")
    start_tg(pg); pg.evaluate("()=>window.__tglConfirm('900001', 'Ali')"); pg.wait_for_timeout(3200)
    ok("ulangan Telegram tasdiqlandi → o'sha akkaunt (ownerA1) va eski do'kon ochildi", opened(pg) and pg.evaluate("()=>fbUser.uid") == 'ownerA1', [opened(pg), pg.evaluate("()=>fbUser && fbUser.uid")])
    ok("do'konlar va akkauntlar soni o'zgarmadi", pg.evaluate(BIZ) == TWO and pg.evaluate(USERS) == ['ownerA1', 'ownerB2'])
    ok("do'kon ochilishidan oldin server tekshiruvi (authGuard) chaqirildi", pg.evaluate("()=>window.__GUARD.calls") == 1)
    ok("sahifa xatolari yo'q", not errs, errs); ctx.close()
    # 3) «Bu men emasman» / noto'g'ri raqam
    ctx, pg, errs = boot(br)
    pg.evaluate(SEED, {'users': [OWNER_A], 'docs': DOCS, 'map': [['900001', 'ownerA1', 'Ali']]})
    start_tg(pg); pg.evaluate("()=>window.__tglDeny()"); pg.wait_for_timeout(2600)
    ok("botda rad etilsa: kirilmadi, tushunarli xato va «Qaytadan urinish»", not opened(pg) and 'bekor qilindi' in (txt(pg, '#tgl-err') or '') and pg.locator('#tgl-retry').count() == 1 and pg.locator('#tgl-open').count() == 0)
    pg.click('#tgl-retry'); pg.wait_for_timeout(500)
    ok("«Qaytadan urinish» — yangi so'rov (yangi havola)", pg.locator('[data-au-mode="tgwait"]').count() == 1 and 'l_rid2' in pg.get_attribute('#tgl-open', 'href'))
    pg.click('#tgl-cancel'); pg.wait_for_timeout(200)
    pg.evaluate(SEED, {'off': True}); pg.click('#auth-telegram-btn'); pg.wait_for_timeout(500)
    ok("bot o'chiq bo'lsa — kirish ekranida tushunarli xato", pg.locator('#auth-form').count() == 1 and 'hozir ishlamayapti' in (txt(pg, '#auth-error') or ''), txt(pg, '#auth-error'))
    ok("sahifa xatolari yo'q", not errs, errs); ctx.close()
    # 4) ulanmagan Telegram → tanlov → «Mavjud akkauntimga ulash»
    ctx, pg, errs = boot(br)
    pg.evaluate(SEED, {'users': [OWNER_A, OWNER_B], 'docs': DOCS})
    start_tg(pg); pg.evaluate("()=>window.__tglConfirm('900002', 'Vali Karimov')"); pg.wait_for_timeout(2600)
    ok("ulanmagan Telegram: tanlov oynasi (ism ko'rinadi), hech narsa yaratilmadi", pg.locator('[data-au-mode="tgchoose"]').count() == 1 and 'Vali Karimov' in txt(pg, '.tgl-acct') and pg.evaluate(USERS) == ['ownerA1', 'ownerB2'] and pg.evaluate(BIZ) == TWO and not opened(pg))
    ok("tanlovda: «Mavjud akkauntimga ulash» (asosiy), izoh va «Yangi do'kon ochish»", pg.locator('#tgl-pick-link.btn-primary').count() == 1 and pg.locator('#tgl-pick-new').count() == 1 and 'ikkinchi bo\'sh do\'kon ochilmaydi' in txt(pg, '.tgl-hint'))
    pg.click('#tgl-pick-link'); pg.wait_for_timeout(200)
    ok("ulash: email va parol formasi", pg.locator('#tgl-link-form #auth-email').count() == 1 and pg.locator('#auth-password').count() == 1)
    pg.click('#tgl-cancel'); pg.wait_for_timeout(200)
    ok("«Orqaga» — tanlovga qaytdi (so'rov saqlangan)", pg.locator('#tgl-pick-link').count() == 1)
    pg.click('#tgl-pick-link'); pg.fill('#auth-email', 'vali@mail.uz'); pg.fill('#auth-password', 'xato'); pg.click('#auth-submit-btn'); pg.wait_for_timeout(500)
    ok("noto'g'ri parol — xato, kirilmadi, ulanmadi", not opened(pg) and (txt(pg, '#auth-password-err') or txt(pg, '#auth-error')) and pg.evaluate("()=>!window.__TS.map['900002']"))
    pg.fill('#auth-password', 'parol2'); pg.click('#auth-submit-btn'); pg.wait_for_timeout(1800)
    ok("to'g'ri parol: eski akkaunt (ownerB2) va do'koni ochildi", opened(pg) and pg.evaluate("()=>fbUser.uid") == 'ownerB2')
    ok("Telegram shu akkauntga ulandi, yangi akkaunt/do'kon yo'q", pg.evaluate("()=>window.__TS.map['900002']") == 'ownerB2' and pg.evaluate(USERS) == ['ownerA1', 'ownerB2'] and pg.evaluate(BIZ) == TWO)
    pg.wait_for_timeout(600)
    ok("xabar: «Telegram akkauntingizga ulandi»", 'ulandi' in (txt(pg, '#toast') or ''), txt(pg, '#toast'))
    pg.evaluate("()=>fbAuth.signOut()"); pg.wait_for_timeout(500)
    start_tg(pg); pg.evaluate("()=>window.__tglConfirm('900002', 'Vali Karimov')"); pg.wait_for_timeout(3200)
    ok("chiqib, endi Telegram bilan qayta kirish — parolsiz, o'sha akkaunt", opened(pg) and pg.evaluate("()=>fbUser.uid") == 'ownerB2' and pg.evaluate(USERS) == ['ownerA1', 'ownerB2'])
    acct(pg)
    ok("Hisob: Email, Google, Telegram qatorlari; Telegram — ism · ulangan, «Uzish» bor", pg.locator('#acct-methods .am-row').count() == 3 and 'Vali Karimov' in txt(pg, '[data-am="telegram"] .am-sub') and pg.locator('#am-unlink-telegram').count() == 1 and pg.locator('#am-unlink-password').count() == 1, txt(pg, '#acct-methods'))
    pg.click('#am-unlink-telegram'); pg.wait_for_timeout(200); pg.click('.modal-overlay .btn-danger, .modal-overlay .btn-primary, #confirm-yes', timeout=3000); pg.wait_for_timeout(600)
    ok("Telegram uzildi — «Ulash» chiqdi, email qoldi (uni endi uzib bo'lmaydi)", pg.evaluate("()=>!window.__TS.map['900002']") and pg.locator('#am-link-telegram').count() == 1 and pg.locator('#am-unlink-password').count() == 0)
    pg.click('#am-link-telegram'); pg.wait_for_selector('#tgl-modal-body .tgl-num', timeout=4000)
    ok("Hisob → Telegram «Ulash»: oynada raqam va bot havolasi", txt(pg, '#tgl-modal-body .tgl-num') == '47' and pg.locator('#tgl-modal-body #tgl-open').count() == 1)
    pg.evaluate("()=>window.__tglConfirm('900002', 'Vali Karimov')"); pg.wait_for_timeout(2800)
    ok("tasdiqdan keyin oyna yopildi, Telegram ulandi", pg.locator('#tgl-modal-body').count() == 0 and pg.evaluate("()=>window.__TS.map['900002']") == 'ownerB2' and pg.locator('#am-unlink-telegram').count() == 1)
    ok("sahifa xatolari yo'q", not errs, errs); ctx.close()
    # 5) boshqa akkauntga ulangan Telegram'ni ulab bo'lmaydi
    ctx, pg, errs = boot(br)
    pg.evaluate(SEED, {'users': [OWNER_A, OWNER_B], 'docs': DOCS, 'map': [['900001', 'ownerA1', 'Ali']]})
    pg.fill('#auth-email', 'vali@mail.uz'); pg.fill('#auth-password', 'parol2'); pg.click('#auth-submit-btn'); pg.wait_for_timeout(1500)
    ok("email+parol bilan kirish avvalgidek (server tekshiruvi kerak emas)", opened(pg) and pg.evaluate("()=>fbUser.uid") == 'ownerB2' and pg.evaluate("()=>window.__GUARD.calls") == 0)
    acct(pg); pg.click('#am-link-telegram'); pg.wait_for_selector('#tgl-modal-body .tgl-num', timeout=4000)
    pg.evaluate("()=>window.__tglConfirm('900001', 'Ali')"); pg.wait_for_timeout(2800)
    ok("boshqa akkauntga ulangan Telegram — rad, xabar ko'rinadi", 'boshqa Savdo Pos akkauntiga ulangan' in (txt(pg, '#tgl-modal-body') or '') and pg.evaluate("()=>window.__TS.map['900001']") == 'ownerA1')
    pg.evaluate("()=>closeModal()")
    ok("sahifa xatolari yo'q", not errs, errs); ctx.close()
    # 6) ulanmagan Telegram → «Yangi do'kon ochish» → shartlar → yangi do'kon
    ctx, pg, errs = boot(br)
    pg.evaluate(SEED, {'users': [OWNER_A], 'docs': DOCS})
    start_tg(pg); pg.evaluate("()=>window.__tglConfirm('900003', 'Olim Toshev')"); pg.wait_for_timeout(2600)
    pg.click('#tgl-pick-new'); pg.wait_for_timeout(1200)
    ok("yangi do'kon: shartlar oynasi, Telegram matni va ism, do'kon hali yo'q", pg.locator('[data-au-mode="gterms"]').count() == 1 and 'Telegram bilan yangi do\'kon' in txt(pg, '.au-sub') and txt(pg, '.au-acct') == 'Olim Toshev' and 'Telegram' in txt(pg, '.au-gt-hint') and len(pg.evaluate(BIZ)) == 2 and not opened(pg))
    pg.click('label[for="auth-terms-check"]'); pg.click('#auth-gterms-ok'); pg.wait_for_timeout(2000)
    uid = pg.evaluate("()=>fbUser && fbUser.uid")
    ok("rozilikdan keyin: odatdagi yangi do'kon (sinov muddati) yaratildi va ochildi", opened(pg) and ('businesses/' + str(uid)) in pg.evaluate(BIZ) and pg.evaluate("(u)=>window.__FDB.docs['businesses/' + u].subscriptionPlan", uid) == 'trial', [opened(pg), pg.evaluate(BIZ)])
    ok("faqat bitta yangi akkaunt yaratildi", len(pg.evaluate(USERS)) == 2)
    acct(pg)
    ok("faqat-Telegram akkaunt: Telegram ulangan («Uzish» yo'q), Email — «Ulash», email almashtirish tugmasi yo'q", pg.locator('#am-unlink-telegram').count() == 0 and 'ulangan' in txt(pg, '[data-am="telegram"] .am-sub') and pg.locator('#am-add-email').count() == 1 and pg.locator('#open-change-email-btn').count() == 0, txt(pg, '#acct-methods'))
    pg.click('#am-add-email'); pg.fill('#am-em', 'ali@gmail.com'); pg.fill('#am-pw1', 'abc123'); pg.fill('#am-pw2', 'abc123'); pg.click('#am-pw-go'); pg.wait_for_timeout(400)
    ok("band email (boshqa akkauntniki) — «Bu email allaqachon band», ikkinchi akkaunt yo'q", 'band' in (txt(pg, '#am-pw-err') or '') and pg.evaluate("(u)=>window.__FA.users[u].providers", uid) == [], txt(pg, '#am-pw-err'))
    pg.fill('#am-em', 'olim@mail.uz'); pg.click('#am-pw-go'); pg.wait_for_timeout(600)
    ok("email va parol qo'shildi — endi ikkala usulda «Uzish»", pg.evaluate("(u)=>window.__FA.users[u].providers", uid) == ['password'] and pg.locator('#am-unlink-telegram').count() == 1)
    pg.evaluate("()=>fbAuth.signOut()"); pg.wait_for_timeout(500)
    start_tg(pg); pg.evaluate("()=>window.__tglConfirm('900003', 'Olim Toshev')"); pg.wait_for_timeout(3200)
    ok("qayta Telegram bilan kirish — o'sha akkaunt, yangi akkaunt yaratilmadi", opened(pg) and pg.evaluate("()=>fbUser.uid") == uid and len(pg.evaluate(USERS)) == 2)
    ok("sahifa xatolari yo'q", not errs, errs); ctx.close()
    # 7) shartlarda «Bekor qilish» — yangi akkaunt o'chadi, do'kon yo'q
    ctx, pg, errs = boot(br)
    pg.evaluate(SEED, {'users': [OWNER_A], 'docs': DOCS})
    start_tg(pg); pg.evaluate("()=>window.__tglConfirm('900004', 'Yana Bir')"); pg.wait_for_timeout(2600)
    pg.click('#tgl-pick-new'); pg.wait_for_timeout(1200); pg.click('#auth-gterms-cancel'); pg.wait_for_timeout(800)
    ok("shartlarda «Bekor qilish»: yangi akkaunt o'chirildi, do'kon yaratilmadi, kirish ekrani", pg.evaluate(USERS) == ['ownerA1'] and len(pg.evaluate(BIZ)) == 2 and pg.locator('#auth-form').count() == 1 and not opened(pg))
    ok("sahifa xatolari yo'q", not errs, errs); ctx.close()
    # 8) faqat-Telegram akkaunt: PIN'ni tiklash (Telegram bilan tasdiqlash) va akkauntni o'chirish
    ctx, pg, errs = boot(br)
    pg.evaluate(SEED, {'users': [OWNER_A], 'docs': DOCS})
    start_tg(pg); pg.evaluate("()=>window.__tglConfirm('900005', 'Pin Egasi')"); pg.wait_for_timeout(2600)
    pg.click('#tgl-pick-new'); pg.wait_for_timeout(1200); pg.click('label[for="auth-terms-check"]'); pg.click('#auth-gterms-ok'); pg.wait_for_timeout(2000)
    uid = pg.evaluate("()=>fbUser && fbUser.uid")
    pg.evaluate("()=>openForgotPinModal()"); pg.wait_for_timeout(300)
    ok("PIN'ni unutdim (parolsiz akkaunt): parol so'ralmaydi, «Telegram bilan tasdiqlash»", pg.locator('#fp-password').count() == 0 and pg.locator('#fp-tg').is_visible())
    pg.click('#fp-tg'); pg.wait_for_selector('#tgl-modal-body .tgl-num', timeout=4000)
    pg.evaluate("()=>window.__tglConfirm('900099', 'Begona')"); pg.wait_for_timeout(2800)
    ok("boshqa Telegram tasdiqlasa — rad («Boshqa Telegram akkaunti»), PIN oynasi ochilmadi", 'Boshqa Telegram akkaunti' in (txt(pg, '#tgl-modal-body') or '') and pg.locator('#np-pin').count() == 0)
    pg.evaluate("()=>closeModal()"); pg.evaluate("()=>openForgotPinModal()"); pg.wait_for_timeout(300); pg.click('#fp-tg'); pg.wait_for_selector('#tgl-modal-body .tgl-num', timeout=4000)
    pg.evaluate("()=>window.__tglConfirm('900005', 'Pin Egasi')"); pg.wait_for_timeout(2800)
    ok("o'z Telegram'i tasdiqlasa — yangi PIN oynasi ochildi", pg.locator('#np-pin').count() == 1 or 'admin' in (txt(pg, '#modal-root') or '').lower(), txt(pg, '#modal-root'))
    pg.evaluate("()=>closeModal()")
    pg.evaluate("()=>openDeleteAccountModal()"); pg.wait_for_timeout(200)
    ok("akkauntni o'chirish: parolsiz akkauntda parol so'ralmaydi", pg.locator('#da-password').count() == 0 and pg.locator('#da-confirm').count() == 1)
    pg.evaluate("()=>closeModal()")
    res = pg.evaluate("async ()=>{ try{ return await deleteMyAccountAndData(null); }catch(e){ return 'ERR ' + e.message; } }"); pg.wait_for_timeout(500)
    ok("o'chirish: do'kon, Telegram ulanishi va akkaunt (server orqali) o'chdi; Google oynasi ochilmadi", res is True and pg.evaluate(USERS) == ['ownerA1'] and pg.evaluate("()=>!window.__TS.map['900005']") and ('businesses/' + str(uid)) not in pg.evaluate(BIZ) and ['reauthPopup'] not in pg.evaluate("()=>window.__FA.calls"), [res, pg.evaluate(USERS)])
    ok("sahifa xatolari yo'q", not errs, errs); ctx.close()
    # 9) Android (Google plagini yo'q eski APK) — Telegram tugmasi bor; telefon kengligida ekranlar sig'adi
    ctx, pg, errs = boot(br, NATIVE_NOPLUGIN, 360, 640)
    ok("Android: Telegram tugmasi bor", pg.locator('#auth-telegram-btn').count() == 1)
    pg.evaluate(SEED, {'users': [], 'docs': {}})
    start_tg(pg)
    ok("360px: kutish ekrani gorizontal siljimaydi, raqam va tugma ko'rinadi", pg.evaluate("()=>document.documentElement.scrollWidth <= 360") and pg.locator('#tgl-open').is_visible() and pg.locator('#tgl-num').is_visible())
    ok("sahifa xatolari yo'q", not errs, errs); ctx.close()
    br.close()
print("JAMI: %d OK, %d XATO" % (R["ok"], R["bad"]))
sys.exit(1 if R["bad"] else 0)
