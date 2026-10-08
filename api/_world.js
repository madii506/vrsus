// The sources. A duel settles only on a reading from one of these, and every reading keeps the raw fields and the link it came from.
//   world   Polymarket's public gamma API (a market's outcome once Polymarket resolves it)
//   sports  ESPN's public scoreboards and game summaries (the final score, the moment ESPN marks it final)
//   price   Coinbase Exchange one-minute candles (the close of the candle that opens at the duel's minute)
//   coins   Dexscreener once a pool exists, the pump.fun bonding curve before that
const L = require('./_lib');
const V = require('../assets/js/vrsus.js');
const now = () => new Date().toISOString();
const r2 = v => Math.round(v * 100) / 100;

// ---------- price ----------
async function price(asset) {
  if (!V.ASSETS.includes(asset)) return { ok: false, error: 'unknown asset' };
  return L.remember('px:' + asset, 20000, async () => {
    const p = asset + '-USD';
    const [spot, c60] = await Promise.all([L.getJson(`https://api.coinbase.com/v2/prices/${p}/spot`, {}, 7000), L.getJson(`https://api.exchange.coinbase.com/products/${p}/candles?granularity=3600`, {}, 7000)]);
    const v = Number(spot.json && spot.json.data && spot.json.data.amount);
    if (!(v > 0)) return { ok: false, asset, error: 'coinbase did not answer' };
    const k = Array.isArray(c60.json) ? c60.json : [];
    const h24 = k.length > 24 ? Number(k[24][4]) : null;
    return { ok: true, asset, price: v, ch24h: h24 ? r2((v / h24 - 1) * 100) : null, src: `https://api.coinbase.com/v2/prices/${p}/spot`, at: now() };
  });
}
// the one-minute candle that opens at `at` (ISO), straight from Coinbase Exchange: [time, low, high, open, close, volume]
async function candle(asset, at) {
  const t = Math.floor(new Date(at).getTime() / 6e4) * 60;
  const url = `https://api.exchange.coinbase.com/products/${asset}-USD/candles?granularity=60&start=${new Date(t * 1000).toISOString()}&end=${new Date((t + 60) * 1000).toISOString()}`;
  const r = await L.getJson(url, {}, 8000);
  if (!Array.isArray(r.json)) return { ok: false, error: 'coinbase did not answer', src: url };
  const c = r.json.find(k => Number(k[0]) === t);
  if (!c) return { ok: false, pending: true, error: 'no candle for that minute yet', src: url };
  return { ok: true, time: new Date(t * 1000).toISOString(), low: Number(c[1]), high: Number(c[2]), open: Number(c[3]), close: Number(c[4]), volume: Number(c[5]), src: url };
}

