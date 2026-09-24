import sys, re, shutil, time
F = "www/index.html"
s = open(F, encoding="utf-8").read()
shutil.copy(F, F + ".fix6bak")

def rep(old, new, label, count=1):
    global s
    n = s.count(old)
    if n != count:
        print("XATO:", label, "-", n, "ta topildi,", count, "kutilgan. Hech narsa o'zgarmadi.")
        sys.exit(1)
    s = s.replace(old, new)
    print("OK", label)

rep("function tr(key){ return (T[key] && (T[key][state.lang] || T[key].uz)) || key; }",
    "function tr(key){ return (T[key] && (T[key][state.lang] || T[key].uz)) || key; }\n"
    "// Receipts are printed in the language the business owner chose (Settings > Receipt design), regardless of the cashier's app language.\n"
    "function receiptLang(){ return (state.settings && state.settings.receiptLanguage) || state.lang; }\n"
    "function trR(key){ const l = receiptLang(); return (T[key] && (T[key][l] || T[key].uz)) || key; }",
    "trR helper")

rep('  save:{uz:"Saqlash",ru:"Сохранить",en:"Save",kk:"Сақтау",ky:"Сактоо",tg:"Захира кардан"},',
    '  save:{uz:"Saqlash",ru:"Сохранить",en:"Save",kk:"Сақтау",ky:"Сактоо",tg:"Захира кардан"},\n'
    '  receiptLanguageLabel:{uz:"Chek tili",ru:"Язык чека",en:"Receipt language",kk:"Чек тілі",ky:"Чек тили",tg:"Забони чек"},\n'
    '  receiptLanguageHint:{uz:"Xodim ilovani qaysi tilda ishlatmasin, chek doim shu tilda chiqadi.",ru:"На каком бы языке сотрудник ни пользовался приложением, чек всегда печатается на этом языке.",en:"Receipts always print in this language, whatever app language the cashier uses.",kk:"Қызметкер қосымшаны қай тілде қолданса да, чек әрқашан осы тілде шығады.",ky:"Кызматкер колдонмону кайсы тилде колдонбосун, чек дайыма ушул тилде чыгат.",tg:"Корманд барномаро бо ҳар забоне истифода барад, чек ҳамеша бо ин забон чоп мешавад."},\n'
    '  receiptLanguageSameAsApp:{uz:"Ilova tili bilan bir xil",ru:"Как язык приложения",en:"Same as app language",kk:"Қосымша тілімен бірдей",ky:"Колдонмо тили менен бирдей",tg:"Мисли забони барнома"},',
    "translations")

rep("  return {businessName:'Savdo Pos', businessAddress:'', businessPhone:'', ownerPhone:'', receiptFooter:'',",
    "  return {businessName:'Savdo Pos', businessAddress:'', businessPhone:'', ownerPhone:'', receiptFooter:'', receiptLanguage:'',",
    "default setting")

rep("""function renderSettingsReceipt(container){
  container.innerHTML = `
    ${settingsBackHeader(tr('receiptDesign'))}
    <div class="card">
""",
"""function renderSettingsReceipt(container){
  container.innerHTML = `
    ${settingsBackHeader(tr('receiptDesign'))}
    <div class="card">
      <div class="field">
        <label class="field-label">${tr('receiptLanguageLabel')}</label>
        <select id="s-receipt-language">
          <option value="" ${!state.settings.receiptLanguage?'selected':''}>${tr('receiptLanguageSameAsApp')}</option>
          ${availableLanguages().map(l=>`<option value="${l.code}" ${state.settings.receiptLanguage===l.code?'selected':''}>${l.label}</option>`).join('')}
        </select>
        <p class="subtle" style="margin:4px 0 0;">${tr('receiptLanguageHint')}</p>
      </div>
    </div>
    <div class="card">
""", "receipt language select")

rep("""    state.settings.receiptLogo = null;
    state.settings.footerImage = null;
    await saveSettings();
    showToast(tr('savedSuccess'));
  });""",
"""    state.settings.receiptLogo = null;
    state.settings.footerImage = null;
    const rl = document.getElementById('s-receipt-language');
    if(rl) state.settings.receiptLanguage = rl.value || '';
    await saveSettings();
    showToast(tr('savedSuccess'));
    state.settingsCategory = null; renderAll();
  });""", "receipt design save -> back to menu")

rep("""    const customChars = document.getElementById('printer-chars-input');
    if(customChars && customChars.value !== ''){
      const val = parseInt(customChars.value,10);
      if(!isNaN(val) && val>10 && val<80) state.settings.printerCharsPerLine = val;
    }
    await saveSettings();
    showToast(tr('savedSuccess'));
  });""",
"""    const customChars = document.getElementById('printer-chars-input');
    if(customChars && customChars.value !== ''){
      const val = parseInt(customChars.value,10);
      if(!isNaN(val) && val>10 && val<80) state.settings.printerCharsPerLine = val;
    }
    const lineSpacingEl = document.getElementById('s-line-spacing');
    if(lineSpacingEl) state.settings.printerLineSpacing = parseInt(lineSpacingEl.value,10) || 65;
    await saveSettings();
    showToast(tr('savedSuccess'));
    state.settingsCategory = null; renderAll();
  });""", "printer save -> back to menu")

funcs = ["receiptImageBlob", "shareReceipt", "buildItemReceiptLines", "buildReceiptText",
         "buildKitchenTicketText", "buildKitchenTicketHtml", "buildReceiptHtml", "sendReceiptToBluetoothPrinter"]
lines = s.split("\n")
starts = {}
for i, ln in enumerate(lines):
    m = re.match(r"^(async )?function (\w+)\(", ln)
    if m: starts[m.group(2)] = i
tops = sorted(starts.values())
for fn in funcs:
    if fn not in starts:
        print("XATO: funksiya topilmadi:", fn); sys.exit(1)
    a = starts[fn]
    b = min([t for t in tops if t > a], default=len(lines))
    for i in range(a, b):
        lines[i] = re.sub(r"(?<![\w.])tr\(", "trR(", lines[i])
s = "\n".join(lines)
print("OK trR:", s.count("trR("), "ta chaqiruv")

rep("function trR(key){",
    "function withReceiptLang(fn){ const prev = state.lang; state.lang = receiptLang(); try{ return fn(); } finally{ state.lang = prev; } }\nfunction trR(key){",
    "withReceiptLang")
for fn in ["buildReceiptText", "buildReceiptHtml", "buildKitchenTicketText", "buildKitchenTicketHtml"]:
    rep("\nfunction %s(" % fn,
        "\nfunction %s(...a){ return withReceiptLang(()=>%sInner(...a)); }\nfunction %sInner(" % (fn, fn, fn),
        "wrap " + fn)
open(F, "w", encoding="utf-8").write(s)
print("TAYYOR")
