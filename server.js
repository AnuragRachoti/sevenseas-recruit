require('dotenv').config({ quiet: true });
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { db, nextId, log, DATA_DIR } = require('./src/db');
const { entities, OPTIONS } = require('./src/entities');
const { seed } = require('./src/seed');
const automation = require('./src/automation');
const matching = require('./src/matching');
const cv = require('./src/cv');
const { provider } = require('./src/ai');
const { checkDuplicate } = require('./src/dedupe');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const actor = (req) => req.get('X-User') || 'unknown';
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => { console.error(e); res.status(400).json({ error: e.message }); });

// ---------- Meta & lookups ----------
app.get('/api/meta', (req, res) => {
  res.json({ entities, options: OPTIONS, ai: provider(), settings: db.prepare('SELECT * FROM settings').all() });
});

app.get('/api/lookups', (req, res) => {
  const map = (rows) => Object.fromEntries(rows.map((r) => [r.id, r.label]));
  res.json({
    recruiters: map(db.prepare("SELECT id, name label FROM recruiters ORDER BY name").all()),
    clients: map(db.prepare("SELECT id, name label FROM clients ORDER BY name").all()),
    candidates: map(db.prepare("SELECT id, full_name label FROM candidates ORDER BY full_name").all()),
    vacancies: map(db.prepare("SELECT v.id, v.id || ' · ' || v.position || ' (' || COALESCE(c.name,'') || ')' label FROM vacancies v LEFT JOIN clients c ON c.id=v.client_id ORDER BY v.id").all()),
  });
});

// ---------- Generic CRUD for every module ----------
const yearStart = () => `${new Date().getFullYear()}-01-01`;
const COMPUTED = {
  clients: `,(SELECT COUNT(*) FROM vacancies v WHERE v.client_id=t.id AND v.status IN ('Open','Interviewing')) open_vacancies,
    (SELECT COUNT(*) FROM placements p JOIN vacancies v ON v.id=p.vacancy_id WHERE v.client_id=t.id AND p.joining_date >= '${yearStart()}') placements_ytd,
    (SELECT COALESCE(SUM(p.fee),0) FROM placements p JOIN vacancies v ON v.id=p.vacancy_id WHERE v.client_id=t.id AND p.joining_date >= '${yearStart()}') revenue_ytd`,
  vacancies: `,(SELECT COUNT(*) FROM matches m WHERE m.vacancy_id=t.id AND m.status IN ('Submitted','Interview','Placed')) submitted,
    (SELECT COUNT(*) FROM interviews i WHERE i.vacancy_id=t.id) interviews_count,
    (SELECT COUNT(*) FROM placements p WHERE p.vacancy_id=t.id) placed`,
};

function getEntity(req) {
  const e = entities[req.params.entity];
  if (!e) throw new Error('Unknown module');
  return { name: req.params.entity, ...e };
}
function cleanBody(e, body) {
  const out = {};
  for (const f of e.fields) {
    if (!(f.key in body)) continue;
    let v = body[f.key];
    if (v === '' || v === undefined) v = null;
    if (v != null && ['number', 'money'].includes(f.type)) v = Number(v);
    out[f.key] = v;
  }
  return out;
}

app.get('/api/e/:entity', wrap((req, res) => {
  const e = getEntity(req);
  const where = []; const args = [];
  for (const [k, v] of Object.entries(req.query)) {
    if (k === 'q' || v === '') continue;
    if (e.fields.some((f) => f.key === k) || k === 'id') { where.push(`t.${k} = ?`); args.push(v); }
  }
  if (req.query.q) {
    const text = e.fields.filter((f) => !['number', 'money', 'date'].includes(f.type)).map((f) => `COALESCE(t.${f.key},'')`).join("||' '||");
    where.push(`(t.id || ' ' || ${text}) LIKE ?`); args.push(`%${req.query.q}%`);
  }
  const sql = `SELECT t.* ${COMPUTED[e.name] || ''} FROM ${e.name} t ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.id DESC LIMIT 2000`;
  res.json(db.prepare(sql).all(...args));
}));

