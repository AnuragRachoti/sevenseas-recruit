// Duplicate detection: email/phone exact match, then fuzzy name + profession/specialty/license.
// Never merges anything automatically; it only flags.
const { db, getSetting } = require('./db');

const normEmail = (e) => (e ? String(e).trim().toLowerCase() : '');
const normPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : ''; };
const normName = (n) => String(n || '').toLowerCase().replace(/\b(dr|mr|mrs|ms|miss)\.?\s+/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

function bigrams(s) { const out = []; const x = s.replace(/ /g, ''); for (let i = 0; i < x.length - 1; i++) out.push(x.slice(i, i + 2)); return out; }
function nameSimilarity(a, b) {
  a = normName(a); b = normName(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  // same tokens in different order ("Khan Ahmed" vs "Ahmed Khan")
  const ta = a.split(' ').sort().join(' '); const tb = b.split(' ').sort().join(' ');
  if (ta === tb) return 0.97;
  const A = bigrams(a); const B = bigrams(b); if (!A.length || !B.length) return 0;
  const m = new Map(); A.forEach((g) => m.set(g, (m.get(g) || 0) + 1));
  let hit = 0; B.forEach((g) => { if (m.get(g) > 0) { hit++; m.set(g, m.get(g) - 1); } });
  return (2 * hit) / (A.length + B.length);
}

function checkDuplicate(fields, excludeId = null) {
  const threshold = getSetting('duplicate_review_threshold', 0.85);
  const rows = db.prepare('SELECT id, full_name, email, phone, profession, specialty, license_authority FROM candidates').all();
  let best = { status: 'Unique', candidate_id: null, score: 0, reason: null };
  const e = normEmail(fields.email); const p = normPhone(fields.phone);
  for (const c of rows) {
    if (c.id === excludeId) continue;
    let score = 0; const why = [];
    if (e && e === normEmail(c.email)) { score = 1; why.push('same email'); }
    if (p && p === normPhone(c.phone)) { score = Math.max(score, 0.97); why.push('same phone'); }
    const ns = nameSimilarity(fields.full_name, c.full_name);
    if (ns >= 0.75) {
      let s = ns * 0.7;
      if (fields.profession && fields.profession === c.profession) s += 0.1;
      if (fields.specialty && c.specialty && fields.specialty.toLowerCase() === c.specialty.toLowerCase()) s += 0.1;
      if (fields.license_authority && fields.license_authority === c.license_authority) s += 0.1;
      if (s > score) score = s;
      why.push(`name ${Math.round(ns * 100)}% similar`);
    }
    if (score > best.score) best = { candidate_id: c.id, score: Math.round(score * 100) / 100, reason: why.join(', ') };
  }
  if (best.score >= 0.95 && /email|phone/.test(best.reason || '')) best.status = 'Confirmed Duplicate';
  else if (best.score >= threshold) best.status = 'Possible Duplicate';
  else best = { status: 'Unique', candidate_id: null, score: best.score, reason: null };
  return best;
}

module.exports = { checkDuplicate, nameSimilarity };