// ---------- world: Polymarket ----------
const GAMMA = 'https://gamma-api.polymarket.com';
const parseArr = v => { try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch { return []; } };
function mkt(m, ev, cat) {
  const outs = parseArr(m.outcomes), px = parseArr(m.outcomePrices).map(Number);
  const yi = outs.findIndex(o => /^yes$/i.test(o)); if (yi < 0 || !isFinite(px[yi])) return null;
  const slug = (ev && ev.slug) || ((m.events || [])[0] || {}).slug || m.slug || '';
  const yes = px[yi], closed = !!m.closed, uma = String(m.umaResolutionStatus || '').toLowerCase();
  const resolved = closed && (yes >= .995 || yes <= .005) ? (yes >= .995 ? 'YES' : 'NO') : null;
  return { id: String(m.id), q: String(m.question || ''), slug, cat: cat || null, yes: Math.round(yes * 1000) / 10, closed, resolved, voided: closed && !resolved && uma === 'resolved',
    uma: uma || null, prices: px, end: m.endDate || null, vol: Number(m.volume24hr || m.volume || 0), src: 'https://polymarket.com/event/' + slug };
}
async function world(cat) {
  const c = V.CATS.find(x => x.id === cat); if (!c) return { ok: false, error: 'unknown kind' };
  return L.remember('pm:' + cat, 120000, async () => {
    const r = await L.getJson(`${GAMMA}/events?tag_slug=${c.tag}&active=true&closed=false&order=volume24hr&ascending=false&limit=30`, {}, 9000);
    const evs = Array.isArray(r.json) ? r.json : []; const t = Date.now(), list = [];
    for (const ev of evs) {
      const ms = (ev.markets || []).filter(m => !m.closed && m.active !== false && m.acceptingOrders !== false).map(m => mkt(m, ev, cat))
        .filter(x => x && x.q && !/^(game|map|set|round|match) \d+\s*:/i.test(x.q) && !NOISE.test(x.q) && x.yes >= 2 && x.yes <= 98)
        .filter(x => { const e = x.end ? new Date(x.end).getTime() : NaN; return isFinite(e) && e > t + 36e5 && e < t + 400 * 864e5; })
        .sort((a, b) => b.vol - a.vol);
      if (ms.length) list.push(...ms.slice(0, 2));
    }
    if (!list.length) return { ok: false, cat, error: 'polymarket did not answer' };
    list.sort((a, b) => b.vol - a.vol);
    return { ok: true, cat, markets: list.slice(0, 18), src: 'https://polymarket.com/' + c.tag, at: now() };
  });
}
async function market(id, fresh) {
  if (!/^\d{1,12}$/.test(String(id))) return { ok: false };
  return L.remember('pmm:' + id, fresh ? 1 : 45000, async () => {
    const url = `${GAMMA}/markets/${id}`;
    const r = await L.getJson(url, {}, 8000);
    const m = r.json && !Array.isArray(r.json) ? r.json : Array.isArray(r.json) ? r.json[0] : null;
    const x = m ? mkt(m) : null;
    return x ? { ok: true, ...x, api: url, at: now() } : { ok: false, error: 'polymarket did not answer', api: url };
  });
}

// ---------- sports: ESPN ----------
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const lgOf = id => V.LEAGUES.find(l => l.id === id);
const scoreOf = c => { const s = c && c.score; return s == null ? '' : typeof s === 'object' ? String(s.displayValue != null ? s.displayValue : s.value) : String(s); };
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');
function gameRow(ev, lg) {
  const comp = (ev.competitions || [])[0] || {}; const st = (comp.status || ev.status || {}).type || {}; const cs = comp.competitors || [];
  const h = cs.find(c => c.homeAway === 'home') || cs[0], a = cs.find(c => c !== h); if (!h || !a) return null;
  const T = c => ({ id: String((c.team || {}).id || ''), name: (c.team || {}).displayName || (c.team || {}).name || '', short: (c.team || {}).shortDisplayName || '', abbr: (c.team || {}).abbreviation || '' });
  const link = ((ev.links || []).find(l => /gamecast|summary|boxscore/i.test((l.rel || []).join(' '))) || (ev.links || [])[0] || {}).href || `https://www.espn.com/${lg.sport}/game/_/gameId/${ev.id}`;
  return { league: lg.id, leagueName: lg.name, gameId: String(ev.id), date: ev.date || comp.date || comp.startDate || null, state: st.state || '', status: st.name || '', completed: !!st.completed, detail: st.shortDetail || '',
    home: T(h), away: T(a), hs: scoreOf(h), as: scoreOf(a), hw: h.winner === true, aw: a.winner === true, link };
}
// upcoming games in a league over the next week (the ones a duel can be paired to)
async function games(id) {
  const lg = lgOf(id); if (!lg) return { ok: false, error: 'unknown league' };
  return L.remember('games:' + id, 300000, async () => {
    const d0 = new Date(), d1 = new Date(Date.now() + 7 * 864e5);
    let r = await L.getJson(`${ESPN}/${lg.sport}/${lg.id}/scoreboard?dates=${ymd(d0)}-${ymd(d1)}&limit=200`, {}, 9000);
    if (!r.json || !Array.isArray(r.json.events)) r = await L.getJson(`${ESPN}/${lg.sport}/${lg.id}/scoreboard`, {}, 9000);
    const t = Date.now();
    const list = ((r.json && r.json.events) || []).map(ev => gameRow(ev, lg)).filter(g => g && g.state === 'pre' && new Date(g.date).getTime() > t + 10 * 6e4)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    if (!r.json) return { ok: false, error: 'espn did not answer' };
    return { ok: true, league: lg.id, name: lg.name, games: list.slice(0, 24), at: now() };
  });
}
// one game, read fresh for settlement: ESPN's game summary
async function game(leagueId, gameId) {
  const lg = lgOf(leagueId); if (!lg || !/^\d{1,14}$/.test(String(gameId))) return { ok: false, error: 'bad game' };
  const api = `${ESPN}/${lg.sport}/${lg.id}/summary?event=${gameId}`;
  const r = await L.getJson(api, {}, 9000);
  const comp = r.json && r.json.header && (r.json.header.competitions || [])[0];
  if (!comp) return { ok: false, error: 'espn did not answer', api };
  const g = gameRow({ id: gameId, competitions: [comp], links: r.json.header.links || [] }, lg);
  return g ? { ok: true, ...g, api } : { ok: false, error: 'espn did not answer', api };
}

