// GET /api/duels                 every duel (live first): the event, both coins, crowd odds, the pot
// GET /api/duels?id=<id>|m=<mint> one duel with its live reading, its rounds (snapshot + every payout) and the full log
// GET /api/duels?op=receipts     settled duels with their settlement receipts
// GET /api/duels?op=log          the latest engine actions (the tape)
// GET /api/duels?op=stats        totals and the engine's heartbeat
// GET /api/duels?op=round&id=&r= one payout round in full: the published snapshot, its hash and Merkle root, every payout and its transaction
// GET /api/duels?op=series&id=    a live duel's tape: both market caps, the pot and the source's number, every ~5 minutes
// GET /api/duels?op=wallet&w=     everything owed or paid to one wallet, with the rounds it appears in
// GET /api/duels?op=bundle&id=    the full proof of one duel as one JSON file (what verify.mjs checks)
const L = require('./_lib');
const E = require('./_engine');
const V = require('../assets/js/vrsus.js');
const S = n => (n == null ? null : +(Number(n) / 1e9).toFixed(4));
const coin = (c, site, id, side) => ({ name: c.name, symbol: c.symbol, mint: c.mint, img: `${site}/i/${id}-${side}` });
const pub = (d, site) => ({ id: d.id, n: d.n, kind: d.kind, q: d.q, rule: d.rule, src: d.src, closesAt: d.closes_at, state: d.state, fp: d.fp,
  event: d.event, yes: { ...coin(d.yes, site, d.id, 'yes'), mcapUsd: d.mcap_yes }, no: { ...coin(d.no, site, d.id, 'no'), mcapUsd: d.mcap_no },
  crowd: V.crowd(d.mcap_yes, d.mcap_no), potSol: S(d.pot_now), claimedSol: S(d.claimed), paidSol: S(d.paid), rounds: d.rounds, outcome: d.outcome, settledAt: d.settled_at,
  lastRead: d.last_read, lastReadAt: d.last_read_at, liveAt: d.live_at, createdAt: d.created_at });

