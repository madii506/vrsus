// The engine. It is custodial, and says so. Every duel has one wallet, derived on this server from one master secret,
// and that wallet is the pump.fun creator of BOTH of the duel's coins, so the creator fees of the YES coin and the NO coin
// land in one pot. The engine claims them, reads the event's source every pass, and the first pass that sees a final
// answer settles the duel: it snapshots the winning coin's holders, publishes the snapshot and its hash, and pays the pot
// to them pro rata. Every step is a public Solana transaction. There is no sell action and no withdraw action.
const crypto = require('crypto');
const L = require('./_lib');
const WD = require('./_world');
const V = require('../assets/js/vrsus.js');

let web3 = null, spl = null;
const w3 = () => web3 || (web3 = require('@solana/web3.js'));
const sp = () => spl || (spl = require('@solana/spl-token'));

const LAMPORTS = 1e9;
const RESERVE = 0.015 * LAMPORTS;          // stays in every coin wallet for gas and token-account rent
const CREATE_COST = 0.03 * LAMPORTS;       // pump.fun rent for a new coin, plus margin; whatever is unused goes back
const MIN_DEV = V.DEV.min, MAX_DEV = V.DEV.max;
const CLAIM_MIN = 0.003 * LAMPORTS;        // claim when at least this much is waiting
const MIN_ACTION = 0.002 * LAMPORTS;       // smaller than this, a fire is recorded but nothing is spent
const PORTAL = 'https://pumpportal.fun/api/trade-local';
const PRIORITY = Number(process.env.PRIORITY_FEE || 0.0002);
const need = (devYes, devNo) => Math.ceil((2 * CREATE_COST + (devYes + devNo) * 1.02 * LAMPORTS + RESERVE) / 1e6) * 1e6;   // rounded up to 0.001 SOL

// ---------- keys: derived, never stored ----------
let MASTER = null;
async function master() {
  if (MASTER) return MASTER;
  if (process.env.VRSUS_MASTER && process.env.VRSUS_MASTER.length >= 32) return (MASTER = process.env.VRSUS_MASTER);
  await L.ready();
  await L.q(`INSERT INTO vs_meta (k, v) VALUES ('master', $1) ON CONFLICT (k) DO NOTHING`, [crypto.randomBytes(32).toString('hex')]);
  const r = await L.q(`SELECT v FROM vs_meta WHERE k='master'`);
  return (MASTER = r[0].v);
}
async function keys(id) {
  const m = await master(); const { Keypair } = w3();
  const seed = tag => crypto.createHmac('sha256', m).update(tag + ':' + id).digest();
  return { wallet: Keypair.fromSeed(seed('wallet')), yes: Keypair.fromSeed(seed('mint:yes')), no: Keypair.fromSeed(seed('mint:no')) };
}
const newId = () => crypto.randomBytes(9).toString('base64url');

// ---------- sending ----------
async function blockhash() { const r = await L.rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]); return r.value; }
async function confirm(sig, ms = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await L.rpc('getSignatureStatuses', [[sig], { searchTransactionHistory: false }]);
      const s = r.value && r.value[0];
      if (s) { if (s.err) return { ok: false, err: JSON.stringify(s.err) }; if (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized') return { ok: true }; }
    } catch {}
    await new Promise(r => setTimeout(r, 1500));
  }
  return { ok: false, err: 'not confirmed in time' };
}
async function sendRaw(bytes, skipPreflight = false) {
  const b64 = Buffer.from(bytes).toString('base64');
  const j = await L.rpcRaw('sendTransaction', [b64, { encoding: 'base64', skipPreflight, maxRetries: 3, preflightCommitment: 'confirmed' }], 20000);
  if (j.error) { const logs = j.error.data && j.error.data.logs; throw new Error((j.error.message || 'send failed') + (logs ? ' | ' + logs.slice(-3).join(' | ') : '')); }
  return j.result;
}
async function sendAndConfirm(bytes) { const sig = await sendRaw(bytes); const c = await confirm(sig); if (!c.ok) { const e = new Error(c.err); e.sig = sig; throw e; } return sig; }
// a plain transaction from a coin wallet (transfers, burns, token moves)
async function sendIxs(payer, ixs) {
  const { Transaction, ComputeBudgetProgram } = w3();
  const bh = await blockhash();
  const tx = new Transaction({ feePayer: payer.publicKey, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight });
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }), ...ixs); tx.sign(payer);
  return sendAndConfirm(tx.serialize());
}
// PumpPortal's local API writes the pump.fun transaction; we sign it here with the coin's own keys
async function portal(args, signers) {
  if (L.MOCK && L.MOCK.portal) return L.MOCK.portal(args);
  const r = await fetch(PORTAL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(15000) });
  if (r.status !== 200) throw new Error('pumpportal ' + r.status + ': ' + (await r.text().catch(() => '')).slice(0, 160));
  const { VersionedTransaction } = w3();
  const tx = VersionedTransaction.deserialize(new Uint8Array(await r.arrayBuffer()));
  tx.sign(signers); return tx;
}

