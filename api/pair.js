// GET  /api/pair?op=config             what pairing costs and whether it is open
// POST /api/pair?op=prepare            record a duel (event + two coins); returns its wallet and the one deposit it needs
// GET  /api/pair?op=status&id=         where a launch is (and moves it forward: a full deposit creates both coins)
// GET  /api/pair?op=blockhash          for the wallet that signs the deposit
// POST /api/pair?op=relay {tx}         sends a signed deposit, for wallets that can sign but not send
// GET  /api/pair?op=selftest           builds and simulates a create and a claim with a throwaway key (no funds move)
const crypto = require('crypto');
const L = require('./_lib');
const E = require('./_engine');
const WD = require('./_world');
const V = require('../assets/js/vrsus.js');
const SOL = n => +(n / 1e9).toFixed(4);

// the server re-reads the source before it accepts an event: it must exist, be open, and not be decided yet
async function checkEvent(ev) {
  if (ev.kind === 'pm') {
    const m = await WD.market(ev.market.id, true);
    if (!m.ok) return 'Polymarket didn’t answer. Try again in a moment.';
    if (m.closed) return 'That market is closed.';
    if (m.yes < 1 || m.yes > 99) return 'That market is already all but decided.';
    ev.market.q = m.q; ev.market.slug = m.slug; ev.closes = m.end;
    return null;
  }
  if (ev.kind === 'game') {
    const g = await WD.game(ev.league, ev.gameId);
    if (!g.ok) return 'ESPN didn’t answer. Try again in a moment.';
    if (g.state !== 'pre') return 'That game has already started.';
    if (new Date(g.date).getTime() < Date.now() + 10 * 6e4) return 'That game starts in under 10 minutes.';
    ev.home = { id: g.home.id, name: g.home.name }; ev.away = { id: g.away.id, name: g.away.name }; ev.date = g.date; ev.link = g.link; ev.closes = g.date;
    return null;
  }
  if (ev.kind === 'price') {
    const t = new Date(ev.at).getTime();
    if (t < Date.now() + 50 * 6e4) return 'The price duel has to settle at least an hour from now.';
    if (t > Date.now() + 31 * 864e5) return 'Pick a time within 30 days.';
    const p = await WD.price(ev.asset); if (!p.ok) return 'Coinbase didn’t answer. Try again in a moment.';
    if (ev.value < p.price * .5 || ev.value > p.price * 2) return `Pick a line between ${V.usd(p.price * .5)} and ${V.usd(p.price * 2)}.`;
    ev.closes = ev.at;
    return null;
  }
  return 'Pick an event.';
}
function coinIn(c, side) {
  c = c || {};
  const name = L.clean(c.name, 32), symbol = L.clean(c.symbol, 10).replace(/^\$/, '').toUpperCase();
  if (!name || Buffer.byteLength(name) > 32) return { err: `Give the ${side} coin a name of up to 32 characters.` };
  if (!/^[A-Z0-9]{1,10}$/.test(symbol)) return { err: `The ${side} ticker is 1–10 letters or numbers.` };
  if (L.BANNED.test(name + ' ' + symbol)) return { err: 'Pick other words. Those break the house rules.' };
  const dev = Number(c.dev);
  if (!(dev >= E.MIN_DEV && dev <= E.MAX_DEV)) return { err: `The ${side} first buy is between ${E.MIN_DEV} and ${E.MAX_DEV} SOL.` };
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(String(c.image || ''));
  if (!m) return { err: `Add a picture for the ${side} coin.` };
  return { name, symbol, dev, raw: Buffer.from(m[2], 'base64') };
}

