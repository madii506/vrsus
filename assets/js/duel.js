/* vrsus duel page: the split ring, the lifecycle, the tape (crowd vs source), the source and its raw reading, the pot,
   every payout round with an in-browser verifier (hash, Merkle root, split, chain), the proof bundle, the log */
(function () {
  const { $, $$, esc, api, post, usd, sol, ago, day } = VR;
  const V = window.VS;
  VR.tape(); VR.nudge();
  const VSART = (window.VS_ART && window.VS_ART.vs) || 'vs';
  const qs = new URLSearchParams(location.search), key = qs.get('id') || qs.get('m') || '';
  const none = m => { $('#none').hidden = false; $('#none').innerHTML = m; };
  if (!key) { none('No duel picked. <a class="u" href="/#card">see the fight card</a>.'); return; }
  let D = null, R = [], first = true;
  const tugN = () => (innerWidth < 640 ? 24 : 44);

  function side(d, s) {
    const c = d[s], Y = s === 'yes', won = d.outcome && d.outcome === s.toUpperCase();
    return `<div class="sd ${Y ? 'y' : 'n'}"><span class="lb">${Y ? 'YES' : 'NO'}${won ? ' · WON' : d.outcome && d.outcome !== 'VOID' ? ' · LOST' : ''}</span><pre class="coin" data-coin="${s}" aria-hidden="true"></pre>
      <span class="tk">$${esc(c.symbol)}</span><span class="nm">${esc(c.name)}</span><span class="mc">mcap <b>${usd(c.mcapUsd)}</b></span>
      <span class="lk"><a class="br sm" href="https://pump.fun/coin/${esc(c.mint)}" target="_blank" rel="noopener">${d.state === 'live' ? 'buy ' + (Y ? 'yes' : 'no') : 'pump.fun'}</a><a class="br sm" href="https://dexscreener.com/solana/${esc(c.mint)}" target="_blank" rel="noopener">chart</a><a class="br sm" href="#" data-copy="${esc(c.mint)}" data-what="${Y ? 'YES' : 'NO'} contract copied">ca</a></span></div>`;
  }

  // ---------- the lifecycle: every step a duel goes through, each with its proof ----------
  function life(d, rounds) {
    const sg = s => s && s !== 'landed' ? `<a class="u" href="${VR.tx(s)}" target="_blank" rel="noopener">tx ${esc(VR.short(s))}</a>` : s === 'landed' ? '<span class="dim">landed</span>' : '';
    const live = d.state === 'live', settled = !!d.settledAt, rd = d.lastRead || {};
    const allPaid = rounds.length && rounds.every(x => x.state === 'paid');
    const steps = [
      { nm: 'paired', done: true, ds: `event, rule and both coins recorded · fingerprint ${esc(d.fp)}`, rt: day(d.createdAt) },
      { nm: 'YES minted', done: !!(d.sigs && d.sigs.yes), ds: `<span class="yes">$${esc(d.yes.symbol)}</span> on pump.fun · creator: the duel wallet`, rt: sg(d.sigs && d.sigs.yes) },
      { nm: 'NO minted', done: !!(d.sigs && d.sigs.no), ds: `<span class="no">$${esc(d.no.symbol)}</span> on pump.fun · same creator, so both coins’ fees fill one pot`, rt: sg(d.sigs && d.sigs.no) },
      { nm: 'handed out', done: !!d.outSig || !live, ds: 'the launcher’s first buys of both coins sent back to the launcher', rt: d.outSig ? sg(d.outSig) : '' },
      { nm: 'reading', done: !live, now: live, ds: live ? `${esc(VR.srcName(d.kind))}, every minute · ${esc(rd.text || 'not read yet')}` : `${esc(VR.srcName(d.kind))} gave a final answer`, rt: live && d.lastReadAt ? ago(d.lastReadAt) : '' },
      { nm: 'settled', done: settled, ds: settled ? `<b class="${d.outcome === 'YES' ? 'yes' : d.outcome === 'NO' ? 'no' : 'dim'}">${d.outcome === 'VOID' ? 'VOID' : d.outcome + ' WON'}</b> · ${esc((d.reading && d.reading.text) || '')}` : `on the first pass after ${esc(VR.srcName(d.kind))} gives a final answer`, rt: settled ? day(d.settledAt) : '' },
      { nm: 'snapshot', done: rounds.length > 0, ds: rounds.length ? `round ${rounds[0].round}: ${rounds[0].holders} ${rounds[0].side.toUpperCase()} holders · merkle root <code>${esc((rounds[0].root || rounds[0].hash).slice(0, 16))}…</code>` : 'every holder of the winning coin, read from the chain, hashed and committed to a merkle root', rt: rounds.length ? day(rounds[0].at) : '' },
      { nm: 'paid', done: !!allPaid, now: d.state === 'settling', ds: rounds.length ? `${sol(d.paidSol)} sent in ${rounds.length} round${rounds.length === 1 ? '' : 's'} · new fees go to the winners every 24h` : 'floor(pot × bag ÷ all bags) to every wallet in the snapshot', rt: rounds.length ? `<a class="u" href="#rounds">rounds</a>` : '' },
    ];
    let marked = false;
    $('#dLife').innerHTML = steps.map(s => { let c = s.done ? 'done' : 'todo'; if (!s.done && (s.now || !marked)) { c = 'now'; } if (c === 'now') marked = true;
      return `<div class="st ${c}"><span class="bx">${c === 'done' ? '[x]' : c === 'now' ? '[>]' : '[ ]'}</span><span class="nm">${s.nm}</span><span class="ds">${s.ds}</span><span class="rt2">${s.rt || ''}</span></div>`; }).join('');
  }

  // ---------- the tape: the crowd (the two market caps) against the source's own number ----------
  let PTS = [], tpH = 6;
  const cw = (() => { const s = document.createElement('span'); s.style.cssText = 'position:absolute;visibility:hidden;font:12px JBM,monospace;white-space:pre'; s.textContent = 'x'.repeat(100); document.body.appendChild(s); const w = s.getBoundingClientRect().width / 100; s.remove(); return w || 7.2; });
  async function series() { const r = await api('/api/duels?op=series&id=' + encodeURIComponent(D.id)); if (r && r.ok) { PTS = r.points; drawTape(); } }
  function drawTape() {
    if (!D) return;
    const t1 = PTS.length ? +new Date(PTS[PTS.length - 1].at) : Date.now();
    let pts = tpH ? PTS.filter(p => +new Date(p.at) > t1 - tpH * 36e5) : PTS; if (pts.length < 3) pts = PTS;
    if (pts.length < 2) { $('#dPlot').innerHTML = `<span class="ax">The tape starts with the engine’s first readings: one sample about every 5 minutes while the duel is live.</span>`; $('#dLeg').innerHTML = ''; $('#dEdge').hidden = true; $('#dPx').innerHTML = ''; return; }
    $('#dEdge').hidden = false;
    const pre = $('#dPlot'), W = Math.max(30, Math.floor((pre.clientWidth || 700) / cw()) - 9), Hh = innerWidth < 640 ? 10 : 13;
    const crowd = pts.map(p => ({ at: p.at, v: p.crowd })), src = D.kind === 'pm' ? pts.map(p => ({ at: p.at, v: p.src })) : [];
    const vals = crowd.concat(src).map(p => p.v).filter(v => v != null);
    const lo = Math.max(0, Math.floor((Math.min(...vals) - 4) / 5) * 5), hi = Math.min(100, Math.ceil((Math.max(...vals) + 4) / 5) * 5);
    const series = [{ pts: crowd, ch: '*', cls: 'a' }]; if (src.length) series.push({ pts: src, ch: 'o', cls: 'b' });
    pre.innerHTML = VR.plot({ w: W, h: Hh, min: lo, max: hi, fmt: v => v.toFixed(0) + '%', series, hline: lo < 50 && hi > 50 ? { v: 50, ch: '-', cls: 'ax' } : null });
    const last = pts[pts.length - 1], firstP = pts[0], cNow = last.crowd, sNow = last.src;
    $('#dLeg').innerHTML = `<span><span class="a">*</span> the crowd: YES coin mcap ÷ both · ${cNow == null ? '—' : cNow + '%'}</span>${D.kind === 'pm' ? `<span><span class="b">o</span> polymarket YES · ${sNow == null ? '—' : sNow + '%'}</span>` : ''}<span class="dim">${pts.length} samples · ${day(firstP.at).slice(5, 16)} → ${day(last.at).slice(5, 16)}</span>`;
    if (D.kind === 'price') {
      const px = pts.map(p => ({ at: p.at, v: p.src })).filter(p => p.v != null), line = D.event.value;
      $('#dPx').innerHTML = px.length > 1 ? `<div class="legend" style="margin-top:16px"><span><span class="b">o</span> ${esc(D.event.asset)} on coinbase · ${usd(px[px.length - 1].v)}</span><span><span class="ln2">-</span> the line · ${usd(line)} (${esc(D.event.op)})</span></div><pre class="plot" style="margin-top:8px">${VR.plot({ w: W, h: Math.round(Hh * .8), fmt: v => usd(v), series: [{ pts: px, ch: 'o', cls: 'b' }], hline: { v: line, ch: '-', cls: 'ln2' } })}</pre>` : '';
    } else $('#dPx').innerHTML = '';
    const potG = last.potSol != null && firstP.potSol != null ? last.potSol - firstP.potSol : null;
    const cr = pts.map(p => p.crowd).filter(v => v != null);
    const edge = D.kind === 'pm' && cNow != null && sNow != null ? [`${cNow - sNow >= 0 ? '+' : ''}${(cNow - sNow).toFixed(1)} pts`, `crowd vs polymarket (${cNow - sNow >= 0 ? 'the crowd leans YES' : 'the crowd leans NO'})`]
      : D.kind === 'price' && sNow != null ? [`${((sNow / D.event.value - 1) * 100).toFixed(2)}%`, `${D.event.asset} vs the line right now`]
      : [last.note ? esc(last.note.slice(0, 22)) : (cNow == null ? '—' : cNow + '%'), last.note ? 'espn, at the last sample' : 'the crowd right now'];
    $('#dEdge').innerHTML = `<div><b class="crea">${edge[0]}</b><span>${edge[1]}</span></div><div><b>${cr.length ? Math.min(...cr).toFixed(0) + '–' + Math.max(...cr).toFixed(0) + '%' : '—'}</b><span>the crowd’s range in this window</span></div><div><b class="g">${potG == null ? '—' : (potG >= 0 ? '+' : '') + potG.toFixed(4) + ' SOL'}</b><span>fees into the pot in this window</span></div>`;
  }
  $('#tpTabs').addEventListener('click', e => { const b = e.target.closest('[data-h]'); if (!b) return; tpH = +b.dataset.h; $$('#tpTabs .br').forEach(x => x.classList.toggle('on', x === b)); drawTape(); });
  addEventListener('resize', () => { clearTimeout(drawTape.t); drawTape.t = setTimeout(drawTape, 200); });

  async function load() {
    const r = await api('/api/duels?id=' + encodeURIComponent(key));
    if (!r || !r.ok) { if (first) none(esc((r && r.error) || 'The records didn’t answer.') + ' <a class="u" href="/#card">see the fight card</a>.'); return; }
    const d = r.duel; D = d; R = r.rounds; $('#duel').hidden = false; $('#none').hidden = true;
    document.title = `vrsus · $${d.yes.symbol} vs $${d.no.symbol}`;
    const rd = d.lastRead || {};
    const keep = {}; $$('[id^=vOut]').forEach(e => { keep[e.id] = e.innerHTML; });
    const sig = JSON.stringify([d.state, d.potSol, d.paidSol, d.crowd, d.lastReadAt, d.yes.mcapUsd, d.no.mcapUsd, d.outcome]);
    const real = d.kind === 'pm' && rd.text && /YES ([\d.]+)%/.test(rd.text) ? /YES ([\d.]+)%/.exec(rd.text)[1] : null;
    if (sig !== load.sig) { load.sig = sig; $('#dHead').innerHTML = `
      <div class="kick" style="margin:0 0 6px">${VR.stateChip(d)} <span class="dim">#${d.n} · ${VR.kindName(d.kind)} · settles on ${VR.srcName(d.kind)}${d.closesAt && d.state === 'live' ? ' · ' + (d.kind === 'price' ? 'at ' : 'closes ') + day(d.closesAt) : d.settledAt ? ' · settled ' + day(d.settledAt) : ''} · duel ${esc(d.fp)}</span></div>
      <h1 class="q">${esc(d.q)}</h1>
      <div class="ring">${side(d, 'yes')}
        <div class="mid"><pre aria-hidden="true">${VSART}</pre><span class="k">the pot</span><span class="pv">${sol(d.potSol)}</span><span class="s">${d.state === 'live' ? 'goes to the winning side' : d.outcome === 'VOID' ? 'split, half each side' : 'paid to ' + d.outcome + ' holders'}</span><span class="s">paid so far ${sol(d.paidSol)}</span></div>
        ${side(d, 'no')}</div>
      <div class="under"><div><div class="tg">${VR.tug(d.crowd, tugN())}</div><div class="od">${d.crowd != null ? `the crowd: ${d.crowd}% YES` : 'the crowd: no market caps yet'}${real ? ` · polymarket: ${real}% YES` : ''}</div></div>
        <div class="rd">${d.state === 'live' ? `the source says: <b>${esc(rd.text || 'not read yet')}</b><br><span class="dim">${d.lastReadAt ? 'read ' + ago(d.lastReadAt) : 'the engine reads it every minute'}</span>` : `<span class="state-big ${d.outcome === 'YES' ? 'yes' : d.outcome === 'NO' ? 'no' : 'dim'}">${d.outcome === 'VOID' ? 'VOID' : d.outcome + ' WON'}</span><br><span class="dim">${esc((d.reading && d.reading.text) || '')}</span>`}</div></div>`;
    $$('#dHead [data-coin]').forEach(p => VR.coinArt(p, p.dataset.coin)); }
    life(d, r.rounds);
    $('#dRule').innerHTML = `<div class="code"><span class="kw">event</span>  <span class="st">"${esc(d.q)}"</span>\n<span class="kw">rule</span>   ${esc(d.rule)}\n<span class="kw">source</span> <a class="u" href="${esc(d.src)}" target="_blank" rel="noopener">${esc(d.src)}</a></div>`;
    if (d.reading) { $('#dEvidence').hidden = false; $('#dEvidence').innerHTML = `<span class="cm"># the reading the duel settled on, stored as the source returned it</span>\n${esc(JSON.stringify(d.reading, null, 2))}`; }
    $('#dRead').innerHTML = d.state === 'live' ? `<span class="dim">last engine reading:</span> <b>${esc(rd.text || '—')}</b> <span class="dim">${d.lastReadAt ? '· ' + ago(d.lastReadAt) : ''}</span>` : '';
    $('#dPot').innerHTML = `<div><span>in the pot</span><b>${sol(d.chestSol)}</b></div><div><span>fees waiting</span><b>${sol(d.waitingSol)}</b></div><div><span>claimed</span><b>${sol(d.claimedSol)}</b></div><div><span>paid out</span><b>${sol(d.paidSol)}</b></div><div><span>rounds</span><b>${d.rounds || 0}</b></div>`;
    $('#dWal').textContent = d.wallet; $('#dWalCp').onclick = () => VR.copy(d.wallet, 'Wallet copied'); $('#dWalScan').href = VR.acct(d.wallet); $('#dRes').textContent = d.reserveSol;
    $('#dRounds').innerHTML = r.rounds.length ? r.rounds.map(x => `<div class="rstate" style="grid-template-columns:60px minmax(0,1fr) 190px"><span class="i">#${x.round}</span>
        <div><b class="${x.side === 'yes' ? 'yes' : 'no'}">${x.side.toUpperCase()} holders</b> · pot ${sol(x.potSol)} · ${x.holders} wallets ${x.source === 'all' ? '(every holder)' : '(the top 20: this RPC won’t list them all)'}
          <div class="rd">snapshot hash <code>${esc(x.hash)}</code></div>${x.root ? `<div class="rd">merkle root <code>${esc(x.root)}</code></div>` : ''}<div class="rd dim">${day(x.at)}</div><div class="out" id="vOut${x.round}"></div></div>
        <div class="stt"><b class="${x.state === 'paid' ? 'g' : 'crea'}">${x.state === 'paid' ? 'paid' : 'paying'}</b>${sol(x.paidSol)} sent<br><button class="br sm" type="button" data-verify="${x.round}">verify this round</button><br><button class="br sm" type="button" data-chain="${x.round}">check on chain</button></div></div>`).join('')
      : `<div class="empty">${d.state === 'live' ? 'No rounds yet. When the source settles the event, the engine snapshots every holder of the winning coin, publishes the snapshot, its hash and a Merkle root here, and pays the pot out pro rata.' : 'No rounds.'}</div>`;
    Object.entries(keep).forEach(([id, h]) => { const el = document.getElementById(id); if (el) el.innerHTML = h; });
    $('#dLog').innerHTML = r.log.length ? r.log.map(e => `<div class="ev ${esc(e.kind)}"><span class="t">${ago(e.at)}</span><span><span class="kind">${esc(e.kind)}</span>${esc(e.text)}</span>
        <span class="l">${e.src ? `<a class="u" href="${esc(e.src)}" target="_blank" rel="noopener">source</a>` : ''}${e.sig ? `<a class="u" href="${VR.tx(e.sig)}" target="_blank" rel="noopener">tx</a>` : ''}</span></div>`).join('') : '<div class="empty">Nothing yet.</div>';
    const site = location.origin;
    $('#bDl').href = `/api/duels?op=bundle&id=${encodeURIComponent(d.id)}`;
    $('#bCmd').textContent = `curl -sO ${site}/verify.mjs && node verify.mjs ${d.id} --site ${site}`;
    if (first) { first = false; VR.stagger($('#dLog'), '.ev', 30); series(); setInterval(() => { if (!document.hidden && D && D.state === 'live') series(); }, 60000); if (location.hash === '#rounds') $('#rounds').scrollIntoView(); }
  }
  $('#bCp').addEventListener('click', () => VR.copy($('#bCmd').textContent, 'Command copied'));
  // read the source right now, the same reading the engine settles on
  $('#readGo').addEventListener('click', async e => {
    if (!D) return; const b = e.currentTarget; b.disabled = true; $('#dRead').innerHTML = '<span class="dim">reading…</span>';
    const t0 = performance.now(); const r = await post('/api/events?op=read', { event: D.event }); b.disabled = false; const ms = Math.round(performance.now() - t0);
    if (!r || !r.ok) { $('#dRead').innerHTML = '<span class="off">the source didn’t answer</span>'; return; }
    const x = r.reading;
    $('#dRead').innerHTML = `<span class="dim">the source, ${VR.hhmm(r.at)} (${ms}ms):</span> <b>${esc(x.text)}</b> ${x.outcome ? `<span class="chip ${x.outcome === 'YES' ? 'yes' : x.outcome === 'NO' ? 'no' : 'void'}">${x.outcome === 'VOID' ? 'VOID' : x.outcome + ' WINS'}</span> <span class="dim">the engine settles on its next pass</span>` : ''}`;
    if (x.evidence && !D.reading) { $('#dEvidence').hidden = false; $('#dEvidence').innerHTML = `<span class="cm"># the raw reading, right now</span>\n${esc(JSON.stringify(x.evidence, null, 2))}`; }
  });
  // verify a round in the browser: hash, merkle root, split; then find any wallet's path; then read the payouts back from the chain
  const cache = {};
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-verify]'), c = e.target.closest('[data-chain]'); if ((!b && !c) || !D) return;
    const n = (b || c).dataset.verify || (b || c).dataset.chain, out = $('#vOut' + n);
    if (!cache[n]) { out.innerHTML = '<span class="dim">fetching the round and recomputing it here…</span>'; cache[n] = await VP.round(D.id, n); }
    const v = cache[n]; if (!v.ok) { out.innerHTML = `<span class="bad2">${esc(v.error)}</span>`; delete cache[n]; return; }
    if (b) {
      out.innerHTML = VP.lines(v) + `<form class="pform" data-pf="${n}" style="margin-top:10px"><input placeholder="find a wallet in this round" spellcheck="false" autocomplete="off" aria-label="wallet"><button class="br sm" type="submit">prove it</button></form><div data-pt="${n}"></div>` +
        `<details style="margin-top:8px"><summary>every payout</summary><div style="overflow-x:auto"><table class="tbl pays"><thead><tr><th>wallet</th><th>bag</th><th>SOL</th><th>tx</th></tr></thead><tbody>${v.pays.map(p => { const hh = v.holders.find(x => x.owner === p.owner);
          return `<tr><td><a class="u" href="${VR.acct(p.owner)}" target="_blank" rel="noopener"><code>${esc(VR.short(p.owner))}</code></a></td><td>${hh ? (Number(hh.amount) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}</td><td>${(p.lamports / 1e9).toFixed(6)}</td><td>${p.sig ? `<a class="u" href="${VR.tx(p.sig)}" target="_blank" rel="noopener">${esc(VR.short(p.sig))}</a>` : '<span class="crea">pending</span>'}</td></tr>`; }).join('')}</tbody></table></div></details>`;
      const w = VR.wallet(); if (w && v.leaves.find(x => x.owner === w.pk)) { $(`[data-pf="${n}"] input`).value = w.pk; }
    } else {
      const st = document.createElement('div'); st.className = 'dim'; st.textContent = 'reading the payout transactions from Solana…'; out.appendChild(st);
      const r = await VP.chain(v, D.wallet, o => { st.textContent = `read ${o.txs} of ${v.txs.length} transactions…`; });
      st.className = r.bad.length ? 'bad2' : 'ok2';
      st.innerHTML = `${r.bad.length ? '[x]' : '[+]'} ${r.okTx} of ${r.txs} transactions landed on chain · ${r.matched} of ${r.payouts} payouts found as a transfer from the duel wallet to the right wallet for the right amount <span class="dim">· read via ${esc([...r.via].join(', '))}</span>${r.bad.length ? '<br>' + r.bad.slice(0, 6).map(esc).join('<br>') : ''}`;
    }
  });
  document.addEventListener('submit', async e => {
    const f = e.target.closest('[data-pf]'); if (!f) return; e.preventDefault();
    const n = f.dataset.pf, w = $('input', f).value.trim(), box = $(`[data-pt="${n}"]`), v = cache[n]; if (!v) return;
    const pp = await VP.path(v, w);
    box.innerHTML = pp ? `<pre class="ptree">${VP.tree(pp, v)}</pre>${pp.pay && pp.pay.sig ? `<div class="ok2" style="margin-top:6px">[+] paid ${VP.S(pp.pay.lamports)} SOL · <a class="u" href="${VR.tx(pp.pay.sig)}" target="_blank" rel="noopener">${esc(VR.short(pp.pay.sig))}</a></div>` : ''}` : `<div class="bad2" style="margin-top:6px">[x] ${esc(VR.short(w) || 'that wallet')} is not in this round’s snapshot</div>`;
  });
  load(); setInterval(() => { if (!document.hidden) load(); }, 15000);
})();
