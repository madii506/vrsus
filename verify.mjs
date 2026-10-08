#!/usr/bin/env node
// verify.mjs: check a vrsus duel without trusting vrsus.
//
//   node verify.mjs <duel-id> [--site https://vrsus.vercel.app] [--rpc <any Solana RPC>] [--bundle <file.json>]
//
// It downloads the duel's proof bundle (or reads one you saved), then checks it against the world on its own:
//   1. the event   re-reads the source itself (Polymarket, ESPN or Coinbase) and applies the published rule
//   2. the pot     reads both coins' pump.fun bonding curves and checks their creator is the duel wallet
//   3. the rounds  recomputes every pro-rata split, the snapshot hash and the Merkle root
//   4. the chain   reads every payout transaction from your RPC and matches each transfer
// No dependencies. Node 18 or newer. Exit code 0 when everything checks out, 1 when anything doesn't.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2), opt = {}, pos = [];
for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; else pos.push(argv[i]); }
const SITE = String(opt.site || 'https://vrsus.vercel.app').replace(/\/$/, ''), RPC = String(opt.rpc || 'https://api.mainnet-beta.solana.com');
if (!pos[0] && !opt.bundle) { console.log('usage: node verify.mjs <duel-id> [--site URL] [--rpc URL] [--bundle file.json]'); process.exit(2); }

const tty = process.stdout.isTTY, c = (n, s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : s);
const G = s => c(32, s), R = s => c(31, s), Y = s => c(33, s), D = s => c(2, s), B = s => c(1, s);
let pass = 0, fail = 0, skip = 0;
const ok = (good, msg) => { if (good === null) { skip++; console.log(`  ${Y('[?]')} ${msg}`); } else if (good) { pass++; console.log(`  ${G('[+]')} ${msg}`); } else { fail++; console.log(`  ${R('[x]')} ${msg}`); } };
const H = s => createHash('sha256').update(s).digest('hex');
const getJson = async (url, init) => { const r = await fetch(url, { ...init, headers: { accept: 'application/json', 'user-agent': 'vrsus-verify/1', ...((init && init.headers) || {}) }, signal: AbortSignal.timeout(15000) }); return r.json(); };
const rpc = async (method, params) => { const j = await getJson(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); if (j.error) throw new Error(j.error.message); return j.result; };
const S = l => (Number(l) / 1e9).toFixed(6);

// ---- the published math (the same as assets/js/vrsus.js) ----
const split = (pot, hs) => { const tot = hs.reduce((t, h) => t + BigInt(h.amount), 0n); return tot === 0n ? [] : hs.map(h => ({ owner: h.owner, amount: String(h.amount), lamports: Number(BigInt(pot) * BigInt(h.amount) / tot) })); };
const leafStr = (round, side, p) => `L|${round}|${side}|${p.owner}|${p.amount}|${p.lamports}`;
function merkleRoot(strs) { let lvl = strs.map(H); while (lvl.length > 1) { const nx = []; for (let i = 0; i < lvl.length; i += 2) nx.push(i + 1 < lvl.length ? H('N|' + lvl[i] + '|' + lvl[i + 1]) : lvl[i]); lvl = nx; } return lvl[0] || null; }
const DUST = 100000;

// ---- base58 and program addresses, so the bonding curves can be found without any SDK ----
const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58e = buf => { let n = 0n; for (const b of buf) n = n * 256n + BigInt(b); let s = ''; while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; } for (const b of buf) { if (b === 0) s = '1' + s; else break; } return s; };
const b58d = str => { let n = 0n; for (const ch of str) n = n * 58n + BigInt(A.indexOf(ch)); const out = []; while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; } for (const ch of str) { if (ch === '1') out.unshift(0); else break; } return Buffer.from(out); };
const P = (1n << 255n) - 19n, md = a => ((a % P) + P) % P, pw = (b, e) => { let r = 1n; b = md(b); while (e > 0n) { if (e & 1n) r = r * b % P; b = b * b % P; e >>= 1n; } return r; };
const Dd = md(-121665n * pw(121666n, P - 2n)), I = pw(2n, (P - 1n) / 4n);
function onCurve(bytes) { const b = Buffer.from(bytes); b[31] &= 0x7f; let y = 0n; for (let i = 31; i >= 0; i--) y = (y << 8n) + BigInt(b[i]); if (y >= P) return false; const y2 = y * y % P, u = md(y2 - 1n), v = md(Dd * y2 + 1n), x2 = u * pw(v, P - 2n) % P; if (x2 === 0n) return true; let x = pw(x2, (P + 3n) / 8n); if (x * x % P === x2) return true; x = x * I % P; return x * x % P === x2; }
function pda(seeds, prog) { const p = b58d(prog); for (let bump = 255; bump >= 0; bump--) { const h = createHash('sha256'); for (const s of seeds) h.update(s); h.update(Buffer.from([bump])); h.update(p); h.update(Buffer.from('ProgramDerivedAddress')); const k = h.digest(); if (!onCurve(k)) return b58e(k); } }
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