// ---------- reading a coin wallet ----------
async function mintInfo(mint) {
  return L.remember('mi:' + mint, 36e5, async () => { const [m] = await L.accounts([mint]); if (!m) throw new Error('mint not found'); return { program: m.owner, decimals: m.data[44] }; });
}
async function tokenBal(owner, mint) {
  const { program } = await mintInfo(mint); const [a] = await L.accounts([L.ataOf(owner, mint, program)]);
  return L.tokenAmount(a);
}
async function waiting(wallet) {   // creator fees waiting to be claimed, in lamports
  const v1 = L.creatorVaultOf(wallet), v2 = L.ammVaultOf(wallet);
  const [a, b] = await L.accounts([v1, L.ataOf(v2, L.SOL, L.TOKEN)]);
  return Math.max(0, (a ? a.lamports - L.RENT0 : 0)) + Number(L.tokenAmount(b));
}

// ---------- the launch: one deposit, two coins ----------
const SIDES = ['yes', 'no'];
async function createSide(d, k, side) {
  const c = d[side], mk = k[side];
  try {
    const tx = await portal({ publicKey: k.wallet.publicKey.toBase58(), action: 'create', tokenMetadata: { name: c.name, symbol: c.symbol, uri: c.uri },
      mint: mk.publicKey.toBase58(), denominatedInSol: 'true', amount: c.dev, slippage: 10, priorityFee: PRIORITY, pool: 'pump' }, [mk, k.wallet]);
    const sig = await sendAndConfirm(tx.serialize());
    return { ok: true, sig };
  } catch (e) {
    const [bc] = await L.accounts([L.bondingCurveOf(c.mint)]).catch(() => [null]);    // it may have landed even though we did not see it confirm
    if (bc && bc.owner === L.PUMP) return { ok: true, sig: e.sig || null };
    return { ok: false, error: String(e.message).slice(0, 240), sig: e.sig };
  }
}
async function create(d) {
  const k = await keys(d.id);
  const sigs = { ...(d.sigs || {}) };
  for (const side of SIDES) {
    if (sigs[side]) continue;
    await L.log(d.id, 'launch', `creating the ${side.toUpperCase()} coin $${d[side].symbol} on pump.fun`);
    const r = await createSide(d, k, side);
    if (!r.ok) {
      const tries = (d.create_tries || 0) + 1;
      await L.q(`UPDATE vs_duels SET create_tries=$2, sigs=$3, err=$4, state=CASE WHEN $2 >= 3 THEN 'failed' ELSE 'creating' END WHERE id=$1`, [d.id, tries, JSON.stringify(sigs), r.error]);
      await L.log(d.id, 'error', `creating $${d[side].symbol} failed (try ${tries}/3): ${r.error.slice(0, 160)}`, { sig: r.sig });
      if (tries >= 3) await refund({ ...d, sigs }, 'the duel could not be created; what is left of the deposit was returned');
      return { ok: false, error: r.error };
    }
    sigs[side] = r.sig || 'landed';
    await L.q(`UPDATE vs_duels SET sigs=$2 WHERE id=$1`, [d.id, JSON.stringify(sigs)]);
    await L.log(d.id, 'launch', `$${d[side].symbol} (${side.toUpperCase()}) is live on pump.fun`, { sig: r.sig });
  }
  await L.q(`UPDATE vs_duels SET state='live', live_at=now(), err=NULL WHERE id=$1`, [d.id]);
  await L.log(d.id, 'launch', `the duel is live. both coins share one creator wallet, so both coins' fees fill one pot`);
  await handOut(d, k).catch(e => L.log(d.id, 'error', 'sending the first buys back failed: ' + String(e.message).slice(0, 160)));
  return { ok: true };
}
// after launch: the launcher's first-buy tokens of both coins, and any SOL beyond the reserve, go back to the launcher
async function handOut(d, k) {
  k = k || await keys(d.id);
  const { PublicKey, SystemProgram } = w3(); const S = sp();
  const owner = k.wallet.publicKey, to = new PublicKey(d.launcher); const ixs = [];
  for (const side of SIDES) {
    const m = d[side].mint; const { program, decimals } = await mintInfo(m); const prog = new PublicKey(program), mint = new PublicKey(m);
    const amt = await tokenBal(owner.toBase58(), m);
    if (amt > 0n) {
      const src = new PublicKey(L.ataOf(owner.toBase58(), m, program)), dst = new PublicKey(L.ataOf(d.launcher, m, program));
      ixs.push(S.createAssociatedTokenAccountIdempotentInstruction(owner, dst, to, mint, prog), S.createTransferCheckedInstruction(src, mint, dst, owner, amt, decimals, [], prog));
    }
  }
  const bal = await L.balance(owner.toBase58());
  const extra = bal - RESERVE - 0.005 * LAMPORTS;
  if (extra > 0.002 * LAMPORTS) ixs.push(SystemProgram.transfer({ fromPubkey: owner, toPubkey: to, lamports: Math.floor(extra) }));
  if (!ixs.length) return null;
  const sig = await sendIxs(k.wallet, ixs);
  await L.q(`UPDATE vs_duels SET out_sig=$2 WHERE id=$1`, [d.id, sig]);
  await L.log(d.id, 'launch', `first buys of both coins${extra > 0.002 * LAMPORTS ? ' and unused SOL' : ''} sent to the launcher`, { sig, sol: extra > 0 ? extra / LAMPORTS : null });
  return sig;
}
async function refund(d, why) {
  const k = await keys(d.id); const { SystemProgram, PublicKey } = w3();
  const bal = await L.balance(k.wallet.publicKey.toBase58());
  const amt = bal - 10000; if (amt <= 0) return null;
  try {
    const sig = await sendIxs(k.wallet, [SystemProgram.transfer({ fromPubkey: k.wallet.publicKey, toPubkey: new PublicKey(d.launcher), lamports: amt })]);
    await L.q(`UPDATE vs_duels SET refund_sig=$2, state=CASE WHEN state IN ('waiting','expired') THEN 'refunded' ELSE state END WHERE id=$1`, [d.id, sig]);
    await L.log(d.id, 'refund', why, { sig, sol: amt / LAMPORTS });
    return sig;
  } catch (e) { await L.log(d.id, 'error', 'refund failed, will retry: ' + String(e.message).slice(0, 160)); return null; }
}
async function advance(d) {
  if (d.state === 'waiting') {
    const bal = await L.balance(d.wallet);
    if (bal >= Number(d.need) * 0.995) {
      const got = await L.q(`UPDATE vs_duels SET state='creating', ticked_at=now() WHERE id=$1 AND state='waiting' RETURNING *`, [d.id]);
      if (got.length) return create(got[0]);
    } else if (Date.now() - new Date(d.created_at) > 3 * 36e5) {
      await L.q(`UPDATE vs_duels SET state='expired' WHERE id=$1 AND state='waiting'`, [d.id]);
      if (bal > 10000) await refund({ ...d, state: 'expired' }, 'never fully funded, deposit returned');
    }
    return { ok: true, state: 'waiting', balance: bal };
  }
  if (d.state === 'creating' && Date.now() - new Date(d.ticked_at || d.created_at) > 60000) {
    await L.q(`UPDATE vs_duels SET ticked_at=now() WHERE id=$1`, [d.id]);
    return create(d);
  }
  if ((d.state === 'expired' || d.state === 'failed') && !d.refund_sig) { const bal = await L.balance(d.wallet); if (bal > 10000) await refund(d, 'deposit returned'); }
  return { ok: true, state: d.state };
}

