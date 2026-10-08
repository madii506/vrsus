/* vrsus proofs, computed in the browser: a round's snapshot hash, its Merkle root, the pro-rata split,
   a wallet's Merkle path, and the payout transactions read back from the chain. Nothing here trusts the server's math. */
(function () {
  const { esc, api, sha, short } = VR;
  const V = window.VS;
  const H = s => sha(s);
  const S = l => (Number(l) / 1e9).toFixed(6);

  // fetch a round and check everything that can be checked without the chain
  async function round(id, n) {
    const r = await api(`/api/duels?op=round&id=${encodeURIComponent(id)}&r=${n}`);
    if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'the round didn’t load' };
    const R = r.round, h = R.holders;
    const hash = await H(V.snapStr(R.side, R.pot, h));
    const lv = V.leaves(R.round, R.side, R.pot, h);
    const m = await V.merkle(lv.map(x => x.s), H);
    const want = lv.filter(p => p.lamports >= V.DUST);
    const paid = r.pays.filter(p => p.sig);
    let match = 0; const miss = [];
    for (const w of want) { const p = paid.find(x => x.owner === w.owner); if (p && p.lamports === w.lamports) match++; else miss.push(w.owner); }
    const extra = paid.filter(p => !want.find(w => w.owner === p.owner));
    return { ok: true, R, pays: r.pays, holders: h, leaves: lv, levels: m.levels, hash, hashOk: hash === R.hash, root: m.root, rootOk: R.root ? m.root === R.root : null,
      want, match, miss, extra, sum: paid.reduce((t, p) => t + p.lamports, 0), txs: [...new Set(paid.map(p => p.sig))] };
  }
  // one wallet's path from its leaf to the root
  async function path(v, owner) {
    const i = v.leaves.findIndex(x => x.owner === owner); if (i < 0) return null;
    const leaf = v.leaves[i], lh = await H(leaf.s), p = V.proof(v.levels, i), w = await V.walk(lh, p, H);
    return { i, n: v.leaves.length, leaf, leafHash: lh, path: p, steps: w.steps, root: w.root, ok: w.root === (v.R.root || v.root), pay: v.pays.find(x => x.owner === owner) || null };
  }
  function tree(pp, v) {
    const L = [];
    L.push(`<span class="lf">leaf</span>  #${pp.i + 1} of ${pp.n}  ${esc(short(pp.leaf.owner))}  bag ${Number(pp.leaf.amount).toLocaleString('en-US')}  owed ${S(pp.leaf.lamports)} SOL`);
    L.push(`      sha256("${esc(pp.leaf.s.replace(pp.leaf.owner, short(pp.leaf.owner)))}")`);
    L.push(`      = <span class="lf">${pp.leafHash.slice(0, 20)}…</span>`);
    pp.path.forEach((p, k) => L.push(`  d${String(p.d).padEnd(2)} <span class="sb">+ ${p.pos === 'L' ? 'left ' : 'right'} sibling ${p.hash.slice(0, 14)}…</span>  -> ${pp.steps[k + 1].slice(0, 14)}…`));
    if (!pp.path.length) L.push('      (the only leaf: it is the root)');
    const pub = v.R.root;
    L.push(pub ? `<span class="${pp.ok ? 'rt' : 'bad'}">root  ${pp.root.slice(0, 20)}…  ${pp.ok ? '==' : '!='} published ${pub.slice(0, 20)}…  ${pp.ok ? '[+] proven' : '[x] does not match'}</span>`
      : `<span class="rt">root  ${pp.root.slice(0, 20)}…</span>  (this round was published before roots; the snapshot hash covers it)`);
    return L.join('\n');
  }
  // read every payout transaction back from the chain and match its transfers to the snapshot
  async function chain(v, wallet, onStep) {
    const out = { txs: 0, okTx: 0, matched: 0, bad: [], via: new Set() };
    const bySig = {}; v.pays.filter(p => p.sig).forEach(p => (bySig[p.sig] = bySig[p.sig] || []).push(p));
    const sigs = Object.keys(bySig).slice(0, 30);
    for (const sg of sigs) {
      out.txs++;
      const r = await VR.rpc('getTransaction', [sg, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
      out.via.add(r.via);
      const t = r.result;
      if (!t) { out.bad.push(`${short(sg)}: not found on chain`); onStep && onStep(out); continue; }
      if (t.meta && t.meta.err) { out.bad.push(`${short(sg)}: failed on chain`); onStep && onStep(out); continue; }
      out.okTx++;
      const ixs = ((t.transaction && t.transaction.message && t.transaction.message.instructions) || []).filter(i => i.parsed && i.parsed.type === 'transfer' && (i.program === 'system' || i.programId === '11111111111111111111111111111111'));
      for (const p of bySig[sg]) {
        const hit = ixs.find(i => i.parsed.info.destination === p.owner && Number(i.parsed.info.lamports) === p.lamports && (!wallet || i.parsed.info.source === wallet));
        if (hit) out.matched++; else out.bad.push(`${short(sg)}: no transfer of ${S(p.lamports)} SOL to ${short(p.owner)}`);
      }
      onStep && onStep(out);
    }
    out.payouts = v.pays.filter(p => p.sig && sigs.includes(p.sig)).length;
    return out;
  }
  // the standard verdict lines
  function lines(v) {
    const ln = (ok, t) => `<div class="${ok ? 'ok2' : 'bad2'}">${ok ? '[+]' : '[x]'} ${t}</div>`;
    return ln(v.hashOk, `snapshot hash recomputed: ${v.hash.slice(0, 24)}… ${v.hashOk ? 'matches' : 'does NOT match'}`) +
      (v.rootOk == null ? ln(true, `merkle root computed: ${v.root.slice(0, 24)}… (round published before roots)`) : ln(v.rootOk, `merkle root recomputed over ${v.leaves.length} leaves: ${v.root.slice(0, 24)}… ${v.rootOk ? 'matches the published root' : 'does NOT match'}`)) +
      ln(true, `${v.holders.length} holders · ${BigInt(v.R.total).toLocaleString('en-US')} tokens · pot ${S(v.R.pot)} SOL`) +
      ln(v.match === v.want.length, `${v.match} of ${v.want.length} payouts match floor(pot × bag ÷ total) exactly${v.miss.length ? ` (${v.miss.length} not sent yet)` : ''}`) +
      ln(!v.extra.length, v.extra.length ? `${v.extra.length} payouts to wallets not in the snapshot` : 'no payout went to a wallet outside the snapshot') +
      ln(true, `${S(v.sum)} SOL sent in ${v.txs.length} transaction${v.txs.length === 1 ? '' : 's'}`);
  }
  window.VP = { round, path, tree, chain, lines, S };
})();
