/* vrsus: one shape for a duel, shared by the browser and the engine.
   A duel is one real event and two pump.fun coins: a YES coin and a NO coin. Both coins have the same creator wallet,
   so the creator fees of both land in one pot. When the source of the event says how it ended, the pot is paid in SOL
   to the holders of the winning coin. Nothing here touches the network; the readers live in api/_world.js. */
(function (root, make) { const V = make(); if (typeof module === 'object' && module.exports) module.exports = V; else root.VS = V; })(this, function () {
  const CATS = [{ id: 'war', name: 'war', tag: 'geopolitics' }, { id: 'politics', name: 'politics', tag: 'politics' }, { id: 'money', name: 'money', tag: 'economy' },
    { id: 'crypto', name: 'crypto', tag: 'crypto' }, { id: 'tech', name: 'tech', tag: 'tech' }, { id: 'culture', name: 'culture', tag: 'pop-culture' }];
  const LEAGUES = [
    { id: 'eng.1', sport: 'soccer', name: 'Premier League', draw: true }, { id: 'esp.1', sport: 'soccer', name: 'La Liga', draw: true },
    { id: 'uefa.champions', sport: 'soccer', name: 'Champions League', draw: true }, { id: 'ita.1', sport: 'soccer', name: 'Serie A', draw: true },
    { id: 'ger.1', sport: 'soccer', name: 'Bundesliga', draw: true }, { id: 'nba', sport: 'basketball', name: 'NBA' }, { id: 'nfl', sport: 'football', name: 'NFL' },
    { id: 'nhl', sport: 'hockey', name: 'NHL' }, { id: 'mlb', sport: 'baseball', name: 'MLB' },
  ];
  const ASSETS = ['SOL', 'BTC', 'ETH'];
  const HORIZONS = [1, 4, 12, 24, 72, 168];           // hours from now, rounded up to the hour
  const KINDS = {
    pm: { name: 'world', source: 'Polymarket', what: 'war, politics, money, crypto, tech, culture' },
    game: { name: 'sports', source: 'ESPN', what: 'soccer, NBA, NFL, NHL, MLB' },
    price: { name: 'price', source: 'Coinbase', what: 'SOL, BTC or ETH at an exact minute' },
  };
  const DEV = { min: 0.01, max: 5 };
  const POST_MIN = 0.05;                                 // after settlement, a new payout round once this much more SOL is in the pot
  const usd = v => '$' + (v >= 1 ? Number(v).toLocaleString('en-US', { maximumFractionDigits: v >= 1000 ? 0 : 2 }) : Number(v).toPrecision(3));
  const when = iso => new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  function fail(m) { const e = new Error(m); e.rule = true; throw e; }

  // the question and the exact settlement rule, written out the same way everywhere (pump.fun descriptions, pages, receipts)
  function describe(ev) {
    if (ev.kind === 'pm') return {
      q: ev.market.q,
      rule: `YES wins if Polymarket resolves this market YES. NO wins if it resolves NO. Void if Polymarket voids it.`,
      src: 'https://polymarket.com/event/' + (ev.market.slug || ''),
    };
    if (ev.kind === 'game') {
      const lg = LEAGUES.find(l => l.id === ev.league) || { name: ev.league };
      return {
        q: `Will ${ev.home.name} beat ${ev.away.name}?`,
        rule: `YES wins if ESPN marks the ${lg.name} game final with ${ev.home.name} as the winner. NO wins if ${ev.home.name} ${lg.draw ? 'draws or loses' : 'loses'}. Void if it is cancelled, or still not played 14 days after the scheduled start.`,
        src: ev.link || 'https://www.espn.com',
      };
    }
    if (ev.kind === 'price') return {
      q: `Will ${ev.asset} be ${ev.op === 'above' ? 'above' : 'below'} ${usd(ev.value)} at ${when(ev.at)}?`,
      rule: `YES wins if the Coinbase ${ev.asset}-USD one-minute candle that opens at ${when(ev.at)} closes ${ev.op === 'above' ? 'above' : 'below'} ${usd(ev.value)}. Otherwise NO wins.`,
      src: `https://api.exchange.coinbase.com/products/${ev.asset}-USD/candles?granularity=60&start=${encodeURIComponent(ev.at)}&end=${encodeURIComponent(new Date(new Date(ev.at).getTime() + 60000).toISOString())}`,
    };
    fail('Pick an event.');
  }
  const s = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  // the shape of an event a duel can be paired to (the server re-reads the source before it accepts one)
  function normalizeEvent(e) {
    e = e || {};
    if (e.kind === 'pm') {
      const m = e.market || {}; if (!/^\d{1,12}$/.test(String(m.id || ''))) fail('Pick a world event.');
      return { kind: 'pm', market: { id: String(m.id), q: s(m.q, 200), slug: s(m.slug, 160), cat: s(m.cat, 20) } };
    }
    if (e.kind === 'game') {
      const lg = LEAGUES.find(l => l.id === e.league); if (!lg) fail('Pick a league.');
      if (!/^\d{1,14}$/.test(String(e.gameId || ''))) fail('Pick a game.');
      return { kind: 'game', league: lg.id, gameId: String(e.gameId), home: { id: s((e.home || {}).id, 12), name: s((e.home || {}).name, 40) }, away: { id: s((e.away || {}).id, 12), name: s((e.away || {}).name, 40) }, date: s(e.date, 40), link: s(e.link, 200) };
    }
    if (e.kind === 'price') {
      if (!ASSETS.includes(e.asset)) fail('Pick SOL, BTC or ETH.');
      if (e.op !== 'above' && e.op !== 'below') fail('Pick above or below.');
      const v = Number(e.value); if (!(v > 0)) fail('Give a price.');
      const at = new Date(e.at); if (isNaN(at)) fail('Pick when.');
      return { kind: 'price', asset: e.asset, op: e.op, value: v >= 100 ? Math.round(v) : Math.round(v * 100) / 100, at: new Date(Math.floor(at.getTime() / 6e4) * 6e4).toISOString() };
    }
    fail('Pick an event.');
  }
  const canon = (ev, yes, no) => JSON.stringify({ ev, yes: { name: yes.name, symbol: yes.symbol }, no: { name: no.name, symbol: no.symbol } });
  // crowd odds from the two market caps; null until both coins have one
  const crowd = (a, b) => (a > 0 && b > 0 ? Math.round(1000 * a / (a + b)) / 10 : null);
  // the payout split, exactly as the engine computes it: floor(pot × bag / total), dust under 0.0001 SOL is skipped and stays in the pot
  function split(pot, holders) {
    const total = holders.reduce((t, h) => t + BigInt(h.amount), 0n);
    if (total === 0n) return [];
    return holders.map(h => ({ owner: h.owner, amount: String(h.amount), lamports: Number(BigInt(pot) * BigInt(h.amount) / total) }));
  }
  const DUST = 100000;
  // ---- the Merkle commitment of a payout round ----
  // One leaf per wallet in the published snapshot, in its published order, committing to what that wallet is owed:
  //   leaf = sha256("L|" + round + "|" + side + "|" + owner + "|" + bag + "|" + lamports)
  //   node = sha256("N|" + left + "|" + right)      an odd node at the end of a level moves up unchanged
  // H is any sha256-to-hex function: sync on the server, async (SubtleCrypto) in the browser; both work with await.
  const leaves = (round, side, pot, holders) => split(pot, holders).map(p => ({ owner: p.owner, amount: p.amount, lamports: p.lamports, s: `L|${round}|${side}|${p.owner}|${p.amount}|${p.lamports}` }));
  async function merkle(strs, H) {
    let lvl = []; for (const s of strs) lvl.push(await H(s));
    const levels = [lvl];
    while (lvl.length > 1) { const nx = []; for (let i = 0; i < lvl.length; i += 2) nx.push(i + 1 < lvl.length ? await H('N|' + lvl[i] + '|' + lvl[i + 1]) : lvl[i]); levels.push(lvl = nx); }
    return { root: lvl[0] || null, levels };
  }
  // the sibling hashes from leaf i up to the root; pos says which side the sibling sits on
  function proof(levels, i) { const path = []; for (let d = 0; d < levels.length - 1; d++) { const sib = i ^ 1; if (sib < levels[d].length) path.push({ d, pos: i & 1 ? 'L' : 'R', hash: levels[d][sib] }); i >>= 1; } return path; }
  async function walk(leafHash, path, H) { let h = leafHash; const steps = [h]; for (const p of path) { h = await H(p.pos === 'L' ? 'N|' + p.hash + '|' + h : 'N|' + h + '|' + p.hash); steps.push(h); } return { root: h, steps }; }
  // the flat snapshot hash (kept alongside the root): sha256(side|pot|owner:bag,owner:bag,…)
  const snapStr = (side, pot, holders) => `${side}|${pot}|` + holders.map(h => `${h.owner}:${h.amount}`).join(',');
  return { CATS, LEAGUES, ASSETS, HORIZONS, KINDS, DEV, POST_MIN, DUST, usd, when, describe, normalizeEvent, canon, crowd, split, leaves, merkle, proof, walk, snapStr };
});
