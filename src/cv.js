// CV pipeline: read file -> extract fields (AI or built-in rules) -> duplicate check -> assign -> review task.
const fs = require('fs');
const path = require('path');
const { db, getSetting, log } = require('./db');
const { PROMPTS, provider, callJSON } = require('./ai');
const { checkDuplicate } = require('./dedupe');
const { createTask, assignRecruiter } = require('./automation');

async function extractText(filePath, fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.pdf') {
    const { extractText: pdfText, getDocumentProxy } = await import('unpdf');
    const doc = await getDocumentProxy(new Uint8Array(fs.readFileSync(filePath)));
    const { text } = await pdfText(doc, { mergePages: true });
    return text;
  }
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const r = await mammoth.extractRawText({ path: filePath });
    return r.value;
  }
  if (ext === '.txt') return fs.readFileSync(filePath, 'utf8');
  throw new Error(`Unsupported file type ${ext}. Upload PDF, DOCX or TXT.`);
}

// ---------- Built-in rule-based extraction (used when no AI key is set) ----------
const SPECIALTIES = [
  ['NICU', /\bNICU\b|neonatal intensive/i], ['PICU', /\bPICU\b/i], ['ICU', /\bICU\b|intensive care|critical care/i],
  ['Emergency', /\bemergency\b|\bER\b|\bA&E\b/i], ['Operating Theatre', /operating (room|theat(re|er))|\bOT\b|\bOR nurse/i],
  ['Pediatrics', /pa?ediatric/i], ['OB/GYN', /obstetric|gyn(a)?ecolog|OB\/?GYN|midwi/i], ['Cardiology', /cardiolog|cardiac/i],
  ['Dialysis', /dialysis|nephrolog/i], ['Oncology', /oncolog/i], ['Dermatology', /dermatolog/i], ['Orthopedics', /orthop(a)?edic/i],
  ['Radiology', /radiolog/i], ['Anesthesia', /an(a)?esthe/i], ['General Surgery', /general surg/i], ['Internal Medicine', /internal medicine/i],
  ['Family Medicine', /family medicine/i], ['GP', /general practi|\bGP\b/i], ['Psychiatry', /psychiatr/i], ['Neurology', /neurolog/i],
  ['ENT', /\bENT\b|otolaryng/i], ['Ophthalmology', /ophthalm/i], ['Urology', /urolog/i], ['Dental', /dental|dentist/i],
  ['Home Care', /home ?care|home health/i], ['Medical-Surgical', /med(ical)?[- ]surg/i],
];
const EMIRATES = [['Abu Dhabi', /abu dhabi/i], ['Al Ain', /al ain/i], ['Dubai', /dubai/i], ['Sharjah', /sharjah/i], ['Ajman', /ajman/i], ['Umm Al Quwain', /umm al quwain/i], ['Ras Al Khaimah', /ras al khaimah|\bRAK\b/i], ['Fujairah', /fujairah/i]];

