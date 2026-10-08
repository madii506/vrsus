/* vrsus pairing: a real event → a YES coin and a NO coin → one deposit → the engine creates both from one wallet */
(function () {
  const { $, $$, esc, api, post, sol, toast, short, day, usd } = VR;
  const V = window.VS;
  VR.typePrompt($('#prompt'), 'pair an event'); VR.tape(); VR.nudge();
  VR.coinArt($('#pvY'), 'yes'); VR.coinArt($('#pvN'), 'no');

  let CFG = { createSol: 0.03, reserveSol: 0.015, minDev: 0.01, maxDev: 5, feeBps: 500, open: true };
  api('/api/pair?op=config').then(c => { if (c && c.ok) { CFG = c; costs(); } });

  // ---------- 01 the event ----------
  let kind = 'pm', sub = 'politics', EV = null;
  const cache = {}; let LIST = [], PRICES = null;
  function subs() {
    const list = kind === 'pm' ? V.CATS.map(c => [c.id, c.name]) : kind === 'game' ? V.LEAGUES.map(l => [l.id, l.name]) : [];
    $('#kSub').innerHTML = list.map(([id, n]) => `<button class="br sm${id === sub ? ' on' : ''}" type="button" data-sub="${id}">${esc(n)}</button>`).join('');
  }
  const optHtml = (i, q, o, w, on) => `<div class="opt${on ? ' on' : ''}" data-i="${i}" role="radio" aria-checked="${on}" tabindex="0"><span class="q">${esc(q)}</span><span class="o">${o}</span><span class="w">${w}</span></div>`;
  async function body() {
    subs();
    if (kind === 'price') return priceBuilder();
    const key = kind + ':' + sub;
    if (!cache[key]) { $('#kBody').innerHTML = '<div class="empty">reading the source…</div>'; cache[key] = await api(kind === 'pm' ? '/api/events?op=world&cat=' + sub : '/api/events?op=sports&league=' + sub); }
    if (key !== kind + ':' + sub) return;
    const r = cache[key];
    if (!r || !r.ok) { delete cache[key]; $('#kBody').innerHTML = '<div class="empty"><span class="off">the source didn’t answer · try again in a minute</span></div>'; return; }
    if (kind === 'pm') {
      LIST = r.markets.map(m => ({ kind: 'pm', market: { id: m.id, q: m.q, slug: m.slug, cat: m.cat }, _o: `YES ${m.yes}%`, _w: `ends ${day(m.end)} · polymarket` }));
    } else {
      LIST = r.games.map(g => ({ kind: 'game', league: g.league, gameId: g.gameId, home: g.home, away: g.away, date: g.date, link: g.link, _o: day(g.date), _w: `${g.away.name} at ${g.home.name} · ${g.leagueName} · espn` }));
    }
    if (!LIST.length) { $('#kBody').innerHTML = `<div class="empty">Nothing open here right now${kind === 'game' ? ' (no games in the next 7 days)' : ''}. Try another tab.</div>`; return; }
    $('#kBody').innerHTML = `<div class="evpick" role="radiogroup">${LIST.map((e, i) => optHtml(i, V.describe(e).q, e._o, e._w, EV && same(EV, e))).join('')}</div>`;
  }
  const same = (a, b) => a.kind === b.kind && (a.kind === 'pm' ? a.market.id === b.market.id : a.kind === 'game' ? a.gameId === b.gameId : false);
  function priceBuilder() {
    const go = async () => {
      if (!PRICES) { const r = await api('/api/events?op=price'); PRICES = r && r.ok ? r.prices : []; }
      const asset = (EV && EV.kind === 'price' && EV.asset) || 'SOL', p = PRICES.find(x => x.asset === asset);
      $('#kBody').innerHTML = `<div class="pbuild">Will <select id="pA">${V.ASSETS.map(a => `<option${a === asset ? ' selected' : ''}>${a}</option>`).join('')}</select> be
        <select id="pO"><option value="above">above</option><option value="below">below</option></select> $<input id="pV" class="num" type="number" step="any" min="0" style="width:110px">
        at <select id="pH">${V.HORIZONS.map(h => `<option value="${h}"${h === 24 ? ' selected' : ''}>${h < 24 ? h + 'h' : h / 24 + 'd'} from now</option>`).join('')}</select>?</div>
        <div class="dim" id="pNow" style="margin-top:10px;font-size:12.5px"></div>
        <button class="br" type="button" id="pUse" style="margin-top:10px">use this price duel</button>`;
      const fill = () => { const a = $('#pA').value, q = PRICES.find(x => x.asset === a);
        $('#pNow').innerHTML = q && q.ok ? `${a} is <b>${usd(q.price)}</b> on Coinbase right now. The line has to be within half and double of that. The duel settles on the close of the one-minute candle at the time you pick (rounded up to the next full hour).` : `<span class="off">Coinbase didn’t answer</span>`;
        if (q && q.ok && !$('#pV').value) { const step = q.price > 10000 ? 1000 : q.price > 1000 ? 50 : 5; $('#pV').value = Math.ceil(q.price * 1.03 / step) * step; } };
      $('#pA').addEventListener('change', () => { $('#pV').value = ''; fill(); }); fill();
      if (EV && EV.kind === 'price') { $('#pO').value = EV.op; $('#pV').value = EV.value; }
      $('#pUse').addEventListener('click', () => {
        const h = Number($('#pH').value), t = new Date(Date.now() + h * 36e5); t.setUTCMinutes(0, 0, 0); t.setUTCHours(t.getUTCHours() + 1);
        choose({ kind: 'price', asset: $('#pA').value, op: $('#pO').value, value: Number($('#pV').value), at: t.toISOString() });
      });
    };
    go();
  }
  function choose(e) {
    try { e = { ...V.normalizeEvent(e), ...(e._w ? {} : {}) }; } catch (x) { toast(x.message); return; }
    EV = e; const D = V.describe(e);
    $('#chosen').hidden = false;
    $('#chosen').innerHTML = `<span class="dim">the duel</span><span class="q">${esc(D.q)}</span><span class="rl">${esc(D.rule)}</span><span class="rl"><a class="u" href="${esc(D.src)}" target="_blank" rel="noopener">${VR.srcName(e.kind)}</a> · <a class="u" href="#" id="readNow">read the source now</a> <span id="readOut"></span></span>`;
    $('#readNow').addEventListener('click', async ev => { ev.preventDefault(); $('#readOut').textContent = 'reading…'; const r = await post('/api/events?op=read', { event: EV }); $('#readOut').innerHTML = r && r.ok ? `→ <b>${esc(r.reading.text)}</b>` : '<span class="off">the source didn’t answer</span>'; });
    $$('#kBody .opt').forEach((o, i) => { const on = LIST[i] && same(LIST[i], e); o.classList.toggle('on', !!on); o.setAttribute('aria-checked', !!on); });
    suggest(); book();
  }
  $('#kBody').addEventListener('click', e => { const o = e.target.closest('.opt'); if (o) choose(LIST[+o.dataset.i]); });
  $('#kBody').addEventListener('keydown', e => { const o = e.target.closest('.opt'); if (o && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); choose(LIST[+o.dataset.i]); } });
  $('#kTabs').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; kind = b.dataset.k; sub = kind === 'pm' ? 'politics' : kind === 'game' ? 'nba' : ''; $$('#kTabs .br').forEach(x => x.classList.toggle('on', x === b)); body(); });
  $('#kSub').addEventListener('click', e => { const b = e.target.closest('[data-sub]'); if (!b) return; sub = b.dataset.sub; body(); });

  // ---------- 02 the two coins ----------
  const STOP = new Set(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'announce', 'approval', 'called', 'release', 'released', 'will', 'the', 'be', 'a', 'an', 'by', 'of', 'in', 'on', 'at', 'to', 'and', 'or', 'for', 'before', 'after', 'end', 'than', 'above', 'below', 'win', 'beat', 'is', 'are', 'it', 'its', 'this', 'that', 'with', 'from', 'yes', 'no']);
  let touched = { yName: 0, ySym: 0, nName: 0, nSym: 0 };
  ['yName', 'ySym', 'nName', 'nSym'].forEach(id => $('#' + id).addEventListener('input', () => { touched[id] = 1; book(); }));
  function suggest() {
    if (!EV) return;
    let word;
    if (EV.kind === 'price') word = EV.asset + (EV.op === 'above' ? 'UP' : 'DN');
    else if (EV.kind === 'game') word = (EV.home.name.split(' ').pop() || 'HOME').replace(/[^A-Za-z0-9]/g, '');
    else { const ws = V.describe(EV).q.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w.toLowerCase()) && !/^\d+$/.test(w)); word = (ws.sort((a, b) => b.length - a.length)[0] || 'EVENT'); }
    word = word.toUpperCase().slice(0, 7);
    const short = V.describe(EV).q.replace(/^Will /, '').replace(/\?$/, '');
    if (!touched.ySym) $('#ySym').value = word + 'YES'.slice(0, 10 - word.length);
    if (!touched.nSym) $('#nSym').value = word + 'NO';
    const fit = t => { let o = ''; for (const ch of t) { if (new TextEncoder().encode(o + ch).length > 32) break; o += ch; } return o.trim(); };
    if (!touched.yName) $('#yName').value = fit('yes: ' + short);
    if (!touched.nName) $('#nName').value = fit('no: ' + short);
    ['yes', 'no'].forEach(s => { if (!IMG[s] || IMG[s].drawn) draw(s); });
  }
  const IMG = { yes: null, no: null };
  function setImg(side, c, drawn) { IMG[side] = { url: c.toDataURL('image/jpeg', .9), drawn }; $(side === 'yes' ? '#yDrop' : '#nDrop').innerHTML = `<img src="${IMG[side].url}" alt="${side} coin picture">`; }
  ['yes', 'no'].forEach(side => {
    const inp = $(side === 'yes' ? '#yImg' : '#nImg');
    inp.addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return; if (f.size > 8 * 1024 * 1024) { toast('That picture is over 8 MB'); return; }
      const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
        const s = Math.max(512 / im.width, 512 / im.height), w = im.width * s, h = im.height * s; x.fillStyle = '#0a0c0b'; x.fillRect(0, 0, 512, 512); x.drawImage(im, (512 - w) / 2, (512 - h) / 2, w, h);
        setImg(side, c, false); URL.revokeObjectURL(im.src); };
      im.onerror = () => toast('That picture couldn’t be read'); im.src = URL.createObjectURL(f);
    });
  });
  // the coin picture, drawn: the same lit ASCII coin as the site, green or red, with the ticker under it
  async function draw(side) {
    try { await document.fonts.load('700 20px JBM'); } catch {}
    const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
    x.fillStyle = '#0a0c0b'; x.fillRect(0, 0, 512, 512);
    x.fillStyle = '#1d2421'; for (let i = 16; i < 512; i += 32) for (let j = 16; j < 512; j += 32) x.fillRect(i - 1, j - 1, 2, 2);
    const pre = document.createElement('pre'); VR.coinArt(pre, side, { still: true });
    const lines = pre.innerHTML.split('\n'); const px = 15.5, cw = px * .6, rows = lines.length - 1, colsN = 41;
    const ox = (512 - colsN * cw) / 2, oy = 54;
    const css = getComputedStyle(document.body); const tmp = document.createElement('span'); document.body.appendChild(tmp);
    const colorOf = cls => { tmp.className = cls; return getComputedStyle(tmp).color; };
    x.font = `700 ${px}px JBM, monospace`; x.textBaseline = 'top';
    lines.forEach((ln, r) => { let col = 0; const d = document.createElement('div'); d.innerHTML = ln; d.childNodes.forEach(n => { const t = n.textContent, cl = n.nodeType === 1 ? n.className : null; if (cl) x.fillStyle = colorOf(cl); for (const ch of t) { if (cl && ch !== ' ') x.fillText(ch, ox + col * cw, oy + r * px); col++; } }); });
    tmp.remove();
    const sym = ($(side === 'yes' ? '#ySym' : '#nSym').value.trim() || side.toUpperCase()).toUpperCase().replace(/^\$/, '');
    x.textAlign = 'center'; x.textBaseline = 'middle'; let fs = 40; x.font = `800 ${fs}px JBM, monospace`; while (x.measureText('$' + sym).width > 440 && fs > 18) { fs -= 2; x.font = `800 ${fs}px JBM, monospace`; }
    x.fillStyle = side === 'yes' ? '#4fbf7c' : '#ff6b4a'; x.fillText('$' + sym, 256, 445);
    setImg(side, c, true);
  }
  $$('[data-draw]').forEach(b => b.addEventListener('click', () => draw(b.dataset.draw)));
  ['#ySym', '#nSym'].forEach(s => $(s).addEventListener('change', () => { const side = s === '#ySym' ? 'yes' : 'no'; if (IMG[side] && IMG[side].drawn) draw(side); }));

  // ---------- the preview + costs ----------
  async function sha(s) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join(''); }
  let bt = null;
  function book() {
    clearTimeout(bt); bt = setTimeout(async () => {
      if (!EV) { $('#book').innerHTML = '<span class="cm"># pick an event</span>'; return; }
      const D = V.describe(EV), y = { name: $('#yName').value.trim(), symbol: $('#ySym').value.trim().toUpperCase() }, n = { name: $('#nName').value.trim(), symbol: $('#nSym').value.trim().toUpperCase() };
      const fp = window.crypto && crypto.subtle ? (await sha(V.canon(EV, y, n))).slice(0, 12) : '';
      $('#fp').textContent = fp ? 'fingerprint ' + fp : '';
      $('#book').innerHTML = [`<span class="cm"># ${esc(VR.kindName(EV.kind))} · settles on ${esc(VR.srcName(EV.kind))}</span>`, `<span class="kw">event</span> <span class="st">"${esc(D.q)}"</span>`,
        `<span class="kw">yes</span>   <span class="yes">$${esc(y.symbol || '…')}</span> ${esc(y.name)}`, `<span class="kw">no</span>    <span class="no">$${esc(n.symbol || '…')}</span> ${esc(n.name)}`,
        `<span class="kw">pot</span>   both coins' creator fees, one wallet`, `<span class="kw">wins</span>  <span class="cm">${esc(D.rule)}</span>`].join('\n');
    }, 80);
  }
  function costs() {
    const dy = Number($('#yDev').value), dn = Number($('#nDev').value); $('#yDevV').textContent = dy.toFixed(2); $('#nDevV').textContent = dn.toFixed(2);
    const need = Math.ceil((2 * CFG.createSol + (dy + dn) * 1.02 + CFG.reserveSol) * 1000) / 1000;
    $('#costs').innerHTML = `<tr><td><span class="yes">YES</span> first buy (+2% for fees and slippage)</td><td>${(dy * 1.02).toFixed(4)} SOL</td></tr>
      <tr><td><span class="no">NO</span> first buy (+2% for fees and slippage)</td><td>${(dn * 1.02).toFixed(4)} SOL</td></tr>
      <tr><td>pump.fun rent and fees for two new coins (unused part comes back)</td><td>${(2 * CFG.createSol).toFixed(3)} SOL</td></tr>
      <tr><td>gas reserve kept in the duel’s wallet (it pays for the payouts)</td><td>${CFG.reserveSol.toFixed(3)} SOL</td></tr>
      <tr class="t"><td>one deposit</td><td>${need.toFixed(3)} SOL</td></tr>`;
  }
  ['#yDev', '#nDev'].forEach(s => $(s).addEventListener('input', costs)); costs();
  setInterval(() => { const w = VR.wallet(); if (w && !$('#fWal').value) $('#fWal').value = w.pk; }, 600);

  // ---------- 04 pair it: record, one deposit, the engine does the rest ----------
  const err = m => { const e = $('#err'); e.textContent = m; e.hidden = !m; if (m) e.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
  const STEPS = [['rec', 'duel recorded'], ['dep', 'deposit received'], ['make', 'both coins created on pump.fun'], ['back', 'first buys sent back to you'], ['live', 'the engine is reading the source']];
  function prog(state) {
    const bad = ['failed', 'refunded', 'expired'].includes(state), at = { waiting: 1, creating: 2, live: 5 }[state] || 1;
    $('#prog').innerHTML = STEPS.map(([k, t], i) => `<div class="s ${bad ? (i === 0 ? 'ok' : i === 1 ? 'bad' : '') : i < at ? 'ok' : i === at ? 'on' : ''}">${esc(t)}</div>`).join('');
  }
  let P = null, poll = null;
  async function sendDeposit() {
    const w = VR.wallet() || await VR.connect(); if (!w || !P) return;
    try {
      if (!window.solanaWeb3) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = '/assets/js/web3.min.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
      const { Transaction, SystemProgram, PublicKey } = window.solanaWeb3;
      const bh = await api('/api/pair?op=blockhash'); if (!bh || !bh.ok) throw new Error('Solana didn’t answer. Try again.');
      const from = new PublicKey(w.pk);
      const tx = new Transaction({ feePayer: from, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }).add(SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(P.wallet), lamports: P.need }));
      $('#depMsg').textContent = 'approve the transfer in your wallet…';
      let sig = null;
      if (w.p.signAndSendTransaction) { const r = await w.p.signAndSendTransaction(tx); sig = r && (r.signature || r); }
      else { const s = await w.p.signTransaction(tx); const r = await post('/api/pair?op=relay', { tx: btoa(String.fromCharCode(...s.serialize())) }); if (!r.ok) throw new Error(r.error); sig = r.sig; }
      $('#depMsg').innerHTML = `sent: <a class="u" href="${VR.tx(String(sig))}" target="_blank" rel="noopener">${esc(short(String(sig)))}</a>. waiting for it to land…`;
    } catch (e) { $('#depMsg').innerHTML = `<span class="red">${esc((e && e.message) || 'The transfer was cancelled.')}</span> You can also send it from any wallet.`; }
  }
  function depositBox(d) {
    $('#dep').innerHTML = `<div class="box"><div class="bd">
      <div style="margin-bottom:8px">send exactly <b>${d.needSol} SOL</b> to the duel’s wallet:</div>
      <div class="addr"><code>${esc(d.wallet)}</code><button class="br sm" type="button" data-copy="${esc(d.wallet)}" data-what="Wallet copied">copy</button><button class="br sm" type="button" data-copy="${d.needSol}" data-what="Amount copied">copy amount</button></div>
      <div class="cta" style="margin-top:12px"><button class="btn" type="button" id="sendDep">send it with my wallet <span class="k">-&gt;</span></button></div>
      <div id="depMsg" class="dim" style="margin-top:10px;font-size:12.5px">this page checks every few seconds. the engine also checks, so you can close it once the transfer is sent.</div>
      <div class="dim" style="margin-top:8px;font-size:12px">the coins will be <span class="yes">${esc(d.yes)}</span> and <span class="no">${esc(d.no)}</span>. a duel that isn’t funded within 3 hours is cancelled and anything sent is returned.</div></div></div>`;
    $('#sendDep').addEventListener('click', sendDeposit);
  }
  function done(d) {
    clearInterval(poll); try { localStorage.removeItem('vrsus:pair'); } catch {}
    $('#dep').innerHTML = `<div class="msg ok"><b>the duel is live:</b> <span class="yes">$${esc(d.symYes)}</span> vs <span class="no">$${esc(d.symNo)}</span>. the engine reads the source every minute.
      <div class="cta" style="margin-top:10px"><a class="btn" href="/duel?id=${esc(d.id)}">open the duel <span class="k">-&gt;</span></a><a class="br" href="https://pump.fun/coin/${esc(d.yes)}" target="_blank" rel="noopener">yes on pump.fun</a><a class="br" href="https://pump.fun/coin/${esc(d.no)}" target="_blank" rel="noopener">no on pump.fun</a></div></div>`;
  }
  async function check() {
    if (!P) return;
    const d = await api('/api/pair?op=status&id=' + encodeURIComponent(P.id)); if (!d || !d.ok) return;
    prog(d.state);
    if (d.state === 'waiting' && !$('#sendDep')) depositBox({ ...P, ...d });
    if (d.state === 'waiting' && d.balance != null && d.balance > 0 && $('#depMsg')) $('#depMsg').textContent = `${(d.balance / 1e9).toFixed(4)} of ${d.needSol} SOL arrived.`;
    if (d.state === 'creating') $('#dep').innerHTML = `<div class="msg ok">deposit in. creating both coins on pump.fun…${d.err ? ' (retrying: ' + esc(d.err.slice(0, 120)) + ')' : ''}</div>`;
    if (d.state === 'live') done(d);
    if (['failed', 'expired', 'refunded'].includes(d.state)) { clearInterval(poll); try { localStorage.removeItem('vrsus:pair'); } catch {}
      $('#dep').innerHTML = `<div class="msg">the duel ${d.state === 'expired' ? 'expired' : 'didn’t go through'}${d.err ? ': ' + esc(d.err.slice(0, 160)) : ''}. ${d.refund_sig ? `your deposit was returned: <a class="u" href="${VR.tx(d.refund_sig)}" target="_blank" rel="noopener">refund tx</a>` : 'anything you sent is being returned automatically.'}</div>`; }
  }
  function track(d) { P = d; $('#flow').hidden = false; prog('waiting'); depositBox(d); clearInterval(poll); poll = setInterval(check, 3500); check(); try { localStorage.setItem('vrsus:pair', JSON.stringify(d)); } catch {} }
  try { const s = JSON.parse(localStorage.getItem('vrsus:pair') || 'null'); if (s && s.id) { track(s); toast('Picking up your duel where it left off'); } } catch {}
  $('#go').addEventListener('click', async e => {
    err('');
    if (!EV) return err('Pick an event first.');
    const y = { name: $('#yName').value.trim(), symbol: $('#ySym').value.trim().replace(/^\$/, '').toUpperCase(), dev: Number($('#yDev').value), image: IMG.yes && IMG.yes.url };
    const n = { name: $('#nName').value.trim(), symbol: $('#nSym').value.trim().replace(/^\$/, '').toUpperCase(), dev: Number($('#nDev').value), image: IMG.no && IMG.no.url };
    for (const [c, s] of [[y, 'YES'], [n, 'NO']]) { if (!c.name) return err(`Give the ${s} coin a name.`); if (new TextEncoder().encode(c.name).length > 32) return err(`The ${s} coin's name is too long for pump.fun (32 bytes).`); if (!/^[A-Z0-9]{1,10}$/.test(c.symbol)) return err(`The ${s} ticker is 1–10 letters or numbers.`); if (!c.image) return err(`Add a picture for the ${s} coin, or draw it.`); }
    if (y.symbol === n.symbol) return err('The two coins need different tickers.');
    const launcher = $('#fWal').value.trim(); if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(launcher)) return err('Connect a wallet or paste your Solana address.');
    if (!$('#fOk').checked) return err('Tick the box to confirm you understand how the engine works.');
    const b = e.currentTarget; b.disabled = true; b.textContent = 'recording…';
    const ev = { ...EV }; delete ev._o; delete ev._w;
    const r = await post('/api/pair?op=prepare', { launcher, event: ev, yes: y, no: n });
    b.disabled = false; b.innerHTML = 'pair it <span class="k">-&gt;</span>';
    if (!r || !r.ok) return err((r && r.error) || 'The duel didn’t record. Try again.');
    track({ id: r.id, wallet: r.wallet, need: r.need, needSol: r.needSol, yes: r.yes, no: r.no, symYes: y.symbol, symNo: n.symbol });
    toast('Duel ' + r.fp + ' recorded');
  });

  // an event handed over from the home page board (#e=…)
  (function fromHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.get('e')) { try { const e = JSON.parse(decodeURIComponent(escape(atob(p.get('e'))))); kind = e.kind; sub = e.kind === 'pm' ? (e.market.cat || 'politics') : e.kind === 'game' ? e.league : ''; $$('#kTabs .br').forEach(x => x.classList.toggle('on', x.dataset.k === kind)); choose(e); } catch {} }
    body();
  })();
})();