// ---------- the coins themselves ----------
async function coinMarket(mint) {
  if (!L.isAddr(mint)) return { ok: false };
  return L.remember('cm:' + mint, 45000, async () => {
    try {
      const r = await L.getJson(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {}, 7000);
      const ps = ((r.json && r.json.pairs) || []).filter(p => p.chainId === 'solana').sort((a, b) => ((b.liquidity || {}).usd || 0) - ((a.liquidity || {}).usd || 0));
      if (ps.length) { const p = ps[0]; return { ok: true, mcapUsd: Number(p.marketCap || p.fdv || 0) || null, priceUsd: Number(p.priceUsd) || null, complete: p.dexId !== 'pumpfun', src: p.url, at: now() }; }
    } catch {}
    try {
      const [bc] = await L.accounts([L.bondingCurveOf(mint)]);
      if (bc && bc.data.length >= 49) {
        const vTok = Number(bc.data.readBigUInt64LE(8)), vSol = Number(bc.data.readBigUInt64LE(16)), supply = Number(bc.data.readBigUInt64LE(40)), complete = bc.data[48] === 1;
        const sp = await price('SOL'); const solUsd = sp.ok ? sp.price : null;
        const mcapSol = vTok ? (vSol / 1e9) * (supply / vTok) : null;
        return { ok: true, mcapUsd: mcapSol && solUsd ? mcapSol * solUsd : null, mcapSol, complete, src: 'https://pump.fun/coin/' + mint, at: now() };
      }
    } catch {}
    return { ok: false, error: 'no market yet', src: 'https://pump.fun/coin/' + mint };
  });
}