// ---------- fees: both coins pay their creator fees to the same wallet, the pot ----------
async function claim(d, k) {
  const w = await waiting(d.wallet);
  if (w < CLAIM_MIN) return 0;
  const before = await L.balance(d.wallet);
  const tx = await portal({ publicKey: d.wallet, action: 'collectCreatorFee', priorityFee: 0.00001, pool: 'pump' }, [k.wallet]);
  const sig = await sendAndConfirm(tx.serialize());
  const got = Math.max(0, (await L.balance(d.wallet)) - before);
  if (got <= 0) return 0;
  await L.q(`UPDATE vs_duels SET claimed = claimed + $2 WHERE id=$1`, [d.id, got]);
  await L.log(d.id, 'claim', `claimed ${(got / LAMPORTS).toFixed(4)} SOL of creator fees into the pot`, { sig, sol: got / LAMPORTS });
  const cut = Math.floor(got * L.FEE_BPS / 1e4);
  if (L.STUDIO && cut >= 100000) {
    const { SystemProgram, PublicKey } = w3();
    const s2 = await sendIxs(k.wallet, [SystemProgram.transfer({ fromPubkey: k.wallet.publicKey, toPubkey: new PublicKey(L.STUDIO), lamports: cut })]).catch(() => null);
    if (s2) await L.log(d.id, 'fee', `vrsus's 5% (${(cut / LAMPORTS).toFixed(4)} SOL)`, { sig: s2, sol: cut / LAMPORTS });
    else await L.log(d.id, 'error', `sending vrsus's 5% failed; it stays in the pot`);
  }
  return got;
}
async function pot(d) { return Math.max(0, (await L.balance(d.wallet)) - RESERVE); }

