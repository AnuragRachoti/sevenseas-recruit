// SQLite database. To move to the cloud later, swap this file for a PostgreSQL client;
// the table structure below translates almost one-to-one.
const path = require('path');
const fs = require('fs');
// Uses the SQLite engine built into Node.js (22.13+), so there is nothing to compile on install.
const _emit = process.emitWarning;
process.emitWarning = (w, ...a) => (String(w).includes('SQLite') ? undefined : _emit.call(process, w, ...a));
let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); } catch {
  console.error(`\n  Your Node.js version (${process.version}) is too old. Install the LTS version (22.13 or newer) from https://nodejs.org and start again.\n`);
  process.exit(1);
}

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(DATA_DIR, 'cvs'), { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'sevenseas.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS recruiters (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, role TEXT DEFAULT 'Recruiter',
  specialties TEXT, emirates TEXT, target_revenue REAL DEFAULT 0, active TEXT DEFAULT 'Yes'
);
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, sector TEXT, emirate TEXT, contact_person TEXT,
  phone TEXT, email TEXT, account_owner TEXT REFERENCES recruiters(id), status TEXT DEFAULT 'Active',
  last_contact TEXT, next_follow_up TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS vacancies (
  id TEXT PRIMARY KEY, client_id TEXT REFERENCES clients(id), position TEXT NOT NULL,
  profession TEXT, specialty TEXT, emirate TEXT, license_required TEXT, min_experience REAL,
  max_salary REAL, openings INTEGER DEFAULT 1, priority TEXT DEFAULT 'Medium', date_opened TEXT,
  target_join_date TEXT, status TEXT DEFAULT 'Open', fee_per_placement REAL DEFAULT 0,
  recruiter_id TEXT REFERENCES recruiters(id), notes TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY, full_name TEXT NOT NULL, profession TEXT, specialty TEXT, current_emirate TEXT,
  license_authority TEXT, license_status TEXT, years_experience REAL, uae_experience REAL,
  current_employer TEXT, education TEXT, languages TEXT, nationality TEXT, availability TEXT,
  notice_days INTEGER, expected_salary REAL, phone TEXT, email TEXT,
  recruiter_id TEXT REFERENCES recruiters(id), source TEXT, status TEXT DEFAULT 'Active',
  profile_status TEXT DEFAULT 'Approved', last_contact TEXT, next_follow_up TEXT, cv_upload_id TEXT,
  notes TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY, candidate_id TEXT REFERENCES candidates(id) ON DELETE CASCADE, authority TEXT,
  eligibility TEXT, psv_dataflow TEXT, exam TEXT, good_standing TEXT, documents_complete TEXT,
  license_status TEXT, license_number TEXT, expiry_date TEXT, next_action TEXT,
  owner_id TEXT REFERENCES recruiters(id)
);
CREATE TABLE IF NOT EXISTS cv_uploads (
  id TEXT PRIMARY KEY, file_name TEXT, stored_path TEXT, upload_date TEXT DEFAULT (datetime('now')),
  uploaded_by TEXT, processing_status TEXT DEFAULT 'Pending', extraction_method TEXT,
  extracted_json TEXT, overall_confidence REAL, verification_flags TEXT,
  duplicate_status TEXT DEFAULT 'Not Checked', duplicate_candidate_id TEXT, duplicate_score REAL,
  duplicate_reason TEXT, review_status TEXT DEFAULT 'Pending', assigned_recruiter_id TEXT,
  candidate_id TEXT, review_notes TEXT, processed_at TEXT, error_message TEXT, raw_text TEXT
);
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY, vacancy_id TEXT REFERENCES vacancies(id) ON DELETE CASCADE,
  candidate_id TEXT REFERENCES candidates(id) ON DELETE CASCADE,
  specialty_score REAL, license_score REAL, experience_score REAL, availability_score REAL,
  salary_score REAL, location_score REAL, overall_score REAL, band TEXT, key_gaps TEXT,
  strengths TEXT, ai_rationale TEXT, status TEXT DEFAULT 'New', updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(vacancy_id, candidate_id)
);
CREATE TABLE IF NOT EXISTS interviews (
  id TEXT PRIMARY KEY, vacancy_id TEXT REFERENCES vacancies(id), candidate_id TEXT REFERENCES candidates(id),
  interview_date TEXT, stage TEXT, result TEXT DEFAULT 'Scheduled', next_step TEXT,
  recruiter_id TEXT REFERENCES recruiters(id), notes TEXT
);
CREATE TABLE IF NOT EXISTS placements (
  id TEXT PRIMARY KEY, candidate_id TEXT REFERENCES candidates(id), vacancy_id TEXT REFERENCES vacancies(id),
  joining_date TEXT, recruiter_id TEXT REFERENCES recruiters(id), fee REAL DEFAULT 0,
  invoice_status TEXT DEFAULT 'Not Invoiced', invoice_date TEXT, payment_status TEXT DEFAULT 'Pending',
  replacement_window_ends TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, created_at TEXT DEFAULT (datetime('now')), recruiter_id TEXT REFERENCES recruiters(id),
  task_type TEXT, title TEXT, related_type TEXT, related_id TEXT, priority TEXT DEFAULT 'Medium',
  due_date TEXT, status TEXT DEFAULT 'Open', suggested_action TEXT, notes TEXT, completed_at TEXT,
  auto_key TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, purpose TEXT);
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT DEFAULT (datetime('now')), actor TEXT,
  action TEXT, entity TEXT, entity_id TEXT, details TEXT
);
`);

// Generates the next readable ID, e.g. CAN-000012
function nextId(table, prefix, width = 3) {
  const rows = db.prepare(`SELECT id FROM ${table} WHERE id LIKE ?`).all(prefix + '-%');
  let max = 0;
  for (const r of rows) {
    const n = parseInt(String(r.id).split('-').pop(), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(width, '0')}`;
}

function getSetting(key, fallback) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!r) return fallback;
  const n = Number(r.value);
  return isNaN(n) ? r.value : n;
}

function log(actor, action, entity, entity_id, details) {
  db.prepare('INSERT INTO activity_log (actor, action, entity, entity_id, details) VALUES (?,?,?,?,?)')
    .run(actor || 'system', action, entity, entity_id, details ? JSON.stringify(details) : null);
}

module.exports = { db, nextId, getSetting, log, DATA_DIR };
