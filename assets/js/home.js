/* vrsus home: the arena, the fight card, the board of pairable events, receipts, the money, the sources */
(function () {
  const { $, $$, esc, api, usd, sol, ago, hhmm, day } = VR;
  const V = window.VS;
  VR.caStrip($('#ca')); VR.tape(); VR.reveal(); VR.nudge();
  const enc = o => encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(o)))));
  const VSART = (window.VS_ART && window.VS_ART.vs) || 'vs';

  // ---------- the arena: one duel, split down the middle ----------
  let DUELS = [], featured = null;
  function side(d, s) {
    const c = d[s], Y = s === 'yes';
    return `<div class="sd ${Y ? 'y' : 'n'}"><span class="lb">${Y ? 'YES' : 'NO'}</span><pre class="coin" data-coin="${s}" aria-hidden="true"></pre>
      ${c ? `<span class="tk">$${esc(c.symbol)}</span><span class="nm">${esc(c.name)}</span><span class="mc">mcap <b>${usd(c.mcapUsd)}</b></span>
        <span class="lk"><a class="br sm" href="https://pump.fun/coin/${esc(c.mint)}" target="_blank" rel="noopener">buy ${Y ? 'yes' : 'no'}</a><a class="br sm" href="https://dexscreener.com/solana/${esc(c.mint)}" target="_blank" rel="noopener">chart</a></span>`
        : `<span class="tk">no coin yet</span><span class="nm">the ${Y ? 'YES' : 'NO'} side is open</span>`}</div>`;
  }
  function paintArena() {
    const live = DUELS.filter(d => d.state === 'live');
    $('#arenaN').innerHTML = live.length ? `${live.length} live duel${live.length > 1 ? 's' : ''} · <a class="u" href="#card">all of them</a>` : '';
    if (!featured) { if (paintArena.sig !== 'next') { paintArena.sig = 'next'; nextFight(); } return; }
    const d = featured, rd = d.lastRead || {};
    const sig = JSON.stringify([d.id, d.state, d.potSol, d.crowd, d.lastReadAt, d.yes.mcapUsd, d.no.mcapUsd, DUELS.filter(x => x.state === 'live').length]);
    if (sig === paintArena.sig) return; paintArena.sig = sig;
    const real = d.kind === 'pm' && rd.text && /YES ([\d.]+)%/.test(rd.text) ? /YES ([\d.]+)%/.exec(rd.text)[1] : null;
    $('#arenaBd').innerHTML = `
      <div class="kick" style="margin:0 0 6px">${VR.stateChip(d)} <span class="dim">${VR.kindName(d.kind)} · settles on ${VR.srcName(d.kind)}${d.closesAt ? ' · ' + (d.kind === 'price' ? 'at ' : 'closes ') + day(d.closesAt) : ''}</span></div>
      <h2 class="q"><a href="/duel?id=${esc(d.id)}">${esc(d.q)}</a></h2>
      <div class="rl2">${esc(d.rule)} <a class="u" href="${esc(d.src)}" target="_blank" rel="noopener">source</a></div>
      <div class="ring">${side(d, 'yes')}
        <div class="mid"><pre aria-hidden="true">${VSART}</pre><span class="k">the pot</span><span class="pv" id="potV">${sol(d.potSol)}</span><span class="s">${d.state === 'live' ? 'goes to the winning side' : d.outcome === 'VOID' ? 'split, half each side' : 'paid to ' + d.outcome + ' holders'}</span></div>
        ${side(d, 'no')}</div>
      <div class="under"><div><div class="tg">${VR.tug(d.crowd, innerWidth < 640 ? 24 : 44)}</div><div class="od">${d.crowd != null ? `the crowd: ${d.crowd}% YES` : 'the crowd: no market caps yet'}${real ? ` · polymarket: ${real}% YES` : ''}</div></div>
        <div class="rd">the source says: <b>${esc(rd.text || 'not read yet')}</b><br><span class="dim">${d.lastReadAt ? 'read ' + ago(d.lastReadAt) : 'the engine reads it every minute'} · <a class="u" href="/duel?id=${esc(d.id)}">open the duel</a></span></div></div>
      ${live.length > 1 ? `<div class="pick">other live duels: ${live.filter(x => x.id !== d.id).slice(0, 6).map(x => `<button class="br sm" type="button" data-f="${esc(x.id)}"><span class="yes">$${esc(x.yes.symbol)}</span> vs <span class="no">$${esc(x.no.symbol)}</span></button>`).join(' ')}</div>` : ''}`;
    $$('#arenaBd [data-coin]').forEach(p => VR.coinArt(p, p.dataset.coin));
  }
  $('#arenaBd').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; featured = DUELS.find(d => d.id === b.dataset.f) || featured; paintArena(); });
  // no duel yet: the ring is open, both sides empty; events to pair live on the wire, the board and the pair page
  function nextFight() {
    const d = { yes: null, no: null };
    $('#arenaBd').innerHTML = `
      <div class="kick" style="margin:0 0 6px"><span class="chip">THE RING IS OPEN</span> <span class="dim">no duels running yet</span></div>
      <div class="ring">${side(d, 'yes')}<div class="mid"><pre aria-hidden="true">${VSART}</pre><span class="k">the pot</span><span class="pv">—</span><span class="s">fills once both coins trade</span></div>${side(d, 'no')}</div>
      <div class="opencta"><a class="btn" href="/pair">pair an event <span class="k">-&gt;</span></a><a class="br" href="#wire">see what’s happening</a></div>`;
    $$('#arenaBd [data-coin]').forEach(p => VR.coinArt(p, p.dataset.coin));
  }

  // ---------- the fight card ----------
  let tab = 'live';
  function card() {
    const list = DUELS.filter(d => !tab || (tab === 'live' ? d.state === 'live' : ['settled', 'settling'].includes(d.state)));
    $('#cardN').textContent = DUELS.length ? `${DUELS.filter(d => d.state === 'live').length} live · ${DUELS.filter(d => d.state !== 'live').length} settled` : '';
    if (!list.length) { $('#cardBd').innerHTML = `<div class="empty"><pre aria-hidden="true">   .--------------------.\n   |  no ${tab ? tab + ' ' : ''}duels yet${' '.repeat(Math.max(0, 9 - (tab ? tab.length + 1 : 0)))}|\n   '--------------------'</pre>${tab === 'settled' ? 'Nothing has settled yet.' : 'The first duel on vrsus could be yours.'} <a class="u" href="/pair">pair an event</a>.</div>`; return; }
    VR.swap($('#cardBd'), list.map(d => `<div class="row2">
      <a class="s1" href="https://pump.fun/coin/${esc(d.yes.mint)}" target="_blank" rel="noopener"><img src="${esc(d.yes.img)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><span><b>$${esc(d.yes.symbol)}</b><span class="sm2">${usd(d.yes.mcapUsd)}</span></span></a>
      <div class="ev2"><a href="/duel?id=${esc(d.id)}"><span class="q2">${esc(d.q)}</span></a><div class="tg">${VR.tug(d.crowd, 30)}</div>
        <div class="mt">${VR.stateChip(d)}<span>${VR.kindName(d.kind)} · ${VR.srcName(d.kind)}</span><span>pot ${sol(d.potSol)}</span>${d.state === 'live' && d.closesAt ? `<span>${d.kind === 'price' ? 'at' : 'closes'} ${day(d.closesAt)}</span>` : d.settledAt ? `<span>settled ${ago(d.settledAt)}</span>` : ''}</div></div>
      <a class="s2" href="https://pump.fun/coin/${esc(d.no.mint)}" target="_blank" rel="noopener"><span><b>$${esc(d.no.symbol)}</b><span class="sm2">${usd(d.no.mcapUsd)}</span></span><img src="${esc(d.no.img)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"></a></div>`).join(''),
      () => VR.stagger($('#cardBd'), '.row2', 50));
  }
  $('#cardTabs').addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (!b) return; tab = b.dataset.s; $$('#cardTabs .br').forEach(x => x.classList.toggle('on', x === b)); card(); });

  async function duels() {
    const r = await api('/api/duels');
    if (!r || !r.ok) { $('#arenaBd').innerHTML = '<div class="empty"><span class="off">the records didn’t answer · retrying</span></div>'; return; }
    DUELS = r.duels || [];
    const live = DUELS.filter(d => d.state === 'live');
    featured = featured && DUELS.find(d => d.id === featured.id) || live.slice().sort((a, b) => (b.potSol || 0) - (a.potSol || 0))[0] || null;
    paintArena(); card();
    VR.countUp($('#stLive'), live.length, v => String(Math.round(v)), 600);
  }

  // ---------- the board: real events you can pair ----------
  let bKind = 'pm', bSub = 'politics';
  const cache = {};
  const bar = p => { const n = Math.round(Math.max(0, Math.min(100, p)) / 5); return `<span class="bar" data-fill="${n}" data-w="20">[${'#'.repeat(n)}<span class="dim">${'-'.repeat(20 - n)}</span>]</span>`; };
  const vol = v => !v ? '' : v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? '$' + Math.round(v / 1e3) + 'K' : '$' + Math.round(v);
  function subs() {
    const list = bKind === 'pm' ? V.CATS.map(c => [c.id, c.name]) : bKind === 'game' ? V.LEAGUES.map(l => [l.id, l.name]) : [];
    $('#bSub').innerHTML = list.map(([id, n]) => `<button class="br sm${id === bSub ? ' on' : ''}" type="button" data-sub="${id}">${esc(n)}</button>`).join('');
    $('#bSrc').textContent = bKind === 'pm' ? 'source: polymarket · settles when Polymarket resolves the market' : bKind === 'game' ? 'source: espn · “will the home side win” · settles when ESPN marks it final' : 'source: coinbase · settles on the one-minute candle at the deadline';
  }
  async function board() {
    subs();
    const key = bKind + ':' + bSub;
    if (!cache[key]) { $('#bList').innerHTML = '<div class="empty">reading the board…</div>'; cache[key] = await api(bKind === 'pm' ? '/api/events?op=world&cat=' + bSub : bKind === 'game' ? '/api/events?op=sports&league=' + bSub : '/api/events?op=price'); }
    if (key !== bKind + ':' + bSub) return;
    const r = cache[key];
    if (!r || !r.ok) { delete cache[key]; $('#bList').innerHTML = '<div class="empty"><span class="off">the source didn’t answer · try again in a minute</span></div>'; return; }
    $('#bAt').textContent = 'read ' + hhmm(r.at || new Date());
    let html = '';
    if (bKind === 'pm') html = r.markets.slice(0, 10).map(m => `<div class="evrow2"><div class="q">${esc(m.q)}</div><div class="o">${bar(m.yes)} <b class="yes">YES ${m.yes}%</b> <span class="dim">${vol(m.vol)}</span></div>
      <div class="a"><a class="br sm" href="/pair#e=${enc({ kind: 'pm', market: { id: m.id, q: m.q, slug: m.slug, cat: m.cat } })}">pair it <span class="p">-&gt;</span></a></div><div class="w">ends ${day(m.end)} · <a class="u" href="${esc(m.src)}" target="_blank" rel="noopener">polymarket</a></div></div>`).join('');
    else if (bKind === 'game') html = r.games.length ? r.games.slice(0, 12).map(g => `<div class="evrow2"><div class="q">Will ${esc(g.home.name)} beat ${esc(g.away.name)}?</div><div class="o">${esc(g.leagueName)} · ${day(g.date)}</div>
      <div class="a"><a class="br sm" href="/pair#e=${enc({ kind: 'game', league: g.league, gameId: g.gameId, home: g.home, away: g.away, date: g.date, link: g.link })}">pair it <span class="p">-&gt;</span></a></div><div class="w">${esc(g.away.name)} at ${esc(g.home.name)} · <a class="u" href="${esc(g.link)}" target="_blank" rel="noopener">espn</a></div></div>`).join('')
      : `<div class="empty">No ${esc(r.name || '')} games in the next 7 days. Try another league.</div>`;
    else {
      const at = h => { const t = new Date(Date.now() + h * 36e5); t.setUTCMinutes(0, 0, 0); t.setUTCHours(t.getUTCHours() + 1); return t.toISOString(); };
      html = `<div class="pxrow">${r.prices.map(p => p.ok ? `<div><span class="dim">${p.asset} on coinbase</span><b>${usd(p.price)}</b><span class="dim">${p.ch24h == null ? '' : (p.ch24h >= 0 ? '+' : '') + p.ch24h + '% 24h'}</span></div>` : `<div><span class="off">${p.asset} offline</span></div>`).join('')}</div>` +
        r.prices.filter(p => p.ok).flatMap(p => { const step = p.price > 10000 ? 1000 : p.price > 1000 ? 50 : 5; const up = Math.ceil(p.price * 1.03 / step) * step, dn = Math.floor(p.price * .97 / step) * step;
          return [[p.asset, 'above', up, 24], [p.asset, 'below', dn, 24]].map(([a, op, v, h]) => { const ev = { kind: 'price', asset: a, op, value: v, at: at(h) };
            return `<div class="evrow2"><div class="q">${esc(V.describe(ev).q)}</div><div class="o">now ${usd(p.price)}</div><div class="a"><a class="br sm" href="/pair#e=${enc(ev)}">pair it <span class="p">-&gt;</span></a></div><div class="w">or pick your own line and minute on the pair page</div></div>`; }); }).join('');
    }
    VR.swap($('#bList'), html || '<div class="empty">nothing open here right now.</div>', () => { VR.stagger($('#bList'), '.evrow2', 45); VR.fillBars($('#bList')); });
  }
  $('#bTabs').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; bKind = b.dataset.k; bSub = bKind === 'pm' ? 'politics' : bKind === 'game' ? 'nba' : ''; $$('#bTabs .br').forEach(x => x.classList.toggle('on', x === b)); board(); });
  $('#bSub').addEventListener('click', e => { const b = e.target.closest('[data-sub]'); if (!b) return; bSub = b.dataset.sub; board(); });

  // ---------- receipts ----------
  async function receipts() {
    const r = await api('/api/duels?op=receipts');
    const list = (r && r.receipts) || [];
    if (!r || !r.ok) { $('#rcBd').innerHTML = '<div class="empty"><span class="off">the receipts didn’t answer · retrying</span></div>'; return; }
    if (!list.length) { $('#rcBd').innerHTML = '<div class="empty">No settlements yet. When the first duel settles, its receipt prints here: the raw reading from the source, the outcome, the snapshot hash and every payout.</div>'; return; }
    const raw = x => { const e = x.reading || {}; if (e.source === 'polymarket') return `closed: ${e.closed} · outcomePrices: ${JSON.stringify(e.outcomePrices)} · uma: ${e.umaResolutionStatus || '—'}`;
      if (e.source === 'espn') return `${e.status} · ${e.home} ${e.score} ${e.away} · home winner: ${e.homeWinner}`; if (e.source === 'coinbase') return `1m candle ${e.candle ? e.candle[0] : ''} · close ${e.close} vs line ${e.line} (${e.op})`; return e.text || ''; };
    $('#rcBd').innerHTML = `<div class="rcpts">${list.map(x => `<div class="rcpt"><h4>VRSUS · DUEL ${esc(x.fp)}</h4>
      <div class="ln"><span>event</span><span>${esc(x.q)}</span></div>
      <div class="ln"><span>source</span><span><a class="u" href="${esc((x.reading && (x.reading.page || x.reading.api)) || x.src)}" target="_blank" rel="noopener">${VR.srcName(x.kind)}</a></span></div>
      <div class="ln"><span>read at</span><span>${day(x.settledAt)}</span></div>
      <div class="raw">${esc(raw(x))}</div>
      <div class="big4 ${x.outcome === 'YES' ? 'yes' : x.outcome === 'NO' ? 'no' : 'dim'}">${x.outcome === 'VOID' ? 'VOID' : x.outcome + ' WON'}</div>
      <div class="ln"><span>winner</span><span>${x.outcome === 'VOID' ? 'both, half each' : '$' + esc(x.outcome === 'YES' ? x.yes.symbol : x.no.symbol)}</span></div>
      <div class="ln"><span>paid</span><span>${sol(x.paidSol)}</span></div>
      ${(x.roundsList || []).map(rr => `<div class="ln"><span>round ${rr.round}</span><span>${rr.holders} ${rr.side.toUpperCase()} holders · ${sol(rr.paidSol)} · #${esc(rr.hash.slice(0, 10))}</span></div>`).join('')}
      <div class="r"><a class="br sm" href="/duel?id=${esc(x.id)}#rounds">verify it</a></div></div>`).join('')}</div>`;
    VR.stagger($('#rcBd .rcpts'), '.rcpt', 70);
  }

  // ---------- where the money goes ----------
  $('#moneyArt').innerHTML = [" <span class=\"y\">.--------------.</span>                                               <span class=\"n\">.--------------.</span>", " <span class=\"y\">|  $YES  coin  |</span>---- creator fees ---.   .--- creator fees ----<span class=\"n\">|   $NO  coin  |</span>", " <span class=\"y\">'--------------'</span>                     |   |                     <span class=\"n\">'--------------'</span>", "                                      v   v", "                               <span class=\"p\">.-----------------.</span>", "                               <span class=\"p\">|     THE POT     |</span>----> 5% to vrsus", "                               <span class=\"p\">|  one wallet is  |</span>", "                               <span class=\"p\">|  both creators  |</span>", "                               <span class=\"p\">'-----------------'</span>", "                                        |   the source says how it ended", "                                        v", "                    <span class=\"i\">snapshot every holder of the winning coin</span>", "                   <span class=\"i\">publish it + its hash \u00b7 pay pro rata in SOL</span>"].join('\n');
  const fitMoney = () => { const p = $('#moneyArt'); p.style.fontSize = ''; const w = p.parentNode.clientWidth; p.style.fontSize = Math.min(12.5, w / (82 * .6)) + 'px'; };
  addEventListener('resize', fitMoney); fitMoney();

  // ---------- the wire: what just happened, newest first; new lines type themselves in ----------
  let WIRE = [], wF = '', wSeen = new Set(), wFirst = true, wNext = 0, wMore = false;
  document.addEventListener('click', e => { if (e.target.closest('#wMore')) { wMore = !wMore; wpaint(); } });
  const KT = x => x.kind === 'new' ? ['new', '[NEW]'] : x.kind === 'move' ? [x.dir, `[MOVE ${x.dir === 'up' ? '+' : '-'}${(/([\d.]+) pts/.exec(x.sub) || [])[1] || ''}]`] : x.kind === 'live' ? ['live', 'LIVE'] : x.kind === 'final' ? ['final', '[FINAL]'] : x.kind === 'soon' ? ['soon', '[SOON]'] : [x.dir, `[${x.dir === 'up' ? '+' : '-'}${((/([\d.]+)%/.exec(x.sub) || [])[1]) || ''}%]`];
  const wkey = x => x.kind + '|' + x.head;
  function wtime(x) { const s = (Date.now() - new Date(x.t)) / 1000; return s < 90 ? 'now' : s < 3600 ? Math.round(s / 60) + 'm' : s < 86400 ? Math.round(s / 3600) + 'h' : Math.round(s / 86400) + 'd'; }
  function wpaint() {
    const all = WIRE.filter(x => !wF || x.src === wF), list = all.slice(0, wMore ? 30 : innerWidth < 640 ? 7 : 12);
    if (!list.length) { $('#wList').innerHTML = '<div class="empty">Nothing on this wire right now.</div>'; return; }
    const fresh = [];
    $('#wList').innerHTML = list.map((x, i) => { const [c, t] = KT(x), isNew = !wSeen.has(wkey(x)); if (isNew && !wFirst) fresh.push(i);
      return `<div class="wl${isNew && !wFirst ? ' fresh' : ''}" data-i="${i}"><span class="t">${wtime(x)}</span><span class="k ${c}">${esc(t)}</span>
        <span class="h"><span class="hx">${esc(x.head)}</span><span class="s"><span class="src">${esc(x.src)} ·</span> ${esc(x.sub)}</span></span>
        <span class="a">${x.pair ? `<a class="br sm" href="/pair#e=${enc(x.pair)}">pair it <span class="p">-&gt;</span></a>` : ''}<a class="br sm" href="${esc(x.link)}" target="_blank" rel="noopener">source</a></span></div>`; }).join('');
    // the first read types the top lines in one after another; later reads type only what is new
    const rows = $$('#wList .wl'), typeIdx = wFirst ? rows.slice(0, 6).map((_, i) => i) : fresh;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      let delay = 0;
      for (const i of typeIdx) { const el = $('.hx', rows[i]); if (!el) continue; const full = el.textContent; el.textContent = ''; el.classList.add('tw'); const d0 = delay; delay += Math.min(900, full.length * 14) + 120;
        setTimeout(() => { let k = 0; const go = () => { k += 2; el.textContent = full.slice(0, k); if (k < full.length) setTimeout(go, 14); else el.classList.remove('tw'); }; go(); }, d0); }
    }
    if (all.length > list.length || wMore) $('#wList').insertAdjacentHTML('beforeend', `<div class="wl" style="display:block;text-align:center"><button class="br sm" type="button" id="wMore">${wMore ? 'show fewer' : `show all ${all.length}`}</button></div>`);
    list.forEach(x => wSeen.add(wkey(x))); wFirst = false;
  }
  async function wire() {
    const r = await api('/api/events?op=wire'); wNext = Date.now() + 30000;
    if (!r || !r.ok) { if (!WIRE.length) $('#wList').innerHTML = '<div class="empty"><span class="off">the sources didn’t answer · listening again in 30s</span></div>'; return; }
    const before = WIRE.length ? new Set(WIRE.map(wkey)) : null;
    WIRE = r.items;
    const h = Object.values(r.health || {}), up = h.filter(Boolean).length;
    $('#wHealth').innerHTML = `<span class="hl">${h.map(v => `<i class="${v ? '' : 'x'}"></i>`).join('')}</span> ${up}/${h.length} feeds up · read ${VR.hhmm(r.at)}`;
    if (!before || WIRE.some(x => !before.has(wkey(x))) || !$('#wList .wl')) wpaint();
  }
  setInterval(() => { const el = $('#wLis'); if (!el || !wNext) return; const s = Math.max(0, Math.round((wNext - Date.now()) / 1000)); el.textContent = `listening · next read in ${s}s · news hits a source, lands here, pair it in one click`; }, 1000);
  $('#wTabs').addEventListener('click', e => { const b = e.target.closest('[data-w]'); if (!b) return; wF = b.dataset.w; $$('#wTabs .br').forEach(x => x.classList.toggle('on', x === b)); wpaint(); });

  // ---------- the system: the chain, the engine's heartbeat, the sources ----------
  function paintChain(c, prev) {
    const el = $('#xSlot'); if (!el) return;
    el.textContent = VR.num(c.slot); if (prev && prev.slot !== c.slot) { el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick'); }
    const k = Math.round(c.slotIndex / c.slotsInEpoch * 20);
    $('#xEp').innerHTML = `epoch ${c.epoch} <span class="g">[${'#'.repeat(k)}<span class="dim">${'-'.repeat(20 - k)}</span>]</span> ${(c.slotIndex / c.slotsInEpoch * 100).toFixed(1)}% · ${c.tps == null ? '—' : VR.num(c.tps)} tps`;
  }
  VR.onChain(paintChain); if (VR.chain()) paintChain(VR.chain());
  function paintStats(s) {
    $('#xPass').textContent = VR.num(s.day.passes); $('#xPassS').textContent = `avg ${s.day.avgMs}ms · ${s.day.errors} error${s.day.errors === 1 ? '' : 's'}`;
    $('#xPaid').textContent = sol(s.paidSol); $('#xPaidS').textContent = `to ${s.paidHolders} wallet${s.paidHolders === 1 ? '' : 's'} in ${s.rounds} round${s.rounds === 1 ? '' : 's'}`;
    $('#stPaid').textContent = sol(s.paidSol);
    if (s.lastTick) { $('#stTick').textContent = ago(s.lastTick); $('#stTickL').textContent = 'since the engine’s last pass (it runs every minute)'; }
    // the heartbeat: one column per pass in the last hour, height = how long the pass took, ! = a pass with errors
    const b = (s.beats || []).slice().reverse(), now = Date.now(), H = 6;
    const pre = $('#xHb'), fit = Math.floor((pre.clientWidth || 600) / (innerWidth < 640 ? 6.02 : 7.22)), bw = fit >= 120 ? 2 : 1, cols = Math.min(60, Math.floor(fit / bw));
    const slots = Array.from({ length: cols }, () => null);
    for (const x of b) { const age = (now - new Date(x.at)) / 6e4; const c = cols - 1 - Math.floor(age / (60 / cols)); if (c >= 0 && c < cols) slots[c] = x; }
    const mx = Math.max(400, ...b.map(x => x.ms));
    let out = '';
    for (let r = H; r >= 1; r--) out += slots.map(x => { if (!x) return r === 1 ? `<span class="cn">${'.'.repeat(bw)}</span>` : ' '.repeat(bw); const h = Math.max(1, Math.ceil(x.ms / mx * H)); if (h < r) return ' '.repeat(bw); const cl = x.errors ? 'cx' : r === h ? 'c3' : r > H / 2 ? 'c2' : 'c1'; return `<span class="${cl}">${(x.errors && r === h ? '!' : r === h ? '#' : '|').repeat(bw)}</span>`; }).join('') + '\n';
    $('#xHb').innerHTML = out;
    $('#xHbL').textContent = b.length ? `${b.length} passes in the last hour · slowest ${Math.max(...b.map(x => x.ms))}ms` : 'no passes recorded in the last hour yet';
  }
  VR.onStats(paintStats); if (VR.stats()) paintStats(VR.stats());
  setInterval(() => { const s = VR.stats(); if (!s) return; $('#xLast').textContent = s.lastTick ? ago(s.lastTick) : 'idle';
    const next = s.lastTick ? Math.max(0, 60 - Math.round((Date.now() - new Date(s.lastTick)) / 1000)) : null;
    $('#xNext').textContent = s.lastTick ? (next > 0 ? `next pass in ~${next}s` : 'next pass due now') : 'waiting for the first pass'; }, 1000);
  async function probe(btn) {
    if (btn) btn.disabled = true; $('#probe tbody').innerHTML = '<tr><td colspan="4" class="dim">reading every source…</td></tr>';
    const r = await api('/api/events?op=probe'); if (btn) btn.disabled = false;
    if (!r || !r.ok) { $('#probe tbody').innerHTML = '<tr><td colspan="4" class="red">the server didn’t answer</td></tr>'; return; }
    $('#probe tbody').innerHTML = r.rows.map(x => { const n = Math.min(16, Math.max(1, Math.round(x.ms / 70)));
      return `<tr><td>${esc(x.name)}</td><td>${x.ok ? '<span class="g">ok</span>' : '<span class="burn">offline</span>'}</td><td class="lat"><span class="latb">${'|'.repeat(n)}<span class="dim">${'.'.repeat(16 - n)}</span></span> ${x.ms}ms</td><td class="dim">${esc(x.sample || '—')}</td></tr>`; }).join('');
  }
  $('#probeGo').addEventListener('click', e => probe(e.currentTarget));
  if ('IntersectionObserver' in window) { const io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { io.disconnect(); probe(); } }); io.observe($('#system')); }

  // ---------- check your wallet: every round it is in, its leaf, its path to the published root ----------
  async function check(w) {
    w = String(w || '').trim(); const res = $('#pRes');
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w)) { res.innerHTML = '<div class="bad2">[x] that is not a Solana address</div>'; return; }
    res.innerHTML = '<div class="dim">reading every snapshot for this wallet…</div>';
    const r = await api('/api/duels?op=wallet&w=' + encodeURIComponent(w));
    if (!r || !r.ok) { res.innerHTML = `<div class="bad2">[x] ${esc((r && r.error) || 'the records didn’t answer')}</div>`; return; }
    if (!r.rounds.length) { res.innerHTML = `<div class="dim">${esc(VR.short(w))} isn’t in any payout snapshot yet${r.launched.length ? ` · it launched ${r.launched.length} duel${r.launched.length === 1 ? '' : 's'}` : ''}. When a duel it holds the winning side of settles, its leaf shows up here.</div>`; return; }
    const got = r.pays.filter(x => x.sig).reduce((t, x) => t + x.lamports, 0);
    res.innerHTML = `<div class="ok2">[+] ${r.rounds.length} round${r.rounds.length === 1 ? '' : 's'} · ${VP.S(got)} SOL received · proving each one below</div>`;
    for (const x of r.rounds.slice(0, 8)) {
      const box = document.createElement('div'); box.className = 'pr'; res.appendChild(box);
      box.innerHTML = `<div><b>#${x.n}</b> <span class="yes">$${esc(x.sy)}</span> vs <span class="no">$${esc(x.sn)}</span> · round ${x.round} · <b class="${x.side === 'yes' ? 'yes' : 'no'}">${x.side.toUpperCase()}</b> <span class="dim">${esc(x.q.slice(0, 70))}</span></div><div class="dim">recomputing…</div>`;
      const v = await VP.round(x.id, x.round); if (!v.ok) { box.lastChild.textContent = v.error; continue; }
      const pp = await VP.path(v, w); if (!pp) { box.lastChild.textContent = 'not found in this snapshot'; continue; }
      box.lastChild.outerHTML = `<pre class="ptree">${VP.tree(pp, v)}</pre><div style="margin-top:6px">${pp.pay && pp.pay.sig ? `<span class="ok2">[+] paid ${VP.S(pp.pay.lamports)} SOL</span> · <a class="u" href="${VR.tx(pp.pay.sig)}" target="_blank" rel="noopener">${esc(VR.short(pp.pay.sig))}</a>` : '<span class="dim">no payout for this leaf (under the dust line, or still pending)</span>'} · <a class="u" href="/duel?id=${esc(x.id)}#rounds">the duel</a></div>`;
    }
  }
  $('#pForm').addEventListener('submit', e => { e.preventDefault(); check($('#pIn').value); });
  $('#pMe').addEventListener('click', async () => { const w = VR.wallet() || await VR.connect(); if (w) { $('#pIn').value = w.pk; check(w.pk); } });
  $('#pRes').innerHTML = '<div class="dim">Every payout round commits to what each wallet is owed with a Merkle root. Paste a wallet to find its leaves and walk each one up to the published root, here in your browser.</div>';

  duels(); board(); receipts(); wire();
  setInterval(() => { if (!document.hidden) { duels(); receipts(); } }, 20000);
  setInterval(() => { if (!document.hidden) wire(); }, 30000);
})();