// ---------- holders: every token account of the coin (the top 20 when the RPC won't list them all) ----------
async function holders(d, side) {
  const mint = d[side].mint; const { program } = await mintInfo(mint);
  const skip = new Set([d.wallet, L.bondingCurveOf(mint)]);
  const by = new Map(); let source = 'all';
  try {
    const r = await L.rpc('getProgramAccounts', [program, { encoding: 'base64', commitment: 'confirmed', dataSlice: { offset: 32, length: 40 }, filters: [{ memcmp: { offset: 0, bytes: mint } }] }], 20000);
    for (const a of r || []) {
      const b = Buffer.from(a.account.data[0], 'base64'); if (b.length < 40) continue;
      const owner = L.b58enc(b.subarray(0, 32)), amt = b.readBigUInt64LE(32);
      if (amt > 0n) by.set(owner, (by.get(owner) || 0n) + amt);
    }
    if (!Array.isArray(r)) throw new Error('no list');
  } catch {
    source = 'top20'; by.clear();
    const r = await L.rpc('getTokenLargestAccounts', [mint, { commitment: 'confirmed' }]);
    const accts = (r.value || []).filter(a => Number(a.amount) > 0);
    const raw = await L.accounts(accts.map(a => a.address));
    raw.forEach((a, i) => { const owner = L.tokenOwner(a); if (owner) by.set(owner, (by.get(owner) || 0n) + BigInt(accts[i].amount)); });
  }
  const list = [...by.entries()].filter(([o]) => !skip.has(o) && L.onCurve(L.b58dec(o)))     // pools and the curve are program accounts, not people
    .map(([owner, amount]) => ({ owner, amount: amount.toString() })).sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : -1) || a.owner.localeCompare(b.owner));
  return { list, source };
}
const H = s => crypto.createHash('sha256').update(s).digest('hex');
const snapHash = (side, potL, list) => H(V.snapStr(side, potL, list));
async function rootOf(round, side, potL, list) { return (await V.merkle(V.leaves(round, side, potL, list).map(x => x.s), H)).root; }