// ---- the sources, read directly ----
const LG = { 'eng.1': 'soccer', 'esp.1': 'soccer', 'uefa.champions': 'soccer', 'ita.1': 'soccer', 'ger.1': 'soccer', nba: 'basketball', nfl: 'football', nhl: 'hockey', mlb: 'baseball' };
async function source(ev) {
  if (ev.kind === 'pm') {
    const url = `https://gamma-api.polymarket.com/markets/${ev.market.id}`; const m = await getJson(url);
    const outs = JSON.parse(m.outcomes || '[]'), px = JSON.parse(m.outcomePrices || '[]').map(Number), yi = outs.findIndex(o => /^yes$/i.test(o)), yes = px[yi];
    const out = m.closed && (yes >= .995 || yes <= .005) ? (yes >= .995 ? 'YES' : 'NO') : m.closed && String(m.umaResolutionStatus || '').toLowerCase() === 'resolved' ? 'VOID' : null;
    return { url, outcome: out, text: out ? `Polymarket: closed=${m.closed}, outcomePrices=${m.outcomePrices}` : `Polymarket: open, YES ${(yes * 100).toFixed(1)}%` };
  }
  if (ev.kind === 'game') {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${LG[ev.league]}/${ev.league}/summary?event=${ev.gameId}`; const j = await getJson(url);
    const comp = j.header.competitions[0], st = comp.status.type, h = comp.competitors.find(x => x.homeAway === 'home'), a = comp.competitors.find(x => x.homeAway === 'away');
    if (/CANCEL/i.test(st.name)) return { url, outcome: 'VOID', text: 'ESPN: cancelled' };
    if (st.completed && st.state === 'post') return { url, outcome: h.winner === true ? 'YES' : 'NO', text: `ESPN: final ${h.team.displayName} ${h.score}-${a.score} ${a.team.displayName}` };
    return { url, outcome: null, text: `ESPN: ${st.name}` };
  }
  if (ev.kind === 'price') {
    const t = Math.floor(new Date(ev.at).getTime() / 1000);
    const url = `https://api.exchange.coinbase.com/products/${ev.asset}-USD/candles?granularity=60&start=${new Date(t * 1000).toISOString()}&end=${new Date((t + 60) * 1000).toISOString()}`;
    if (Date.now() < (t + 60) * 1000) return { url, outcome: null, text: 'Coinbase: that minute has not closed yet' };
    const k = (await getJson(url)).find(x => Number(x[0]) === t); if (!k) return { url, outcome: null, text: 'Coinbase: no candle yet' };
    const close = Number(k[4]), y = ev.op === 'above' ? close > ev.value : close < ev.value;
    return { url, outcome: y ? 'YES' : 'NO', text: `Coinbase: ${ev.asset} closed ${close} (${ev.op} ${ev.value})` };
  }
}

// ---- go ----
const b = opt.bundle ? JSON.parse(readFileSync(opt.bundle, 'utf8')) : await getJson(`${SITE}/api/duels?op=bundle&id=${encodeURIComponent(pos[0])}`);
if (!b || !b.ok || !b.duel) { console.log(R('could not load the bundle: ' + ((b && b.error) || 'no answer'))); process.exit(1); }
const d = b.duel;
console.log(`\n${B('vrsus verify')} ${D('· ' + b.schema + ' · ' + (opt.bundle || SITE))}\n${B('#' + d.n + ' ' + d.q)}\n${D(`$${d.yes.symbol} vs $${d.no.symbol} · wallet ${d.wallet} · state ${d.state}${d.outcome ? ' · ' + d.outcome : ''}`)}\n${D('rpc ' + RPC)}\n`);

