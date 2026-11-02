/* SevenSeas Recruitment Command Center — front end (no build step needed) */
const S = { meta: null, lk: null, user: localStorage.getItem('ss_user') || '' };
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);

async function api(method, url, body) {
  const opt = { method, headers: { 'X-User': S.user ? (S.lk?.recruiters[S.user] || S.user) : 'unknown' } };
  if (body instanceof FormData) opt.body = body;
  else if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(url, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || r.statusText); e.status = r.status; e.data = j; throw e; }
  return j;
}
const GET = (u) => api('GET', u);
function toast(msg, err) { const d = document.createElement('div'); d.textContent = msg; if (err) d.className = 'err'; $('#toast').append(d); setTimeout(() => d.remove(), err ? 6000 : 3000); }
const fail = (e) => toast(e.message, true);

// ---------- formatting ----------
const money = (n) => (n == null || n === '' ? '' : 'AED ' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }));
const fmtDate = (d) => { if (!d) return ''; const s = String(d).slice(0, 10); const dt = new Date(s + 'T00:00:00'); return isNaN(dt) ? esc(d) : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };
const GREEN = /^(Active|Open|Approved|Recommend|Paid|Done|Complete|Passed|Offer Accepted|Unique|Yes|Placed|Invoiced|Processed|Eligible|Filled|Shortlisted)$/;
const AMBER = /^(Pending|Recruiter Review|In Progress|Interviewing|Scheduled|In Process|Possible Duplicate|Needs Edit|Processing|Medium|Submitted|Interview|Offer|Under Review|Prospect|On Hold|Passive|New|Not Invoiced|Not Checked)$/;
const RED = /^(Rejected|Error|Overdue|Expired|Blocked|Do Not Recommend|Confirmed Duplicate|High|Failed|No Show|Not Eligible|No|Inactive|Closed|Cancelled|Not Available)$/;
function chip(v) { if (v == null || v === '') return ''; const c = GREEN.test(v) ? 'green' : RED.test(v) ? 'red' : AMBER.test(v) ? 'amber' : ''; return `<span class="chip ${c}">${esc(v)}</span>`; }
function scoreBar(n, max = 100) { if (n == null) return ''; const p = Math.round((n / max) * 100); const c = p >= 80 ? 'green' : p >= 65 ? 'amber' : 'red'; return `<span class="score"><span class="bar ${c}"><span style="width:${p}%"></span></span><b>${max === 1 ? p + '%' : Math.round(n)}</b></span>`; }
const ROUTE = { candidates: 'candidates', vacancies: 'vacancies', clients: 'clients', recruiters: 'recruiters', cv_uploads: 'cv', licenses: 'licenses', interviews: 'interviews', placements: 'placements' };
function refLink(ref, id) { if (!id) return ''; const label = S.lk?.[ref]?.[id] || id; return `<a href="#/${ROUTE[ref] || ref}/${esc(id)}">${esc(label)}</a>`; }
function fmt(f, v) {
  if (v == null || v === '') return '<span class="muted">—</span>';
  if (f.type === 'ref') return refLink(f.ref, v);
  if (f.type === 'date') return fmtDate(v);
  if (f.type === 'money') return money(v);
  if (f.type === 'select') return chip(v);
  return esc(v);
}

// ---------- modal & forms ----------
function modal(title, bodyHtml, footHtml, wide) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-back"><div class="modal" ${wide ? 'style="max-width:1000px"' : ''}><header><h2 style="margin:0">${title}</h2><button class="x" data-close>×</button></header><div class="body">${bodyHtml}</div>${footHtml ? `<footer>${footHtml}</footer>` : ''}</div></div>`;
  $$('[data-close]', root).forEach((b) => (b.onclick = closeModal));
  $('.modal-back', root).onmousedown = (e) => { if (e.target.classList.contains('modal-back')) closeModal(); };
  return $('.modal', root);
}
const closeModal = () => ($('#modal-root').innerHTML = '');

