(opts)=>{
  opts = opts || {};
  const out = []; const ctx = document.createElement('canvas').getContext('2d');
  const VW = innerWidth, VH = innerHeight;
  const mr = document.getElementById('modal-root');
  const modalOn = !!(mr && mr.firstElementChild && mr.innerText.trim());
  const scope = modalOn ? mr : document.body;
  let uidN = 0;
  const mark = (el)=>{ if(!el.dataset.uiId) el.dataset.uiId = 'u' + (++uidN); return el.dataset.uiId; };
  const visCache = new Map();
  const vis = (el)=>{ if(visCache.has(el)) return visCache.get(el); let v = true; for(let a=el; a && a.nodeType===1; a=a.parentElement){ const c=getComputedStyle(a); if(c.display==='none'||c.visibility==='hidden'||parseFloat(c.opacity)===0){ v=false; break; } if(a.tagName==='DETAILS' && !a.open && !(el.closest('summary') && a.contains(el.closest('summary')))){ v=false; break; } } visCache.set(el, v); return v; };
  const inScope = (el)=> scope.contains(el) && !(modalOn ? false : (mr && mr.contains(el))) && !el.closest('#toast-root,.toast,script,style,svg,noscript,#print-receipt');
  const fixedOf = (el)=>{ for(let a=el; a && a.nodeType===1; a=a.parentElement){ const p=getComputedStyle(a).position; if(p==='fixed'||p==='sticky') return a; } return null; };
  const path = (el)=>{ const p=[]; for(let a=el; a && a.nodeType===1 && p.length<4; a=a.parentElement){ let s=a.tagName.toLowerCase(); if(a.id) s+='#'+a.id; else if(a.classList.length) s+='.'+[...a.classList].filter(c=>c!=='active').slice(0,2).join('.'); p.unshift(s); if(a.id) break; } return p.join(' > '); };
  const add = (o, els)=>{ o.ids = els.filter(Boolean).map(mark); out.push(o); };
  const texts = [];
  const tw = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {acceptNode:(n)=>/[^\s​]/.test(n.nodeValue)?1:2});
  let n;
  while((n = tw.nextNode())){
    const el = n.parentElement; if(!el || !inScope(el) || !vis(el)) continue;
    const r = document.createRange(); r.selectNodeContents(n);
    let cl = {l: 0, t: 0, r: VW, b: VH};   /* ko'rinadigan qism: overflow bilan kesuvchi ota-bobolar ichida */
    for(let a = el; a && a !== document.documentElement; a = a.parentElement){ const c = getComputedStyle(a); if(c.overflowX !== 'visible' || c.overflowY !== 'visible'){ const b = a.getBoundingClientRect(); cl = {l: Math.max(cl.l, b.left + a.clientLeft), t: Math.max(cl.t, b.top + a.clientTop), r: Math.min(cl.r, b.left + a.clientLeft + a.clientWidth), b: Math.min(cl.b, b.top + a.clientTop + a.clientHeight)}; } }
    const raw = [...r.getClientRects()].filter(x=>x.width>0.5 && x.height>0.5);
    const rects = raw.map(x=>({left: Math.max(x.left, cl.l), right: Math.min(x.right, cl.r), top: Math.max(x.top, cl.t), bottom: Math.min(x.bottom, cl.b), height: x.height, full: x})).filter(x=>x.right - x.left > 0.5 && x.bottom - x.top > 0.5);
    if(!rects.length) continue;
    const cs = getComputedStyle(el);
    const txt = n.nodeValue.replace(/\s+/g,' ').trim();
    texts.push({el, rects, txt, fixed: fixedOf(el)});
    ctx.font = cs.fontStyle+' '+cs.fontWeight+' '+cs.fontSize+' '+cs.fontFamily;
    const m = ctx.measureText(txt);
    const fd = m.fontBoundingBoxDescent, id = Math.max(0, m.actualBoundingBoxDescent), ia = m.actualBoundingBoxAscent;
    const clips = [];
    for(let a = el; a && a !== document.body && a !== document.documentElement; a = a.parentElement){
      const c = getComputedStyle(a);
      if(c.overflowY !== 'visible' || c.overflowX !== 'visible'){
        const scrollY = (c.overflowY==='auto'||c.overflowY==='scroll') && a.scrollHeight > a.clientHeight + 8;
        const b = a.getBoundingClientRect(); const top = b.top + a.clientTop; clips.push({a, top, bottom: top + a.clientHeight, left: b.left + a.clientLeft, right: b.left + a.clientLeft + a.clientWidth, scrollY, scrollX: (c.overflowX==='auto'||c.overflowX==='scroll'), ov: c.overflowY, to: c.textOverflow});
      }
    }
    { /* qatorlar: tepasi bir-biriga yaqin to'rtburchaklar bitta qator; kodlar (raqam yoki / bor so'zlar) bo'linishi mumkin */
      const words = txt.split(' ').filter(w=>w && !/[\d\/_@.]/.test(w)); const tops = []; raw.slice().sort((a,b)=>a.top-b.top).forEach(q=>{ if(!tops.length || q.top > tops[tops.length-1] + q.height*0.5) tops.push(q.top); });
      const codes = txt.split(' ').filter(w=>w && /[\d\/_@.]/.test(w)).length;
      if(words.length && !codes && txt.length >= 3 && tops.length > words.length && !/^[•·.\-–—\s\d]+$/.test(txt)) add({kind:'harfma-harf', px:tops.length, text:txt.slice(0,60), el:path(el)}, [el]); }
    let done = false;
    for(const q0 of rects){
      if(done) break;
      const q = q0.full;
      const base = q.bottom - fd; const inkB = base + id, inkT = base - ia;
      for(const c of clips){
        if(c.scrollY) break;
        if(base > c.top + 1 && base < c.bottom + 0.5 && inkB > c.bottom + 0.6){ add({kind:'pasti-kesilgan', px:+(inkB-c.bottom).toFixed(1), text:txt.slice(0,60), el:path(el), clip:path(c.a)}, [el]); done = true; break; }
        if(base - ia*0.5 > c.top && inkT < c.top - 0.6 && base < c.bottom){ add({kind:'tepasi-kesilgan', px:+(c.top-inkT).toFixed(1), text:txt.slice(0,60), el:path(el), clip:path(c.a)}, [el]); done = true; break; }
        if(!c.scrollX && c.to !== 'ellipsis' && q.right > c.right + 1.5 && q.left < c.right){ add({kind:'yon-kesilgan', px:+(q.right-c.right).toFixed(1), text:txt.slice(0,60), el:path(el), clip:path(c.a)}, [el]); done = true; break; }
      }
    }
  }
  /* ellipsis / line-clamp — matn «…» bilan qisqargan */
  scope.querySelectorAll('*').forEach(e=>{
    if(!inScope(e) || !e.childNodes.length) return;
    const c = getComputedStyle(e); if(c.display==='none') return;
    const b = e.getBoundingClientRect(); if(b.width < 1 || b.bottom < 0 || b.top > VH) return;
    const t = (e.innerText || '').replace(/\s+/g,' ').trim(); if(!t) return;
    if(c.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1 && vis(e)) add({kind:'uch-nuqta', px:e.scrollWidth - e.clientWidth, text:t.slice(0,60), el:path(e), num:/\d/.test(t)}, [e]);
    else if(c.webkitLineClamp && c.webkitLineClamp !== 'none' && e.scrollHeight > e.clientHeight + 2 && vis(e)) add({kind:'uch-nuqta', px:e.scrollHeight - e.clientHeight, text:t.slice(0,60), el:path(e), num:/\d/.test(t), clamp:c.webkitLineClamp}, [e]);
  });
  /* yozuvlar bir-birining ustida (ota-bola emas, ikkalasi bir qatlamda) */
  for(let i = 0; i < texts.length; i++){
    const A = texts[i];
    for(let j = i + 1; j < texts.length; j++){
      const B = texts[j];
      if(A.el === B.el || A.el.contains(B.el) || B.el.contains(A.el)) continue;
      if((A.fixed || null) !== (B.fixed || null)) continue;
      let hit = null;
      for(const p of A.rects){ for(const q of B.rects){ const ox = Math.min(p.right,q.right)-Math.max(p.left,q.left), oy = Math.min(p.bottom,q.bottom)-Math.max(p.top,q.top); if(ox > 2 && oy > Math.min(p.height, q.height) * 0.35){ hit = [ox, oy]; break; } } if(hit) break; }
      if(hit) add({kind:'ustma-ust', px:+hit[0].toFixed(1), text:A.txt.slice(0,30) + ' | ' + B.txt.slice(0,30), el:path(A.el) + '  ⟷  ' + path(B.el)}, [A.el, B.el]);
    }
  }
  /* bola elementlar konteynerdan chiqib, qo'shnisi ustiga tushgan */
  scope.querySelectorAll('*').forEach(e=>{
    if(!inScope(e)) return;
    const c = getComputedStyle(e); if(c.overflowX !== 'visible' || c.display === 'inline' || c.display === 'contents' || c.display === 'none') return;
    const b = e.getBoundingClientRect(); if(b.width < 1 || b.bottom < 0 || b.top > VH || b.right < 0 || b.left > VW) return;
    let worst = 0, what = '', wel = null;
    e.childNodes.forEach(ch=>{
      let q = null, t = '', ce = null;
      if(ch.nodeType === 3 && /\S/.test(ch.nodeValue)){ const r = document.createRange(); r.selectNodeContents(ch); q = r.getBoundingClientRect(); t = ch.nodeValue.trim(); ce = e; }
      else if(ch.nodeType === 1){ const s = getComputedStyle(ch); if(s.position === 'absolute' || s.position === 'fixed' || s.display === 'none' || s.visibility === 'hidden') return; if(parseFloat(s.marginRight) < 0 || parseFloat(s.marginLeft) < 0) return; if(!(ch.innerText||'').trim()) return; q = ch.getBoundingClientRect(); t = (ch.innerText || '').trim(); ce = ch; }
      if(!q || q.width < 0.5) return;
      const over = Math.max(q.right - b.right, b.left - q.left);
      if(over > worst){ worst = over; what = t; wel = ce; }
    });
    if(worst > 1.5 && vis(e)) add({kind:'toshgan', px:+worst.toFixed(1), text:what.replace(/\s+/g,' ').slice(0,60), el:path(e)}, [e, wel]);
  });
  /* gorizontal aylantirish */
  const hs = [];
  const de = document.documentElement; if(de.scrollWidth > VW + 1) hs.push(['sahifa', de.scrollWidth - VW]);
  const vc = document.getElementById('view-container'); if(!modalOn && vc && vc.scrollWidth > vc.clientWidth + 1) hs.push(['view-container', vc.scrollWidth - vc.clientWidth]);
  if(modalOn){ mr.querySelectorAll('.modal-sheet').forEach(ms=>{ if(ms.scrollWidth > ms.clientWidth + 1) hs.push(['modal-sheet', ms.scrollWidth - ms.clientWidth]); }); }
  hs.forEach(h=>add({kind:'gorizontal-aylanish', px:h[1], text:h[0], el:h[0]}, []));
  return {texts: texts.length, issues: out, modal: modalOn};
}