module.exports = async (req, res) => {
  const qy = L.query(req);
  if (!L.dbReady()) return L.send(res, 200, { ok: true, offline: true, duels: [], log: [] });
  try {
    await L.ready(); const site = L.origin(req);
    if (qy.op === 'log') {
      const r = await L.q(`SELECT l.kind, l.text, l.sig, l.src, l.sol, l.at, d.id, d.yes->>'symbol' AS sy, d.no->>'symbol' AS sn FROM vs_log l JOIN vs_duels d ON d.id = l.id
        WHERE l.kind IN ('settle','pay','claim','launch','snapshot','fee','refund') AND d.state NOT IN ('waiting','expired') ORDER BY l.n DESC LIMIT 40`);
      return L.send(res, 200, { ok: true, log: r }, L.CACHE(10));
    }
    if (qy.op === 'stats') {
      const r = await L.q(`SELECT count(*) FILTER (WHERE state='live')::int AS live, count(*) FILTER (WHERE state IN ('settled','settling'))::int AS settled,
        COALESCE(sum(claimed),0)::bigint AS claimed, COALESCE(sum(paid),0)::bigint AS paid, COALESCE(sum(pot_now) FILTER (WHERE state='live'),0)::bigint AS pots FROM vs_duels`);
      const h = await L.q(`SELECT count(DISTINCT owner)::int AS n FROM vs_pays WHERE sig IS NOT NULL AND sig NOT LIKE 'pending:%'`);
      const t = await L.q(`SELECT v FROM vs_meta WHERE k='tick'`).catch(() => []);
      const beats = await L.q(`SELECT at, ms, launches, duels, settled, errors, slot FROM vs_ticks WHERE at > now() - interval '65 minutes' ORDER BY n DESC LIMIT 70`).catch(() => []);
      const day = await L.q(`SELECT count(*)::int AS n, COALESCE(avg(ms),0)::int AS ms, COALESCE(sum(errors),0)::int AS errors FROM vs_ticks WHERE at > now() - interval '24 hours'`).catch(() => [{}]);
      const rounds = await L.q(`SELECT count(*)::int AS n FROM vs_rounds`).catch(() => [{ n: 0 }]);
      return L.send(res, 200, { ok: true, live: r[0].live, settled: r[0].settled, claimedSol: S(r[0].claimed), paidSol: S(r[0].paid), potsSol: S(r[0].pots), paidHolders: h[0].n, rounds: rounds[0].n,
        lastTick: t.length ? new Date(Number(t[0].v)).toISOString() : null,
        beats: beats.map(b => ({ at: b.at, ms: b.ms, duels: b.duels, launches: b.launches, settled: b.settled, errors: b.errors, slot: b.slot == null ? null : Number(b.slot) })),
        day: { passes: day[0].n || 0, avgMs: day[0].ms || 0, errors: day[0].errors || 0 } }, L.CACHE(8));
    }
    if (qy.op === 'series') {   // a live duel's tape: market caps, pot and the source's number over time
      const r = await L.q(`SELECT at, my, mn, pot, src, note FROM vs_samples WHERE id=$1 ORDER BY at DESC LIMIT 600`, [String(qy.id || '')]);
      return L.send(res, 200, { ok: true, points: r.reverse().map(x => ({ at: x.at, my: x.my, mn: x.mn, crowd: V.crowd(x.my, x.mn), potSol: S(x.pot), src: x.src, note: x.note })) }, L.CACHE(30));
    }
    if (qy.op === 'wallet') {   // everything vrsus ever owed or paid one wallet, and every duel it launched
      const w = String(qy.w || '').trim(); if (!L.isAddr(w)) return L.send(res, 200, { ok: false, error: 'That is not a Solana address.' });
      const [pays, rounds, launched] = await Promise.all([
        L.q(`SELECT p.id, p.round, p.lamports, p.sig, p.at, d.n, d.q, d.yes->>'symbol' AS sy, d.no->>'symbol' AS sn FROM vs_pays p JOIN vs_duels d ON d.id=p.id WHERE p.owner=$1 ORDER BY p.at DESC LIMIT 200`, [w]),
        L.q(`SELECT r.id, r.round, r.side, r.root, r.hash, r.at, d.n, d.q, d.yes->>'symbol' AS sy, d.no->>'symbol' AS sn FROM vs_rounds r JOIN vs_duels d ON d.id=r.id WHERE r.holders @> $1::jsonb ORDER BY r.at DESC LIMIT 100`, [JSON.stringify([{ owner: w }])]),
        L.q(`SELECT id, n, q, state, yes->>'symbol' AS sy, no->>'symbol' AS sn, created_at FROM vs_duels WHERE launcher=$1 AND state NOT IN ('waiting','expired') ORDER BY n DESC LIMIT 50`, [w]),
      ]);
      return L.send(res, 200, { ok: true, wallet: w, pays: pays.map(p => ({ ...p, lamports: Number(p.lamports), sig: p.sig && !p.sig.startsWith('pending:') ? p.sig : null })), rounds, launched }, L.CACHE(10));
    }
    if (qy.op === 'bundle') {   // the whole proof of one duel in one file: the event, the rule, the reading, every round, every payout
      const r = await L.q(`SELECT * FROM vs_duels WHERE id=$1`, [String(qy.id || '')]);
      if (!r.length) return L.send(res, 200, { ok: false, error: 'No such duel.' });
      const d = r[0];
      const rounds = await L.q(`SELECT * FROM vs_rounds WHERE id=$1 ORDER BY round`, [d.id]);
      const pays = await L.q(`SELECT round, owner, lamports, sig, at FROM vs_pays WHERE id=$1 ORDER BY n`, [d.id]);
      const log = await L.q(`SELECT kind, text, sig, src, sol, at FROM vs_log WHERE id=$1 ORDER BY n`, [d.id]);
      res.setHeader('Content-Disposition', `attachment; filename="vrsus-duel-${d.fp}.json"`);
      return L.send(res, 200, { ok: true, schema: 'vrsus.bundle/1', generatedAt: new Date().toISOString(), site,
        spec: { leaf: 'sha256("L|"+round+"|"+side+"|"+owner+"|"+bag+"|"+lamports)', node: 'sha256("N|"+left+"|"+right), odd node moves up unchanged', split: 'floor(pot * bag / total), payouts under 100000 lamports skipped', snapshot: 'sha256(side+"|"+pot+"|"+owner:bag joined by ",")' },
        duel: { id: d.id, n: d.n, fp: d.fp, kind: d.kind, event: d.event, q: d.q, rule: d.rule, src: d.src, closesAt: d.closes_at, state: d.state, outcome: d.outcome, settledAt: d.settled_at, reading: d.reading,
          wallet: d.wallet, launcher: d.launcher, yes: { name: d.yes.name, symbol: d.yes.symbol, mint: d.yes.mint }, no: { name: d.no.name, symbol: d.no.symbol, mint: d.no.mint }, sigs: d.sigs, createdAt: d.created_at, liveAt: d.live_at },
        rounds: rounds.map(x => ({ round: x.round, side: x.side, pot: String(x.pot), total: x.total, source: x.source, hash: x.hash, root: x.root, state: x.state, at: x.at, holders: x.holders,
          pays: pays.filter(p => p.round === x.round).map(p => ({ owner: p.owner, lamports: Number(p.lamports), sig: p.sig && !p.sig.startsWith('pending:') ? p.sig : null, at: p.at })) })),
        log });
    }
    if (qy.op === 'receipts') {
      const r = await L.q(`SELECT * FROM vs_duels WHERE state IN ('settled','settling') ORDER BY settled_at DESC LIMIT 30`);
      const rounds = r.length ? await L.q(`SELECT id, round, side, pot, hash, root, source, state, paid, at, jsonb_array_length(holders) AS n FROM vs_rounds WHERE id = ANY($1) ORDER BY round`, [r.map(d => d.id)]) : [];
      return L.send(res, 200, { ok: true, receipts: r.map(d => ({ ...pub(d, site), reading: d.reading, roundsList: rounds.filter(x => x.id === d.id).map(x => ({ round: x.round, side: x.side, potSol: S(x.pot), hash: x.hash, root: x.root, source: x.source, state: x.state, paidSol: S(x.paid), holders: x.n, at: x.at })) })) }, L.CACHE(15));
    }
    if (qy.op === 'round') {
      const r = await L.q(`SELECT * FROM vs_rounds WHERE id=$1 AND round=$2`, [String(qy.id || ''), Number(qy.r) || 0]);
      if (!r.length) return L.send(res, 200, { ok: false, error: 'No such round.' });
      const pays = await L.q(`SELECT owner, lamports, sig, at FROM vs_pays WHERE id=$1 AND round=$2 ORDER BY n`, [r[0].id, r[0].round]);
      return L.send(res, 200, { ok: true, round: { id: r[0].id, round: r[0].round, side: r[0].side, pot: String(r[0].pot), total: r[0].total, hash: r[0].hash, root: r[0].root, source: r[0].source, state: r[0].state, at: r[0].at, holders: r[0].holders },
        pays: pays.map(p => ({ owner: p.owner, lamports: Number(p.lamports), sig: p.sig && !p.sig.startsWith('pending:') ? p.sig : null, at: p.at })) }, L.CACHE(20));
    }
    const key = String(qy.id || qy.m || '');
    if (key) {
      const r = await L.q(`SELECT * FROM vs_duels WHERE id=$1 OR yes->>'mint'=$1 OR no->>'mint'=$1`, [key]);
      if (!r.length) return L.send(res, 200, { ok: false, error: 'No duel with that id or coin on vrsus.' });
      const d = r[0];
      const log = await L.q(`SELECT kind, text, sig, src, sol, at FROM vs_log WHERE id=$1 ORDER BY n DESC LIMIT 80`, [d.id]);
      const rounds = await L.q(`SELECT round, side, pot, total, hash, root, source, state, paid, at, jsonb_array_length(holders) AS n FROM vs_rounds WHERE id=$1 ORDER BY round`, [d.id]);
      let potNow = null, waiting = null;
      if (['live', 'settling', 'settled'].includes(d.state)) [potNow, waiting] = await Promise.all([E.pot(d).catch(() => null), E.waiting(d.wallet).catch(() => null)]);
      return L.send(res, 200, { ok: true, duel: { ...pub(d, site), wallet: d.wallet, launcher: d.launcher, reading: d.reading, sigs: d.sigs, outSig: d.out_sig, potSol: potNow == null ? S(d.pot_now) : S(potNow + (waiting || 0)),
        chestSol: S(potNow), waitingSol: S(waiting), reserveSol: E.RESERVE / 1e9 },
        rounds: rounds.map(x => ({ round: x.round, side: x.side, potSol: S(x.pot), pot: String(x.pot), total: x.total, hash: x.hash, root: x.root, source: x.source, state: x.state, paidSol: S(x.paid), holders: x.n, at: x.at })), log }, L.CACHE(6));
    }
    const r = await L.q(`SELECT * FROM vs_duels WHERE state IN ('live','creating','settling','settled') ORDER BY (state='live') DESC, (state='settling') DESC, COALESCE(settled_at, closes_at) ASC NULLS LAST, n DESC LIMIT 100`);
    L.send(res, 200, { ok: true, duels: r.map(d => pub(d, site)) }, L.CACHE(10));
  } catch (e) { L.send(res, 200, { ok: false, error: 'The records didn’t answer just now.' }); }
};
