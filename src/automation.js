// Automation rules: auto-creates Recruiter Queue tasks and keeps statuses in sync.
const { db, nextId, getSetting, log } = require('./db');

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (date, n) => { const t = new Date(date || Date.now()); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };

// Inserts a task once per auto_key (so re-running rules never creates duplicates).
function createTask(t) {
  if (t.auto_key && db.prepare('SELECT 1 FROM tasks WHERE auto_key=?').get(t.auto_key)) return null;
  const id = nextId('tasks', 'Q', 5);
  const row = { id, status: 'Open', priority: 'Medium', ...t };
  const k = Object.keys(row);
  db.prepare(`INSERT INTO tasks (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...k.map((x) => row[x] ?? null));
  return id;
}

function closeTask(autoKey, note) {
  db.prepare("UPDATE tasks SET status='Done', completed_at=datetime('now'), notes=COALESCE(notes||'\n','')||? WHERE auto_key=? AND status!='Done'").run(note || 'Auto-closed', autoKey);
}

const openTaskCount = (rid) => db.prepare("SELECT COUNT(*) c FROM tasks WHERE recruiter_id=? AND status IN ('Open','In Progress')").get(rid).c;

// Assigns a new CV to a recruiter using the rule in Settings (specialty / workload / round-robin).
function assignRecruiter(fields) {
  const recs = db.prepare("SELECT * FROM recruiters WHERE active='Yes' AND role='Recruiter'").all();
  if (!recs.length) return null;
  const rule = getSetting('assignment_rule', 'specialty');
  if (rule === 'round-robin') {
    const counts = recs.map((r) => ({ r, n: db.prepare('SELECT COUNT(*) c FROM cv_uploads WHERE assigned_recruiter_id=?').get(r.id).c }));
    return counts.sort((a, b) => a.n - b.n)[0].r.id;
  }
  let pool = recs;
  if (rule === 'specialty') {
    const terms = [fields.specialty, fields.profession, fields.current_emirate].filter(Boolean).map((x) => x.toLowerCase());
    const scored = recs.map((r) => {
      const focus = `${r.specialties || ''},${r.emirates || ''}`.toLowerCase();
      return { r, s: terms.filter((t) => focus.includes(t)).length };
    });
    const top = Math.max(...scored.map((x) => x.s));
    if (top > 0) pool = scored.filter((x) => x.s === top).map((x) => x.r);
  }
  return pool.map((r) => ({ r, n: openTaskCount(r.id) })).sort((a, b) => a.n - b.n)[0].r.id;
}

// ---- Event hooks (called after records are saved) ----
function onSaved(entity, row, before) {
  const M = require('./matching');
  if (entity === 'candidates') M.matchCandidate(row.id);
  if (entity === 'vacancies') M.matchVacancy(row.id);
  if (entity === 'interviews') onInterview(row, before);
  if (entity === 'placements') onPlacement(row, before);
  if (entity === 'tasks' && row.status === 'Done' && (!before || before.status !== 'Done')) {
    db.prepare("UPDATE tasks SET completed_at=datetime('now') WHERE id=?").run(row.id);
  }
  if (entity === 'vacancies' && ['Filled', 'Closed'].includes(row.status)) closeVacancyTasks(row.id, row.status);
  if (entity !== 'tasks') runSweep(true); // create any newly-due tasks straight away
}

function closeVacancyTasks(vacancyId, status) {
  db.prepare("UPDATE tasks SET status='Done', completed_at=datetime('now'), notes=COALESCE(notes||'\n','')||? WHERE related_type='vacancies' AND related_id=? AND task_type IN ('Vacancy Match','Client Submission') AND status IN ('Open','In Progress')")
    .run(`Auto-closed: vacancy ${status.toLowerCase()}`, vacancyId);
}

function onInterview(i, before) {
  const c = db.prepare('SELECT * FROM candidates WHERE id=?').get(i.candidate_id);
  const v = db.prepare('SELECT * FROM vacancies WHERE id=?').get(i.vacancy_id);
  if (!c || !v) return;
  if (['Active', 'Passive'].includes(c.status)) db.prepare("UPDATE candidates SET status='Interviewing' WHERE id=?").run(c.id);
  if (v.status === 'Open') db.prepare("UPDATE vacancies SET status='Interviewing' WHERE id=?").run(v.id);
  const m = db.prepare('SELECT id FROM matches WHERE vacancy_id=? AND candidate_id=?').get(v.id, c.id);
  if (m) closeTask(`submitted:${m.id}`, 'Interview scheduled');
  db.prepare("UPDATE matches SET status='Interview' WHERE vacancy_id=? AND candidate_id=? AND status IN ('New','Shortlisted','Submitted')").run(v.id, c.id);
  const changed = !before || before.result !== i.result;
  if (changed && i.result === 'Offer') {
    createTask({ auto_key: `offer:${i.id}`, task_type: 'Offer Follow-up', title: `Offer follow-up: ${c.full_name} for ${v.position}`, recruiter_id: i.recruiter_id || v.recruiter_id, related_type: 'interviews', related_id: i.id, priority: 'High', due_date: addDays(today(), 2), suggested_action: 'Confirm offer terms, salary and joining date with the candidate.' });
  }
  if (changed && i.result === 'Offer Accepted') {
    createTask({ auto_key: `accepted:${i.id}`, task_type: 'Other', title: `Create placement: ${c.full_name} → ${v.position}`, recruiter_id: i.recruiter_id || v.recruiter_id, related_type: 'interviews', related_id: i.id, priority: 'High', due_date: today(), suggested_action: 'Record the placement with joining date and fee; start licensing activation if needed.' });
  }
  if (changed && i.result && i.result !== 'Scheduled') closeTask(`int-fb:${i.id}`, `Result recorded: ${i.result}`);
}

function onPlacement(p, before) {
  const v = db.prepare('SELECT * FROM vacancies WHERE id=?').get(p.vacancy_id);
  db.prepare("UPDATE candidates SET status='Placed' WHERE id=?").run(p.candidate_id);
  db.prepare("DELETE FROM matches WHERE candidate_id=? AND status='New'").run(p.candidate_id);
  db.prepare("UPDATE matches SET status='Placed' WHERE candidate_id=? AND vacancy_id=?").run(p.candidate_id, p.vacancy_id);
  if (!p.replacement_window_ends && p.joining_date) {
    db.prepare('UPDATE placements SET replacement_window_ends=? WHERE id=?').run(addDays(p.joining_date, getSetting('replacement_window_days', 90)), p.id);
  }
  if ((!p.fee || p.fee === 0) && v && v.fee_per_placement) db.prepare('UPDATE placements SET fee=? WHERE id=?').run(v.fee_per_placement, p.id);
  if (v) {
    const placed = db.prepare('SELECT COUNT(*) c FROM placements WHERE vacancy_id=?').get(v.id).c;
    if (placed >= (v.openings || 1) && !['Filled', 'Closed'].includes(v.status)) {
      db.prepare("UPDATE vacancies SET status='Filled' WHERE id=?").run(v.id);
      closeVacancyTasks(v.id, 'Filled');
      require('./matching').matchVacancy(v.id);
    }
  }
  for (const i of db.prepare('SELECT id FROM interviews WHERE candidate_id=? AND vacancy_id=?').all(p.candidate_id, p.vacancy_id)) { closeTask(`accepted:${i.id}`, `Placement ${p.id} recorded`); closeTask(`int-fb:${i.id}`, `Placement ${p.id} recorded`); }
  if (p.invoice_status === 'Invoiced') closeTask(`inv:${p.id}`, 'Invoiced');
  if (p.payment_status === 'Paid') closeTask(`pay:${p.id}`, 'Paid');
}

// ---- Scheduled sweep: runs at startup, every hour, and from the "Run automation" button ----
function runSweep(quiet) {
  const t = today();
  let created = 0;
  const mk = (x) => { if (createTask(x)) created++; };

  for (const c of db.prepare("SELECT * FROM clients WHERE next_follow_up IS NOT NULL AND next_follow_up <= ? AND status != 'Inactive'").all(t)) {
    mk({ auto_key: `client-fu:${c.id}:${c.next_follow_up}`, task_type: 'Follow-up', title: `Follow up with client ${c.name}`, recruiter_id: c.account_owner, related_type: 'clients', related_id: c.id, priority: 'Medium', due_date: c.next_follow_up, suggested_action: 'Check new vacancies, feedback on submitted candidates, and update Next Follow-up.' });
  }
  for (const c of db.prepare("SELECT * FROM candidates WHERE next_follow_up IS NOT NULL AND next_follow_up <= ? AND status NOT IN ('Inactive','Placed')").all(t)) {
    mk({ auto_key: `cand-fu:${c.id}:${c.next_follow_up}`, task_type: 'Follow-up', title: `Follow up with ${c.full_name}`, recruiter_id: c.recruiter_id, related_type: 'candidates', related_id: c.id, due_date: c.next_follow_up, suggested_action: 'Confirm availability, salary expectation and licensing progress.' });
  }
  const warn = addDays(t, getSetting('license_expiry_warning_days', 60));
  for (const l of db.prepare("SELECT l.*, c.full_name, c.recruiter_id FROM licenses l JOIN candidates c ON c.id=l.candidate_id WHERE l.expiry_date IS NOT NULL AND l.expiry_date <= ? AND l.license_status != 'Expired'").all(warn)) {
    mk({ auto_key: `lic-exp:${l.id}:${l.expiry_date}`, task_type: 'Licensing', title: `${l.authority} license for ${l.full_name} expires ${l.expiry_date}`, recruiter_id: l.owner_id || l.recruiter_id, related_type: 'licenses', related_id: l.id, priority: l.expiry_date <= addDays(t, 14) ? 'High' : 'Medium', due_date: addDays(l.expiry_date, -30) < t ? t : addDays(l.expiry_date, -30), suggested_action: 'Start renewal; confirm CME hours and documents.' });
  }
  for (const l of db.prepare("SELECT l.*, c.full_name, c.recruiter_id FROM licenses l JOIN candidates c ON c.id=l.candidate_id WHERE (l.psv_dataflow='In Progress' OR l.documents_complete='No' OR l.exam IN ('Pending','Failed')) AND c.status NOT IN ('Inactive')").all()) {
    mk({ auto_key: `lic-block:${l.id}`, task_type: 'Licensing', title: `Licensing blocker: ${l.full_name} (${l.authority})`, recruiter_id: l.owner_id || l.recruiter_id, related_type: 'licenses', related_id: l.id, due_date: addDays(t, 3), suggested_action: l.next_action || 'Chase outstanding licensing steps.' });
  }
  for (const i of db.prepare("SELECT i.*, c.full_name, v.position FROM interviews i JOIN candidates c ON c.id=i.candidate_id JOIN vacancies v ON v.id=i.vacancy_id WHERE i.result='Scheduled'").all()) {
    if (i.interview_date && i.interview_date < t) {
      mk({ auto_key: `int-fb:${i.id}`, task_type: 'Interview Feedback', title: `Get interview feedback: ${i.full_name} for ${i.position}`, recruiter_id: i.recruiter_id, related_type: 'interviews', related_id: i.id, priority: 'High', due_date: t, suggested_action: 'Call client for feedback and record the result.' });
    } else if (i.interview_date && i.interview_date <= addDays(t, 2)) {
      mk({ auto_key: `int-prep:${i.id}`, task_type: 'Interview Prep', title: `Prepare ${i.full_name} for interview (${i.interview_date})`, recruiter_id: i.recruiter_id, related_type: 'interviews', related_id: i.id, priority: 'High', due_date: addDays(i.interview_date, -1) < t ? t : addDays(i.interview_date, -1), suggested_action: 'Brief candidate on client, role, location and documents to bring.' });
    }
  }
  for (const p of db.prepare("SELECT p.*, c.full_name FROM placements p JOIN candidates c ON c.id=p.candidate_id").all()) {
    if (p.invoice_status === 'Not Invoiced') mk({ auto_key: `inv:${p.id}`, task_type: 'Invoice', title: `Raise invoice for ${p.full_name} placement (${p.id})`, recruiter_id: p.recruiter_id, related_type: 'placements', related_id: p.id, priority: 'High', due_date: p.joining_date && p.joining_date > t ? p.joining_date : t, suggested_action: `Invoice AED ${p.fee || 0}.` });
    const overdueDays = getSetting('payment_overdue_days', 30);
    if (p.invoice_status === 'Invoiced' && p.payment_status === 'Pending' && p.invoice_date && p.invoice_date <= addDays(t, -overdueDays)) {
      db.prepare("UPDATE placements SET payment_status='Overdue' WHERE id=?").run(p.id);
      mk({ auto_key: `pay:${p.id}`, task_type: 'Payment', title: `Chase overdue payment: ${p.id} (AED ${p.fee})`, recruiter_id: p.recruiter_id, related_type: 'placements', related_id: p.id, priority: 'High', due_date: t, suggested_action: 'Contact client accounts team.' });
    }
    if (p.replacement_window_ends && p.replacement_window_ends >= t && p.replacement_window_ends <= addDays(t, 14)) {
      mk({ auto_key: `repl:${p.id}`, task_type: 'Replacement Check', title: `Check-in: ${p.full_name} (guarantee ends ${p.replacement_window_ends})`, recruiter_id: p.recruiter_id, related_type: 'placements', related_id: p.id, due_date: addDays(p.replacement_window_ends, -7) < t ? t : addDays(p.replacement_window_ends, -7), suggested_action: 'Call candidate and client to confirm everything is going well.' });
    }
  }
  if (!quiet || created) log('system', 'sweep', 'tasks', null, { created });
  return created;
}

module.exports = { createTask, closeTask, assignRecruiter, onSaved, runSweep, today, addDays };