function countMatches(text, re) { const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'); return (text.match(g) || []).length; }

function ruleExtract(text, fileName) {
  const t = text.replace(/\r/g, '');
  const out = {}; const flags = [];
  const email = t.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i); out.email = email ? email[0].toLowerCase() : null;
  const phone = t.match(/(\+?971[\s-]?\d{1,2}[\s-]?\d{3}[\s-]?\d{4})|(\b0\d{1,2}[\s-]?\d{3}[\s-]?\d{4}\b)|(\+\d{1,3}[\s-]?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4})/);
  out.mobile = phone ? phone[0].trim() : null;

  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  const nameLine = lines.slice(0, 8).find((l) => /^(dr\.?\s+)?[A-Za-z][A-Za-z.'-]+(\s+[A-Za-z.'-]+){1,3}$/.test(l) && !/curriculum|vitae|resume|profile|contact|objective|summary|nurse|doctor|physician|practitioner|consultant|specialist|surgeon|therapist|pharmacist|technician|\bICU\b|\bGP\b|\bRN\b|registered|staff|senior|head|manager|dubai|abu dhabi|sharjah|uae|street|road/i.test(l));
  if (nameLine) out.full_name = nameLine.replace(/\s+/g, ' ');
  else {
    out.full_name = path.basename(fileName, path.extname(fileName)).replace(/[_-]+/g, ' ').replace(/\b(cv|resume|rn|gp|md|nurse|doctor|final|updated)\b/gi, '').replace(/\s+/g, ' ').trim() || null;
    flags.push('full_name');
  }

  const docScore = countMatches(t, /\b(MBBS|M\.?D\.?|physician|doctor|consultant|specialist|general practitioner|residency|Dr\.)/i);
  const nurseScore = countMatches(t, /\b(nurse|nursing|RN|BSN|staff nurse|charge nurse)\b/i);
  out.profession = docScore === 0 && nurseScore === 0 ? null : docScore > nurseScore ? 'Doctor' : 'Nurse';
  if (!out.profession) flags.push('profession');

  let best = null; let bestN = 0;
  for (const [name, re] of SPECIALTIES) { const n = countMatches(t, re); if (n > bestN) { best = name; bestN = n; } }
  out.specialty = best; if (!best) flags.push('specialty');

  const auth = [['DHA', /\bDHA\b|dubai health authority/i], ['DOH', /\bDOH\b|\bHAAD\b|department of health/i], ['MOHAP', /\bMOHAP\b|\bMOH\b|ministry of health/i], ['SHA', /\bSHA\b|sharjah health authority/i]];
  out.license_authority = null;
  for (const [a, re] of auth) if (re.test(t)) { out.license_authority = a; break; }
  if (out.license_authority) {
    if (/licen[cs]e[^.\n]{0,40}(active|valid)|(active|valid)[^.\n]{0,40}licen[cs]e/i.test(t)) out.license_status = 'Active';
    else if (/eligib/i.test(t)) out.license_status = 'Eligible';
    else if (/dataflow|prometric|in process/i.test(t)) out.license_status = 'In Process';
    else { out.license_status = 'Unknown'; flags.push('license_status'); }
  } else { out.license_status = null; flags.push('license_authority'); }

  out.current_location = null;
  for (const [e, re] of EMIRATES) if (re.test(t)) { out.current_location = e; break; }

  const yrs = [...t.matchAll(/(\d{1,2}(?:\.\d)?)\+?\s*(?:years|yrs)/gi)].map((m) => parseFloat(m[1])).filter((n) => n > 0 && n < 45);
  out.total_experience_years = yrs.length ? Math.max(...yrs) : null;
  if (out.total_experience_years == null) flags.push('total_experience_years');

  const sal = t.match(/expected\s+salary[^\d]{0,25}([\d,]{3,7})/i);
  out.expected_salary = sal ? Number(sal[1].replace(/,/g, '')) : null;

  if (/notice[^\n]{0,30}immediate|immediate(ly)? (available|joiner|joining)/i.test(t)) { out.notice_period_days = 0; }
  else {
    const n = t.match(/notice\s+period[^\d]{0,15}(\d{1,3})\s*(day|week|month)/i);
    if (n) out.notice_period_days = Number(n[1]) * (/week/i.test(n[2]) ? 7 : /month/i.test(n[2]) ? 30 : 1);
    else out.notice_period_days = null;
  }
  const edu = t.match(/\b(MBBS|MD|MS|DNB|FRCS|MRCP|BSN|BSc Nursing|B\.Sc\.? Nursing|Diploma in Nursing|MSN|BDS|PharmD)\b/i);
  out.education = edu ? edu[0] : null;
  const langs = ['English', 'Arabic', 'Hindi', 'Urdu', 'Tagalog', 'Malayalam', 'French'].filter((l) => new RegExp(`\\b${l}\\b`, 'i').test(t));
  out.languages = langs.length ? langs : null;

  const req = ['full_name', 'profession', 'specialty', 'total_experience_years', 'mobile', 'email', 'license_authority'];
  const found = req.filter((k) => out[k] != null && !flags.includes(k)).length;
  out.ai_confidence = Math.round((found / req.length) * 0.78 * 100) / 100; // rules never exceed 0.78 -> always reviewed
  out.verification_flags = [...new Set(flags)];
  return out;
}

function availabilityFromDays(days) {
  if (days == null) return null;
  if (days <= 7) return 'Immediate';
  if (days <= 30) return '30 Days';
  if (days <= 60) return '60 Days';
  return '90 Days';
}

