/* vrsus terminal: talk to the engine. Every command reads the same public endpoints the pages use,
   and every proof is recomputed here in the browser. */
(function () {
  const { $, esc, api, post, sol, ago, day, short } = VR;
  const V = window.VS;
  const out = $('#tOut'), form = $('#tForm'), inp = $('#tIn');
  if (!out || !form) return;
  const W = () => (innerWidth < 640 ? 44 : 86);
  let busy = false, booted = false;
  const hist = (() => { try { return JSON.parse(localStorage.getItem('vrsus:th') || '[]'); } catch { return []; } })();
  let hi = hist.length;
  const line = (html, cls) => { const d = document.createElement('div'); d.className = 'ln' + (cls ? ' ' + cls : ''); d.innerHTML = html; out.appendChild(d); out.scrollTop = out.scrollHeight; return d; };
  const p = (t, cls) => line(esc(t), cls);
  const pad = (s, n) => { s = String(s); return s.length >= n ? s.slice(0, n - 1) + '…' : s + ' '.repeat(n - s.length); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function type(t, cls, ms = 9) { const d = line('', cls); if (matchMedia('(prefers-reduced-motion: reduce)').matches) { d.textContent = t; return d; } for (let i = 0; i <= t.length; i += 3) { d.textContent = t.slice(0, i); await wait(ms); } d.textContent = t; out.scrollTop = out.scrollHeight; return d; }
  let DUELS = null, WIRE = null;
  async function duels(force) { if (!DUELS || force) { const r = await api('/api/duels'); DUELS = r && r.ok ? r.duels : null; } return DUELS; }
  const byN = async n => { const ds = await duels(); return ds && ds.find(d => String(d.n) === String(n).replace('#', '')); };

  const CMDS = {
    help: { a: '', d: 'every command', f: help },
    duels: { a: '[live|settled]', d: 'every duel: #, the two coins, the crowd, the pot', f: cDuels },
    duel: { a: '<#>', d: 'one duel: the rule, the source, the last reading, the pot', f: cDuel },
    read: { a: '<#>', d: 'read a duel’s source right now (what the engine settles on)', f: cRead },
    wire: { a: '[world|sports|price]', d: 'what just happened in the world, numbered', f: cWire },
    pair: { a: '<wire #>', d: 'pair a wire line into a duel', f: cPair },
    board: { a: '[war|politics|money|crypto|tech|culture]', d: 'open Polymarket markets you can pair', f: cBoard },
    verify: { a: '<#> [round]', d: 'recompute a round: snapshot hash, merkle root, every payout', f: cVerify },
    proof: { a: '<#> <round> <wallet>', d: 'a wallet’s merkle path from its leaf to the published root', f: cProof },
    chain: { a: '<#> [round]', d: 'read a round’s payout transactions back from the chain', f: cChain },
    wallet: { a: '<address>', d: 'every payout and proof for a wallet', f: cWallet },
    status: { a: '', d: 'the engine’s heartbeat and the chain', f: cStatus },
    sources: { a: '', d: 'read every source now, timed', f: cSources },
    slot: { a: '', d: 'Solana right now', f: cSlot },
    rules: { a: '', d: 'how each kind of duel settles', f: cRules },
    open: { a: '<#>', d: 'open a duel’s page', f: cOpen },
    clear: { a: '', d: 'clear the screen', f: () => { out.innerHTML = ''; } },
  };
  const ALIAS = { ls: 'duels', '?': 'help', cls: 'clear', probe: 'sources', news: 'wire', me: 'wallet' };

  function help() {
    p('commands', 'hd2');
    const sm = W() < 60;
    for (const [k, c] of Object.entries(CMDS)) line(sm ? `<span class="ok">${esc(k)}</span> <span class="am">${esc(c.a)}</span>\n  <span class="mt">${esc(c.d)}</span>` : `  <span class="ok">${esc(pad(k, 8))}</span><span class="am">${esc(pad(c.a, 26))}</span><span class="mt">${esc(c.d)}</span>`);
    p('tab completes · ↑ ↓ history · duels are numbered #1, #2, …', 'mt');
  }
  async function cDuels(arg) {
    const ds = await duels(true); if (!ds) return p('the records didn’t answer', 'er');
    const list = ds.filter(d => !arg || (arg === 'live' ? d.state === 'live' : ['settled', 'settling'].includes(d.state)));
    if (!list.length) return p(arg ? `no ${arg} duels yet` : 'no duels yet · the first one could be yours · /pair', 'mt');
    if (W() < 60) { for (const d of list) line(`#${d.n} <span class="ok">$${esc(d.yes.symbol)}</span> vs <span class="er">$${esc(d.no.symbol)}</span> · ${d.crowd == null ? '—' : d.crowd + '%'} · ${esc(sol(d.potSol))} · <span class="${d.state === 'live' ? 'am' : 'mt'}">${esc(d.state === 'live' ? 'live' : d.outcome ? d.outcome + ' won' : d.state)}</span>\n  <span class="mt">${esc(d.q)}</span>`); return; }
    line(`<span class="mt">${esc(pad('#', 5) + pad('yes', 12) + pad('no', 12) + pad('crowd', 8) + pad('pot', 13) + pad('state', 11) + 'event')}</span>`);
    for (const d of list) line(`${esc(pad('#' + d.n, 5))}<span class="ok">${esc(pad('$' + d.yes.symbol, 12))}</span><span class="er">${esc(pad('$' + d.no.symbol, 12))}</span>${esc(pad(d.crowd == null ? '—' : d.crowd + '%', 8))}${esc(pad(sol(d.potSol), 13))}<span class="${d.state === 'live' ? 'am' : 'mt'}">${esc(pad(d.state === 'live' ? 'live' : d.outcome ? d.outcome + ' won' : d.state, 11))}</span>${esc(d.q.slice(0, Math.max(20, W() - 61)))}`);
  }
  async function need(n) { if (!n) { p('which duel? e.g. duel 1 (see: duels)', 'er'); return null; } const d = await byN(n); if (!d) p(`no duel #${String(n).replace('#', '')}`, 'er'); return d; }
  async function cDuel(n) {
    const d0 = await need(n); if (!d0) return;
    const r = await api('/api/duels?id=' + d0.id); if (!r || !r.ok) return p('the duel didn’t load', 'er');
    const d = r.duel, rd = d.lastRead || {};
    p(`#${d.n} · duel ${d.fp} · ${VR.kindName(d.kind)} · settles on ${VR.srcName(d.kind)}`, 'mt');
    p(d.q, 'hd2');
    line(`<span class="ok">$${esc(d.yes.symbol)}</span> ${esc(d.yes.mint)}  mcap ${esc(VR.usd(d.yes.mcapUsd))}`);
    line(`<span class="er">$${esc(d.no.symbol)}</span> ${esc(d.no.mint)}  mcap ${esc(VR.usd(d.no.mcapUsd))}`);
    line(`crowd   ${VR.tug(d.crowd, 30)}  ${d.crowd == null ? '' : d.crowd + '% YES'}`);
    p(`rule    ${d.rule}`);
    line(`source  <a href="${esc(d.src)}" target="_blank" rel="noopener">${esc(d.src.slice(0, 80))}</a>`);
    p(`reading ${d.state === 'live' ? (rd.text || 'not read yet') + (d.lastReadAt ? ' · ' + ago(d.lastReadAt) : '') : (d.outcome === 'VOID' ? 'VOID' : d.outcome + ' WON') + ' · ' + ((d.reading && d.reading.text) || '')}`);
    p(`pot     ${sol(d.potSol)} · claimed ${sol(d.claimedSol)} · paid ${sol(d.paidSol)} · ${d.rounds || 0} round${d.rounds === 1 ? '' : 's'}`);
    line(`wallet  <a href="${VR.acct(d.wallet)}" target="_blank" rel="noopener">${esc(d.wallet)}</a>`);
    line(`<span class="mt">try:</span> read ${d.n} · ${d.rounds ? `verify ${d.n} 1 · chain ${d.n} 1 · ` : ''}open ${d.n}`);
  }
  async function cRead(n) {
    const d = await need(n); if (!d) return;
    await type(`reading ${VR.srcName(d.kind)} for #${d.n}…`, 'mt');
    const t0 = performance.now(); const r = await post('/api/events?op=read', { event: d.event }); const ms = Math.round(performance.now() - t0);
    if (!r || !r.ok) return p('the source didn’t answer', 'er');
    const x = r.reading;
    line(`${x.outcome ? `<span class="${x.outcome === 'YES' ? 'ok' : x.outcome === 'NO' ? 'er' : 'am'}">${x.outcome === 'VOID' ? 'VOID' : x.outcome + ' WINS'}</span> · ` : ''}${esc(x.text)} <span class="mt">(${ms}ms)</span>`);
    if (x.evidence) p(JSON.stringify(x.evidence, null, 2), 'mt');
    if (x.outcome) p('the engine settles it on its next pass (every minute)', 'am');
  }
  const KTAG = { new: 'NEW', move: 'MOVE', live: 'LIVE', final: 'FINAL', soon: 'SOON', px: 'PRICE' };
  async function cWire(f) {
    const r = await api('/api/events?op=wire'); if (!r || !r.ok) return p('the wire is quiet right now (the sources didn’t answer)', 'er');
    WIRE = r.items.filter(x => !f || (f === 'world' ? x.src === 'polymarket' : f === 'sports' ? x.src === 'espn' : f === 'price' ? x.src === 'coinbase' : true));
    p(`the wire · ${WIRE.length} lines · read ${VR.hhmm(r.at)}`, 'mt');
    if (W() < 60) WIRE.slice(0, 20).forEach((x, i) => line(`${i + 1}. <span class="${x.kind === 'new' ? 'am' : x.dir === 'up' ? 'ok' : x.dir === 'dn' || x.kind === 'live' ? 'er' : 'mt'}">${KTAG[x.kind]}</span> ${esc(x.head)}\n   <span class="mt">${esc(x.sub)}</span>`));
    else WIRE.slice(0, 20).forEach((x, i) => line(`${esc(pad(String(i + 1), 4))}<span class="${x.kind === 'new' ? 'am' : x.dir === 'up' ? 'ok' : x.dir === 'dn' || x.kind === 'live' ? 'er' : 'mt'}">${esc(pad(KTAG[x.kind], 7))}</span>${esc(pad(x.head, Math.max(24, W() - 40)))}<span class="mt">${esc(x.sub.slice(0, 34))}</span>`));
    p('pair <n> turns a line into a duel', 'mt');
  }
  const enc = o => encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(o)))));
  async function cPair(n) {
    if (!WIRE) { await cWire(); }
    const x = WIRE && WIRE[Number(n) - 1]; if (!x) return p('which line? e.g. pair 3 (see: wire)', 'er');
    if (!x.pair) return p('that line can’t be paired (the game has started or it is a result)', 'er');
    p(`opening the pair page with: ${x.head}`, 'ok'); setTimeout(() => { location.href = '/pair#e=' + enc(x.pair); }, 500);
  }
  async function cBoard(cat) {
    cat = cat || 'politics'; if (!V.CATS.find(c => c.id === cat)) return p('pick one: ' + V.CATS.map(c => c.id).join(' · '), 'er');
    const r = await api('/api/events?op=world&cat=' + cat); if (!r || !r.ok) return p('polymarket didn’t answer', 'er');
    for (const m of r.markets.slice(0, 12)) line(`<span class="ok">${esc(pad(m.yes + '%', 7))}</span>${esc(pad(m.q, Math.max(30, W() - 20)))}<span class="mt">${esc(day(m.end).slice(0, 10))}</span>`);
  }
  async function roundArgs(n, r) {
    const d = await need(n); if (!d) return {};
    if (!d.rounds) { p(`#${d.n} has no payout rounds yet${d.state === 'live' ? ' (it is still live)' : ''}`, 'mt'); return {}; }
    const k = Number(r || 1); if (!(k >= 1 && k <= d.rounds)) { p(`#${d.n} has rounds 1–${d.rounds}`, 'er'); return {}; }
    return { d, k };
  }
  async function cVerify(n, r) {
    const { d, k } = await roundArgs(n, r); if (!d) return;
    await type(`fetching round ${k} of #${d.n} and recomputing it here…`, 'mt');
    const v = await VP.round(d.id, k); if (!v.ok) return p(v.error, 'er');
    line(VP.lines(v).replace(/<div class="ok2">/g, '<div class="ok">').replace(/<div class="bad2">/g, '<div class="er">'));
    p(`chain ${d.n} ${k} reads the payout transactions back from Solana`, 'mt');
  }
  async function cProof(n, r, w) {
    const { d, k } = await roundArgs(n, r); if (!d) return;
    w = w || (VR.wallet() && VR.wallet().pk); if (!w) return p('which wallet? proof <#> <round> <address>', 'er');
    const v = await VP.round(d.id, k); if (!v.ok) return p(v.error, 'er');
    const pp = await VP.path(v, w); if (!pp) return p(`${short(w)} is not in round ${k}’s snapshot`, 'er');
    line(VP.tree(pp, v));
    line(pp.pay && pp.pay.sig ? `paid ${VP.S(pp.pay.lamports)} SOL · <a href="${VR.tx(pp.pay.sig)}" target="_blank" rel="noopener">${esc(short(pp.pay.sig))}</a>` : '<span class="mt">no payout sent for this leaf (under the dust line, or still pending)</span>');
  }
  async function cChain(n, r) {
    const { d, k } = await roundArgs(n, r); if (!d) return;
    const full = await api('/api/duels?id=' + d.id); const wal = full && full.duel && full.duel.wallet;
    const v = await VP.round(d.id, k); if (!v.ok) return p(v.error, 'er');
    const st = line('<span class="mt">reading transactions…</span>');
    const c = await VP.chain(v, wal, o => { st.innerHTML = `<span class="mt">read ${o.txs} of ${v.txs.length} transactions…</span>`; });
    st.innerHTML = `<span class="${c.bad.length ? 'er' : 'ok'}">${c.bad.length ? '[x]' : '[+]'} ${c.okTx} of ${c.txs} transactions landed · ${c.matched} of ${c.payouts} payouts found on chain as a transfer from the duel wallet</span> <span class="mt">via ${[...c.via].join(', ')}</span>`;
    c.bad.slice(0, 6).forEach(b => p('    ' + b, 'er'));
  }
  async function cWallet(w) {
    w = w || (VR.wallet() && VR.wallet().pk); if (!w) return p('wallet <address> (or connect one)', 'er');
    const r = await api('/api/duels?op=wallet&w=' + encodeURIComponent(w)); if (!r || !r.ok) return p((r && r.error) || 'the records didn’t answer', 'er');
    p(`${w}`, 'hd2');
    if (!r.rounds.length && !r.pays.length && !r.launched.length) return p('not in any snapshot, payout or launch on vrsus yet', 'mt');
    const got = r.pays.filter(x => x.sig).reduce((t, x) => t + x.lamports, 0);
    p(`${r.rounds.length} round${r.rounds.length === 1 ? '' : 's'} · ${r.pays.length} payout${r.pays.length === 1 ? '' : 's'} · ${VP.S(got)} SOL received · ${r.launched.length} duel${r.launched.length === 1 ? '' : 's'} launched`, 'ok');
    for (const x of r.rounds.slice(0, 10)) { const py = r.pays.find(q => q.id === x.id && q.round === x.round); line(`  #${x.n} r${x.round} <span class="${x.side === 'yes' ? 'ok' : 'er'}">${x.side.toUpperCase()}</span> $${esc(x.sy)}/$${esc(x.sn)} · ${py ? VP.S(py.lamports) + ' SOL' + (py.sig ? ` · <a href="${VR.tx(py.sig)}" target="_blank" rel="noopener">tx</a>` : ' · pending') : 'under the dust line'} <span class="mt">→ proof ${x.n} ${x.round} ${short(w)}</span>`); }
    for (const x of r.launched.slice(0, 6)) line(`  launched #${x.n} <span class="ok">$${esc(x.sy)}</span> vs <span class="er">$${esc(x.sn)}</span> · ${esc(x.state)}`);
  }
  async function cStatus() {
    const s = await api('/api/duels?op=stats'); const c = await api('/api/events?op=chain');
    if (s && s.ok) {
      p(`engine   last pass ${s.lastTick ? ago(s.lastTick) : 'never'} · ${s.day.passes} passes in 24h · avg ${s.day.avgMs}ms · ${s.day.errors} errors`, s.day.errors ? 'am' : 'ok');
      const b = (s.beats || []).slice().reverse(); const R = ' .:-=+*#';
      if (b.length) { const mx = Math.max(...b.map(x => x.ms), 1); line(`heart    <span class="ok">${esc(b.slice(-60).map(x => x.errors ? '!' : R[Math.min(7, 1 + Math.floor(x.ms / mx * 6.99))]).join(''))}</span> <span class="mt">last ${Math.min(60, b.length)} passes</span>`); }
      p(`duels    ${s.live} live · ${s.settled} settled · pots ${sol(s.potsSol)} · paid ${sol(s.paidSol)} to ${s.paidHolders} wallets in ${s.rounds} rounds`);
    } else p('the engine’s records didn’t answer', 'er');
    if (c && c.ok) p(`chain    slot ${VR.num(c.slot)} · height ${VR.num(c.height)} · epoch ${c.epoch} (${(c.slotIndex / c.slotsInEpoch * 100).toFixed(1)}%) · ${c.tps == null ? '—' : VR.num(c.tps)} tps · rpc ${c.rpcMs}ms`);
    else p('chain    the RPC didn’t answer', 'er');
  }
  async function cSources(quiet) {
    if (!quiet) await type('reading every source…', 'mt');
    const r = await api('/api/events?op=probe'); if (!r || !r.ok) return p('the server didn’t answer', 'er');
    if (W() < 60) { for (const x of r.rows) { line(`<span class="${x.ok ? 'ok' : 'er'}">[${x.ok ? 'ok' : '!!'}]</span> ${esc(x.name)} <span class="mt">${x.ms}ms</span>`); await wait(90); } return r; }
    for (const x of r.rows) { const n = Math.min(20, Math.max(1, Math.round(x.ms / 60))); line(`<span class="${x.ok ? 'ok' : 'er'}">[${x.ok ? 'ok' : '!!'}]</span> ${esc(pad(x.name, 22))}<span class="ok">${'|'.repeat(n)}</span><span class="mt">${'.'.repeat(20 - n)}</span> ${esc(pad(x.ms + 'ms', 8))}<span class="mt">${esc((x.sample || '').slice(0, Math.max(10, W() - 58)))}</span>`); await wait(90); }
    return r;
  }
  async function cSlot() { const c = await api('/api/events?op=chain'); if (!c || !c.ok) return p('the RPC didn’t answer', 'er'); p(`slot ${VR.num(c.slot)} · block height ${VR.num(c.height)} · epoch ${c.epoch} · ${c.tps == null ? '—' : VR.num(c.tps)} tps · ${c.slotMs || '—'}ms/slot`, 'ok'); }
  function cRules() {
    p('world   YES/NO when Polymarket closes the market and its price settles to 1 or 0 · VOID if Polymarket voids it');
    p('sports  YES if ESPN marks it final with the home side winning · NO on a loss or draw · VOID if cancelled');
    p('price   the close of the Coinbase 1-minute candle that opens at the duel’s minute, against the line');
    p('pay     floor(pot × bag ÷ all bags) to every holder of the winning coin · snapshot + merkle root published first', 'mt');
  }
  async function cOpen(n) { const d = await need(n); if (d) { p('opening #' + d.n, 'ok'); location.href = '/duel?id=' + d.id; } }

  async function run(raw) {
    const s = raw.trim(); if (!s) return;
    line(`<span class="ps">vrsus@engine:~$</span> ${esc(s)}`, 'cmd');
    hist.push(s); hi = hist.length; try { localStorage.setItem('vrsus:th', JSON.stringify(hist.slice(-40))); } catch {}
    const [c0, ...args] = s.split(/\s+/); const c = ALIAS[c0.toLowerCase()] || c0.toLowerCase();
    const cmd = CMDS[c]; if (!cmd) return p(`${c0}: not a command · try help`, 'er');
    busy = true; inp.disabled = true;
    try { await cmd.f(...args); } catch (e) { p('error: ' + (e && e.message || e), 'er'); }
    busy = false; inp.disabled = false; if (document.activeElement === document.body || matchMedia('(hover: hover)').matches) inp.focus({ preventScroll: true });
  }
  form.addEventListener('submit', e => { e.preventDefault(); if (busy) return; const v = inp.value; inp.value = ''; run(v); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp') { e.preventDefault(); if (hi > 0) inp.value = hist[--hi] || ''; }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (hi < hist.length) inp.value = hist[++hi] || ''; }
    else if (e.key === 'Tab') {
      e.preventDefault(); const v = inp.value; const parts = v.split(' ');
      if (parts.length === 1) { const m = Object.keys(CMDS).filter(k => k.startsWith(parts[0])); if (m.length === 1) inp.value = m[0] + ' '; else if (m.length) p(m.join('  '), 'mt'); }
      else if (/^(wallet|proof)$/.test(parts[0]) && VR.wallet()) { parts[parts.length - 1] = VR.wallet().pk; inp.value = parts.join(' '); }
    } else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); out.innerHTML = ''; }
  });
  out.addEventListener('click', () => { if (!getSelection().toString()) inp.focus({ preventScroll: true }); });
  document.addEventListener('click', e => { const b = e.target.closest('[data-run]'); if (!b) return; e.preventDefault(); if (!busy) { $('#term').scrollIntoView({ block: 'nearest' }); run(b.dataset.run); } });

  // boot: a real diagnostics pass the first time the terminal comes into view
  async function boot() {
    if (booted) return; booted = true; busy = true; inp.disabled = true;
    const FIG = ['__   ___ __ ___ _   _ ___ ', "\\ \\ / / '__/ __| | | / __|", ' \\ V /| |  \\__ \\ |_| \\__ \\', '  \\_/ |_|  |___/\\__,_|___/'];
    const side = ['engine terminal', 'every number here is read live', 'every proof is computed in this browser', new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC'];
    if (W() < 60) { line(FIG.map(f => `<span class="ok">${esc(f.slice(0, 13))}</span><span class="er">${esc(f.slice(13))}</span>`).join('\n')); p(side.slice(0, 2).join(' · '), 'mt'); }
    else line(FIG.map((f, i) => `<span class="ok">${esc(f.slice(0, 13))}</span><span class="er">${esc(f.slice(13))}</span>   <span class="mt">${esc(side[i])}</span>`).join('\n'));
    await wait(150);
    await type('> connecting to the sources…', 'mt');
    await cSources(true);
    const [s, c] = await Promise.all([api('/api/duels?op=stats'), api('/api/events?op=chain')]);
    if (c && c.ok) line(`<span class="ok">[ok]</span> chain at slot ${VR.num(c.slot)} · epoch ${c.epoch} · ${c.tps == null ? '—' : VR.num(c.tps)} tps`);
    if (s && s.ok) line(`<span class="${s.lastTick ? 'ok' : 'am'}">[${s.lastTick ? 'ok' : '..'}]</span> engine ${s.lastTick ? 'last pass ' + ago(s.lastTick) : 'waiting for its first pass'} · ${s.live} live duel${s.live === 1 ? '' : 's'} · ${sol(s.potsSol)} in pots`);
    else line('<span class="am">[..]</span> engine records offline');
    p('type help, or tap a command below', 'mt');
    busy = false; inp.disabled = false;
  }
  if ('IntersectionObserver' in window) { const io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { io.disconnect(); boot(); } }, { threshold: .25 }); io.observe(out); } else boot();
  VR.term = { run };
})();
