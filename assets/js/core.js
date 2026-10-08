/* vrsus — shared browser code: the tape, the lit coins, the tug bar, wallets, motion, the split living background */
(function () {
  const CONFIG = window.VRSUS_CONFIG || { ca: '', x: '' };
  const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = async (url, opt) => { try { const r = await fetch(url, opt); return await r.json(); } catch { return { ok: false, error: 'The network didn’t answer.' }; } };
  const post = (url, body) => api(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const usd = v => v == null ? '—' : '$' + (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e4 ? Math.round(v / 1e3) + 'K' : v >= 1 ? Number(v).toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 0 : 2 }) : Number(v).toPrecision(3));
  const pct = v => v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(2) + '%';
  const sol = v => v == null ? '—' : Number(v).toFixed(Number(v) >= 10 ? 2 : 4) + ' SOL';
  const ago = t => { if (!t) return '—'; const s = Math.max(0, (Date.now() - new Date(t)) / 1000); return s < 60 ? Math.round(s) + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : Math.round(s / 86400) + 'd ago'; };
  const hhmm = t => new Date(t).toISOString().slice(11, 16) + ' UTC';
  const short = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
  const tx = s => 'https://solscan.io/tx/' + s, acct = a => 'https://solscan.io/account/' + a;
  let tt = null;
  function toast(m) { let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); } t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 1900); }
  async function copy(text, what) { try { await navigator.clipboard.writeText(text); toast((what || 'Copied') + ' ✓'); } catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast((what || 'Copied') + ' ✓'); } catch { toast('Copy failed'); } ta.remove(); } }
  document.addEventListener('click', e => { const b = e.target.closest('[data-copy]'); if (b) { e.preventDefault(); copy(b.getAttribute('data-copy'), b.getAttribute('data-what')); } });

  // ---------- the tape: live readings + the engine's latest actions ----------
  async function tape() {
    const el = $('#tape .in'); if (!el) return;
    const [l, d] = await Promise.all([api('/api/duels?op=log'), api('/api/duels')]);
    const items = [];
    if (d && d.ok) for (const x of (d.duels || []).filter(x => x.state === 'live').slice(0, 8))
      items.push(`<span class="it"><b class="yes">$${esc(x.yes.symbol)}</b> <span class="dim">vs</span> <b class="no">$${esc(x.no.symbol)}</b> ${esc(x.q.slice(0, 60))} ${x.crowd != null ? `<span class="dim">crowd</span> <span class="yes">${x.crowd}%</span>` : ''} <span class="dim">pot</span> ${sol(x.potSol)}</span>`);
    if (l && l.ok) for (const e of (l.log || []).filter(e => ['settle', 'pay'].includes(e.kind)).slice(0, 10))
      items.push(`<span class="it"><span class="ar">${e.kind === 'settle' ? '[!]' : '[$]'}</span> <b>$${esc(e.sy)}</b><span class="dim">/</span><b>$${esc(e.sn)}</b> ${esc(e.text.slice(0, 96))}</span>`);
    if (!items.length) { el.innerHTML = '<span class="it dim">no duels running yet · the first one could be yours · every duel settles on a public source</span><span class="sep">//</span>'.repeat(4); el.style.animationDuration = '60s'; return; }
    const one = items.join('<span class="sep">//</span>') + '<span class="sep">//</span>';
    el.innerHTML = one + one;
    el.style.animationDuration = Math.max(40, items.length * 7) + 's';
  }

  // ---------- the coins: lit ASCII discs, one green one red, the light slowly circling ----------
  const RAMP = '-=+*#%@';
  function coinArt(pre, side, opts = {}) {
    if (!pre) return;
    const cols = opts.cols || 41, rows = opts.rows || 20, cw = .6, ch = 1, R = Math.min(cols * cw, rows * ch) / 2 - .5;
    const cx = cols * cw / 2, cy = rows * ch / 2, rim = ringCells(cols, rows, R, R, cw, ch);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cls = side === 'no' ? 'n' : 'y';
    let ang = side === 'no' ? -2.2 : -.9, last = 0;
    function draw() {
      const lx = Math.cos(ang), ly = Math.sin(ang); let out = '';
      for (let r = 0; r < rows; r++) {
        let cur = null, buf = '';
        const push = (k, chr) => { if (k !== cur) { if (buf) out += cur ? `<span class="${cur}">${esc(buf)}</span>` : buf; buf = ''; cur = k; } buf += chr; };
        for (let c = 0; c < cols; c++) {
          const key = r * cols + c;
          if (rim.has(key)) { push('rm', rim.get(key)); continue; }
          const x = ((c + .5) * cw - cx) / R, y = ((r + .5) * ch - cy) / R, e = x * x + y * y;
          if (e >= .9 || (e >= .5 && e < .57)) { push(null, ' '); continue; }
          const rr = Math.sqrt(Math.max(e, 1e-9));
          let b = e >= .57 ? .5 + .5 * ((x / rr) * lx + (y / rr) * ly) : .62 + .36 * (x * lx + y * ly);
          b = Math.max(0, Math.min(1, b));
          push(cls + Math.min(4, Math.floor(b * 5)), RAMP[Math.round(b * (RAMP.length - 1))]);
        }
        if (buf) out += cur ? `<span class="${cur}">${esc(buf)}</span>` : buf;
        out += '\n';
      }
      pre.innerHTML = out;
    }
    draw();
    if (reduce || opts.still) return;
    const frame = t => { if (!pre.isConnected) return; requestAnimationFrame(frame); if (document.hidden || t - last < 110) return; last = t; ang += .045; draw(); };
    requestAnimationFrame(frame);
  }
  function ringCells(cols, rows, Rx, Ry, cw, ch) {
    const cx = cols * cw / 2, cy = rows * ch / 2, out = new Map();
    const chAt = (x, y) => { if (Math.abs(y) < 1e-9) return '|'; const sl = -(x * Ry * Ry) / (y * Rx * Rx) * (cw / ch), a = Math.abs(sl); return a > 2.4 ? '|' : a < .42 ? '-' : sl > 0 ? '\\' : '/'; };
    for (let r = 0; r < rows; r++) { const y = (r + .5) * ch - cy; if (Math.abs(y) < Ry) { const dx = Rx * Math.sqrt(1 - (y / Ry) ** 2); for (const x of [-dx, dx]) if (Math.abs(y) < 1e-9 || Math.abs((x * Ry * Ry) / (y * Rx * Rx)) * (cw / ch) >= 1) out.set(r * cols + Math.floor((cx + x) / cw), chAt(x, y)); } }
    for (let c = 0; c < cols; c++) { const x = (c + .5) * cw - cx; if (Math.abs(x) < Rx) { const dy = Ry * Math.sqrt(1 - (x / Rx) ** 2); for (const y of [-dy, dy]) if (Math.abs((x * Ry * Ry) / (y * Rx * Rx)) * (cw / ch) < 1) out.set(Math.floor((cy + y) / ch) * cols + c, chAt(x, y)); } }
    return out;
  }
  // the tug bar: YES [#####|####] NO, split at the crowd's odds
  function tug(p, n = 40) {
    if (p == null) return `<span class="yes">YES</span> <span class="dim">[${'-'.repeat(n / 2)}|${'-'.repeat(n / 2)}]</span> <span class="no">NO</span>`;
    const k = Math.max(1, Math.min(n - 1, Math.round(p / 100 * n)));
    return `<span class="yes">YES</span> <span class="dim">[</span><span class="yes">${'#'.repeat(k)}</span><b>|</b><span class="no">${'#'.repeat(n - k)}</span><span class="dim">]</span> <span class="no">NO</span>`;
  }
  const STATE = { live: 'live', settling: 'settling', settled: 'settled', creating: 'launching', waiting: 'waiting' };
  function stateChip(d) {
    if (d.state === 'settled' || d.state === 'settling') return d.outcome === 'VOID' ? '<span class="chip void">VOID</span>' : `<span class="chip ${d.outcome === 'YES' ? 'yes' : 'no'}">${d.outcome} WON</span>`;
    if (d.state === 'live') return '<span class="chip live">LIVE</span>';
    return `<span class="chip">${esc(STATE[d.state] || d.state)}</span>`;
  }
  const kindName = k => ({ pm: 'world', game: 'sports', price: 'price' }[k] || k);
  const srcName = k => ({ pm: 'polymarket', game: 'espn', price: 'coinbase' }[k] || k);

  // ---------- wallets ----------
  const wallets = () => [
    { id: 'phantom', name: 'Phantom', p: (window.phantom && window.phantom.solana) || (window.solana && window.solana.isPhantom ? window.solana : null) },
    { id: 'solflare', name: 'Solflare', p: window.solflare && window.solflare.isSolflare ? window.solflare : null },
    { id: 'backpack', name: 'Backpack', p: window.backpack && (window.backpack.solana || window.backpack) },
  ].filter(w => w.p);
  let WAL = null;
  async function connect() {
    const ws = wallets();
    if (!ws.length) { toast('No Solana wallet found in this browser'); return null; }
    const w = ws[0];
    try { const r = await w.p.connect(); const pk = (r && r.publicKey) || w.p.publicKey; WAL = { ...w, pk: pk.toString() }; try { localStorage.setItem('vrsus:w', w.id); } catch {} paintWallet(); return WAL; }
    catch { toast('Wallet connection was cancelled'); return null; }
  }
  function paintWallet() { $$('[data-connect]').forEach(b => { b.innerHTML = WAL ? '<span class="p">●</span> ' + short(WAL.pk) : 'connect'; }); }
  document.addEventListener('click', e => { const b = e.target.closest('[data-connect]'); if (b) { e.preventDefault(); if (WAL) { copy(WAL.pk, 'Address copied'); } else connect(); } });
  (async () => { try { const id = localStorage.getItem('vrsus:w'); const w = wallets().find(x => x.id === id); if (w) { const r = await w.p.connect({ onlyIfTrusted: true }); const pk = (r && r.publicKey) || w.p.publicKey; if (pk) { WAL = { ...w, pk: pk.toString() }; paintWallet(); } } } catch {} })();

  // ---------- motion: staggered pop-in, count-ups, flashes, filling bars (all skipped under reduced motion) ----------
  const RM = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function stagger(el, sel, step = 45) {
    if (!el) return; const kids = sel ? $$(sel, el) : [...el.children];
    kids.forEach((k, i) => { k.style.setProperty('--i', Math.min(i, 14)); k.style.setProperty('--st', step + 'ms'); k.classList.remove('pop'); void k.offsetWidth; k.classList.add('pop'); });
  }
  function countUp(el, to, fmt, ms = 700) {
    if (!el || !isFinite(to)) return; if (RM()) { el.textContent = fmt(to); return; }
    const from = Number(el.dataset.v || 0), t0 = performance.now(); el.dataset.v = to;
    const go = t => { const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(from + (to - from) * e); if (k < 1) requestAnimationFrame(go); };
    requestAnimationFrame(go); setTimeout(() => { el.textContent = fmt(to); }, ms + 200);
  }
  function flash(el, up) { if (!el || RM()) return; el.classList.remove('fl-up', 'fl-dn'); void el.offsetWidth; el.classList.add(up ? 'fl-up' : 'fl-dn'); }
  // fill [#####-----] bars from empty, one cell at a time
  function fillBars(root) {
    if (!root) return; const bars = $$('[data-fill]', root);
    bars.forEach((b, j) => {
      const n = +b.dataset.fill, W = +b.dataset.w || 20;
      const draw = k => { b.innerHTML = '[' + '#'.repeat(k) + '<span class="dim">' + '-'.repeat(W - k) + '</span>]'; };
      if (RM()) return draw(n);
      draw(0); let k = 0; const t0 = performance.now() + j * 60;
      const go = t => { if (t < t0) return requestAnimationFrame(go); const want = Math.min(n, Math.floor((t - t0) / 28)); if (want !== k) { k = want; draw(k); } if (k < n) requestAnimationFrame(go); };
      requestAnimationFrame(go);
    });
  }
  // swap a block's content with a quick fade so tabs and refreshes never jump
  function swap(el, html, after) {
    if (!el) return; if (RM() || !el.innerHTML.trim()) { el.innerHTML = html; after && after(); return; }
    el.classList.add('fading'); setTimeout(() => { el.innerHTML = html; el.classList.remove('fading'); after && after(); }, 160);
  }


  // ---------- the living background: green trails on the YES half, red on the NO half, sparks and pings ----------
  function background() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || document.getElementById('bg')) return;
    const cv = document.createElement('canvas'); cv.id = 'bg'; cv.setAttribute('aria-hidden', 'true'); document.body.prepend(cv);
    const x = cv.getContext('2d'); let W = 0, H = 0, dpr = 1, CW = 8.4, CH = 17, cols = 0, rows = 0;
    const CH_TRAIL = '.:-=+*#', CH_SPARK = '.,:;+*o#%$@', CH_PING = ['.', '·', ':', '+'];
    const INK = '200,214,206', PALE = '70,88,80', GREEN = '79,191,124', RED = '255,107,74', PG = '58,110,82', PR = '128,66,52', ACC = ['255,107,74', '79,191,124', '79,191,124', '255,107,74', '230,169,61'];
    let trails = [], sparks = [], pings = [], mouse = [];
    function size() {
      dpr = Math.min(1.5, devicePixelRatio || 1); W = innerWidth; H = innerHeight;
      cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
      x.setTransform(dpr, 0, 0, dpr, 0, 0); x.font = '600 13px JBM, ui-monospace, monospace'; x.textBaseline = 'top';
      cols = Math.ceil(W / CW); rows = Math.ceil(H / CH);
      const want = Math.max(8, Math.round(cols / (W < 700 ? 7 : 9)));
      trails = Array.from({ length: want }, () => newTrail(true));
    }
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pick = s => s[Math.floor(Math.random() * s.length)];
    function newTrail(anywhere) { return { c: Math.floor(Math.random() * cols), y: anywhere ? rnd(-rows, rows) : rnd(-20, -2), v: rnd(.12, .42), len: Math.floor(rnd(5, 15)), ch: [] }; }
    function ping() {
      // somewhere on the page, something just happened: a ring of dots spreads out and fades
      pings.push({ x: rnd(.05, .95) * W, y: rnd(.08, .92) * H, r: 0, max: rnd(70, 170), c: pick(ACC), born: performance.now() });
      if (pings.length > 6) pings.shift();
    }
    addEventListener('resize', size); size();
    addEventListener('pointermove', e => { if (e.pointerType === 'touch') return; if (Math.random() < .5) mouse.push({ c: Math.floor(e.clientX / CW), r: Math.floor(e.clientY / CH), life: 26, ch: pick(CH_SPARK) }); if (mouse.length > 40) mouse.shift(); }, { passive: true });
    let last = 0, lastPing = 0;
    function frame(t) {
      requestAnimationFrame(frame);
      if (document.hidden || t - last < 42) return; last = t;
      x.clearRect(0, 0, W, H);
      // trails fall down their column, bright head, fading tail
      for (const tr of trails) {
        tr.y += tr.v; if (Math.random() < .08 || tr.ch.length < tr.len) tr.ch.unshift(pick(CH_TRAIL)); tr.ch.length = Math.min(tr.ch.length, tr.len);
        for (let i = 0; i < tr.ch.length; i++) {
          const ry = Math.floor(tr.y) - i; if (ry < 0 || ry > rows) continue;
          const a = i === 0 ? .62 : .5 * (1 - i / tr.len);
          x.fillStyle = `rgba(${i === 0 ? (tr.c * CW < W / 2 ? GREEN : RED) : (tr.c * CW < W / 2 ? PG : PR)},${a})`; x.fillText(tr.ch[i], tr.c * CW, ry * CH);
        }
        if (tr.y - tr.len > rows) Object.assign(tr, newTrail(false));
      }
      // sparks: single cells that re-roll their character and die
      if (sparks.length < Math.round(cols * rows / 170)) sparks.push({ c: Math.floor(Math.random() * cols), r: Math.floor(Math.random() * rows), life: Math.floor(rnd(8, 54)), ch: pick(CH_SPARK) });
      sparks = sparks.filter(s => s.life-- > 0);
      for (const s of sparks) { if (Math.random() < .3) s.ch = pick(CH_SPARK); x.fillStyle = `rgba(${INK},${Math.min(.22, s.life / 90)})`; x.fillText(s.ch, s.c * CW, s.r * CH); }
      // pings: rings snapped to the character grid
      if (t - lastPing > 1100) { lastPing = t; ping(); }
      pings = pings.filter(p => (t - p.born) < 2600 && t >= p.born);
      for (const p of pings) {
        const k = (t - p.born) / 2600, r = p.max * (1 - Math.pow(1 - k, 3)), a = .62 * (1 - k);
        const n = Math.max(8, Math.floor(r / 6)), seen = new Set();
        x.fillStyle = `rgba(${p.c},${a})`;
        for (let i = 0; i < n; i++) {
          const ang = i / n * Math.PI * 2, cx = Math.round((p.x + Math.cos(ang) * r) / CW), cy = Math.round((p.y + Math.sin(ang) * r * .55) / CH);
          const key = cx + ':' + cy; if (seen.has(key)) continue; seen.add(key);
          x.fillText(CH_PING[(i + Math.max(0, Math.floor(k * 8))) % CH_PING.length], cx * CW, cy * CH);
        }
        if (k < .35) { x.fillStyle = `rgba(${p.c},${.7 * (1 - k / .35)})`; x.fillText('@', Math.round(p.x / CW) * CW, Math.round(p.y / CH) * CH); }
      }
      // the cursor leaves a short wake
      mouse = mouse.filter(m => m.life-- > 0);
      for (const m of mouse) { x.fillStyle = `rgba(${GREEN},${m.life / 60})`; x.fillText(m.ch, m.c * CW, m.r * CH); }
    }
    requestAnimationFrame(frame);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', background); else background();

  // nudge the engine: every visit helps keep it awake (the server allows one pass a minute)
  function nudge() { try { if (!sessionStorage.getItem('vrsus:n')) { sessionStorage.setItem('vrsus:n', '1'); fetch('/api/tick', { keepalive: true }).catch(() => {}); } } catch {} }

  // reveal on scroll, with a sweep so anchor jumps never leave sections hidden
  function reveal() {
    const els = $$('.rv'); if (!('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('vis')); return; }
    const io = new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting) { x.target.classList.add('vis'); io.unobserve(x.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: .04 });
    els.forEach(e => io.observe(e));
    const sweep = () => els.forEach(e => { if (e.getBoundingClientRect().top < innerHeight) e.classList.add('vis'); });
    addEventListener('hashchange', sweep); addEventListener('scroll', sweep, { passive: true }); setTimeout(sweep, 60);
  }
  function typePrompt(el, text) {
    if (!el) return; const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.innerHTML = '<span class="gt">&gt;</span><span class="tx"></span><span class="cur u"></span>';
    const tx = $('.tx', el); if (reduce) { tx.textContent = text; return; }
    let i = 0; const go = () => { tx.textContent = text.slice(0, ++i); if (i < text.length) setTimeout(go, 26 + Math.random() * 40); }; setTimeout(go, 300);
  }
  // the official-token strip (both states)
  function caStrip(el) {
    if (!el) return;
    if (CONFIG.ca) el.innerHTML = `<span class="k">$VRSUS</span><code>${esc(CONFIG.ca)}</code><span class="r"><a class="br sm" href="#" data-copy="${esc(CONFIG.ca)}" data-what="Contract copied">copy</a><a class="br sm" href="https://pump.fun/coin/${esc(CONFIG.ca)}" target="_blank" rel="noopener">pump.fun</a><a class="br sm" href="https://dexscreener.com/solana/${esc(CONFIG.ca)}" target="_blank" rel="noopener">chart</a>${CONFIG.x ? `<a class="br sm" href="${esc(CONFIG.x)}" target="_blank" rel="noopener">x</a>` : ''}</span><span></span><span class="dim">anything else posted as $VRSUS is not ours.</span>`;
    else if (CONFIG.x) el.innerHTML = `<span class="k">$VRSUS</span><span><a class="u" href="${esc(CONFIG.x)}" target="_blank" rel="noopener">x</a></span>`;
    else el.remove();
  }

  const day = t => t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—';
  const num = n => n == null ? '—' : Number(n).toLocaleString('en-US');

  // ---------- the status cell in the tape: the engine's last pass and the chain's slot, both read live ----------
  let CHAIN = null, STATS = null;
  const chainSubs = [], statSubs = [];
  async function pollChain() {
    if (document.hidden) return;
    const c = await api('/api/events?op=chain');
    if (c && c.ok) { const prev = CHAIN; CHAIN = c; const el = $('#sysS'); if (el) el.textContent = num(c.slot); chainSubs.forEach(f => f(c, prev)); }
    const d = $('#sysDot'); if (d) d.classList.toggle('off', !(c && c.ok));
  }
  async function pollStats() {
    if (document.hidden) return;
    const s = await api('/api/duels?op=stats');
    if (s && s.ok) { STATS = s; statSubs.forEach(f => f(s)); }
    paintEngine();
  }
  function paintEngine() { const el = $('#sysE'); if (el) el.textContent = STATS && STATS.lastTick ? ago(STATS.lastTick) : STATS && STATS.offline ? 'offline' : '—'; }
  function startSys() { if (!$('#sys')) return; pollChain(); pollStats(); setInterval(pollChain, 5000); setInterval(pollStats, 20000); setInterval(paintEngine, 1000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startSys); else startSys();

  // ---------- hashing and the chain, from the browser ----------
  async function sha(s) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join(''); }
  // read the chain without vrsus in the middle when the RPC allows browsers; otherwise vrsus's read-only relay (and it says which)
  const PUBLIC_RPC = 'https://solana-rpc.publicnode.com';
  async function rpc(method, params) {
    try {
      const r = await fetch(PUBLIC_RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(7000) });
      const j = await r.json(); if (j && 'result' in j) return { result: j.result, via: 'publicnode' };
    } catch {}
    const j = await post('/api/events?op=rpc', { method, params });
    return { result: j && j.result !== undefined ? j.result : null, via: 'vrsus relay', error: j && (j.error && (j.error.message || j.error)) };
  }

  // ---------- an ASCII chart: series of {at, v} on one grid, two series can overlap ----------
  // opts: { w, h, min, max, fmt, series: [{ pts, ch, cls }], hline: { v, ch, cls } }
  function plot(opts) {
    const W = opts.w || 72, Hh = opts.h || 12, all = opts.series.flatMap(s => s.pts.map(p => p.v)).concat(opts.hline ? [opts.hline.v] : []).filter(v => v != null && isFinite(v));
    if (!all.length) return '';
    let lo = opts.min != null ? opts.min : Math.min(...all), hi = opts.max != null ? opts.max : Math.max(...all);
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * .06; if (opts.min == null) lo -= pad; if (opts.max == null) hi += pad;
    const t0 = Math.min(...opts.series.flatMap(s => s.pts.map(p => +new Date(p.at)))), t1 = Math.max(...opts.series.flatMap(s => s.pts.map(p => +new Date(p.at))));
    const grid = Array.from({ length: Hh }, () => Array(W).fill(null));
    const rowOf = v => Math.max(0, Math.min(Hh - 1, Math.round((hi - v) / (hi - lo) * (Hh - 1))));
    const colOf = t => t1 > t0 ? Math.round((t - t0) / (t1 - t0) * (W - 1)) : W - 1;
    if (opts.hline) { const r = rowOf(opts.hline.v); for (let c = 0; c < W; c++) if (c % 2 === 0) grid[r][c] = { ch: opts.hline.ch || '-', cls: opts.hline.cls || 'ln2' }; }
    const put = (r, c, ch, cls) => { const g = grid[r][c]; grid[r][c] = g && g.cls !== 'ln2' && g.cls !== cls ? { ch: '@', cls: 'ab' } : { ch, cls }; };
    opts.series.forEach(s => {
      const pts = s.pts.filter(p => p.v != null && isFinite(p.v)).map(p => ({ c: colOf(+new Date(p.at)), v: p.v })).sort((a, b) => a.c - b.c);
      if (!pts.length) return;
      const val = Array(W).fill(null);
      for (let i = 0; i < pts.length; i++) { val[pts[i].c] = pts[i].v; if (i) { const a = pts[i - 1], b = pts[i]; for (let c = a.c + 1; c < b.c; c++) val[c] = a.v + (b.v - a.v) * (c - a.c) / (b.c - a.c); } }
      let prev = null;
      for (let c = 0; c < W; c++) {
        if (val[c] == null) { prev = null; continue; }
        const r = rowOf(val[c]);
        if (prev != null && Math.abs(prev - r) > 1) for (let k = Math.min(prev, r) + 1; k < Math.max(prev, r); k++) put(k, c, ':', s.cls);
        put(r, c, s.ch, s.cls); prev = r;
      }
    });
    const fmt = opts.fmt || (v => v.toFixed(1)), lab = r => fmt(hi - (hi - lo) * r / (Hh - 1)), LW = Math.max(...[0, Hh - 1, Math.floor(Hh / 2)].map(r => lab(r).length));
    let out = '';
    for (let r = 0; r < Hh; r++) {
      const l = r === 0 || r === Hh - 1 || r === Math.floor(Hh / 2) ? lab(r).padStart(LW) : ' '.repeat(LW);
      out += `<span class="ax">${esc(l)} |</span>` + grid[r].map(g => g ? `<span class="${g.cls}">${esc(g.ch)}</span>` : ' ').join('') + '\n';
    }
    const tl = t => new Date(t).toISOString().slice(5, 16).replace('T', ' ');
    out += `<span class="ax">${' '.repeat(LW)} +${'-'.repeat(W)}</span>\n<span class="ax">${' '.repeat(LW + 2)}${tl(t0).padEnd(W - 11)}${tl(t1)}</span>`;
    return out;
  }
  window.VR = { num, sha, rpc, plot, chain: () => CHAIN, stats: () => STATS, onChain: f => chainSubs.push(f), onStats: f => statSubs.push(f), pollStats, stagger, countUp, flash, fillBars, swap, $, $$, esc, api, post, usd, pct, sol, ago, hhmm, short, tx, acct, toast, copy, tape, coinArt, tug, stateChip, kindName, srcName, day, connect, wallet: () => WAL, wallets, nudge, reveal, typePrompt, caStrip, CONFIG };
})();
