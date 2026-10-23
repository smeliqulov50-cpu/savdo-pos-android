/* Sinov uchun soxta Firebase (compat): Auth «bitta email — bitta akkaunt» qoidasi bilan, Firestore — xotirada, authGuard — server mantig'i nusxasi.
   Faqat tests/auth/check_google.py ishlatadi. */
(function(){
  const W = window;
  const DB = W.__FDB = {docs: {}, writes: []};
  const clone = (v)=>v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  function snap(path){ const has = Object.prototype.hasOwnProperty.call(DB.docs, path); return {exists: has, id: path.split('/').pop(), ref: docRef(path), data: ()=>has ? clone(DB.docs[path]) : undefined, get: (k)=>has ? DB.docs[path][k] : undefined}; }
  function docRef(path){
    const r = {id: path.split('/').pop(), path: path,
      get: async()=>snap(path),
      set: async(d, o)=>{ DB.writes.push(path); DB.docs[path] = (o && o.merge && DB.docs[path]) ? Object.assign({}, DB.docs[path], clone(d)) : clone(d); },
      update: async(d)=>{ DB.writes.push(path); DB.docs[path] = Object.assign({}, DB.docs[path] || {}, clone(d)); },
      delete: async()=>{ delete DB.docs[path]; },
      collection: (n)=>colRef(path + '/' + n),
      onSnapshot: (a)=>{ try{ setTimeout(()=>{ try{ (a && a.next ? a.next : a)(snap(path)); }catch(e){} }, 0); }catch(e){} return ()=>{}; }};
    return r;
  }
  function colRef(path, filters){
    filters = filters || [];
    const q = {
      id: path.split('/').pop(), path: path,
      doc: (id)=>docRef(path + '/' + (id || ('d' + Math.random().toString(36).slice(2, 12)))),
      where: (f, op, v)=>colRef(path, filters.concat([[f, op, v]])), orderBy: ()=>q, limit: ()=>q, limitToLast: ()=>q, startAfter: ()=>q, endBefore: ()=>q, startAt: ()=>q,
      get: async()=>{ const pre = path + '/'; const docs = Object.keys(DB.docs).filter(p=>p.indexOf(pre) === 0 && p.slice(pre.length).indexOf('/') === -1)
          .filter(p=>filters.every(f=>f[1] !== '==' || DB.docs[p][f[0]] === f[2])).map(snap);
        return {docs: docs, empty: !docs.length, size: docs.length, forEach: (fn)=>docs.forEach(fn), docChanges: ()=>[]}; },
      onSnapshot: (a)=>{ setTimeout(async()=>{ try{ const s = await q.get(); (a && a.next ? a.next : a)(s); }catch(e){} }, 0); return ()=>{}; },
      add: async(d)=>{ const r = q.doc(); await r.set(d); return r; }
    };
    return q;
  }
  const FS = {collection: (n)=>colRef(n), doc: (p)=>docRef(p),
    batch: ()=>{ const ops = []; return {set: (r, d, o)=>{ ops.push(()=>r.set(d, o)); }, update: (r, d)=>{ ops.push(()=>r.update(d)); }, delete: (r)=>{ ops.push(()=>r.delete()); }, commit: async()=>{ for(const o of ops) await o(); }}; },
    runTransaction: async(fn)=>fn({get: (r)=>r.get(), set: (r, d, o)=>r.set(d, o), update: (r, d)=>r.update(d), delete: (r)=>r.delete()}),
    enablePersistence: ()=>Promise.resolve(), enableMultiTabIndexedDbPersistence: ()=>Promise.resolve(), settings: ()=>{}, enableNetwork: ()=>Promise.resolve(), disableNetwork: ()=>Promise.resolve()};
  // ---------- Auth ----------
  const A = W.__FA = {users: {}, listeners: [], currentUser: null, calls: [], seq: 0, mode: 'one'};   // mode: 'one' — bitta email bitta akkaunt; 'multi' — noto'g'ri sozlama sinovi
  function err(code, extra){ const e = new Error(code); e.code = code; Object.assign(e, extra || {}); return e; }
  function pdata(u){ return u.providers.map(p=>({providerId: p, email: p === 'google.com' ? (u.gEmail || u.email) : u.email, uid: p === 'google.com' ? u.gSub : u.email})); }
  function view(u){
    if(!u) return null;
    if(u.__v) { u.__v.providerData = pdata(u); u.__v.email = u.email; return u.__v; }
    const v = {uid: u.uid, email: u.email || null, displayName: u.displayName || null, providerData: pdata(u), metadata: {creationTime: new Date(u.created).toUTCString()},
      getIdToken: async()=>'tok-' + u.uid,
      reload: async()=>{ v.providerData = pdata(u); v.email = u.email; },
      delete: async()=>{ A.calls.push(['delete', u.uid]); delete A.users[u.uid]; if(A.currentUser && A.currentUser.uid === u.uid) await setUser(null); },
      linkWithCredential: async(c)=>{ A.calls.push(['link', u.uid, c.providerId]);
        if(c.providerId === 'google.com'){ const other = Object.values(A.users).find(x=>x.gSub === c.sub && x.uid !== u.uid); if(other) throw err('auth/credential-already-in-use');
          if(u.providers.indexOf('google.com') !== -1) throw err('auth/provider-already-linked'); u.providers.push('google.com'); u.gSub = c.sub; u.gEmail = c.email; }
        else if(c.providerId === 'password'){ if(u.providers.indexOf('password') !== -1) throw err('auth/provider-already-linked');
          if(c.email && Object.values(A.users).some(x=>x.uid !== u.uid && String(x.email || '').toLowerCase() === String(c.email).toLowerCase())) throw err('auth/email-already-in-use');
          u.providers.push('password'); u.pw = c.pw; if(!u.email && c.email){ u.email = c.email; v.email = c.email; } }
        v.providerData = pdata(u); return {user: v}; },
      linkWithPopup: async()=>{ const g = W.__G; if(!g) throw err('auth/popup-closed-by-user'); return v.linkWithCredential(gcred(g)); },
      unlink: async(pid)=>{ A.calls.push(['unlink', u.uid, pid]); u.providers = u.providers.filter(p=>p !== pid); if(pid === 'google.com'){ u.gSub = null; } v.providerData = pdata(u); return v; },
      reauthenticateWithCredential: async(c)=>{ A.calls.push(['reauth', c.providerId]); if(c.providerId === 'password' && c.pw !== u.pw) throw err('auth/invalid-credential'); return {user: v}; },
      reauthenticateWithPopup: async()=>{ A.calls.push(['reauthPopup']); return {user: v}; },
      verifyBeforeUpdateEmail: async()=>{} };
    u.__v = v; return v;
  }
  A.preset = function(uid){ const u = A.users[uid]; A.currentUser = u ? view(u) : null; };
  async function setUser(u){ A.currentUser = u ? view(u) : null; const cu = A.currentUser; for(const l of A.listeners.slice()){ try{ l(cu); }catch(e){} } }
  function newUser(o){ const uid = o.uid || ('u' + (++A.seq) + Math.random().toString(36).slice(2, 8)); const u = Object.assign({uid: uid, created: Date.now(), providers: []}, o, {uid: uid}); A.users[uid] = u; return u; }
  function gcred(g){ return {providerId: 'google.com', idToken: 'id-' + g.sub, sub: g.sub, email: g.email}; }
  function trusted(email){ return /@gmail\.com$/i.test(email); }
  async function googleSignIn(c){
    const byG = Object.values(A.users).find(x=>x.gSub === c.sub);
    if(byG){ await setUser(byG); return {user: view(byG), credential: c, additionalUserInfo: {isNewUser: false}}; }
    const byE = Object.values(A.users).find(x=>String(x.email).toLowerCase() === String(c.email).toLowerCase());
    if(byE && A.mode === 'one'){
      if(trusted(c.email)){ byE.providers.push('google.com'); byE.gSub = c.sub; byE.gEmail = c.email; await setUser(byE); return {user: view(byE), credential: c, additionalUserInfo: {isNewUser: false}}; }
      throw err('auth/account-exists-with-different-credential', {email: c.email, credential: c});
    }
    const u = newUser({email: c.email, providers: ['google.com'], gSub: c.sub, gEmail: c.email});
    await setUser(u); return {user: view(u), credential: c, additionalUserInfo: {isNewUser: true}};
  }
  const AUTH = {
    get currentUser(){ return A.currentUser; },
    onAuthStateChanged(cb){ A.listeners.push(cb); setTimeout(()=>cb(A.currentUser), 30); return ()=>{}; },
    async signInWithEmailAndPassword(e, p){ A.calls.push(['signIn', e]); const u = Object.values(A.users).find(x=>String(x.email).toLowerCase() === String(e).toLowerCase() && x.providers.indexOf('password') !== -1);
      if(!u || u.pw !== p) throw err('auth/invalid-credential'); await setUser(u); return {user: view(u), additionalUserInfo: {isNewUser: false}}; },
    async createUserWithEmailAndPassword(e, p){ A.calls.push(['signUp', e]); if(Object.values(A.users).some(x=>String(x.email).toLowerCase() === String(e).toLowerCase())) throw err('auth/email-already-in-use');
      const u = newUser({email: e, providers: ['password'], pw: p}); await setUser(u); return {user: view(u), additionalUserInfo: {isNewUser: true}}; },
    async signInWithPopup(){ A.calls.push(['popup']); const g = W.__G; if(!g) throw err('auth/popup-closed-by-user'); if(g.block) throw err('auth/popup-blocked'); return googleSignIn(gcred(g)); },
    async signInWithRedirect(){ A.calls.push(['redirect']); },
    async getRedirectResult(){ return {user: null}; },
    async signInWithCredential(c){ A.calls.push(['signInCred', c.providerId, c.idToken]); return googleSignIn(c); },
    async signInWithCustomToken(t){ A.calls.push(['custom', t]); const u = A.users[String(t).replace(/^ct-/, '')]; if(!u) throw err('auth/invalid-custom-token'); await setUser(u); return {user: view(u), additionalUserInfo: {isNewUser: false}}; },
    async signOut(){ A.calls.push(['signOut']); await setUser(null); },
    async sendPasswordResetEmail(e){ A.calls.push(['reset', e]); },
    setPersistence: async()=>{}, useDeviceLanguage(){}, languageCode: null
  };
  function GoogleAuthProvider(){ this.providerId = 'google.com'; }
  GoogleAuthProvider.prototype.setCustomParameters = function(){};
  GoogleAuthProvider.prototype.addScope = function(){};
  GoogleAuthProvider.credential = function(idToken){ const sub = String(idToken || '').replace(/^id-/, ''); const g = W.__G && W.__G.sub === sub ? W.__G : {sub: sub, email: ''}; return {providerId: 'google.com', idToken: idToken, sub: sub, email: g.email}; };
  GoogleAuthProvider.credentialFromError = function(e){ return e && e.credential || null; };
  const authFn = function(){ return AUTH; };
  authFn.GoogleAuthProvider = GoogleAuthProvider;
  authFn.EmailAuthProvider = {credential: (email, pw)=>({providerId: 'password', email: email, pw: pw})};
  authFn.Auth = {Persistence: {LOCAL: 'local', SESSION: 'session', NONE: 'none'}};
  const fsFn = function(){ return FS; };
  function FieldValue(){}
  FieldValue.serverTimestamp = ()=>new Date().toISOString(); FieldValue.delete = ()=>null; FieldValue.increment = (n)=>n; FieldValue.arrayUnion = (...a)=>a; FieldValue.arrayRemove = ()=>[];
  fsFn.FieldValue = FieldValue;
  fsFn.Timestamp = {now: ()=>({toMillis: ()=>Date.now()}), fromMillis: (m)=>({toMillis: ()=>m})};
  const msgFn = function(){ return {getToken: async()=>'', onMessage(){}, deleteToken: async()=>true}; };
  msgFn.isSupported = ()=>false;
  W.firebase = {initializeApp: (cfg, name)=>({name: name || '[DEFAULT]', auth: authFn, firestore: fsFn, delete: async()=>{}}), auth: authFn, firestore: fsFn, messaging: msgFn, apps: [], app: ()=>({})};
  // ---------- authGuard (server mantig'i — functions/src/auth/guard.js nusxasi) ----------
  W.__GUARD = {calls: 0, fail: false};
  const origFetch = W.fetch.bind(W);
  W.fetch = async function(url, opts){
    if(String(url).indexOf('/authGuard') === -1) return origFetch(url, opts);
    W.__GUARD.calls++;
    if(W.__GUARD.fail) throw new TypeError('Failed to fetch');
    const tok = String(((opts || {}).headers || {}).Authorization || '').replace(/^Bearer tok-/, '');
    const me = A.users[tok];
    const out = (o)=>new Response(JSON.stringify(Object.assign({ok: true}, o)), {status: 200, headers: {'Content-Type': 'application/json'}});
    if(!me) return new Response(JSON.stringify({ok: false, code: 'unauthenticated'}), {status: 401});
    if(DB.docs['staffAuth/' + tok]) return out({status: 'staff'});
    if(DB.docs['businesses/' + tok]) return out({status: 'own'});
    const em = String(me.email || '');
    if(!em) return out({status: 'new'});
    let other = Object.values(A.users).find(x=>x.uid !== tok && String(x.email).toLowerCase() === em.toLowerCase());
    let otherId = other ? other.uid : null;
    if(!otherId){ const k = Object.keys(DB.docs).find(p=>/^businesses\/[^/]+$/.test(p) && p !== 'businesses/' + tok && (DB.docs[p].ownerEmail === em || DB.docs[p].ownerEmail === em.toLowerCase())); if(k) otherId = k.split('/')[1]; }
    if(!otherId) return out({status: 'new'});
    let removed = false;
    if(Date.now() - me.created < 30 * 60000 && me.providers.length && me.providers.every(p=>p === 'google.com')){ delete A.users[tok]; removed = true; }
    return out({status: 'conflict', email: em, removed: removed});
  };
  // ---------- telegramLogin (server mantig'i — functions/src/telegram/login.js ning soddalashtirilgan nusxasi; botdagi tasdiq — __tglConfirm/__tglDeny) ----------
  const TS = W.__TS = {reqs: {}, last: null, map: {}, rev: {}, names: {}, calls: [], off: false, seq: 0};
  function setMap(tgId, uid, name){ const old = TS.rev[uid]; if(old && old !== tgId) delete TS.map[old]; TS.map[tgId] = uid; TS.rev[uid] = tgId; TS.names[uid] = name; }
  function unMap(uid){ const t = TS.rev[uid]; if(t){ delete TS.map[t]; delete TS.rev[uid]; delete TS.names[uid]; } }
  W.__tglConfirm = function(tgId, name){ const q = TS.reqs[TS.last]; if(q && q.status === 'pending'){ q.status = 'confirmed'; q.tgId = String(tgId); q.name = name || 'Ali Valiyev'; } };
  W.__tglDeny = function(){ const q = TS.reqs[TS.last]; if(q && q.status === 'pending') q.status = 'denied'; };
  W.__tglMap = setMap;
  function tgl(b, uid){
    TS.calls.push(b.action);
    if(TS.off) return [503, {ok: false, code: 'no-bot'}];
    const okr = (o)=>[200, Object.assign({ok: true}, o)], e = (s, c)=>[s, {ok: false, code: c}];
    const a = b.action;
    if(a === 'start'){
      const mode = b.mode || 'login';
      if(mode !== 'login'){ if(!uid) return e(401, 'unauthenticated'); if(DB.docs['staffAuth/' + uid]) return e(403, 'staff'); if(mode === 'verify' && !TS.rev[uid]) return e(409, 'not-linked'); }
      const n = ++TS.seq, rid = 'rid' + n + 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa', poll = 'poll' + n + 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      TS.reqs[rid] = {mode: mode, poll: poll, status: 'pending', linkUid: mode === 'login' ? null : uid}; TS.last = rid;
      return okr({rid: rid, poll: poll, num: 47, url: 'https://t.me/savdo_pos_bot?start=l_' + rid, expMs: Date.now() + 300000});
    }
    if(a === 'status'){ if(!uid) return e(401, 'unauthenticated'); return okr({linked: !!TS.rev[uid], name: TS.names[uid] || ''}); }
    if(a === 'unlink'){ if(!uid) return e(401, 'unauthenticated'); if(!TS.rev[uid]) return okr({linked: false}); if(!(A.users[uid].providers || []).length) return e(409, 'last-method'); unMap(uid); return okr({linked: false}); }
    if(a === 'forget'){ if(!uid) return e(401, 'unauthenticated'); unMap(uid); if(!(A.users[uid].providers || []).length && !DB.docs['businesses/' + uid]){ delete A.users[uid]; return okr({deleted: true}); } return okr({deleted: false}); }
    const q = TS.reqs[b.rid];
    if(!q) return e(404, 'not-found'); if(q.poll !== b.poll) return e(403, 'forbidden');
    if(a === 'poll'){
      if(q.status === 'pending' || q.status === 'denied') return okr({status: q.status});
      if(q.status !== 'confirmed') return okr({status: 'used'});
      q.status = 'used';
      if(q.mode === 'verify') return okr({status: TS.map[q.tgId] === q.linkUid ? 'verified' : 'mismatch'});
      if(q.mode === 'link'){ if(TS.map[q.tgId] && TS.map[q.tgId] !== q.linkUid) return okr({status: 'tg-used'}); setMap(q.tgId, q.linkUid, q.name); return okr({status: 'linked', name: q.name}); }
      const mu = TS.map[q.tgId];
      if(mu && A.users[mu]) return okr({status: 'ok', token: 'ct-' + mu});
      q.status = 'choose'; q.ticket = 'ticket' + TS.seq + 'cccccccccccccccccccccccccccccccc'; return okr({status: 'choose', ticket: q.ticket, name: q.name});
    }
    if(q.status !== 'choose' || q.ticket !== b.ticket) return okr({status: 'used'});
    if(a === 'new'){ q.status = 'used'; const u = newUser({email: null, providers: [], displayName: q.name}); setMap(q.tgId, u.uid, q.name); return okr({status: 'ok', token: 'ct-' + u.uid}); }
    if(a === 'link'){ if(!uid) return e(401, 'unauthenticated'); if(DB.docs['staffAuth/' + uid]) return e(403, 'staff'); q.status = 'used';
      if(TS.map[q.tgId] && TS.map[q.tgId] !== uid) return okr({status: 'tg-used'}); setMap(q.tgId, uid, q.name); return okr({status: 'linked', name: q.name}); }
    return e(400, 'bad-action');
  }
  const prevFetch = W.fetch;
  W.fetch = async function(url, opts){
    if(String(url).indexOf('/telegramLogin') === -1) return prevFetch(url, opts);
    const tok = String(((opts || {}).headers || {}).Authorization || '').replace(/^Bearer tok-/, '');
    const uid = tok && A.users[tok] ? tok : null;
    let b = {}; try{ b = JSON.parse((opts || {}).body || '{}'); }catch(_e){}
    const r = tgl(b, uid);
    return new Response(JSON.stringify(r[1]), {status: r[0], headers: {'Content-Type': 'application/json'}});
  };
})();
