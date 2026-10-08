// GET /m/<id>-yes|no  (→ /api/meta?id=)   the metadata JSON a coin's on-chain uri points at
// GET /i/<id>-yes|no  (→ /api/meta?img=)  its picture
const L = require('./_lib');
module.exports = async (req, res) => {
  const qy = L.query(req);
  if (!L.dbReady()) return L.send(res, 404, { error: 'not found' });
  await L.ready();
  const parse = v => { const m = /^([A-Za-z0-9_-]{6,20})-(yes|no)(?:\.\w+)?$/.exec(String(v || '')); return m ? { id: m[1], side: m[2] } : null; };
  if (qy.img) {
    const k = parse(qy.img);
    const r = k ? await L.q(`SELECT ${k.side === 'yes' ? 'img_yes' : 'img_no'} AS img FROM vs_duels WHERE id=$1`, [k.id]).catch(() => []) : [];
    if (!r.length || !r[0].img) { res.statusCode = 404; res.setHeader('Cache-Control', 'public, max-age=30'); return res.end(); }
    res.statusCode = 200; res.setHeader('Content-Type', 'image/jpeg'); res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
    return res.end(Buffer.from(r[0].img));
  }
  const k = parse(qy.id);
  if (!k) return L.send(res, 404, { error: 'not found' });
  const r = await L.q('SELECT id, yes, no FROM vs_duels WHERE id=$1', [k.id]).catch(() => []);
  if (!r.length) return L.send(res, 404, { error: 'not found' }, 'public, max-age=30');
  const c = r[0][k.side], site = L.origin(req), page = site + '/duel?id=' + k.id;
  L.send(res, 200, { name: c.name, symbol: c.symbol, description: c.desc, image: `${site}/i/${k.id}-${k.side}`, showName: true, createdOn: site, website: page, external_url: page },
    'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800');
};
