// Vacancy matching: transparent rules score (0-100), optional AI rationale on demand.
const { db, nextId, getSetting } = require('./db');
const { PROMPTS, provider, callJSON } = require('./ai');

const WEIGHTS = { specialty: 25, license: 25, experience: 20, availability: 10, salary: 10, location: 10 };
const SYN = { er: 'emergency', 'a&e': 'emergency', 'general practice': 'gp', 'general practitioner': 'gp', 'family medicine': 'gp', 'critical care': 'icu', 'ot': 'operating theatre', 'or': 'operating theatre', paediatrics: 'pediatrics' };
const norm = (s) => { const x = String(s || '').toLowerCase().trim(); return SYN[x] || x; };
const AVAIL_DAYS = { Immediate: 0, '30 Days': 30, '60 Days': 60, '90 Days': 90 };
const UAE = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah', 'Al Ain'];

function score(c, v) {
  const s = {}; const gaps = []; const strengths = [];
  // Specialty
  if (!v.specialty) s.specialty = 1;
  else if (norm(c.specialty) === norm(v.specialty)) s.specialty = 1;
  else if (c.specialty && (norm(c.specialty).includes(norm(v.specialty)) || norm(v.specialty).includes(norm(c.specialty)))) s.specialty = 0.7;
  else s.specialty = 0.2;
  if (s.specialty < 0.7) gaps.push(`Specialty ${c.specialty || 'unknown'} vs required ${v.specialty}`);
  else if (v.specialty) strengths.push(`${v.specialty} specialty`);

  // License
  const req = v.license_required;
  const st = c.license_status;
  if (!req || req === 'None' || req === 'Other') s.license = 1;
  else if (c.license_authority === req) s.license = { Active: 1, Eligible: 0.8, 'In Process': 0.6, Expired: 0.3 }[st] ?? 0.5;
  else if (c.license_authority && c.license_authority !== 'None') s.license = st === 'Active' ? 0.4 : 0.25;
  else s.license = 0.1;
  if (s.license < 0.7) gaps.push(`License: ${c.license_authority || 'none'} ${st || ''} vs ${req} required`.replace(/\s+/g, ' '));
  else if (req && req !== 'None') strengths.push(`${req} ${st === 'Active' ? 'licensed' : 'eligible'}`);

  // Experience
  const yrs = Number(c.years_experience);
  if (!v.min_experience) s.experience = 1;
  else if (isNaN(yrs) || c.years_experience == null) { s.experience = 0.5; gaps.push('Experience unknown'); }
  else if (yrs >= v.min_experience) { s.experience = 1; strengths.push(`${yrs} yrs experience`); }
  else { s.experience = Math.max(0, yrs / v.min_experience); gaps.push(`${yrs} yrs vs ${v.min_experience} required`); }

  // Availability vs target join date
  const days = AVAIL_DAYS[c.availability];
  if (c.availability === 'Not Available') { s.availability = 0; gaps.push('Not available'); }
  else if (days == null) s.availability = 0.6;
  else if (!v.target_join_date) s.availability = { 0: 1, 30: 0.9, 60: 0.7, 90: 0.5 }[days];
  else {
    const toJoin = Math.round((new Date(v.target_join_date) - new Date()) / 86400000);
    s.availability = days <= Math.max(toJoin, 0) ? 1 : Math.max(0, 1 - (days - Math.max(toJoin, 0)) / 60);
    if (s.availability < 0.7) gaps.push(`Available in ${days} days; target join in ${Math.max(toJoin, 0)} days`);
  }

  // Salary
  if (!v.max_salary || c.expected_salary == null) s.salary = 0.8;
  else if (c.expected_salary <= v.max_salary) s.salary = 1;
  else { s.salary = Math.max(0, 1 - ((c.expected_salary - v.max_salary) / v.max_salary) * 3); gaps.push(`Expects AED ${c.expected_salary} vs budget ${v.max_salary}`); }

  // Location
  if (!v.emirate || !c.current_emirate) s.location = 0.6;
  else if (c.current_emirate === v.emirate) s.location = 1;
  else if (UAE.includes(c.current_emirate)) s.location = 0.7;
  else { s.location = 0.4; gaps.push('Currently outside UAE'); }

  const overall = Math.round(Object.keys(WEIGHTS).reduce((t, k) => t + s[k] * WEIGHTS[k], 0));
  return { s, overall, gaps, strengths };
}

function band(overall) {
  if (overall >= getSetting('strong_match_threshold', 80)) return 'Recommend';
  if (overall >= getSetting('medium_match_threshold', 65)) return 'Recruiter Review';
  return 'Do Not Recommend';
}

const ACTIVE_CAND = "status IN ('Active','Passive','Interviewing') AND profile_status = 'Approved'";
const OPEN_VAC = "status IN ('Open','Interviewing')";