// ---------- the wire: what just happened in the world, from the same three sources, newest first ----------
// new Polymarket markets (breaking news opens a market within minutes), the biggest odds moves, games going live or final,
// and sharp price moves. Every line links to its source, and every line that can still be paired carries the event to pair.
const NOISE = /\b\d{2,}\s?-\s?\d{2,}\b|tweets|\b(bitcoin|ethereum|solana|xrp|btc|eth|sol)\b.*\b(above|below|between|reach|dip|hit)\b.*\$[\d,.]+[k]?\b.*\bon (january|february|march|april|may|june|july|august|september|october|november|december) \d|up or down|\b\d{1,2}(:\d{2})?\s?(am|pm)\s?(et|est|edt|utc)?\b|o\/u|over\/under|spread|handicap|total (points|goals|kills|runs)|\bvs\.?\s|map \d|game \d|set \d|\bto score\b|anytime|first (goal|half)|1st half|2nd half/i;
const pmEv = m => ({ kind: 'pm', market: { id: m.id, q: m.q, slug: m.slug, cat: null } });
async function wire() {
  return L.remember('wire', 40000, async () => {
    const t = Date.now(), items = [], health = {}, diag = {};
    const ok = (k, v) => { health[k] = v; };
    const pmUsable = m => m && m.q && !NOISE.test(m.q) && m.yes >= 3 && m.yes <= 97 && (() => { const e = m.end ? new Date(m.end).getTime() : NaN; return isFinite(e) && e > t + 36e5 && e < t + 400 * 864e5; })();
    await Promise.all([
      (async () => {   // newest markets: market ids only grow, so the highest ids are the newest
        // new events: breaking news opens a new Polymarket event within minutes; take each new event's best open market
        const since = new Date(t - 96 * 36e5).toISOString();
        const r = await L.getJson(`${GAMMA}/events?active=true&closed=false&start_date_min=${encodeURIComponent(since)}&order=startDate&ascending=false&limit=200`, {}, 9000);
        const evs = Array.isArray(r.json) ? r.json : [];
        ok('polymarket:new', evs.length > 0); diag.newRaw = evs.length;
        const cand = [];
        for (const ev of evs) {
          if (NOISE.test(ev.title || '')) continue;
          const ms = (ev.markets || []).filter(m => !m.closed && m.active !== false).map(m => ({ m: mkt(m, ev), raw: m })).filter(x => pmUsable(x.m)).sort((x, y) => y.m.vol - x.m.vol);
          if (!ms.length) continue;
          const born = new Date(ev.createdAt || ev.startDate || ms[0].raw.createdAt || 0).getTime(); if (!(born > t - 96 * 36e5)) continue;
          cand.push({ born, m: ms[0].m, vol: Number(ev.volume24hr || ev.volume || 0) });
        }
        cand.sort((x, y) => y.born - x.born);
        let n = 0;
        for (const c of cand) {
          const m = c.m;
          items.push({ t: new Date(Math.min(c.born, t)).toISOString(), kind: 'new', src: 'polymarket', head: m.q, sub: `new market · YES ${m.yes}%${c.vol ? ' · $' + Math.round(c.vol).toLocaleString('en-US') + ' traded' : ''} · ends ${V.when(m.end).slice(0, 10)}`, link: m.src, pair: pmEv(m) });
          if (++n >= 10) break;
        }
        diag.newKept = n;
      })(),
      (async () => {   // the biggest odds moves among the busiest markets
        const r = await L.getJson(`${GAMMA}/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=300`, {}, 9000);
        const arr = Array.isArray(r.json) ? r.json : []; ok('polymarket:moves', arr.length > 0);
        const mv = arr.map(raw => ({ m: mkt(raw), h: Number(raw.oneHourPriceChange) || 0, d: Number(raw.oneDayPriceChange) || 0 }))
          .filter(x => pmUsable(x.m) && (Math.abs(x.h) >= .02 || Math.abs(x.d) >= .05)).sort((a, b) => (Math.abs(b.h) * 3 + Math.abs(b.d)) - (Math.abs(a.h) * 3 + Math.abs(a.d))).slice(0, 8);
        for (const x of mv) {
          const big = Math.abs(x.h) >= .02 ? x.h : x.d, win = Math.abs(x.h) >= .02 ? '1h' : '24h', pts = Math.round(Math.abs(big) * 1000) / 10;
          items.push({ t: new Date(t).toISOString(), kind: 'move', src: 'polymarket', dir: big > 0 ? 'up' : 'dn', head: x.m.q, sub: `odds ${big > 0 ? 'up' : 'down'} ${pts} pts in ${win} · now YES ${x.m.yes}%`, link: x.m.src, pair: pmEv(x.m), w: Math.abs(big) });
        }
      })(),
      ...V.LEAGUES.map(lg => (async () => {   // today's scoreboard in every league
        const r = await L.getJson(`${ESPN}/${lg.sport}/${lg.id}/scoreboard`, {}, 8000);
        const evs = (r.json && r.json.events) || []; ok('espn:' + lg.id, !!r.json);
        for (const ev of evs) {
          const g = gameRow(ev, lg); if (!g) continue; const at = new Date(g.date).getTime();
          if (g.state === 'in') items.push({ t: new Date(t).toISOString(), kind: 'live', src: 'espn', head: `${g.home.name} ${g.hs}–${g.as} ${g.away.name}`, sub: `${lg.name} · live · ${g.detail}`, link: g.link });
          else if (g.state === 'post' && g.completed && at > t - 14 * 36e5) items.push({ t: new Date(Math.min(t, at + 2 * 36e5)).toISOString(), kind: 'final', src: 'espn', head: `${g.home.name} ${g.hs}–${g.as} ${g.away.name}`, sub: `${lg.name} · final${g.hw ? ' · ' + g.home.short + ' win' : g.aw ? ' · ' + g.away.short + ' win' : ' · draw'}`, link: g.link });
          else if (g.state === 'pre' && at > t + 15 * 6e4 && at < t + 30 * 36e5) items.push({ t: new Date(t).toISOString(), kind: 'soon', src: 'espn', head: `${g.away.name} at ${g.home.name}`, sub: `${lg.name} · starts ${V.when(g.date).slice(5)}`, link: g.link, at: g.date,
            pair: { kind: 'game', league: lg.id, gameId: g.gameId, home: g.home, away: g.away, date: g.date, link: g.link } });
        }
      })()),
      ...V.ASSETS.map(a => (async () => {   // the last hour on Coinbase, from five-minute candles
        const r = await L.getJson(`https://api.exchange.coinbase.com/products/${a}-USD/candles?granularity=300`, {}, 7000);
        const k = Array.isArray(r.json) ? r.json : []; ok('coinbase:' + a, k.length > 12);
        if (k.length <= 12) return;
        const now = Number(k[0][4]), h1 = Number(k[12][4]), ch = (now / h1 - 1) * 100;
        const hi = Math.max(...k.slice(0, 12).map(c => Number(c[2]))), lo = Math.min(...k.slice(0, 12).map(c => Number(c[1])));
        const step = now > 10000 ? 500 : now > 1000 ? 25 : 2.5, line = ch >= 0 ? Math.ceil(now * 1.01 / step) * step : Math.floor(now * .99 / step) * step;
        const at = new Date(t + 4 * 36e5); at.setUTCMinutes(0, 0, 0);
        items.push({ t: new Date(t).toISOString(), kind: 'px', src: 'coinbase', dir: ch >= 0 ? 'up' : 'dn', head: `${a} ${V.usd(now)}`, sub: `${ch >= 0 ? '+' : ''}${ch.toFixed(2)}% in 1h · range ${V.usd(lo)}–${V.usd(hi)}`, link: `https://exchange.coinbase.com/trade/${a}-USD`, w: Math.abs(ch),
          pair: { kind: 'price', asset: a, op: ch >= 0 ? 'above' : 'below', value: line, at: at.toISOString() } });
      })()),
    ].map(p => p.catch(() => {})));
    const rank = { move: 0, live: 1, new: 2, px: 3, final: 4, soon: 5 };
    items.sort((a, b) => (new Date(b.t) - new Date(a.t)) || (rank[a.kind] - rank[b.kind]) || ((b.w || 0) - (a.w || 0)));
    // keep the wire readable: a cap per kind so one league or one source can't flood it
    const cap = { new: 10, move: 8, live: 10, final: 8, soon: 8, px: 3 }, seen = {}, out = [];
    for (const x of items) { seen[x.kind] = (seen[x.kind] || 0) + 1; if (seen[x.kind] <= cap[x.kind]) out.push(x); }
    return { ok: out.length > 0, items: out.slice(0, 40), health, diag, at: new Date(t).toISOString() };
  });
}