app.get('/api/e/:entity/:id', wrap((req, res) => {
  const e = getEntity(req);
  const row = db.prepare(`SELECT t.* ${COMPUTED[e.name] || ''} FROM ${e.name} t WHERE t.id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
}));

app.post('/api/e/:entity', wrap((req, res) => {
  const e = getEntity(req);
  const data = cleanBody(e, req.body);
  for (const f of e.fields) if (f.required && (data[f.key] == null)) throw new Error(`${f.label} is required`);
  if (e.name === 'candidates') {
    const dup = checkDuplicate(data);
    if (dup.status === 'Confirmed Duplicate' && !req.body._force) return res.status(409).json({ error: `This looks like an existing candidate (${dup.candidate_id}: ${dup.reason}).`, duplicate: dup });
  }
  data.id = nextId(e.name, e.prefix, e.width);
  const k = Object.keys(data);
  db.prepare(`INSERT INTO ${e.name} (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...k.map((x) => data[x]));
  log(actor(req), 'create', e.name, data.id);
  const row = db.prepare(`SELECT * FROM ${e.name} WHERE id=?`).get(data.id);
  automation.onSaved(e.name, row, null);
  res.json(row);
}));

app.put('/api/e/:entity/:id', wrap((req, res) => {
  const e = getEntity(req);
  const before = db.prepare(`SELECT * FROM ${e.name} WHERE id=?`).get(req.params.id);
  if (!before) return res.status(404).json({ error: 'Not found' });
  const data = cleanBody(e, req.body);
  const k = Object.keys(data);
  if (k.length) {
    const extra = e.name === 'candidates' ? ", updated_at=datetime('now')" : '';
    db.prepare(`UPDATE ${e.name} SET ${k.map((x) => `${x}=?`).join(',')}${extra} WHERE id=?`).run(...k.map((x) => data[x]), req.params.id);
  }
  const changed = k.filter((x) => String(before[x] ?? '') !== String(data[x] ?? ''));
  if (changed.length) log(actor(req), 'update', e.name, req.params.id, Object.fromEntries(changed.map((x) => [x, [before[x], data[x]]])));
  const row = db.prepare(`SELECT * FROM ${e.name} WHERE id=?`).get(req.params.id);
  automation.onSaved(e.name, row, before);
  res.json(row);
}));

app.delete('/api/e/:entity/:id', wrap((req, res) => {
  const e = getEntity(req);
  db.prepare(`DELETE FROM ${e.name} WHERE id=?`).run(req.params.id);
  log(actor(req), 'delete', e.name, req.params.id);
  res.json({ ok: true });
}));

// ---------- Detail pages ----------
app.get('/api/candidates/:id/full', wrap((req, res) => {
  const id = req.params.id;
  const c = db.prepare('SELECT * FROM candidates WHERE id=?').get(id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json({
    candidate: c,
    licenses: db.prepare('SELECT * FROM licenses WHERE candidate_id=?').all(id),
    matches: db.prepare("SELECT m.*, v.position, v.status vacancy_status, cl.name client FROM matches m JOIN vacancies v ON v.id=m.vacancy_id LEFT JOIN clients cl ON cl.id=v.client_id WHERE m.candidate_id=? ORDER BY m.overall_score DESC").all(id),
    interviews: db.prepare('SELECT * FROM interviews WHERE candidate_id=? ORDER BY interview_date DESC').all(id),
    placements: db.prepare('SELECT * FROM placements WHERE candidate_id=?').all(id),
    tasks: db.prepare("SELECT * FROM tasks WHERE related_id=? OR related_id IN (SELECT id FROM licenses WHERE candidate_id=?) ORDER BY created_at DESC").all(id, id),
    cvs: db.prepare('SELECT id, file_name, upload_date, review_status FROM cv_uploads WHERE candidate_id=?').all(id),
    activity: db.prepare("SELECT * FROM activity_log WHERE entity_id=? ORDER BY id DESC LIMIT 30").all(id),
  });
}));

app.get('/api/vacancies/:id/full', wrap((req, res) => {
  const id = req.params.id;
  const v = db.prepare(`SELECT t.* ${COMPUTED.vacancies} FROM vacancies t WHERE t.id=?`).get(id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  res.json({
    vacancy: v,
    client: db.prepare('SELECT * FROM clients WHERE id=?').get(v.client_id),
    matches: db.prepare("SELECT m.*, c.full_name, c.specialty, c.license_authority, c.license_status, c.years_experience, c.availability, c.expected_salary, c.current_emirate FROM matches m JOIN candidates c ON c.id=m.candidate_id WHERE m.vacancy_id=? ORDER BY m.overall_score DESC").all(id),
    interviews: db.prepare('SELECT * FROM interviews WHERE vacancy_id=? ORDER BY interview_date DESC').all(id),
    placements: db.prepare('SELECT * FROM placements WHERE vacancy_id=?').all(id),
    tasks: db.prepare('SELECT * FROM tasks WHERE related_id=? ORDER BY created_at DESC').all(id),
  });
}));

// ---------- Matching ----------
app.get('/api/matches', wrap((req, res) => {
  const where = []; const args = [];
  for (const k of ['vacancy_id', 'candidate_id', 'band', 'status']) if (req.query[k]) { where.push(`m.${k}=?`); args.push(req.query[k]); }
  res.json(db.prepare(`SELECT m.*, c.full_name, c.recruiter_id cand_recruiter, v.position, v.recruiter_id, cl.name client FROM matches m
    JOIN candidates c ON c.id=m.candidate_id JOIN vacancies v ON v.id=m.vacancy_id LEFT JOIN clients cl ON cl.id=v.client_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.overall_score DESC LIMIT 1000`).all(...args));
}));
app.put('/api/matches/:id', wrap((req, res) => {
  const allowed = ['New', 'Shortlisted', 'Submitted', 'Interview', 'Rejected', 'Placed'];
  if (!allowed.includes(req.body.status)) throw new Error('Invalid status');
  const m = db.prepare('SELECT * FROM matches WHERE id=?').get(req.params.id);
  db.prepare("UPDATE matches SET status=?, updated_at=datetime('now') WHERE id=?").run(req.body.status, req.params.id);
  log(actor(req), 'match ' + req.body.status, 'matches', req.params.id);
  if (req.body.status === 'Submitted' && m) {
    const v = db.prepare('SELECT * FROM vacancies WHERE id=?').get(m.vacancy_id);
    const c = db.prepare('SELECT full_name FROM candidates WHERE id=?').get(m.candidate_id);
    automation.createTask({ auto_key: `submitted:${m.id}`, task_type: 'Client Submission', title: `Chase client feedback on ${c.full_name} for ${v.position}`, recruiter_id: v.recruiter_id, related_type: 'vacancies', related_id: v.id, due_date: automation.addDays(automation.today(), 3), suggested_action: 'If the client wants to meet, schedule the interview from the vacancy page.' });
  }
  res.json({ ok: true });
}));
app.post('/api/matches/:id/rationale', wrap(async (req, res) => res.json({ text: await matching.aiRationale(req.params.id) })));
app.post('/api/matching/run', wrap((req, res) => { matching.runAllMatching(); res.json({ ok: true }); }));
app.post('/api/automation/run', wrap((req, res) => { matching.runAllMatching(); res.json({ created: automation.runSweep() }); }));

// ---------- CV Inbox ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(DATA_DIR, 'cvs'),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /\.(pdf|docx|txt)$/i.test(file.originalname)),
});

app.post('/api/cv/upload', upload.array('files', 200), wrap((req, res) => {
  const ids = [];
  for (const f of req.files || []) {
    const id = nextId('cv_uploads', 'CV', 5);
    db.prepare('INSERT INTO cv_uploads (id, file_name, stored_path, uploaded_by, assigned_recruiter_id) VALUES (?,?,?,?,?)')
      .run(id, Buffer.from(f.originalname, 'latin1').toString('utf8'), f.path, actor(req), req.body.assign_to || null);
    ids.push(id); cv.enqueue(id);
  }
  log(actor(req), 'upload', 'cv_uploads', null, { count: ids.length });
  res.json({ ids });
}));

app.get('/api/cv', wrap((req, res) => {
  const where = []; const args = [];
  for (const k of ['review_status', 'processing_status', 'duplicate_status', 'assigned_recruiter_id']) if (req.query[k]) { where.push(`${k}=?`); args.push(req.query[k]); }
  res.json(db.prepare(`SELECT id, file_name, upload_date, uploaded_by, processing_status, extraction_method, extracted_json, overall_confidence, verification_flags, duplicate_status, duplicate_candidate_id, duplicate_score, duplicate_reason, review_status, assigned_recruiter_id, candidate_id, error_message
    FROM cv_uploads ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 1000`).all(...args));
}));
app.get('/api/cv/:id', wrap((req, res) => {
  const r = db.prepare('SELECT * FROM cv_uploads WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  delete r.stored_path;
  r.duplicate = r.duplicate_candidate_id ? db.prepare('SELECT * FROM candidates WHERE id=?').get(r.duplicate_candidate_id) : null;
  res.json(r);
}));
app.get('/api/cv/:id/file', (req, res) => {
  const r = db.prepare('SELECT file_name, stored_path FROM cv_uploads WHERE id=?').get(req.params.id);
  if (!r || !fs.existsSync(r.stored_path)) return res.status(404).send('File not found');
  if (req.query.download) return res.download(r.stored_path, r.file_name);
  res.sendFile(path.resolve(r.stored_path));
});
app.post('/api/cv/:id/reprocess', wrap((req, res) => {
  db.prepare("DELETE FROM tasks WHERE auto_key=? AND status='Open'").run(`cv:${req.params.id}`);
  cv.enqueue(req.params.id); res.json({ ok: true });
}));

// Recruiter decision: approve (new candidate) / merge (update existing) / needs_edit / reject
app.post('/api/cv/:id/review', wrap((req, res) => {
  const r = db.prepare('SELECT * FROM cv_uploads WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const { action, fields = {}, merge_into, notes } = req.body;
  const candEntity = { name: 'candidates', ...entities.candidates };
  const data = cleanBody(candEntity, fields);
  let candidateId = null;

  if (action === 'approve') {
    if (!data.full_name) throw new Error('Full name is required before approving');
    candidateId = nextId('candidates', 'CAN', 6);
    const row = { ...data, id: candidateId, source: 'CV Upload', profile_status: 'Approved', status: data.status || 'Active', recruiter_id: data.recruiter_id || r.assigned_recruiter_id, cv_upload_id: r.id, last_contact: null };
    const k = Object.keys(row).filter((x) => row[x] !== undefined);
    db.prepare(`INSERT INTO candidates (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...k.map((x) => row[x]));
  } else if (action === 'merge') {
    if (!merge_into) throw new Error('Choose the existing candidate to merge into');
    candidateId = merge_into;
    const filled = Object.fromEntries(Object.entries(data).filter(([, v]) => v != null && v !== ''));
    const k = Object.keys(filled);
    if (k.length) db.prepare(`UPDATE candidates SET ${k.map((x) => `${x}=?`).join(',')}, cv_upload_id=?, updated_at=datetime('now') WHERE id=?`).run(...k.map((x) => filled[x]), r.id, candidateId);
  }
  if (candidateId && data.license_authority && !['None', 'Other'].includes(data.license_authority)) {
    const has = db.prepare('SELECT 1 FROM licenses WHERE candidate_id=? AND authority=?').get(candidateId, data.license_authority);
    if (!has) db.prepare('INSERT INTO licenses (id, candidate_id, authority, license_status, eligibility, owner_id, next_action) VALUES (?,?,?,?,?,?,?)')
      .run(nextId('licenses', 'LIC', 4), candidateId, data.license_authority, data.license_status || 'Unknown', data.license_status === 'Active' || data.license_status === 'Eligible' ? 'Eligible' : 'Under Review', r.assigned_recruiter_id, 'Verify license with authority portal');
  }
  const status = { approve: 'Approved', merge: 'Approved', needs_edit: 'Needs Edit', reject: 'Rejected' }[action];
  if (!status) throw new Error('Unknown action');
  db.prepare('UPDATE cv_uploads SET review_status=?, candidate_id=COALESCE(?, candidate_id), review_notes=?, extracted_json=? WHERE id=?')
    .run(status, candidateId, notes || null, JSON.stringify({ ...JSON.parse(r.extracted_json || '{}'), ...data }), r.id);
  if (status !== 'Needs Edit') automation.closeTask(`cv:${r.id}`, `CV ${status.toLowerCase()}`);
  log(actor(req), `cv ${action}`, 'cv_uploads', r.id, { candidateId });
  if (candidateId) matching.matchCandidate(candidateId);
  res.json({ ok: true, candidate_id: candidateId });
}));

// ---------- Dashboard ----------
app.get('/api/dashboard', wrap((req, res) => {
  const one = (sql, ...a) => Object.values(db.prepare(sql).get(...a))[0];
  const ys = yearStart(); const t = automation.today();
  const kpi = {
    active_clients: one("SELECT COUNT(*) FROM clients WHERE status='Active'"),
    open_vacancies: one("SELECT COUNT(*) FROM vacancies WHERE status IN ('Open','Interviewing')"),
    open_positions: one("SELECT COALESCE(SUM(openings),0) - (SELECT COUNT(*) FROM placements p JOIN vacancies v2 ON v2.id=p.vacancy_id WHERE v2.status IN ('Open','Interviewing')) FROM vacancies WHERE status IN ('Open','Interviewing')"),
    active_candidates: one("SELECT COUNT(*) FROM candidates WHERE status IN ('Active','Interviewing')"),
    placements_ytd: one('SELECT COUNT(*) FROM placements WHERE joining_date >= ?', ys),
    revenue_ytd: one('SELECT COALESCE(SUM(fee),0) FROM placements WHERE joining_date >= ?', ys),
    collected_ytd: one("SELECT COALESCE(SUM(fee),0) FROM placements WHERE joining_date >= ? AND payment_status='Paid'", ys),
    outstanding: one("SELECT COALESCE(SUM(fee),0) FROM placements WHERE payment_status IN ('Pending','Overdue')"),
    pipeline_value: one("SELECT COALESCE(SUM(fee_per_placement * openings),0) FROM vacancies WHERE status IN ('Open','Interviewing')"),
    target_revenue: one("SELECT COALESCE(SUM(target_revenue),0) FROM recruiters WHERE active='Yes'"),
  };
  const ai = {
    cvs_processing: one("SELECT COUNT(*) FROM cv_uploads WHERE processing_status IN ('Pending','Processing')"),
    cvs_awaiting_review: one("SELECT COUNT(*) FROM cv_uploads WHERE processing_status='Processed' AND review_status IN ('Pending','Needs Edit')"),
    cvs_error: one("SELECT COUNT(*) FROM cv_uploads WHERE processing_status='Error'"),
    possible_duplicates: one("SELECT COUNT(*) FROM cv_uploads WHERE duplicate_status='Possible Duplicate' AND review_status='Pending'"),
    confirmed_duplicates: one("SELECT COUNT(*) FROM cv_uploads WHERE duplicate_status='Confirmed Duplicate' AND review_status='Pending'"),
    strong_matches: one("SELECT COUNT(*) FROM matches WHERE band='Recommend' AND status='New'"),
    review_matches: one("SELECT COUNT(*) FROM matches WHERE band='Recruiter Review' AND status='New'"),
  };
  const funnel = {
    matched: one("SELECT COUNT(*) FROM matches WHERE band IN ('Recommend','Recruiter Review')"),
    shortlisted: one("SELECT COUNT(*) FROM matches WHERE status IN ('Shortlisted','Submitted','Interview','Placed')"),
    submitted: one("SELECT COUNT(*) FROM matches WHERE status IN ('Submitted','Interview','Placed')"),
    interviewed: one('SELECT COUNT(DISTINCT candidate_id||vacancy_id) FROM interviews'),
    offers: one("SELECT COUNT(*) FROM interviews WHERE result IN ('Offer','Offer Accepted')"),
    placed: one('SELECT COUNT(*) FROM placements'),
  };
  const tasks = {
    overdue: one("SELECT COUNT(*) FROM tasks WHERE status IN ('Open','In Progress') AND due_date < ?", t),
    due_today: one("SELECT COUNT(*) FROM tasks WHERE status IN ('Open','In Progress') AND due_date = ?", t),
    open: one("SELECT COUNT(*) FROM tasks WHERE status IN ('Open','In Progress')"),
    blocked: one("SELECT COUNT(*) FROM tasks WHERE status='Blocked'"),
  };
  const recruiters = db.prepare(`SELECT r.id, r.name, r.target_revenue,
    (SELECT COUNT(*) FROM vacancies v WHERE v.recruiter_id=r.id AND v.status IN ('Open','Interviewing')) active_vacancies,
    (SELECT COUNT(*) FROM candidates c WHERE c.recruiter_id=r.id AND c.status IN ('Active','Interviewing')) active_candidates,
    (SELECT COUNT(*) FROM matches m JOIN vacancies v ON v.id=m.vacancy_id WHERE v.recruiter_id=r.id AND m.status IN ('Submitted','Interview','Placed')) submitted,
    (SELECT COUNT(*) FROM interviews i WHERE i.recruiter_id=r.id) interviews,
    (SELECT COUNT(*) FROM interviews i WHERE i.recruiter_id=r.id AND i.result IN ('Offer','Offer Accepted')) offers,
    (SELECT COUNT(*) FROM placements p WHERE p.recruiter_id=r.id AND p.joining_date >= ?) placements,
    (SELECT COALESCE(SUM(fee),0) FROM placements p WHERE p.recruiter_id=r.id AND p.joining_date >= ?) revenue,
    (SELECT COUNT(*) FROM tasks k WHERE k.recruiter_id=r.id AND k.status IN ('Open','In Progress')) open_tasks,
    (SELECT COUNT(*) FROM tasks k WHERE k.recruiter_id=r.id AND k.status IN ('Open','In Progress') AND k.due_date < ?) overdue_tasks
    FROM recruiters r WHERE r.active='Yes' AND r.role='Recruiter' ORDER BY revenue DESC`).all(ys, ys, t);
  const vacancies = db.prepare(`SELECT v.id, v.position, v.priority, v.status, v.openings, v.target_join_date, c.name client,
    (SELECT COUNT(*) FROM matches m WHERE m.vacancy_id=v.id AND m.band='Recommend') strong,
    (SELECT COUNT(*) FROM matches m WHERE m.vacancy_id=v.id AND m.status IN ('Submitted','Interview','Placed')) submitted,
    (SELECT COUNT(*) FROM placements p WHERE p.vacancy_id=v.id) placed
    FROM vacancies v LEFT JOIN clients c ON c.id=v.client_id WHERE v.status IN ('Open','Interviewing')
    ORDER BY CASE v.priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, v.target_join_date`).all();
  const licensing = db.prepare(`SELECT l.license_status status, COUNT(*) n FROM licenses l JOIN candidates c ON c.id=l.candidate_id WHERE c.status NOT IN ('Inactive') GROUP BY l.license_status`).all();
  const upcoming = db.prepare(`SELECT i.*, c.full_name, v.position, cl.name client FROM interviews i JOIN candidates c ON c.id=i.candidate_id JOIN vacancies v ON v.id=i.vacancy_id LEFT JOIN clients cl ON cl.id=v.client_id WHERE i.result='Scheduled' ORDER BY i.interview_date LIMIT 8`).all();
  res.json({ kpi, ai, funnel, tasks, recruiters, vacancies, licensing, upcoming, today: t });
}));

// ---------- Settings & export ----------
app.put('/api/settings', wrap((req, res) => {
  for (const [k, v] of Object.entries(req.body)) db.prepare('UPDATE settings SET value=? WHERE key=?').run(String(v), k);
  log(actor(req), 'update', 'settings', null, req.body);
  res.json({ ok: true });
}));

app.get('/api/export/:entity.csv', wrap((req, res) => {
  const table = req.params.entity === 'matches' || req.params.entity === 'activity_log' ? req.params.entity : getEntity(req).name;
  const rows = db.prepare(`SELECT * FROM ${table}`).all();
  const cols = rows.length ? Object.keys(rows[0]).filter((c) => c !== 'raw_text' && c !== 'stored_path') : [];
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${table}-${automation.today()}.csv"`);
  res.send('﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'));
}));

app.get('/api/activity', (req, res) => res.json(db.prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT 200').all()));

app.get('/{*splat}', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------- Start ----------
if (seed()) { matching.runAllMatching(); console.log('Loaded sample data from the workbook.'); }
matching.runAllMatching();
automation.runSweep();
setInterval(() => { try { matching.runAllMatching(); automation.runSweep(); } catch (e) { console.error(e); } }, 60 * 60 * 1000);
// Resume any CVs left mid-processing if the app was stopped
for (const r of db.prepare("SELECT id FROM cv_uploads WHERE processing_status IN ('Pending','Processing')").all()) cv.enqueue(r.id);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  SevenSeas Recruitment is running:  http://localhost:${PORT}`);
  console.log(`  AI extraction: ${provider() ? provider() : 'off (using built-in rules). Add a key in .env to turn on.'}\n`);
});