function upsert(c, v) {
  if (!c.profession || !v.profession || c.profession !== v.profession) {
    db.prepare("DELETE FROM matches WHERE vacancy_id=? AND candidate_id=? AND status='New'").run(v.id, c.id);
    return null;
  }
  const r = score(c, v); const b = band(r.overall);
  const existing = db.prepare('SELECT id FROM matches WHERE vacancy_id=? AND candidate_id=?').get(v.id, c.id);
  if (existing) {
    db.prepare(`UPDATE matches SET specialty_score=?, license_score=?, experience_score=?, availability_score=?, salary_score=?, location_score=?,
      overall_score=?, band=?, key_gaps=?, strengths=?, updated_at=datetime('now') WHERE id=?`)
      .run(r.s.specialty, r.s.license, r.s.experience, r.s.availability, r.s.salary, r.s.location, r.overall, b, r.gaps.join('; '), r.strengths.join('; '), existing.id);
    return existing.id;
  }
  const id = nextId('matches', 'MAT', 5);
  db.prepare(`INSERT INTO matches (id, vacancy_id, candidate_id, specialty_score, license_score, experience_score, availability_score, salary_score, location_score, overall_score, band, key_gaps, strengths)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, v.id, c.id, r.s.specialty, r.s.license, r.s.experience, r.s.availability, r.s.salary, r.s.location, r.overall, b, r.gaps.join('; '), r.strengths.join('; '));
  return id;
}

// Keep match status in step with interviews/placements that already exist.
function syncStatuses(vacancyId) {
  db.prepare(`UPDATE matches SET status='Interview' WHERE vacancy_id=? AND status IN ('New','Shortlisted','Submitted')
    AND EXISTS (SELECT 1 FROM interviews i WHERE i.vacancy_id=matches.vacancy_id AND i.candidate_id=matches.candidate_id)`).run(vacancyId);
  db.prepare(`UPDATE matches SET status='Placed' WHERE vacancy_id=?
    AND EXISTS (SELECT 1 FROM placements p WHERE p.vacancy_id=matches.vacancy_id AND p.candidate_id=matches.candidate_id)`).run(vacancyId);
}

function strongMatchTasks(vacancyId) {
  syncStatuses(vacancyId);
  const { createTask } = require('./automation');
  const v = db.prepare('SELECT * FROM vacancies WHERE id=?').get(vacancyId);
  if (!v) return;
  const strong = db.prepare("SELECT m.candidate_id, c.full_name FROM matches m JOIN candidates c ON c.id=m.candidate_id WHERE m.vacancy_id=? AND m.band='Recommend' AND m.status='New' ORDER BY m.overall_score DESC").all(vacancyId);
  if (!strong.length) return;
  createTask({
    auto_key: `strong:${vacancyId}:${strong.map((x) => x.candidate_id).sort().join(',')}`,
    task_type: 'Vacancy Match', title: `${strong.length} strong match${strong.length > 1 ? 'es' : ''} for ${v.id} ${v.position}`,
    recruiter_id: v.recruiter_id, related_type: 'vacancies', related_id: v.id, priority: v.priority || 'Medium',
    due_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    suggested_action: `Review and shortlist: ${strong.slice(0, 5).map((x) => x.full_name).join(', ')}`,
  });
}

function matchCandidate(candidateId) {
  const c = db.prepare('SELECT * FROM candidates WHERE id=?').get(candidateId);
  if (!c) return;
  const ok = db.prepare(`SELECT 1 FROM candidates WHERE id=? AND ${ACTIVE_CAND}`).get(candidateId);
  if (!ok) { db.prepare("DELETE FROM matches WHERE candidate_id=? AND status='New'").run(candidateId); return; }
  const vs = db.prepare(`SELECT * FROM vacancies WHERE ${OPEN_VAC}`).all();
  for (const v of vs) upsert(c, v);
  for (const v of vs) strongMatchTasks(v.id);
}

function matchVacancy(vacancyId) {
  const v = db.prepare('SELECT * FROM vacancies WHERE id=?').get(vacancyId);
  if (!v) return;
  const ok = db.prepare(`SELECT 1 FROM vacancies WHERE id=? AND ${OPEN_VAC}`).get(vacancyId);
  if (!ok) { db.prepare("DELETE FROM matches WHERE vacancy_id=? AND status='New'").run(vacancyId); return; }
  for (const c of db.prepare(`SELECT * FROM candidates WHERE ${ACTIVE_CAND}`).all()) upsert(c, v);
  strongMatchTasks(vacancyId);
}

function runAllMatching() {
  for (const v of db.prepare('SELECT id FROM vacancies').all()) matchVacancy(v.id);
  // clean matches for candidates no longer active
  db.prepare(`DELETE FROM matches WHERE status='New' AND candidate_id NOT IN (SELECT id FROM candidates WHERE ${ACTIVE_CAND})`).run();
}

async function aiRationale(matchId) {
  const m = db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
  if (!m) throw new Error('Match not found');
  const c = db.prepare('SELECT full_name, profession, specialty, current_emirate, license_authority, license_status, years_experience, uae_experience, availability, notice_days, expected_salary, education, languages FROM candidates WHERE id=?').get(m.candidate_id);
  const v = db.prepare('SELECT position, profession, specialty, emirate, license_required, min_experience, max_salary, target_join_date FROM vacancies WHERE id=?').get(m.vacancy_id);
  let text;
  if (provider()) {
    const r = await callJSON(PROMPTS.matching, `VACANCY:\n${JSON.stringify(v, null, 2)}\n\nCANDIDATE:\n${JSON.stringify(c, null, 2)}\n\nRules-based score: ${m.overall_score}/100.`);
    text = `AI score ${r.match_score}/100 (${r.band}). ${r.rationale}` + (r.strengths?.length ? `\nStrengths: ${r.strengths.join('; ')}` : '') + (r.key_gaps?.length ? `\nGaps: ${r.key_gaps.join('; ')}` : '');
  } else {
    text = `Rules score ${m.overall_score}/100 (${m.band}).` + (m.strengths ? ` Strengths: ${m.strengths}.` : '') + (m.key_gaps ? ` Gaps: ${m.key_gaps}.` : ' No significant gaps.') + ' (Add an AI key in .env for a written AI rationale.)';
  }
  db.prepare("UPDATE matches SET ai_rationale=?, updated_at=datetime('now') WHERE id=?").run(text, matchId);
  return text;
}

module.exports = { score, matchCandidate, matchVacancy, runAllMatching, aiRationale, WEIGHTS };