// ---------- the settlement reading: what the source says about a duel's event, right now ----------
// returns { ok, outcome: 'YES'|'NO'|'VOID'|null, text, evidence }   ok=false means the source could not be read (nothing settles on a guess)
async function read(ev, fresh = true) {
  try {
    if (ev.kind === 'pm') {
      const m = await market(ev.market.id, fresh);
      if (!m.ok) return { ok: false, text: 'Polymarket didn’t answer', evidence: { api: m.api } };
      const evidence = { source: 'polymarket', api: m.api, page: m.src, closed: m.closed, outcomePrices: m.prices, umaResolutionStatus: m.uma, question: m.q, read_at: m.at };
      if (m.resolved) return { ok: true, outcome: m.resolved, text: `Polymarket resolved it ${m.resolved}`, evidence };
      if (m.voided) return { ok: true, outcome: 'VOID', text: 'Polymarket voided it', evidence };
      return { ok: true, outcome: null, text: m.closed ? 'closed, waiting for Polymarket’s resolution' : `open · YES ${m.yes}% on Polymarket`, yes: m.yes, evidence };
    }
    if (ev.kind === 'game') {
      const g = await game(ev.league, ev.gameId);
      if (!g.ok) return { ok: false, text: 'ESPN didn’t answer', evidence: { api: g.api } };
      const evidence = { source: 'espn', api: g.api, page: g.link, status: g.status, state: g.state, completed: g.completed, home: g.home.name, away: g.away.name, score: `${g.hs}-${g.as}`, homeWinner: g.hw, awayWinner: g.aw, read_at: now() };
      if (/CANCEL/i.test(g.status)) return { ok: true, outcome: 'VOID', text: 'ESPN lists it as cancelled', evidence };
      if (g.completed && g.state === 'post' && /FINAL|FULL_TIME|END/i.test(g.status || 'STATUS_FINAL')) {
        const homeWon = g.hw === true, draw = !g.hw && !g.aw;
        return { ok: true, outcome: homeWon ? 'YES' : 'NO', text: `final: ${g.home.name} ${g.hs}–${g.as} ${g.away.name}${draw ? ' (draw)' : ''}`, evidence };
      }
      if (/POSTPONED|DELAYED|SUSPENDED/i.test(g.status) && Date.now() - new Date(ev.date).getTime() > 14 * 864e5) return { ok: true, outcome: 'VOID', text: 'postponed and not played within 14 days', evidence };
      return { ok: true, outcome: null, text: g.state === 'in' ? `live: ${g.home.name} ${g.hs}–${g.as} ${g.away.name} · ${g.detail}` : g.state === 'pre' ? (g.date ? `starts ${V.when(g.date)}` : 'not started yet') : (g.detail || g.status || 'not final yet'), evidence };
    }
    if (ev.kind === 'price') {
      if (Date.now() < new Date(ev.at).getTime() + 60000) {
        const p = await price(ev.asset);
        return { ok: true, outcome: null, text: p.ok ? `${ev.asset} is ${V.usd(p.price)} now · settles at ${V.when(ev.at)}` : `settles at ${V.when(ev.at)}`, evidence: { source: 'coinbase', spot: p.ok ? p.price : null, read_at: now() } };
      }
      const c = await candle(ev.asset, ev.at);
      if (!c.ok) return { ok: !!c.pending, outcome: null, text: c.pending ? 'waiting for Coinbase to publish that minute' : 'Coinbase didn’t answer', evidence: { api: c.src } };
      const yes = ev.op === 'above' ? c.close > ev.value : c.close < ev.value;
      return { ok: true, outcome: yes ? 'YES' : 'NO', text: `${ev.asset} closed ${V.usd(c.close)} at ${V.when(c.time)} (${ev.op} ${V.usd(ev.value)}: ${yes ? 'yes' : 'no'})`,
        evidence: { source: 'coinbase', api: c.src, candle: [c.time, c.low, c.high, c.open, c.close, c.volume], close: c.close, line: ev.value, op: ev.op, read_at: now() } };
    }
  } catch (e) { return { ok: false, text: 'source error: ' + String(e && e.message).slice(0, 80) }; }
  return { ok: false, text: 'unknown event' };
}

module.exports = { price, candle, world, market, games, game, coinMarket, read, wire };