// Converts the AI/rules output into Candidate fields used by the app.
function toCandidateFields(x) {
  return {
    full_name: x.full_name || null,
    profession: x.profession || null,
    specialty: x.specialty || null,
    phone: x.mobile || null,
    email: x.email || null,
    years_experience: x.total_experience_years ?? null,
    uae_experience: x.uae_experience_years ?? null,
    current_emirate: x.current_location || null,
    current_employer: x.current_employer || null,
    license_authority: x.license_authority || null,
    license_status: x.license_status || null,
    education: x.education || null,
    languages: Array.isArray(x.languages) ? x.languages.join(', ') : x.languages || null,
    nationality: x.nationality || null,
    notice_days: x.notice_period_days ?? null,
    availability: x.availability || availabilityFromDays(x.notice_period_days),
    expected_salary: x.expected_salary ?? null,
  };
}

async function processUpload(cvId) {
  const cv = db.prepare('SELECT * FROM cv_uploads WHERE id = ?').get(cvId);
  if (!cv) return;
  db.prepare("UPDATE cv_uploads SET processing_status='Processing', error_message=NULL WHERE id=?").run(cvId);
  try {
    const text = await extractText(cv.stored_path, cv.file_name);
    if (!text || text.trim().length < 30) throw new Error('No readable text found. The CV may be a scanned image; enter details manually or use an AI provider with OCR.');
    let raw; let method;
    if (provider()) {
      try {
        raw = await callJSON(PROMPTS.extraction, `File name: ${cv.file_name}\n\nCV TEXT:\n${text.slice(0, 30000)}`);
        method = `AI (${provider()})`;
      } catch (e) {
        raw = ruleExtract(text, cv.file_name); method = 'Rules (AI failed: ' + e.message.slice(0, 80) + ')';
      }
    } else { raw = ruleExtract(text, cv.file_name); method = 'Rules'; }

    const fields = toCandidateFields(raw);
    const confidence = Math.max(0, Math.min(1, Number(raw.ai_confidence) || 0));
    const flags = Array.isArray(raw.verification_flags) ? raw.verification_flags : [];
    const dup = checkDuplicate(fields);
    const recruiterId = cv.assigned_recruiter_id || assignRecruiter(fields);

    db.prepare(`UPDATE cv_uploads SET processing_status='Processed', extraction_method=?, extracted_json=?, overall_confidence=?,
      verification_flags=?, duplicate_status=?, duplicate_candidate_id=?, duplicate_score=?, duplicate_reason=?,
      assigned_recruiter_id=?, processed_at=datetime('now'), raw_text=? WHERE id=?`)
      .run(method, JSON.stringify(fields), confidence, flags.join(', '), dup.status, dup.candidate_id, dup.score, dup.reason, recruiterId, text.slice(0, 60000), cvId);

    const low = confidence < getSetting('low_confidence_threshold', 0.8);
    const isDup = dup.status !== 'Unique';
    const reasons = [low && `low confidence (${Math.round(confidence * 100)}%)`, isDup && `${dup.status.toLowerCase()} of ${dup.candidate_id}`, flags.length && `check: ${flags.join(', ')}`].filter(Boolean);
    createTask({
      auto_key: `cv:${cvId}`,
      task_type: isDup ? 'Duplicate Review' : 'CV Review',
      title: `Review CV: ${fields.full_name || cv.file_name}`,
      recruiter_id: recruiterId, related_type: 'cv_uploads', related_id: cvId,
      priority: low || isDup ? 'High' : 'Medium', due_date: new Date().toISOString().slice(0, 10),
      suggested_action: reasons.length ? `Verify extraction: ${reasons.join('; ')}` : 'Extraction looks complete. Confirm and approve.',
    });
    log('system', 'processed', 'cv_uploads', cvId, { method, confidence, duplicate: dup.status });
  } catch (e) {
    db.prepare("UPDATE cv_uploads SET processing_status='Error', error_message=? WHERE id=?").run(e.message, cvId);
    log('system', 'error', 'cv_uploads', cvId, { error: e.message });
  }
}

// Simple one-at-a-time queue so bulk uploads don't hammer the AI API.
const queue = []; let running = false;
function enqueue(cvId) { queue.push(cvId); if (!running) drain(); }
async function drain() {
  running = true;
  while (queue.length) { await processUpload(queue.shift()); }
  running = false;
}

module.exports = { enqueue, processUpload, toCandidateFields, ruleExtract };
