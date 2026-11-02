// Loads the sample records from the Excel workbook (plus a few extra so matching has something to do).
// Run: npm run seed        (add --reset to wipe and reload)
const { db } = require('./db');

const d = (offset) => { const t = new Date(); t.setDate(t.getDate() + offset); return t.toISOString().slice(0, 10); };

function seed({ reset = false } = {}) {
  const count = db.prepare('SELECT COUNT(*) c FROM recruiters').get().c;
  if (count && !reset) return false;
  if (reset) {
    for (const t of ['activity_log', 'tasks', 'matches', 'interviews', 'placements', 'licenses', 'cv_uploads', 'candidates', 'vacancies', 'clients', 'recruiters', 'settings']) db.exec(`DELETE FROM ${t}`);
  }
  const ins = (table, rows) => {
    for (const r of rows) {
      const k = Object.keys(r);
      db.prepare(`INSERT INTO ${table} (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...k.map((x) => r[x]));
    }
  };

  ins('settings', [
    { key: 'low_confidence_threshold', value: '0.8', purpose: 'Extracted CVs below this confidence go to recruiter review' },
    { key: 'duplicate_review_threshold', value: '0.85', purpose: 'Similarity at or above this is flagged as a possible duplicate' },
    { key: 'strong_match_threshold', value: '80', purpose: 'Match score (0-100) for Recommend' },
    { key: 'medium_match_threshold', value: '65', purpose: 'Match score (0-100) for Recruiter Review' },
    { key: 'replacement_window_days', value: '90', purpose: 'Default guarantee period after joining' },
    { key: 'license_expiry_warning_days', value: '60', purpose: 'Create a licensing task this many days before expiry' },
    { key: 'payment_overdue_days', value: '30', purpose: 'Invoice unpaid this many days is overdue' },
    { key: 'assignment_rule', value: 'specialty', purpose: 'How new CVs are assigned: specialty, workload or round-robin' },
  ]);

  ins('recruiters', [
    { id: 'REC-001', name: 'Recruiter A', email: 'recruiter.a@example.com', role: 'Recruiter', specialties: 'Nurse, ICU, Emergency', emirates: 'Dubai', target_revenue: 100000 },
    { id: 'REC-002', name: 'Recruiter B', email: 'recruiter.b@example.com', role: 'Recruiter', specialties: 'Doctor, GP, Pediatrics', emirates: 'Sharjah, Abu Dhabi', target_revenue: 100000 },
    { id: 'REC-003', name: 'Manager', email: 'manager@example.com', role: 'Manager', specialties: '', emirates: '', target_revenue: 0 },
  ]);

  ins('clients', [
    { id: 'CL-001', name: 'Example Medical Group', sector: 'Clinic Group', emirate: 'Dubai', contact_person: 'HR Manager', phone: '+971 5X XXX XXXX', email: 'hr@example.com', account_owner: 'REC-001', status: 'Active', last_contact: d(-7), next_follow_up: d(0) },
    { id: 'CL-002', name: 'Example Hospital', sector: 'Hospital', emirate: 'Sharjah', contact_person: 'Talent Acquisition', phone: '+971 5X XXX XXXX', email: 'talent@example.com', account_owner: 'REC-002', status: 'Active', last_contact: d(-3), next_follow_up: d(4) },
    { id: 'CL-003', name: 'Example Home Care', sector: 'Home Healthcare', emirate: 'Abu Dhabi', contact_person: 'Operations Lead', phone: '+971 5X XXX XXXX', email: 'ops@example.com', account_owner: 'REC-002', status: 'Prospect', last_contact: d(-12), next_follow_up: d(-1) },
  ]);

  ins('vacancies', [
    { id: 'VAC-001', client_id: 'CL-001', position: 'Registered Nurse', profession: 'Nurse', specialty: 'ICU', emirate: 'Dubai', license_required: 'DHA', min_experience: 3, max_salary: 10000, openings: 5, priority: 'High', date_opened: d(-30), target_join_date: d(20), status: 'Open', fee_per_placement: 12000, recruiter_id: 'REC-001' },
    { id: 'VAC-002', client_id: 'CL-002', position: 'General Practitioner', profession: 'Doctor', specialty: 'GP', emirate: 'Sharjah', license_required: 'MOHAP', min_experience: 5, max_salary: 22000, openings: 2, priority: 'Medium', date_opened: d(-25), target_join_date: d(35), status: 'Interviewing', fee_per_placement: 25000, recruiter_id: 'REC-002' },
    { id: 'VAC-003', client_id: 'CL-003', position: 'Home Care Nurse', profession: 'Nurse', specialty: 'Home Care', emirate: 'Abu Dhabi', license_required: 'DOH', min_experience: 2, max_salary: 8000, openings: 3, priority: 'Medium', date_opened: d(-5), target_join_date: d(45), status: 'Open', fee_per_placement: 9000, recruiter_id: 'REC-002' },
  ]);

  ins('candidates', [
    { id: 'CAN-000001', full_name: 'Sample Candidate 1', profession: 'Nurse', specialty: 'ICU', current_emirate: 'Dubai', license_authority: 'DHA', license_status: 'Active', years_experience: 5, uae_experience: 3, current_employer: 'Example Hospital', availability: 'Immediate', notice_days: 0, expected_salary: 9000, phone: '+971 50 000 0001', email: 'candidate1@example.com', recruiter_id: 'REC-001', source: 'Referral', status: 'Interviewing', last_contact: d(-4), next_follow_up: d(1) },
    { id: 'CAN-000002', full_name: 'Sample Candidate 2', profession: 'Doctor', specialty: 'GP', current_emirate: 'Sharjah', license_authority: 'MOHAP', license_status: 'Eligible', years_experience: 7, uae_experience: 2, current_employer: 'Example Clinic', availability: '30 Days', notice_days: 30, expected_salary: 18000, phone: '+971 50 000 0002', email: 'candidate2@example.com', recruiter_id: 'REC-002', source: 'LinkedIn', status: 'Interviewing', last_contact: d(-6), next_follow_up: d(0) },
    { id: 'CAN-000003', full_name: 'Sample Candidate 3', profession: 'Nurse', specialty: 'ICU', current_emirate: 'Dubai', license_authority: 'DHA', license_status: 'Active', years_experience: 6, availability: 'Not Available', expected_salary: 9500, phone: '+971 50 000 0003', email: 'candidate3@example.com', recruiter_id: 'REC-001', source: 'Job Board', status: 'Placed' },
    { id: 'CAN-000004', full_name: 'Sample Candidate 4', profession: 'Doctor', specialty: 'GP', current_emirate: 'Sharjah', license_authority: 'MOHAP', license_status: 'Active', years_experience: 9, availability: 'Not Available', expected_salary: 20000, phone: '+971 50 000 0004', email: 'candidate4@example.com', recruiter_id: 'REC-002', source: 'Referral', status: 'Placed' },
    { id: 'CAN-000005', full_name: 'Sample Candidate 5', profession: 'Nurse', specialty: 'Emergency', current_emirate: 'Dubai', license_authority: 'DHA', license_status: 'Eligible', years_experience: 4, uae_experience: 0, availability: '30 Days', notice_days: 30, expected_salary: 8500, phone: '+971 50 000 0005', email: 'candidate5@example.com', recruiter_id: 'REC-001', source: 'LinkedIn', status: 'Active' },
    { id: 'CAN-000006', full_name: 'Sample Candidate 6', profession: 'Nurse', specialty: 'Home Care', current_emirate: 'Abu Dhabi', license_authority: 'DOH', license_status: 'Active', years_experience: 3, uae_experience: 3, availability: 'Immediate', notice_days: 0, expected_salary: 7500, phone: '+971 50 000 0006', email: 'candidate6@example.com', recruiter_id: 'REC-002', source: 'Walk-in', status: 'Active' },
  ]);

  ins('licenses', [
    { id: 'LIC-0001', candidate_id: 'CAN-000001', authority: 'DHA', eligibility: 'Eligible', psv_dataflow: 'Complete', exam: 'Not Required', good_standing: 'Complete', documents_complete: 'Yes', license_status: 'Active', expiry_date: d(230), next_action: 'Maintain documents', owner_id: 'REC-001' },
    { id: 'LIC-0002', candidate_id: 'CAN-000002', authority: 'MOHAP', eligibility: 'Eligible', psv_dataflow: 'Complete', exam: 'Not Required', good_standing: 'Complete', documents_complete: 'Yes', license_status: 'Eligible', expiry_date: d(130), next_action: 'Facility activation', owner_id: 'REC-002' },
    { id: 'LIC-0003', candidate_id: 'CAN-000005', authority: 'DHA', eligibility: 'Eligible', psv_dataflow: 'In Progress', exam: 'Pending', good_standing: 'Pending', documents_complete: 'No', license_status: 'In Process', expiry_date: d(40), next_action: 'Chase DataFlow report', owner_id: 'REC-001' },
  ]);

  ins('interviews', [
    { id: 'INT-001', vacancy_id: 'VAC-001', candidate_id: 'CAN-000001', interview_date: d(2), stage: '1st Interview', result: 'Scheduled', next_step: 'Prepare candidate', recruiter_id: 'REC-001' },
    { id: 'INT-002', vacancy_id: 'VAC-002', candidate_id: 'CAN-000002', interview_date: d(-2), stage: 'Final', result: 'Scheduled', next_step: 'Confirm documents', recruiter_id: 'REC-002' },
  ]);

  const year = new Date().getFullYear();
  ins('placements', [
    { id: 'PLC-001', candidate_id: 'CAN-000003', vacancy_id: 'VAC-001', joining_date: `${year}-08-23`, recruiter_id: 'REC-001', fee: 12000, invoice_status: 'Invoiced', invoice_date: `${year}-08-25`, payment_status: 'Paid', replacement_window_ends: `${year}-11-21`, notes: 'Sample data' },
    { id: 'PLC-002', candidate_id: 'CAN-000004', vacancy_id: 'VAC-002', joining_date: `${year}-08-31`, recruiter_id: 'REC-002', fee: 25000, invoice_status: 'Invoiced', invoice_date: `${year}-09-02`, payment_status: 'Pending', replacement_window_ends: `${year}-11-29`, notes: 'Sample data' },
  ]);
  return true;
}

module.exports = { seed };

if (require.main === module) {
  const done = seed({ reset: process.argv.includes('--reset') });
  console.log(done ? 'Sample data loaded.' : 'Database already has data. Use: npm run seed -- --reset');
  if (done) {
    const { runAllMatching } = require('./matching');
    const { runSweep } = require('./automation');
    runAllMatching(); runSweep();
  }
}