// ---------- a payout round: snapshot, publish, pay ----------
async function openRound(d, side, potL, label) {
  const h = await holders(d, side);
  if (!h.list.length) { await L.log(d.id, 'error', `no ${side.toUpperCase()} holders found to pay; the pot waits`); return null; }
  const round = (await L.q(`UPDATE vs_duels SET rounds=rounds+1 WHERE id=$1 RETURNING rounds`, [d.id]))[0].rounds;
  const pays = V.split(potL, h.list);
  const exist = await L.accounts(pays.map(p => p.owner));
  const ok = pays.filter((p, i) => p.lamports >= V.DUST && (exist[i] && exist[i].lamports > 0 || p.lamports >= L.RENT0));
  const hash = snapHash(side, potL, h.list), root = await rootOf(round, side, potL, h.list);
  await L.q(`INSERT INTO vs_rounds (id, round, side, pot, total, holders, hash, source, root) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [d.id, round, side, potL, h.list.reduce((t, x) => t + BigInt(x.amount), 0n).toString(), JSON.stringify(h.list), hash, h.source, root]);
  for (const p of ok) await L.q(`INSERT INTO vs_pays (id, round, owner, lamports) VALUES ($1,$2,$3,$4)`, [d.id, round, p.owner, p.lamports]);
  await L.log(d.id, 'snapshot', `${label}: ${h.list.length} ${side.toUpperCase()} holders snapshotted (${h.source === 'all' ? 'every holder' : 'the top 20'}), merkle root ${root.slice(0, 16)}… · ${ok.length} payouts planned from ${(potL / LAMPORTS).toFixed(4)} SOL`);
  return round;
}
async function payRound(d, k, round, deadline) {
  const { SystemProgram, PublicKey, Transaction, ComputeBudgetProgram } = w3();
  // a payout whose transaction never landed is cleared and sent again; one that landed is never sent twice
  const sent = await L.q(`SELECT DISTINCT sig FROM vs_pays WHERE id=$1 AND round=$2 AND sig IS NOT NULL AND sig LIKE 'pending:%'`, [d.id, round]);
  for (const r of sent) {
    const sig = r.sig.slice(8); const st = await L.rpc('getSignatureStatuses', [[sig], { searchTransactionHistory: true }]).catch(() => null);
    const s = st && st.value && st.value[0];
    if (s && !s.err && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) await L.q(`UPDATE vs_pays SET sig=$3 WHERE id=$1 AND round=$2 AND sig=$4`, [d.id, round, sig, r.sig]);
    else if (!s || s.err) await L.q(`UPDATE vs_pays SET sig=NULL WHERE id=$1 AND round=$2 AND sig=$3`, [d.id, round, r.sig]);
  }
  const todo = await L.q(`SELECT n, owner, lamports FROM vs_pays WHERE id=$1 AND round=$2 AND sig IS NULL ORDER BY n`, [d.id, round]);
  for (let i = 0; i < todo.length; i += 12) {
    if (Date.now() > deadline) return false;
    const batch = todo.slice(i, i + 12);
    const bh = await blockhash();
    const tx = new Transaction({ feePayer: k.wallet.publicKey, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight });
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }), ...batch.map(p => SystemProgram.transfer({ fromPubkey: k.wallet.publicKey, toPubkey: new PublicKey(p.owner), lamports: Number(p.lamports) })));
    tx.sign(k.wallet);
    const sig = L.b58enc(tx.signature);
    await L.q(`UPDATE vs_pays SET sig=$2 WHERE n = ANY($1)`, [batch.map(p => p.n), 'pending:' + sig]);
    try {
      await sendAndConfirm(tx.serialize());
      await L.q(`UPDATE vs_pays SET sig=$2, at=now() WHERE n = ANY($1)`, [batch.map(p => p.n), sig]);
      const sum = batch.reduce((t, p) => t + Number(p.lamports), 0);
      await L.q(`UPDATE vs_rounds SET paid=paid+$3 WHERE id=$1 AND round=$2`, [d.id, round, sum]);
      await L.q(`UPDATE vs_duels SET paid=paid+$2, last_pay_at=now() WHERE id=$1`, [d.id, sum]);
      await L.log(d.id, 'pay', `round ${round}: paid ${batch.length} holders ${(sum / LAMPORTS).toFixed(4)} SOL`, { sig, sol: sum / LAMPORTS });
    } catch (e) {
      if (!/not confirmed in time/.test(String(e.message))) await L.q(`UPDATE vs_pays SET sig=NULL WHERE n = ANY($1)`, [batch.map(p => p.n)]);
      await L.q(`UPDATE vs_duels SET pay_fails=pay_fails+1 WHERE id=$1`, [d.id]);
      await L.log(d.id, 'error', `round ${round}: a payout batch didn’t land (${String(e.message).slice(0, 120)}); it is retried on the next pass`, { sig });
      return false;
    }
  }
  const left = await L.q(`SELECT count(*)::int AS n FROM vs_pays WHERE id=$1 AND round=$2 AND (sig IS NULL OR sig LIKE 'pending:%')`, [d.id, round]);
  if (!left[0].n) { await L.q(`UPDATE vs_rounds SET state='paid' WHERE id=$1 AND round=$2`, [d.id, round]); await L.log(d.id, 'pay', `round ${round} is fully paid`); return true; }
  return false;
}
// the pot that can be paid now: the wallet minus the gas reserve, minus a little for the payout transactions themselves
async function payable(d, n) { return Math.max(0, (await pot(d)) - Math.ceil(n / 12 + 1) * 20000); }

// ---------- settlement: the first pass that sees a final answer from the source ----------
async function settle(d, k, deadline, r) {
  const won = await L.q(`UPDATE vs_duels SET state='settling', outcome=$2, settled_at=now(), reading=$3 WHERE id=$1 AND state='live' RETURNING *`, [d.id, r.outcome, JSON.stringify({ text: r.text, ...r.evidence })]);
  if (!won.length) return;
  d = won[0];
  await L.log(d.id, 'settle', `${r.outcome === 'VOID' ? 'VOID' : r.outcome + ' wins'}: ${r.text}`, { src: (r.evidence && (r.evidence.page || r.evidence.api)) || null });
  try { await claim(d, k); } catch (e) { await L.log(d.id, 'error', 'final claim failed: ' + String(e.message).slice(0, 140)); }
  await payout(d, k, deadline, true);
}
async function payout(d, k, deadline, first) {
  // finish any round that is still being paid
  const open = await L.q(`SELECT round FROM vs_rounds WHERE id=$1 AND state='paying' ORDER BY round`, [d.id]);
  for (const o of open) { const done = await payRound(d, k, o.round, deadline); if (!done) { await L.q(`UPDATE vs_duels SET state='settling' WHERE id=$1`, [d.id]); return; } }
  if (open.length && d.state === 'settling' && !first) { await L.q(`UPDATE vs_duels SET state='settled' WHERE id=$1`, [d.id]); return; }
  const sides = d.outcome === 'VOID' ? ['yes', 'no'] : [d.outcome.toLowerCase()];
  const avail = await payable(d, 60);
  if (!first && avail < V.POST_MIN * LAMPORTS) { if (d.state === 'settling') await L.q(`UPDATE vs_duels SET state='settled' WHERE id=$1`, [d.id]); return; }
  if (!first && d.last_pay_at && Date.now() - new Date(d.last_pay_at) < 864e5) return;
  if (avail < V.DUST * 4) { await L.q(`UPDATE vs_duels SET state='settled' WHERE id=$1`, [d.id]); await L.log(d.id, 'pay', 'the pot was too small to pay out; it keeps filling and is paid once it is worth sending'); return; }
  for (const side of sides) {
    const share = Math.floor(avail / sides.length);
    const round = await openRound(d, side, share, first ? (d.outcome === 'VOID' ? `void: half the pot to ${side.toUpperCase()}` : `settlement`) : `fees since the last round`);
    if (round) await payRound(d, k, round, deadline);
  }
  // settled only once every round is fully paid; until then every pass picks it up again
  const left = await L.q(`SELECT count(*)::int AS n FROM vs_rounds WHERE id=$1 AND state='paying'`, [d.id]);
  await L.q(`UPDATE vs_duels SET state=$2 WHERE id=$1 AND state IN ('settling','settled')`, [d.id, left[0].n ? 'settling' : 'settled']);
}

// ---------- one pass for one live duel ----------
async function tickDuel(d, deadline) {
  const k = await keys(d.id);
  if (k.wallet.publicKey.toBase58() !== d.wallet) throw new Error('key mismatch');
  try { await claim(d, k); } catch (e) { await L.log(d.id, 'error', 'claim failed: ' + String(e.message).slice(0, 160)); }
  const [my, mn] = await Promise.all([WD.coinMarket(d.yes.mint).catch(() => ({ ok: false })), WD.coinMarket(d.no.mint).catch(() => ({ ok: false }))]);
  const p = await pot(d).catch(() => null), w = await waiting(d.wallet).catch(() => 0);
  await L.q(`UPDATE vs_duels SET mcap_yes=COALESCE($2, mcap_yes), mcap_no=COALESCE($3, mcap_no), pot_now=$4 WHERE id=$1`, [d.id, my.ok ? my.mcapUsd : null, mn.ok ? mn.mcapUsd : null, p == null ? null : p + w]);
  if (d.state === 'live') {
    const r = await WD.read(d.event, true);
    await L.q(`UPDATE vs_duels SET last_read=$2, last_read_at=now() WHERE id=$1`, [d.id, JSON.stringify({ ok: r.ok, text: r.text, outcome: r.outcome || null })]);
    // the duel's tape: both market caps, the pot and the source's own number, about every 5 minutes
    if (!d.sampled_at || Date.now() - new Date(d.sampled_at) > 4.5 * 6e4) {
      const src = d.kind === 'pm' ? (r.yes != null ? r.yes : null) : d.kind === 'price' ? ((r.evidence && r.evidence.spot) || null) : null;
      const note = d.kind === 'game' && r.ok ? String(r.text || '').slice(0, 80) : null;
      await L.q(`INSERT INTO vs_samples (id, my, mn, pot, src, note) VALUES ($1,$2,$3,$4,$5,$6)`, [d.id, my.ok ? my.mcapUsd : d.mcap_yes, mn.ok ? mn.mcapUsd : d.mcap_no, p == null ? null : p + w, src, note]).catch(() => {});
      await L.q(`UPDATE vs_duels SET sampled_at=now() WHERE id=$1`, [d.id]);
    }
    if (r.ok && r.outcome) await settle(d, k, deadline, r);
  } else if (d.state === 'settling' || d.state === 'settled') {
    await payout(d, k, deadline, false);
  }
  await L.q(`UPDATE vs_duels SET ticked_at=now() WHERE id=$1`, [d.id]);
}

// ---------- the tick: launches, then live duels (closest to settling first), then settled duels with new fees ----------
async function tick(budgetMs = 45000) {
  await L.ready();
  const lock = await L.q(`INSERT INTO vs_meta (k, v) VALUES ('tick', $1) ON CONFLICT (k) DO UPDATE SET v=EXCLUDED.v WHERE vs_meta.v::bigint < $2 RETURNING v`, [String(Date.now()), Date.now() - 50000]);
  if (!lock.length) return { ok: true, skipped: 'another pass is running or ran under a minute ago' };
  const t0 = Date.now(), deadline = Date.now() + budgetMs; const done = { launches: 0, duels: 0, settled: 0, errors: 0 };
  const slot = await L.rpc('getSlot', [{ commitment: 'confirmed' }], 5000).catch(() => null);
  const pend = await L.q(`SELECT * FROM vs_duels WHERE state IN ('waiting','creating') OR (state IN ('expired','failed') AND refund_sig IS NULL) ORDER BY created_at LIMIT 20`);
  for (const d of pend) { if (Date.now() > deadline - 10000) break; try { await advance(d); done.launches++; } catch { done.errors++; } }
  const live = await L.q(`SELECT * FROM vs_duels WHERE state IN ('live','settling') ORDER BY (state='settling') DESC, closes_at NULLS LAST, ticked_at NULLS FIRST LIMIT 40`);
  await L.pool(live, 4, async d => { if (Date.now() > deadline - 8000) return; try { await tickDuel(d, deadline); done.duels++; } catch (e) { done.errors++; await L.log(d.id, 'error', 'pass: ' + String(e.message).slice(0, 160)); } });
  const post = await L.q(`SELECT * FROM vs_duels WHERE state='settled' AND (last_pay_at IS NULL OR last_pay_at < now() - interval '1 day') ORDER BY ticked_at NULLS FIRST LIMIT 6`);
  for (const d of post) { if (Date.now() > deadline - 8000) break; try { await tickDuel(d, deadline); done.settled++; } catch { done.errors++; } }
  const ms = Date.now() - t0;
  await L.q(`INSERT INTO vs_ticks (ms, launches, duels, settled, errors, slot) VALUES ($1,$2,$3,$4,$5,$6)`, [ms, done.launches, done.duels, done.settled, done.errors, slot]).catch(() => {});
  if (Math.random() < .05) await L.q(`DELETE FROM vs_ticks WHERE at < now() - interval '3 days'`).catch(() => {});
  return { ok: true, ...done, ms, slot, at: new Date().toISOString() };
}

module.exports = { keys, newId, need, advance, tick, blockhash, sendRaw, confirm, portal, waiting, pot, holders, snapHash, rootOf, H, RESERVE, CREATE_COST, MIN_DEV, MAX_DEV, LAMPORTS };