function inputFor(f, v, flagged) {
  const val = v ?? '';
  let ctl;
  if (f.type === 'select') ctl = `<select name="${f.key}"><option value=""></option>${f.options.map((o) => `<option ${String(o) === String(val) ? 'selected' : ''}>${esc(o)}</option>`).join('')}${val && !f.options.includes(val) ? `<option selected>${esc(val)}</option>` : ''}</select>`;
  else if (f.type === 'ref') ctl = `<select name="${f.key}"><option value=""></option>${Object.entries(S.lk[f.ref] || {}).map(([id, l]) => `<option value="${esc(id)}" ${id === val ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  else if (f.type === 'textarea') ctl = `<textarea name="${f.key}">${esc(val)}</textarea>`;
  else ctl = `<input name="${f.key}" type="${f.type === 'date' ? 'date' : ['number', 'money'].includes(f.type) ? 'number' : f.type === 'email' ? 'email' : 'text'}" step="any" value="${esc(String(val).slice(0, f.type === 'date' ? 10 : undefined))}">`;
  return `<div class="field ${f.type === 'textarea' ? 'full' : ''} ${flagged ? 'flag' : ''}"><label class="${f.required ? 'req' : ''}">${esc(f.label)}</label>${ctl}</div>`;
}
const readForm = (el) => Object.fromEntries($$('[name]', el).map((i) => [i.name, i.value]));

function openForm(entity, row = null, prefill = {}, after) {
  const e = S.meta.entities[entity];
  const data = { ...prefill, ...(row || {}) };
  const m = modal(`${row ? 'Edit' : 'New'} ${e.single}${row ? ' · ' + esc(row.id) : ''}`,
    `<form class="form-grid">${e.fields.map((f) => inputFor(f, data[f.key])).join('')}</form>`,
    `<div>${row ? `<button class="btn danger" data-del>Delete</button>` : ''}</div><div class="btn-row"><button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save</button></div>`);
  $$('[data-close]', m).forEach((b) => (b.onclick = closeModal));
  const save = async (force) => {
    const body = readForm($('form', m)); if (force) body._force = true;
    try {
      const saved = row ? await api('PUT', `/api/e/${entity}/${row.id}`, body) : await api('POST', `/api/e/${entity}`, body);
      closeModal(); toast(`${e.single} saved`); await loadLookups(); after ? after(saved) : route();
    } catch (err) {
      if (err.status === 409 && confirm(err.message + '\n\nCreate anyway?')) return save(true);
      fail(err);
    }
  };
  $('[data-save]', m).onclick = () => save(false);
  const del = $('[data-del]', m);
  if (del) del.onclick = async () => { if (!confirm(`Delete ${row.id}? This cannot be undone.`)) return; try { await api('DELETE', `/api/e/${entity}/${row.id}`); closeModal(); toast('Deleted'); await loadLookups(); location.hash = `#/${ROUTE[entity] || entity}`; } catch (err) { fail(err); } };
}

// ---------- navigation ----------
const NAV = [
  ['Overview'], ['dashboard', 'Command Center'], ['queue', 'Recruiter Queue', 'tasks'],
  ['AI Workflow'], ['cv', 'CV Inbox', 'cv'], ['matches', 'Match Results', 'matches'],
  ['Records'], ['candidates', 'Candidates'], ['vacancies', 'Vacancies'], ['clients', 'Clients'], ['interviews', 'Interviews'], ['placements', 'Placements'], ['licenses', 'Licensing'],
  ['Admin'], ['recruiters', 'Recruiters'], ['settings', 'Settings & Export'],
];
async function renderNav() {
  const cur = (location.hash.slice(2) || 'dashboard').split('/')[0];
  let counts = {};
  try { const d = S.dash || (await GET('/api/dashboard')); counts = { tasks: d.tasks.overdue + d.tasks.due_today, cv: d.ai.cvs_awaiting_review + d.ai.cvs_processing, matches: d.ai.strong_matches }; } catch {}
  $('#nav').innerHTML = NAV.map(([k, l, c]) => (l ? `<a href="#/${k}" class="${cur === k ? 'active' : ''}">${l}${c && counts[c] ? `<span class="badge">${counts[c]}</span>` : ''}</a>` : `<div class="sec">${k}</div>`)).join('');
}

const VIEWS = {};
async function route() {
  const [name, id] = (location.hash.slice(2) || 'dashboard').split('/');
  S.dash = null;
  const view = $('#view');
  try {
    if (VIEWS[name]) await VIEWS[name](view, id && decodeURIComponent(id));
    else if (S.meta.entities[name]) await (id ? detailView(view, name, decodeURIComponent(id)) : listView(view, name));
    else view.innerHTML = '<div class="empty">Page not found</div>';
  } catch (e) { view.innerHTML = `<div class="card">Something went wrong: ${esc(e.message)}</div>`; }
  renderNav();
}

// ---------- Dashboard ----------
VIEWS.dashboard = async (v) => {
  const d = (S.dash = await GET('/api/dashboard'));
  const k = d.kpi; const a = d.ai;
  const pct = k.target_revenue ? Math.round((k.revenue_ytd / k.target_revenue) * 100) : 0;
  const tile = (label, value, note, href, cls = '') => `<div class="kpi ${href ? 'link' : ''} ${cls}" ${href ? `onclick="location.hash='${href}'"` : ''}><div class="label">${label}</div><div class="value">${value}</div>${note ? `<div class="note">${note}</div>` : ''}</div>`;
  const maxF = Math.max(1, ...Object.values(d.funnel));
  v.innerHTML = `
  <div class="page-head"><div><h1>Command Center</h1><div class="sub">Live view, updated whenever anyone saves a record · ${fmtDate(d.today)}</div></div>
    <div class="btn-row"><a class="btn" href="#/cv">+ Upload CVs</a><button class="btn ghost" onclick="openForm('vacancies')">+ Vacancy</button></div></div>
  <div class="kpis">
    ${tile('Active Clients', k.active_clients, '', '#/clients')}
    ${tile('Open Vacancies', k.open_vacancies, `${k.open_positions} positions to fill`, '#/vacancies')}
    ${tile('Active Candidates', k.active_candidates, '', '#/candidates')}
    ${tile('Placements YTD', k.placements_ytd, '', '#/placements')}
    ${tile('Revenue YTD', money(k.revenue_ytd), `${pct}% of ${money(k.target_revenue)} target`, '#/placements', 'good')}
    ${tile('Outstanding', money(k.outstanding), `Collected ${money(k.collected_ytd)}`, '#/placements', k.outstanding ? 'alert' : '')}
    ${tile('Pipeline Value', money(k.pipeline_value), 'Open positions × fee')}
  </div>
  <div class="kpi-band"><h3>AI Operations</h3><div class="kpis">
    ${tile('CVs Processing', a.cvs_processing, '', '#/cv')}
    ${tile('CVs Awaiting Review', a.cvs_awaiting_review, a.cvs_error ? `${a.cvs_error} with errors` : '', '#/cv')}
    ${tile('Possible Duplicates', a.possible_duplicates, `${a.confirmed_duplicates} confirmed`, '#/cv')}
    ${tile('Strong Matches', a.strong_matches, 'Not yet actioned', '#/matches')}
    ${tile('Review Matches', a.review_matches, '65–79 score', '#/matches')}
    ${tile('Tasks Overdue', d.tasks.overdue, `${d.tasks.due_today} due today · ${d.tasks.open} open`, '#/queue', d.tasks.overdue ? 'alert' : '')}
  </div></div>
  <div class="grid g2">
    <div class="card"><h2>Priority Vacancies</h2>${d.vacancies.length ? `<table><tr><th>Vacancy</th><th>Client</th><th>Priority</th><th class="num">Strong</th><th class="num">Submitted</th><th class="num">Filled</th><th>Target Join</th></tr>
      ${d.vacancies.map((x) => `<tr class="click" onclick="location.hash='#/vacancies/${x.id}'"><td><b>${esc(x.position)}</b><div class="small muted">${x.id}</div></td><td>${esc(x.client)}</td><td>${chip(x.priority)}</td><td class="num">${x.strong}</td><td class="num">${x.submitted}</td><td class="num">${x.placed}/${x.openings}</td><td>${fmtDate(x.target_join_date)}</td></tr>`).join('')}</table>` : '<div class="empty">No open vacancies</div>'}</div>
    <div class="card"><h2>Pipeline Funnel</h2><div class="funnel">
      ${[['Matched', 'matched'], ['Shortlisted', 'shortlisted'], ['Submitted', 'submitted'], ['Interviewed', 'interviewed'], ['Offers', 'offers'], ['Placed', 'placed']].map(([l, key]) => `<div class="row"><span>${l}</span><div class="fb" style="width:${(d.funnel[key] / maxF) * 100}%"></div><b>${d.funnel[key]}</b></div>`).join('')}
    </div></div>
    <div class="card"><h2>Recruiter Performance</h2><table><tr><th>Recruiter</th><th class="num">Vacancies</th><th class="num">Submitted</th><th class="num">Interviews</th><th class="num">Placed</th><th>Revenue vs Target</th><th class="num">Overdue</th></tr>
      ${d.recruiters.map((r) => `<tr class="click" onclick="location.hash='#/queue/${r.id}'"><td><b>${esc(r.name)}</b></td><td class="num">${r.active_vacancies}</td><td class="num">${r.submitted}</td><td class="num">${r.interviews}</td><td class="num">${r.placements}</td><td>${money(r.revenue)}<div class="bar" style="margin-top:4px"><span style="width:${r.target_revenue ? Math.min(100, (r.revenue / r.target_revenue) * 100) : 0}%"></span></div></td><td class="num">${r.overdue_tasks ? `<span class="chip red">${r.overdue_tasks}</span>` : '0'}</td></tr>`).join('')}</table></div>
    <div class="card"><h2>Upcoming Interviews</h2>${d.upcoming.length ? `<table>${d.upcoming.map((i) => `<tr class="click" onclick="location.hash='#/candidates/${i.candidate_id}'"><td>${fmtDate(i.interview_date)}${i.interview_date < d.today ? ' <span class="chip red">Past – no result</span>' : ''}</td><td><b>${esc(i.full_name)}</b><div class="small muted">${esc(i.position)} · ${esc(i.client)}</div></td><td>${chip(i.stage)}</td></tr>`).join('')}</table>` : '<div class="empty">No interviews scheduled</div>'}
      <h2 class="mt">Licensing Status</h2><div class="btn-row">${d.licensing.map((l) => `${chip(l.status || 'Unknown')} <b>${l.n}</b>`).join('&nbsp;&nbsp;')}</div></div>
  </div>`;
};

// ---------- Generic list ----------
async function listView(v, entity, opts = {}) {
  const e = S.meta.entities[entity];
  const cols = [...e.fields.filter((f) => f.list), ...(e.computed || []).filter((f) => f.list)];
  const filterFields = e.fields.filter((f) => f.list && (f.type === 'select' || f.type === 'ref') && f.key !== 'client_id' && f.key !== 'candidate_id' && f.key !== 'vacancy_id');
  const q = opts.query || {};
  v.innerHTML = `<div class="page-head"><div><h1>${e.label}</h1><div class="sub" id="count"></div></div>
    <div class="btn-row"><a class="btn ghost" href="/api/export/${entity}.csv">Export CSV</a><button class="btn" id="new">+ New ${e.single}</button></div></div>
    <div class="filters"><input type="search" id="q" placeholder="Search…">${filterFields.map((f) => `<select data-f="${f.key}"><option value="">${esc(f.label)}: all</option>${(f.type === 'ref' ? Object.entries(S.lk[f.ref]) : f.options.map((o) => [o, o])).map(([id, l]) => `<option value="${esc(id)}" ${q[f.key] === id ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`).join('')}</div>
    <div class="table-wrap"><table><thead><tr><th>ID</th>${cols.map((c) => `<th class="${['number', 'money'].includes(c.type) || !c.type && e.computed?.includes(c) ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody id="rows"></tbody></table></div>`;
  $('#new').onclick = () => openForm(entity);
  const load = async () => {
    const p = new URLSearchParams();
    const qq = $('#q').value; if (qq) p.set('q', qq);
    $$('[data-f]').forEach((s) => s.value && p.set(s.dataset.f, s.value));
    const rows = await GET(`/api/e/${entity}?${p}`);
    $('#count').textContent = `${rows.length} record${rows.length === 1 ? '' : 's'}`;
    $('#rows').innerHTML = rows.length ? rows.map((r) => `<tr class="click" data-id="${esc(r.id)}"><td class="muted small">${esc(r.id)}</td>${cols.map((c) => `<td class="${['number', 'money'].includes(c.type) || (e.computed || []).includes(c) ? 'num' : ''}">${(e.computed || []).includes(c) ? (c.type === 'money' ? money(r[c.key]) : r[c.key]) : fmt(c, r[c.key])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length + 1}" class="empty">No records yet</td></tr>`;
    $$('#rows tr[data-id]').forEach((tr) => (tr.onclick = (ev) => { if (ev.target.tagName === 'A') return; location.hash = `#/${ROUTE[entity] || entity}/${tr.dataset.id}`; }));
  };
  let t; $('#q').oninput = () => { clearTimeout(t); t = setTimeout(load, 200); };
  $$('[data-f]').forEach((s) => (s.onchange = load));
  await load();
}

// ---------- Generic detail ----------
async function detailView(v, entity, id) {
  if (entity === 'candidates') return candidateView(v, id);
  if (entity === 'vacancies') return vacancyView(v, id);
  const e = S.meta.entities[entity];
  const r = await GET(`/api/e/${entity}/${id}`);
  const extra = entity === 'clients' ? await GET(`/api/e/vacancies?client_id=${id}`) : null;
  v.innerHTML = `<div class="page-head"><div><a href="#/${ROUTE[entity] || entity}" class="small">← ${e.label}</a><h1>${esc(r[e.title] && e.title !== 'id' ? r[e.title] : e.single)} <span class="muted small">${esc(r.id)}</span></h1></div>
    <div class="btn-row">${entity === 'clients' ? `<button class="btn ghost" id="addvac">+ Vacancy</button>` : ''}<button class="btn" id="edit">Edit</button></div></div>
    <div class="grid g-side"><div class="card"><dl class="dl">${e.fields.map((f) => `<dt>${esc(f.label)}</dt><dd>${fmt(f, r[f.key])}</dd>`).join('')}${(e.computed || []).map((f) => `<dt>${esc(f.label)}</dt><dd>${f.type === 'money' ? money(r[f.key]) : r[f.key]}</dd>`).join('')}</dl></div>
    <div>${extra ? `<div class="card"><h2>Vacancies</h2>${extra.length ? `<table>${extra.map((x) => `<tr class="click" onclick="location.hash='#/vacancies/${x.id}'"><td><b>${esc(x.position)}</b><div class="small muted">${x.id}</div></td><td>${chip(x.status)}</td></tr>`).join('')}</table>` : '<div class="muted">None yet</div>'}</div>` : ''}</div></div>`;
  $('#edit').onclick = () => openForm(entity, r);
  if ($('#addvac')) $('#addvac').onclick = () => openForm('vacancies', null, { client_id: id, emirate: r.emirate, recruiter_id: r.account_owner, date_opened: today(), status: 'Open' });
}

// ---------- Candidate profile ----------
async function candidateView(v, id) {
  const d = await GET(`/api/candidates/${id}/full`);
  const c = d.candidate; const e = S.meta.entities.candidates;
  const sec = (title, inner, btn = '') => `<div class="card mb"><div class="split"><h2>${title}</h2>${btn}</div>${inner}</div>`;
  v.innerHTML = `<div class="page-head"><div><a href="#/candidates" class="small">← Candidates</a><h1>${esc(c.full_name)} <span class="muted small">${c.id}</span></h1>
    <div class="sub">${esc(c.profession || '')} ${c.specialty ? '· ' + esc(c.specialty) : ''} ${c.current_emirate ? '· ' + esc(c.current_emirate) : ''} &nbsp; ${chip(c.status)} ${chip(c.license_authority ? c.license_authority + ' ' + (c.license_status || '') : '')}</div></div>
    <div class="btn-row">${d.cvs.map((x) => `<a class="btn ghost" target="_blank" href="/api/cv/${x.id}/file">View CV</a>`).join('')}<button class="btn" id="edit">Edit profile</button></div></div>
  <div class="grid g-side"><div>
    ${sec('Vacancy Matches', d.matches.length ? `<table><tr><th>Vacancy</th><th>Score</th><th>Band</th><th>Status</th><th>Gaps</th></tr>${d.matches.map((m) => `<tr><td><a href="#/vacancies/${m.vacancy_id}"><b>${esc(m.position)}</b></a><div class="small muted">${esc(m.client)}</div></td><td>${scoreBar(m.overall_score)}</td><td>${chip(m.band)}</td><td>${chip(m.status)}</td><td class="small">${esc(m.key_gaps || '—')}</td></tr>`).join('')}</table>` : '<div class="muted">No open vacancies match this profession yet.</div>')}
    ${sec('Interviews', d.interviews.length ? `<table>${d.interviews.map((i) => `<tr class="click" data-int="${i.id}"><td>${fmtDate(i.interview_date)}</td><td>${refLink('vacancies', i.vacancy_id)}</td><td>${chip(i.stage)}</td><td>${chip(i.result)}</td><td class="small">${esc(i.next_step || '')}</td></tr>`).join('')}</table>` : '<div class="muted">None</div>', `<button class="btn sm ghost" id="add-int">+ Interview</button>`)}
    ${sec('Licensing', d.licenses.length ? `<table><tr><th>Authority</th><th>Status</th><th>PSV/DataFlow</th><th>Exam</th><th>Expiry</th><th>Next action</th></tr>${d.licenses.map((l) => `<tr class="click" data-lic="${l.id}"><td><b>${esc(l.authority)}</b></td><td>${chip(l.license_status)}</td><td>${chip(l.psv_dataflow)}</td><td>${chip(l.exam)}</td><td>${fmtDate(l.expiry_date)}</td><td class="small">${esc(l.next_action || '')}</td></tr>`).join('')}</table>` : '<div class="muted">No license records</div>', `<button class="btn sm ghost" id="add-lic">+ License</button>`)}
    ${d.placements.length ? sec('Placements', `<table>${d.placements.map((p) => `<tr><td>${refLink('placements', p.id)}</td><td>${refLink('vacancies', p.vacancy_id)}</td><td>${fmtDate(p.joining_date)}</td><td>${money(p.fee)}</td><td>${chip(p.payment_status)}</td></tr>`).join('')}</table>`) : ''}
    ${sec('Tasks', d.tasks.length ? d.tasks.map(taskRow).join('') : '<div class="muted">No tasks</div>')}
  </div><div>
    <div class="card mb"><dl class="dl">${e.fields.filter((f) => !['full_name', 'notes'].includes(f.key)).map((f) => `<dt>${esc(f.label)}</dt><dd>${fmt(f, c[f.key])}</dd>`).join('')}</dl>${c.notes ? `<p class="small">${esc(c.notes)}</p>` : ''}</div>
    <div class="card"><h2>Activity</h2>${d.activity.length ? d.activity.map((a) => `<div class="small" style="margin-bottom:6px"><b>${esc(a.actor)}</b> ${esc(a.action)} <span class="muted">${esc(a.at)}</span></div>`).join('') : '<div class="muted small">No activity yet</div>'}</div>
  </div></div>`;
  $('#edit').onclick = () => openForm('candidates', c);
  $('#add-int').onclick = () => openForm('interviews', null, { candidate_id: id, recruiter_id: c.recruiter_id, result: 'Scheduled', stage: '1st Interview' });
  $('#add-lic').onclick = () => openForm('licenses', null, { candidate_id: id, authority: c.license_authority, owner_id: c.recruiter_id });
  $$('[data-int]').forEach((tr) => (tr.onclick = async (ev) => { if (ev.target.tagName === 'A') return; openForm('interviews', await GET(`/api/e/interviews/${tr.dataset.int}`)); }));
  $$('[data-lic]').forEach((tr) => (tr.onclick = async () => openForm('licenses', await GET(`/api/e/licenses/${tr.dataset.lic}`))));
  bindTasks(v);
}

// ---------- Vacancy page with ranked shortlist ----------
async function vacancyView(v, id) {
  const d = await GET(`/api/vacancies/${id}/full`);
  const x = d.vacancy; const e = S.meta.entities.vacancies;
  const actions = (m) => {
    const b = [];
    if (m.status === 'New') b.push(`<button class="btn sm" data-ms="Shortlisted" data-m="${m.id}">Shortlist</button>`);
    if (['New', 'Shortlisted'].includes(m.status)) b.push(`<button class="btn sm navy" data-ms="Submitted" data-m="${m.id}">Submit to client</button>`);
    if (['Submitted', 'Shortlisted', 'New'].includes(m.status)) b.push(`<button class="btn sm ghost" data-iv="${m.candidate_id}">Schedule interview</button>`);
    if (!['Rejected', 'Placed'].includes(m.status)) b.push(`<button class="btn sm ghost" data-ms="Rejected" data-m="${m.id}">✕</button>`);
    if (m.status === 'Interview') b.push(`<button class="btn sm" data-pl="${m.candidate_id}">Record placement</button>`);
    b.push(`<button class="btn sm ghost" data-ai="${m.id}" title="Explain this match">Why?</button>`);
    return b.join(' ');
  };
  const tab = S.vtab || 'top';
  const list = d.matches.filter((m) => (tab === 'top' ? m.band !== 'Do Not Recommend' && m.status !== 'Rejected' : tab === 'all' ? true : m.status === 'Rejected'));
  v.innerHTML = `<div class="page-head"><div><a href="#/vacancies" class="small">← Vacancies</a><h1>${esc(x.position)} <span class="muted small">${x.id}</span></h1>
    <div class="sub">${refLink('clients', x.client_id)} · ${esc(x.emirate || '')} · ${esc(x.license_required || 'Any license')} · ${x.min_experience ?? 0}+ yrs · up to ${money(x.max_salary) || '—'} &nbsp; ${chip(x.status)} ${chip(x.priority)}</div></div>
    <div class="btn-row"><button class="btn" id="edit">Edit vacancy</button></div></div>
  <div class="kpis"><div class="kpi"><div class="label">Openings</div><div class="value">${x.placed}/${x.openings}</div><div class="note">filled</div></div>
    <div class="kpi"><div class="label">Strong matches</div><div class="value">${d.matches.filter((m) => m.band === 'Recommend').length}</div></div>
    <div class="kpi"><div class="label">Submitted</div><div class="value">${x.submitted}</div></div><div class="kpi"><div class="label">Interviews</div><div class="value">${x.interviews_count}</div></div>
    <div class="kpi"><div class="label">Fee / placement</div><div class="value" style="font-size:20px">${money(x.fee_per_placement)}</div></div></div>
  <div class="card mb"><div class="tabs"><button data-tab="top" class="${tab === 'top' ? 'on' : ''}">Shortlist (65+)</button><button data-tab="all" class="${tab === 'all' ? 'on' : ''}">All matches</button><button data-tab="rej" class="${tab === 'rej' ? 'on' : ''}">Rejected</button></div>
    ${list.length ? `<table><tr><th>Candidate</th><th>Score</th><th>Band</th><th>License</th><th>Exp.</th><th>Availability</th><th>Salary</th><th>Status</th><th>Gaps</th><th></th></tr>
    ${list.map((m) => `<tr><td><a href="#/candidates/${m.candidate_id}"><b>${esc(m.full_name)}</b></a><div class="small muted">${esc(m.specialty || '')} · ${esc(m.current_emirate || '')}</div></td><td>${scoreBar(m.overall_score)}</td><td>${chip(m.band)}</td><td class="small">${esc(m.license_authority || '')} ${chip(m.license_status)}</td><td>${m.years_experience ?? '—'}</td><td>${chip(m.availability)}</td><td class="small">${money(m.expected_salary)}</td><td>${chip(m.status)}</td><td class="small" style="max-width:220px">${esc(m.key_gaps || '—')}${m.ai_rationale ? `<div class="muted" style="margin-top:4px">${esc(m.ai_rationale)}</div>` : ''}</td><td><div class="btn-row">${actions(m)}</div></td></tr>`).join('')}</table>` : '<div class="empty">No candidates in this view. Upload CVs or add candidates with the same profession.</div>'}</div>
  <div class="grid g2"><div class="card"><h2>Interviews</h2>${d.interviews.length ? `<table>${d.interviews.map((i) => `<tr class="click" data-int="${i.id}"><td>${fmtDate(i.interview_date)}</td><td>${refLink('candidates', i.candidate_id)}</td><td>${chip(i.stage)}</td><td>${chip(i.result)}</td></tr>`).join('')}</table>` : '<div class="muted">None yet</div>'}</div>
    <div class="card"><h2>Details</h2><dl class="dl">${e.fields.filter((f) => ['date_opened', 'target_join_date', 'recruiter_id', 'specialty', 'notes'].includes(f.key)).map((f) => `<dt>${esc(f.label)}</dt><dd>${fmt(f, x[f.key])}</dd>`).join('')}</dl></div></div>`;
  $('#edit').onclick = () => openForm('vacancies', x);
  $$('[data-tab]').forEach((b) => (b.onclick = () => { S.vtab = b.dataset.tab; vacancyView(v, id); }));
  $$('[data-ms]').forEach((b) => (b.onclick = async () => { try { await api('PUT', `/api/matches/${b.dataset.m}`, { status: b.dataset.ms }); toast(`Marked ${b.dataset.ms}`); vacancyView(v, id); } catch (er) { fail(er); } }));
  $$('[data-iv]').forEach((b) => (b.onclick = () => openForm('interviews', null, { vacancy_id: id, candidate_id: b.dataset.iv, recruiter_id: x.recruiter_id, result: 'Scheduled', stage: '1st Interview' }, () => vacancyView(v, id))));
  $$('[data-pl]').forEach((b) => (b.onclick = () => openForm('placements', null, { vacancy_id: id, candidate_id: b.dataset.pl, recruiter_id: x.recruiter_id, fee: x.fee_per_placement, invoice_status: 'Not Invoiced', payment_status: 'Pending' }, () => vacancyView(v, id))));
  $$('[data-ai]').forEach((b) => (b.onclick = async () => { b.disabled = true; b.textContent = '…'; try { await api('POST', `/api/matches/${b.dataset.ai}/rationale`); vacancyView(v, id); } catch (er) { fail(er); b.disabled = false; b.textContent = 'Why?'; } }));
  $$('[data-int]').forEach((tr) => (tr.onclick = async (ev) => { if (ev.target.tagName === 'A') return; openForm('interviews', await GET(`/api/e/interviews/${tr.dataset.int}`), {}, () => vacancyView(v, id)); }));
}

// ---------- Match Results ----------
VIEWS.matches = async (v) => {
  const f = S.mf || { band: '', status: 'New', vacancy_id: '' };
  v.innerHTML = `<div class="page-head"><div><h1>Match Results</h1><div class="sub">Every active candidate scored against every open vacancy of the same profession. Score = specialty 25 · license 25 · experience 20 · availability 10 · salary 10 · location 10.</div></div>
    <div class="btn-row"><a class="btn ghost" href="/api/export/matches.csv">Export CSV</a><button class="btn" id="rerun">Re-run matching</button></div></div>
    <div class="filters"><select id="fv"><option value="">All vacancies</option>${Object.entries(S.lk.vacancies).map(([id, l]) => `<option value="${id}" ${f.vacancy_id === id ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    <select id="fb"><option value="">All bands</option>${['Recommend', 'Recruiter Review', 'Do Not Recommend'].map((b) => `<option ${f.band === b ? 'selected' : ''}>${b}</option>`).join('')}</select>
    <select id="fs"><option value="">All statuses</option>${['New', 'Shortlisted', 'Submitted', 'Interview', 'Placed', 'Rejected'].map((b) => `<option ${f.status === b ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
    <div class="table-wrap"><table><thead><tr><th>Vacancy</th><th>Candidate</th><th>Score</th><th>Band</th><th>Specialty</th><th>License</th><th>Exp.</th><th>Avail.</th><th>Salary</th><th>Location</th><th>Status</th><th>Gaps</th></tr></thead><tbody id="rows"></tbody></table></div>`;
  const pc = (n) => scoreBar(n, 1);
  const load = async () => {
    S.mf = { vacancy_id: $('#fv').value, band: $('#fb').value, status: $('#fs').value };
    const rows = await GET('/api/matches?' + new URLSearchParams(Object.entries(S.mf).filter(([, x]) => x)));
    $('#rows').innerHTML = rows.length ? rows.map((m) => `<tr><td><a href="#/vacancies/${m.vacancy_id}">${esc(m.position)}</a><div class="small muted">${esc(m.client)}</div></td><td><a href="#/candidates/${m.candidate_id}"><b>${esc(m.full_name)}</b></a></td><td>${scoreBar(m.overall_score)}</td><td>${chip(m.band)}</td><td>${pc(m.specialty_score)}</td><td>${pc(m.license_score)}</td><td>${pc(m.experience_score)}</td><td>${pc(m.availability_score)}</td><td>${pc(m.salary_score)}</td><td>${pc(m.location_score)}</td><td>${chip(m.status)}</td><td class="small">${esc(m.key_gaps || '—')}</td></tr>`).join('') : '<tr><td colspan="12" class="empty">No matches for this filter</td></tr>';
  };
  $$('#fv,#fb,#fs').forEach((s) => (s.onchange = load));
  $('#rerun').onclick = async () => { await api('POST', '/api/matching/run'); toast('Matching updated'); load(); };
  await load();
};

// ---------- Recruiter Queue ----------
function taskRow(t) {
  const overdue = t.due_date && t.due_date < today() && ['Open', 'In Progress'].includes(t.status);
  const rel = t.related_id ? (t.related_type === 'cv_uploads' ? `<a href="#/cv/${t.related_id}">Open CV review →</a>` : t.related_type === 'matches' ? '' : `<a href="#/${ROUTE[t.related_type] || t.related_type}/${t.related_id}">${esc(S.lk[t.related_type]?.[t.related_id] || t.related_id)} →</a>`) : '';
  return `<div class="task" data-task="${t.id}"><div class="t-main"><div class="t-title">${esc(t.title)}</div>
    <div class="t-meta">${chip(t.task_type)} ${chip(t.priority)} <span>${overdue ? '<b style="color:var(--red)">Overdue · </b>' : ''}Due ${fmtDate(t.due_date) || '—'}</span><span>${esc(S.lk.recruiters[t.recruiter_id] || 'Unassigned')}</span>${rel}</div>
    ${t.suggested_action ? `<div class="t-sugg">💡 ${esc(t.suggested_action)}</div>` : ''}${t.notes ? `<div class="t-sugg muted">${esc(t.notes)}</div>` : ''}</div>
    <div class="btn-row">${chip(t.status)}${t.status !== 'Done' ? `${t.status === 'Open' ? `<button class="btn sm ghost" data-ts="In Progress">Start</button>` : ''}<button class="btn sm" data-ts="Done">Done</button><button class="btn sm ghost" data-ts="Blocked" title="Blocked">⛔</button>` : ''}<button class="btn sm ghost" data-te>Edit</button></div></div>`;
}
function bindTasks(root, reload) {
  $$('[data-task]', root).forEach((el) => {
    const id = el.dataset.task;
    $$('[data-ts]', el).forEach((b) => (b.onclick = async () => {
      let notes;
      if (b.dataset.ts === 'Done' || b.dataset.ts === 'Blocked') { notes = prompt(b.dataset.ts === 'Done' ? 'Outcome / notes (optional):' : 'What is blocking this?'); if (notes === null) return; }
      const t = await GET(`/api/e/tasks/${id}`);
      await api('PUT', `/api/e/tasks/${id}`, { status: b.dataset.ts, notes: notes ? (t.notes ? t.notes + '\n' : '') + notes : t.notes });
      toast(`Task ${b.dataset.ts.toLowerCase()}`); reload ? reload() : route();
    }));
    const ed = $('[data-te]', el); if (ed) ed.onclick = async () => openForm('tasks', await GET(`/api/e/tasks/${id}`), {}, reload);
  });
}
VIEWS.queue = async (v, who) => {
  const owner = who ?? S.qowner ?? (['Manager', 'Admin'].includes(S.roles?.[S.user]) ? '' : S.user) ?? '';
  v.innerHTML = `<div class="page-head"><div><h1>Recruiter Queue</h1><div class="sub">Tasks are created automatically from CVs, matches, follow-up dates, interviews, licensing and invoices.</div></div>
    <div class="btn-row"><button class="btn" id="new">+ Task</button></div></div>
    <div class="filters"><select id="owner"><option value="">Everyone</option>${Object.entries(S.lk.recruiters).map(([id, l]) => `<option value="${id}" ${owner === id ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    <select id="type"><option value="">All types</option>${S.meta.entities.tasks.fields.find((f) => f.key === 'task_type').options.map((o) => `<option>${o}</option>`).join('')}</select>
    <label class="small"><input type="checkbox" id="done"> Show completed</label></div><div id="groups"></div>`;
  const load = async () => {
    S.qowner = $('#owner').value;
    const p = new URLSearchParams(); if (S.qowner) p.set('recruiter_id', S.qowner); if ($('#type').value) p.set('task_type', $('#type').value);
    const all = await GET('/api/e/tasks?' + p);
    const t = today(); const showDone = $('#done').checked;
    const open = all.filter((x) => ['Open', 'In Progress'].includes(x.status)).sort((a, b) => String(a.due_date || '9').localeCompare(String(b.due_date || '9')) || (a.priority === 'High' ? -1 : 1));
    const groups = [['Overdue', open.filter((x) => x.due_date && x.due_date < t), 'red'], ['Due today', open.filter((x) => x.due_date === t)], ['Upcoming', open.filter((x) => !x.due_date || x.due_date > t)], ['Blocked', all.filter((x) => x.status === 'Blocked'), 'red']];
    if (showDone) groups.push(['Completed', all.filter((x) => x.status === 'Done')]);
    $('#groups').innerHTML = groups.filter((g) => g[1].length).map(([l, items, c]) => `<div class="card mb" style="padding:0;overflow:hidden"><div class="group-head ${c || ''}"><span>${l}</span><span>${items.length}</span></div>${items.map(taskRow).join('')}</div>`).join('') || '<div class="card empty">🎉 Nothing in the queue</div>';
    bindTasks($('#groups'), load);
  };
  $('#new').onclick = () => openForm('tasks', null, { recruiter_id: S.user, due_date: today(), priority: 'Medium', status: 'Open' }, load);
  $$('#owner,#type,#done').forEach((s) => (s.onchange = load));
  await load();
};

// ---------- CV Inbox ----------
VIEWS.cv = async (v, id) => {
  if (id) return cvReview(v, id);
  const f = S.cvf || 'review';
  v.innerHTML = `<div class="page-head"><div><h1>CV Inbox</h1><div class="sub">Drop CVs here. Each one is read, checked for duplicates, assigned to a recruiter and placed in the review queue. Nothing becomes a candidate until a recruiter approves it.</div></div></div>
    <div class="drop mb" id="drop"><input type="file" id="files" multiple accept=".pdf,.docx,.txt" hidden><div style="font-size:30px">📄</div><strong>Click or drag CVs here</strong><div class="muted small">PDF, DOCX or TXT · up to 200 at a time · ${S.meta.ai ? `AI extraction via ${S.meta.ai}` : 'built-in extraction (add an AI key for better accuracy)'}</div>
      <div class="mt small">Assign to: <select id="assign" onclick="event.stopPropagation()"><option value="">Auto (by rule in Settings)</option>${Object.entries(S.lk.recruiters).map(([i, l]) => `<option value="${i}">${esc(l)}</option>`).join('')}</select></div></div>
    <div class="tabs">${[['review', 'Awaiting review'], ['processing', 'Processing'], ['error', 'Errors'], ['done', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']].map(([k, l]) => `<button data-t="${k}" class="${f === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="table-wrap"><table><thead><tr><th>CV</th><th>Name (extracted)</th><th>Profession</th><th>Confidence</th><th>Duplicate</th><th>Recruiter</th><th>Status</th><th>Uploaded</th></tr></thead><tbody id="rows"></tbody></table></div>`;
  const drop = $('#drop'); const input = $('#files');
  drop.onclick = () => input.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); send(e.dataTransfer.files); };
  input.onchange = () => send(input.files);
  async function send(files) {
    if (!files.length) return;
    const fd = new FormData(); [...files].forEach((x) => fd.append('files', x)); fd.append('assign_to', $('#assign').value);
    try { const r = await api('POST', '/api/cv/upload', fd); toast(`${r.ids.length} CV${r.ids.length === 1 ? '' : 's'} uploaded – processing…`); if (r.ids.length < files.length) toast(`${files.length - r.ids.length} file(s) skipped (only PDF/DOCX/TXT)`, true); S.cvf = 'processing'; VIEWS.cv(v); poll(); } catch (e) { fail(e); }
  }
  const load = async () => {
    const rows = await GET('/api/cv');
    const pick = { review: (r) => r.processing_status === 'Processed' && ['Pending', 'Needs Edit'].includes(r.review_status), processing: (r) => ['Pending', 'Processing'].includes(r.processing_status), error: (r) => r.processing_status === 'Error', done: (r) => r.review_status === 'Approved', rejected: (r) => r.review_status === 'Rejected', all: () => true }[S.cvf || 'review'];
    const list = rows.filter(pick);
    $('#rows').innerHTML = list.length ? list.map((r) => { const x = JSON.parse(r.extracted_json || '{}'); return `<tr class="click" data-id="${r.id}"><td><b>${esc(r.id)}</b><div class="small muted">${esc(r.file_name)}</div></td><td>${esc(x.full_name || '')}${r.candidate_id ? `<div class="small">${refLink('candidates', r.candidate_id)}</div>` : ''}</td><td>${esc(x.profession || '')} <span class="muted small">${esc(x.specialty || '')}</span></td><td>${r.overall_confidence != null ? scoreBar(r.overall_confidence, 1) : ''}</td><td>${chip(r.duplicate_status)}${r.duplicate_candidate_id ? `<div class="small muted">${esc(r.duplicate_candidate_id)}</div>` : ''}</td><td>${esc(S.lk.recruiters[r.assigned_recruiter_id] || '')}</td><td>${r.processing_status === 'Processed' ? chip(r.review_status) : chip(r.processing_status)}${r.error_message ? `<div class="small" style="color:var(--red)">${esc(r.error_message)}</div>` : ''}</td><td class="small">${fmtDate(r.upload_date)}</td></tr>`; }).join('') : '<tr><td colspan="8" class="empty">Nothing here</td></tr>';
    $$('#rows tr[data-id]').forEach((tr) => (tr.onclick = (e) => { if (e.target.tagName !== 'A') location.hash = `#/cv/${tr.dataset.id}`; }));
    return rows;
  };
  $$('[data-t]').forEach((b) => (b.onclick = () => { S.cvf = b.dataset.t; VIEWS.cv(v); }));
  let timer;
  const poll = async () => { clearTimeout(timer); if (!location.hash.startsWith('#/cv') || location.hash.split('/')[2]) return; const rows = await load(); if (rows.some((r) => ['Pending', 'Processing'].includes(r.processing_status))) timer = setTimeout(poll, 2000); else renderNav(); };
  await poll();
};

async function cvReview(v, id) {
  const r = await GET(`/api/cv/${id}`);
  const x = JSON.parse(r.extracted_json || '{}');
  const flags = String(r.verification_flags || '').split(',').map((s) => s.trim()).filter(Boolean);
  const FMAP = { full_name: 'full_name', mobile: 'phone', total_experience_years: 'years_experience', current_location: 'current_emirate', notice_period: 'notice_days' };
  const flagged = new Set(flags.map((f) => FMAP[f] || f));
  const low = r.overall_confidence != null && r.overall_confidence < (Number(S.meta.settings.find((s) => s.key === 'low_confidence_threshold')?.value) || 0.8);
  const ce = S.meta.entities.candidates;
  const reviewFields = ce.fields.filter((f) => !['status', 'source', 'last_contact', 'next_follow_up'].includes(f.key));
  const pre = { ...x, recruiter_id: x.recruiter_id || r.assigned_recruiter_id };
  for (const f of reviewFields) if (pre[f.key] == null || pre[f.key] === '') if (['full_name', 'profession', 'specialty', 'years_experience', 'license_authority', 'phone', 'email'].includes(f.key)) flagged.add(f.key);
  const isPdf = /\.pdf$/i.test(r.file_name);
  const d = r.duplicate;
  const cmpKeys = ['full_name', 'email', 'phone', 'profession', 'specialty', 'license_authority', 'years_experience', 'current_emirate'];
  const decided = ['Approved', 'Rejected'].includes(r.review_status);
  v.innerHTML = `<div class="page-head"><div><a href="#/cv" class="small">← CV Inbox</a><h1>Review ${esc(r.id)} <span class="muted small">${esc(r.file_name)}</span></h1>
    <div class="sub">${chip(r.processing_status)} ${chip(r.review_status)} · Extracted by ${esc(r.extraction_method || '—')} · Confidence ${r.overall_confidence != null ? Math.round(r.overall_confidence * 100) + '%' : '—'} ${low ? '<span class="chip red">Low confidence: check highlighted fields</span>' : ''}</div></div>
    <div class="btn-row"><a class="btn ghost" href="/api/cv/${id}/file?download=1">Download original</a><button class="btn ghost" id="reproc">Re-run extraction</button></div></div>
  ${r.error_message ? `<div class="dup-box red">${esc(r.error_message)}</div>` : ''}
  <div class="review"><div>${isPdf ? `<div class="tabs"><button class="on" data-pv="pdf">Original CV</button><button data-pv="txt">Extracted text</button></div>` : ''}${isPdf ? `<iframe class="cv-frame" id="pv-pdf" src="/api/cv/${id}/file"></iframe>` : ''}<pre class="cv-text" id="pv-txt" ${isPdf ? 'style="display:none"' : ''}>${esc(r.raw_text || 'No text extracted')}</pre></div>
  <div>
    ${d ? `<div class="dup-box ${r.duplicate_status === 'Confirmed Duplicate' ? 'red' : ''}"><b>${esc(r.duplicate_status)}</b> of ${refLink('candidates', d.id)} (${Math.round((r.duplicate_score || 0) * 100)}%: ${esc(r.duplicate_reason || '')})
      <table class="compare mt"><tr><th></th><th>This CV</th><th>Existing ${esc(d.id)}</th></tr>${cmpKeys.map((k) => `<tr class="${String(x[k] ?? '') !== String(d[k] ?? '') ? 'diff' : ''}"><td class="muted">${esc(ce.fields.find((f) => f.key === k).label)}</td><td>${esc(x[k] ?? '—')}</td><td>${esc(d[k] ?? '—')}</td></tr>`).join('')}</table>
      <div class="small muted mt">Use <b>Merge into existing</b> to update ${esc(d.id)} with this CV instead of creating a second profile.</div></div>` : r.processing_status === 'Processed' ? '<div class="dup-box" style="border-color:#9fd3b2;background:#f2fbf5">✓ No duplicate found</div>' : ''}
    <div class="card"><h2>Extracted profile <span class="small muted">(edit anything before approving)</span></h2>
      <form class="form-grid" id="rf">${reviewFields.map((f) => inputFor(f, pre[f.key], flagged.has(f.key))).join('')}<div class="field full"><label>Review notes</label><textarea name="_notes">${esc(r.review_notes || '')}</textarea></div></form>
      ${decided ? `<div class="mt">This CV was <b>${esc(r.review_status)}</b>${r.candidate_id ? ` → ${refLink('candidates', r.candidate_id)}` : ''}.</div>` : ''}
      <div class="btn-row mt">
        <button class="btn" data-act="approve" ${r.processing_status !== 'Processed' ? 'disabled' : ''}>✓ Approve as new candidate</button>
        ${d ? `<button class="btn navy" data-act="merge">⇄ Merge into ${esc(d.id)}</button>` : ''}
        <button class="btn warn" data-act="needs_edit">Needs edit</button><button class="btn danger" data-act="reject">Reject</button>
      </div></div></div></div>`;
  $$('[data-pv]').forEach((b) => (b.onclick = () => { $$('[data-pv]').forEach((x) => x.classList.toggle('on', x === b)); $('#pv-pdf').style.display = b.dataset.pv === 'pdf' ? '' : 'none'; $('#pv-txt').style.display = b.dataset.pv === 'txt' ? '' : 'none'; }));
  $('#reproc').onclick = async () => { await api('POST', `/api/cv/${id}/reprocess`); toast('Re-processing…'); setTimeout(() => cvReview(v, id), 2500); };
  $$('[data-act]').forEach((b) => (b.onclick = async () => {
    const act = b.dataset.act; const form = readForm($('#rf')); const notes = form._notes; delete form._notes;
    if (act === 'approve' && d && r.duplicate_status === 'Confirmed Duplicate' && !confirm(`This CV appears to be ${d.id} (${r.duplicate_reason}). Create a separate new candidate anyway?`)) return;
    if (act === 'reject' && !confirm('Reject this CV?')) return;
    try {
      const res = await api('POST', `/api/cv/${id}/review`, { action: act, fields: form, merge_into: d?.id, notes });
      await loadLookups();
      toast({ approve: 'Candidate created and matched against open vacancies', merge: `Merged into ${d?.id}`, needs_edit: 'Marked as needs edit', reject: 'CV rejected' }[act]);
      location.hash = res.candidate_id ? `#/candidates/${res.candidate_id}` : '#/cv';
    } catch (e) { fail(e); }
  }));
}

// ---------- Settings ----------
VIEWS.settings = async (v) => {
  const m = (S.meta = await GET('/api/meta'));
  const act = await GET('/api/activity');
  v.innerHTML = `<div class="page-head"><div><h1>Settings & Export</h1></div></div>
  <div class="grid g2"><div class="card"><h2>Automation thresholds</h2><form id="sf" class="form-grid">
    ${m.settings.map((s) => `<div class="field ${s.key === 'assignment_rule' ? '' : ''}"><label>${esc(s.key.replace(/_/g, ' '))}</label>${s.key === 'assignment_rule' ? `<select name="${s.key}">${['specialty', 'workload', 'round-robin'].map((o) => `<option ${o === s.value ? 'selected' : ''}>${o}</option>`).join('')}</select>` : `<input name="${s.key}" value="${esc(s.value)}">`}<div class="small muted">${esc(s.purpose)}</div></div>`).join('')}
    </form><div class="btn-row mt"><button class="btn" id="save">Save settings</button><button class="btn ghost" id="rerun">Save & re-run matching</button></div>
    <h2 class="mt">AI provider</h2><p>${m.ai ? `<span class="chip green">Configured: ${esc(m.ai)}</span>` : '<span class="chip amber">Off: using built-in rules</span>'}</p>
    <p class="small muted">To use local AI, install Ollama, download a model (for example <code>ollama pull qwen2.5:7b</code>), set <code>AI_PROVIDER=ollama</code> in <code>.env</code>, then restart the app. Defaults: <code>http://localhost:11434</code> and <code>qwen2.5:7b</code>. OpenAI and Anthropic are also supported; see <code>.env.example</code>.</p></div>
  <div class="card"><h2>Export to Excel (CSV)</h2><div class="btn-row">${[...Object.keys(m.entities), 'matches', 'activity_log'].map((k) => `<a class="btn ghost sm" href="/api/export/${k}.csv">${esc(m.entities[k]?.label || k.replace('_', ' '))}</a>`).join('')}</div>
    <h2 class="mt">Recent activity (audit log)</h2><div style="max-height:420px;overflow:auto">${act.map((a) => `<div class="small" style="padding:4px 0;border-bottom:1px solid var(--line)"><span class="muted">${esc(a.at)}</span> · <b>${esc(a.actor)}</b> ${esc(a.action)} ${esc(a.entity || '')} ${esc(a.entity_id || '')}</div>`).join('')}</div></div></div>`;
  const save = async () => { await api('PUT', '/api/settings', readForm($('#sf'))); S.meta = await GET('/api/meta'); toast('Settings saved'); };
  $('#save').onclick = save;
  $('#rerun').onclick = async () => { await save(); await api('POST', '/api/automation/run'); toast('Matching and tasks refreshed'); };
};

// ---------- global search ----------
function setupSearch() {
  const inp = $('#global-search'); const box = $('#search-results');
  inp.oninput = () => {
    const q = inp.value.trim().toLowerCase();
    if (q.length < 2) { box.style.display = 'none'; return; }
    const hits = [];
    for (const [ref, label] of [['candidates', 'Candidate'], ['vacancies', 'Vacancy'], ['clients', 'Client']]) for (const [id, l] of Object.entries(S.lk[ref])) if ((id + ' ' + l).toLowerCase().includes(q)) hits.push(`<a href="#/${ref}/${id}"><span class="muted small">${label}</span> ${esc(l)} <span class="muted small">${id}</span></a>`);
    box.innerHTML = hits.slice(0, 15).join('') || '<div class="empty small">No matches</div>';
    box.style.display = 'block';
  };
  box.onclick = () => { box.style.display = 'none'; inp.value = ''; };
  document.addEventListener('click', (e) => { if (!e.target.closest('.search-wrap')) box.style.display = 'none'; });
}

async function loadLookups() { S.lk = await GET('/api/lookups'); S.roles = Object.fromEntries((await GET('/api/e/recruiters')).map((r) => [r.id, r.role])); }
async function boot() {
  [S.meta] = await Promise.all([GET('/api/meta'), loadLookups()]);
  const us = $('#user-select');
  us.innerHTML = Object.entries(S.lk.recruiters).map(([id, l]) => `<option value="${id}" ${id === S.user ? 'selected' : ''}>${esc(l)}</option>`).join('');
  if (!S.user) S.user = us.value;
  us.onchange = () => { S.user = us.value; S.qowner = undefined; localStorage.setItem('ss_user', S.user); route(); };
  $('#ai-status').innerHTML = `<span class="dot" style="background:${S.meta.ai ? '#3ccf8e' : '#e8a93a'}"></span>AI: ${S.meta.ai ? esc(S.meta.ai) : 'built-in rules'}`;
  $('#run-auto').onclick = async () => { try { const r = await api('POST', '/api/automation/run'); toast(`Automation ran · ${r.created} new task${r.created === 1 ? '' : 's'}`); route(); } catch (e) { fail(e); } };
  setupSearch();
  window.addEventListener('hashchange', route);
  route();
}
boot();