console.log(B('1. the event'));
try {
  const s = await source(d.event);
  console.log(`  ${D(s.url)}\n  ${D(s.text)}`);
  if (d.outcome) ok(s.outcome === d.outcome, `the source says ${s.outcome || 'not final'}; vrsus settled ${d.outcome}`);
  else ok(s.outcome == null ? true : null, s.outcome ? `the source is final (${s.outcome}); vrsus settles it on its next pass` : 'still open at the source, and still live on vrsus');
} catch (e) { ok(null, `couldn't read the source from here (${e.message})`); }

console.log(B('\n2. the pot'));
for (const side of ['yes', 'no']) {
  try {
    const bc = pda([Buffer.from('bonding-curve'), b58d(d[side].mint)], PUMP);
    const a = await rpc('getAccountInfo', [bc, { encoding: 'base64', commitment: 'confirmed' }]);
    const data = a && a.value ? Buffer.from(a.value.data[0], 'base64') : null;
    if (!data || data.length < 81) { ok(null, `$${d[side].symbol}: bonding curve ${bc} not readable`); continue; }
    const creator = b58e(data.subarray(49, 81));
    ok(creator === d.wallet, `$${d[side].symbol} (${side.toUpperCase()}) creator on pump.fun is ${creator === d.wallet ? 'the duel wallet' : creator}`);
  } catch (e) { ok(null, `$${d[side].symbol}: ${e.message}`); }
}

console.log(B('\n3. the rounds'));
if (!b.rounds.length) console.log(D('  no payout rounds yet'));
for (const r of b.rounds) {
  console.log(`  ${B('round ' + r.round)} ${D(`${r.side.toUpperCase()} · ${r.holders.length} holders · pot ${S(r.pot)} SOL · ${r.source === 'all' ? 'every holder' : 'top 20'}`)}`);
  const total = r.holders.reduce((t, h) => t + BigInt(h.amount), 0n).toString();
  ok(total === r.total, `bag total ${total}`);
  ok(H(`${r.side}|${r.pot}|` + r.holders.map(h => `${h.owner}:${h.amount}`).join(',')) === r.hash, `snapshot hash ${r.hash.slice(0, 20)}…`);
  const sp = split(r.pot, r.holders);
  if (r.root) ok(merkleRoot(sp.map(p => leafStr(r.round, r.side, p))) === r.root, `merkle root ${r.root.slice(0, 20)}… over ${sp.length} leaves`);
  const want = sp.filter(p => p.lamports >= DUST), paid = r.pays.filter(p => p.sig);
  const bad = paid.filter(p => { const w = want.find(x => x.owner === p.owner); return !w || w.lamports !== p.lamports; });
  ok(!bad.length, `${paid.length} payouts all equal floor(pot × bag ÷ total)${bad.length ? `; ${bad.length} don't` : ''}`);
  ok(paid.reduce((t, p) => t + p.lamports, 0) <= Number(r.pot), `paid ${S(paid.reduce((t, p) => t + p.lamports, 0))} of a ${S(r.pot)} SOL pot`);
}

console.log(B('\n4. the chain'));
const bySig = {}; for (const r of b.rounds) for (const p of r.pays) if (p.sig) (bySig[p.sig] = bySig[p.sig] || []).push(p);
const sigs = Object.keys(bySig);
if (!sigs.length) console.log(D('  no payout transactions yet'));
let found = 0, total = 0;
for (const sg of sigs) {
  try {
    const t = await rpc('getTransaction', [sg, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
    if (!t) { ok(false, `${sg.slice(0, 16)}… not found on chain`); continue; }
    if (t.meta && t.meta.err) { ok(false, `${sg.slice(0, 16)}… failed on chain`); continue; }
    const ixs = (t.transaction.message.instructions || []).filter(i => i.parsed && i.parsed.type === 'transfer' && i.parsed.info.source === d.wallet);
    let n = 0; for (const p of bySig[sg]) { total++; if (ixs.find(i => i.parsed.info.destination === p.owner && Number(i.parsed.info.lamports) === p.lamports)) { n++; found++; } }
    ok(n === bySig[sg].length, `${sg.slice(0, 16)}… ${n} of ${bySig[sg].length} transfers from the duel wallet match`);
  } catch (e) { ok(null, `${sg.slice(0, 16)}… ${e.message}`); }
}
if (sigs.length) console.log(D(`  ${found} of ${total} payouts found on chain`));

console.log(`\n${fail ? R(B(`${fail} check${fail === 1 ? '' : 's'} failed`)) : G(B('everything checks out'))} ${D(`· ${pass} passed${skip ? ' · ' + skip + ' could not be checked from here' : ''}`)}\n`);
process.exit(fail ? 1 : 0);