async function prepare(req, res) {
  if (!L.MOCK && L.limited('prep:' + L.ip(req), 8, 600000)) return L.send(res, 200, { ok: false, error: 'Too many duels from here. Wait a few minutes.' });
  if (!L.dbReady()) return L.send(res, 200, { ok: false, error: 'The engine’s records are offline, so pairing is paused.' });
  const b = await L.body(req, 5 * 1024 * 1024);
  if (b.tooBig) return L.send(res, 200, { ok: false, error: 'Those pictures are too big. Use ones under 1.5 MB.' });
  const launcher = String(b.launcher || '').trim();
  if (!L.isAddr(launcher)) return L.send(res, 200, { ok: false, error: 'Connect a wallet (or paste your address) so the first buys and any refund have somewhere to go.' });
  let ev; try { ev = V.normalizeEvent(b.event); } catch (e) { return L.send(res, 200, { ok: false, error: e.rule ? e.message : 'The event didn’t read right.' }); }
  const bad = await checkEvent(ev); if (bad) return L.send(res, 200, { ok: false, error: bad });
  const yes = coinIn(b.yes, 'YES'); if (yes.err) return L.send(res, 200, { ok: false, error: yes.err });
  const no = coinIn(b.no, 'NO'); if (no.err) return L.send(res, 200, { ok: false, error: no.err });
  if (yes.symbol === no.symbol) return L.send(res, 200, { ok: false, error: 'The two coins need different tickers.' });
  let imgY, imgN;
  try {
    const sharp = require('sharp'); const prep = raw => sharp(raw).rotate().resize(512, 512, { fit: 'cover' }).flatten({ background: '#0a0c0b' }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    [imgY, imgN] = await Promise.all([prep(yes.raw), prep(no.raw)]);
  } catch { return L.send(res, 200, { ok: false, error: 'A picture couldn’t be read. Try a PNG or JPG.' }); }
  try {
    await L.ready();
    const id = E.newId(); const k = await E.keys(id);
    const wallet = k.wallet.publicKey.toBase58(), mintY = k.yes.publicKey.toBase58(), mintN = k.no.publicKey.toBase58();
    const site = L.origin(req), page = site + '/duel?id=' + id;
    const D = V.describe(ev);
    const fp = crypto.createHash('sha256').update(V.canon(ev, yes, no)).digest('hex').slice(0, 12);
    const desc = side => `The ${side} side of a vrsus duel: “${D.q}” ${D.rule} Both coins' creator fees fill one pot, paid in SOL to the winning coin's holders. Pair: $${side === 'YES' ? no.symbol : yes.symbol}. duel ${fp}. ${page.replace(/^https?:\/\//, '')}`;
    const coin = (c, side, mint) => ({ name: c.name, symbol: c.symbol, dev: c.dev, mint, uri: `${site}/m/${id}-${side}`, desc: desc(side.toUpperCase()).slice(0, 900) });
    const Y = coin(yes, 'yes', mintY), N = coin(no, 'no', mintN);
    const needL = E.need(yes.dev, no.dev);
    await L.q(`INSERT INTO vs_duels (id, wallet, launcher, kind, event, q, rule, src, closes_at, yes, no, img_yes, img_no, need, fp)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [id, wallet, launcher, ev.kind, JSON.stringify(ev), D.q, D.rule, D.src, ev.closes || null, JSON.stringify(Y), JSON.stringify(N), imgY, imgN, needL, fp]);
    await L.log(id, 'launch', `duel ${fp} recorded: $${Y.symbol} (YES) vs $${N.symbol} (NO) on “${D.q.slice(0, 120)}”. waiting for ${SOL(needL)} SOL`);
    L.send(res, 200, { ok: true, id, wallet, yes: mintY, no: mintN, need: needL, needSol: SOL(needL), fp, q: D.q, rule: D.rule });
  } catch (e) { L.send(res, 200, { ok: false, error: 'The duel didn’t save. Try again.' }); }
}

async function status(req, res) {
  const id = String(L.query(req).id || '');
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(id) || !L.dbReady()) return L.send(res, 200, { ok: false, error: 'No such duel.' });
  await L.ready();
  let r = await L.q('SELECT * FROM vs_duels WHERE id=$1', [id]);
  if (!r.length) return L.send(res, 200, { ok: false, error: 'No such duel.' });
  let d = r[0], bal = null, note = null;
  if (['waiting', 'creating', 'failed', 'expired'].includes(d.state)) {
    try { const a = await E.advance(d); if (a && a.balance != null) bal = a.balance; if (a && a.error) note = a.error; } catch (e) { note = String(e.message).slice(0, 160); }
    d = (await L.q('SELECT * FROM vs_duels WHERE id=$1', [id]))[0];
  }
  if (bal == null && d.state === 'waiting') bal = await L.balance(d.wallet).catch(() => null);
  const logs = await L.q(`SELECT kind, text, sig, at FROM vs_log WHERE id=$1 ORDER BY n DESC LIMIT 12`, [id]);
  L.send(res, 200, { ok: true, id: d.id, state: d.state, wallet: d.wallet, yes: d.yes.mint, no: d.no.mint, symYes: d.yes.symbol, symNo: d.no.symbol, need: Number(d.need), needSol: SOL(Number(d.need)), balance: bal,
    sigs: d.sigs, out_sig: d.out_sig, refund_sig: d.refund_sig, err: d.err, note, logs });
}

async function relay(req, res) {
  if (L.limited('relay:' + L.ip(req), 10, 600000)) return L.send(res, 200, { ok: false, error: 'Too many from here.' });
  const b = await L.body(req, 4096);
  try {
    const { Transaction, SystemProgram } = require('@solana/web3.js');
    const buf = Buffer.from(String(b.tx || ''), 'base64'); const tx = Transaction.from(buf);
    const to = tx.instructions.filter(i => i.programId.equals(SystemProgram.programId)).map(i => i.keys[1] && i.keys[1].pubkey.toBase58()).filter(Boolean);
    if (!to.length) return L.send(res, 200, { ok: false, error: 'That isn’t a deposit.' });
    await L.ready();
    const ok = await L.q(`SELECT 1 FROM vs_duels WHERE wallet = ANY($1) AND state='waiting'`, [to]);
    if (!ok.length) return L.send(res, 200, { ok: false, error: 'That deposit isn’t for a duel that is waiting.' });
    const sig = await E.sendRaw(buf);
    L.send(res, 200, { ok: true, sig });
  } catch (e) { L.send(res, 200, { ok: false, error: 'Sending failed: ' + String(e.message).slice(0, 140) }); }
}

async function selftest(req, res) {
  if (L.limited('st:' + L.ip(req), 6, 600000)) return L.send(res, 200, { ok: false, error: 'Wait a few minutes.' });
  const { Keypair } = require('@solana/web3.js');
  const sim = async tx => { const j = await L.rpcRaw('simulateTransaction', [Buffer.from(tx.serialize()).toString('base64'), { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' }]);
    const v = j.result && j.result.value; return { err: v ? v.err : j.error && j.error.message, logs: v && v.logs ? v.logs.slice(-4) : [] }; };
  const out = {}; const w = Keypair.generate(), mk = Keypair.generate();
  const step = async (name, fn) => { const t0 = Date.now(); try { out[name] = { ok: true, ...(await fn()), ms: Date.now() - t0 }; } catch (e) { out[name] = { ok: false, error: String(e.message).slice(0, 200), ms: Date.now() - t0 }; } };
  await step('create', async () => { const tx = await E.portal({ publicKey: w.publicKey.toBase58(), action: 'create', tokenMetadata: { name: 'vrsus selftest', symbol: 'TEST', uri: L.origin(req) + '/m/selftest' }, mint: mk.publicKey.toBase58(), denominatedInSol: 'true', amount: 0.01, slippage: 10, priorityFee: 0.0001, pool: 'pump' }, [mk, w]);
    return { bytes: tx.serialize().length, signers: tx.signatures.length, sim: await sim(tx) }; });
  await step('claim', async () => { const tx = await E.portal({ publicKey: w.publicKey.toBase58(), action: 'collectCreatorFee', priorityFee: 0.00001, pool: 'pump' }, [w]); return { bytes: tx.serialize().length, sim: await sim(tx) }; });
  await step('keys', async () => { if (!L.dbReady()) return { db: false }; const a = await E.keys('selftest-x'), b2 = await E.keys('selftest-x'); return { stable: a.wallet.publicKey.equals(b2.wallet.publicKey), distinct: !a.yes.publicKey.equals(a.no.publicKey) }; });
  await step('holders', async () => { const r = await L.rpcRaw('getProgramAccounts', [L.TOKEN22, { encoding: 'base64', dataSlice: { offset: 32, length: 40 }, filters: [{ memcmp: { offset: 0, bytes: Keypair.generate().publicKey.toBase58() } }] }], 15000).catch(e => ({ error: { message: e.message } }));
    return { full: !r.error, note: r.error ? 'this RPC won’t list every holder, so payouts use the top 20 holders' : 'this RPC lists every holder' }; });
  L.send(res, 200, { ok: true, note: 'throwaway keys, nothing is sent; insufficient-funds errors in the simulation are expected', ...out });
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return L.send(res, 204, {});
  const op = String(L.query(req).op || 'config');
  try {
    if (req.method === 'POST' && op === 'prepare') return prepare(req, res);
    if (req.method === 'POST' && op === 'relay') return relay(req, res);
    if (op === 'status') return status(req, res);
    if (op === 'blockhash') return L.send(res, 200, { ok: true, ...(await E.blockhash()) });
    if (op === 'selftest') return selftest(req, res);
    L.send(res, 200, { ok: true, open: L.dbReady(), feeBps: L.FEE_BPS, feeTaken: !!L.STUDIO, reserveSol: E.RESERVE / 1e9, createSol: E.CREATE_COST / 1e9, minDev: E.MIN_DEV, maxDev: E.MAX_DEV, postMin: V.POST_MIN }, L.CACHE(60));
  } catch (e) { L.send(res, 200, { ok: false, error: 'Something broke: ' + String(e && e.message).slice(0, 120) }); }
};
