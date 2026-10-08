// GET  /api/events?op=world&cat=      open Polymarket markets on a beat
// GET  /api/events?op=sports&league=  ESPN games in the next 7 days
// GET  /api/events?op=price           SOL, BTC and ETH right now (a price duel is drawn from a line and a minute)
// POST /api/events?op=read {event}    what the event's source says right now, with the raw evidence (the same reading the engine settles on)
// GET  /api/events?op=probe           every source, timed
// GET  /api/events?op=wire            what just happened: new markets, odds moves, games live/final, price moves (each pairable line carries its event)
// GET  /api/events?op=chain           Solana right now: slot, block height, epoch progress, TPS
// POST /api/events?op=rpc             read-only transaction lookups for browsers ({method, params})
const L = require('./_lib');
const WD = require('./_world');
const V = require('../assets/js/vrsus.js');
async function probe(res) {
  const t = async (name, fn) => { const t0 = Date.now(); try { const v = await fn(); return { name, ok: !!(v && v.ok !== false), ms: Date.now() - t0, sample: v && v.sample }; } catch (e) { return { name, ok: false, ms: Date.now() - t0 }; } };
  const rows = await Promise.all([
    t('world · polymarket', async () => { const m = await WD.world('politics'); return { ok: m.ok, sample: m.ok ? m.markets[0].q.slice(0, 44) + ' · YES ' + m.markets[0].yes + '%' : null }; }),
    t('sports · espn', async () => { const g = await WD.games('nba'); const h = g.ok && g.games[0]; return { ok: g.ok, sample: h ? `${h.away.name} @ ${h.home.name} · ${V.when(h.date)}` : g.ok ? 'no NBA games this week' : null }; }),
    t('price · coinbase', async () => { const c = await WD.candle('SOL', new Date(Date.now() - 3 * 6e4).toISOString()); return { ok: c.ok, sample: c.ok ? `SOL 1m candle closed ${V.usd(c.close)}` : null }; }),
    t('chain · solana rpc', async () => { const s = await L.rpc('getSlot', [{ commitment: 'confirmed' }]); return { ok: s > 0, sample: 'slot ' + s }; }),
  ]);
  L.send(res, 200, { ok: true, rows, at: new Date().toISOString() }, L.CACHE(20));
}
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return L.send(res, 204, {});
  const qy = L.query(req); const op = String(qy.op || '');
  try {
    if (op === 'world') return L.send(res, 200, await WD.world(String(qy.cat || '')), L.CACHE(90));
    if (op === 'sports') return L.send(res, 200, await WD.games(String(qy.league || '')), L.CACHE(120));
    if (op === 'price') { const ps = await Promise.all(V.ASSETS.map(a => WD.price(a).catch(() => ({ ok: false, asset: a })))); return L.send(res, 200, { ok: true, prices: ps, at: new Date().toISOString() }, L.CACHE(15)); }
    if (op === 'read' && req.method === 'POST') {
      if (L.limited('read:' + L.ip(req), 40, 60000)) return L.send(res, 200, { ok: false, error: 'Slow down a little.' });
      const b = await L.body(req, 8192); let ev; try { ev = V.normalizeEvent(b.event); } catch (e) { return L.send(res, 200, { ok: false, error: e.message }); }
      return L.send(res, 200, { ok: true, reading: await WD.read(ev, false), at: new Date().toISOString() });
    }
    if (op === 'probe') return probe(res);
    if (op === 'wire') return L.send(res, 200, await WD.wire(), L.CACHE(30, 120));
    if (op === 'chain') {   // the chain right now: slot, block height, epoch, and throughput from the last performance sample
      const c = await L.remember('chain', 1800, async () => {
        const t0 = Date.now();
        const [ep, perf] = await Promise.all([L.rpc('getEpochInfo', [{ commitment: 'confirmed' }], 6000), L.rpc('getRecentPerformanceSamples', [1], 6000).catch(() => null)]);
        const p = perf && perf[0];
        return { ok: true, slot: ep.absoluteSlot, height: ep.blockHeight, epoch: ep.epoch, slotIndex: ep.slotIndex, slotsInEpoch: ep.slotsInEpoch,
          tps: p ? Math.round(p.numTransactions / p.samplePeriodSecs) : null, slotMs: p && p.numSlots ? Math.round(p.samplePeriodSecs * 1000 / p.numSlots) : null, rpcMs: Date.now() - t0, at: new Date().toISOString() };
      });
      return L.send(res, 200, c, L.CACHE(2, 10));
    }
    if (op === 'rpc' && req.method === 'POST') {   // a read-only relay for browsers whose RPC refuses them: transaction lookups only
      if (L.limited('rpc:' + L.ip(req), 60, 60000)) return L.send(res, 200, { ok: false, error: 'Slow down a little.' });
      const b = await L.body(req, 4096);
      if (!['getTransaction', 'getSignatureStatuses'].includes(b.method) || !Array.isArray(b.params)) return L.send(res, 200, { ok: false, error: 'Only getTransaction and getSignatureStatuses.' });
      return L.send(res, 200, await L.rpcRaw(b.method, b.params, 12000));
    }
    L.send(res, 200, { ok: false, error: 'unknown op' });
  } catch (e) { L.send(res, 200, { ok: false, error: 'The source didn’t answer just now.' }); }
};
