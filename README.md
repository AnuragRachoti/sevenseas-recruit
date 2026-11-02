# SevenSeas Healthcare Recruitment Command Center

A local web app that replaces the *Recruitment Command Center v3* Excel workbook. It runs on your own computer at `http://localhost:3000`, and the same code can be hosted in the cloud later.

---

## 1. Run it on your computer (first time)

1. **Install Node.js.** Go to https://nodejs.org, download the **LTS** version (22.13 or newer) and install it with the default options.
2. **Unzip** this folder somewhere permanent, for example `Documents\sevenseas-recruit`.
3. **Start it:**
   - **Windows:** double-click `start-windows.bat`
   - **Mac:** double-click `start-mac.command` (the first time, right-click → Open)
   - **Or from a terminal:** `npm install`, then `npm start`
4. Your browser opens at **http://localhost:3000**. Keep the black terminal window open while you use the app; closing it stops the app.

The first run loads the sample records from your workbook so you can try everything. Clear them with `npm run reset-sample-data` (which reloads the samples) or delete them in the app.

## 2. Turn on AI CV extraction (optional, recommended)

Without an AI provider, the app reads CVs with built-in rules. These are free and work offline, but they're less accurate, so every CV is flagged for review. You can use Ollama locally (no API key required) or a hosted provider:

1. **For local Ollama:** install Ollama and download a model, for example `ollama pull qwen2.5:7b`. Make sure Ollama is running.
2. Open the `.env` file in this folder and set `AI_PROVIDER=ollama`. The defaults use `http://localhost:11434` and `qwen2.5:7b`; optionally set `OLLAMA_BASE_URL` and `OLLAMA_MODEL` to use another local model or Ollama host.
3. **For hosted AI instead:** set `AI_PROVIDER=openai` with `OPENAI_API_KEY=...`, or `AI_PROVIDER=anthropic` with `ANTHROPIC_API_KEY=...`.
4. Restart the app. The Settings page shows the selected provider. With Ollama, CV text is sent to the configured Ollama server rather than OpenAI or Anthropic; keep that server on a trusted machine/network.

See `.env.example` for the available configuration variables. The AI prompts are the ones from your workbook's *AI Prompts* sheet (`src/ai.js`).

## 3. How the workflow maps to your workbook

| Workbook sheet | In the app |
|---|---|
| Command Center | **Command Center**: live KPIs, AI operations panel, funnel, recruiter performance |
| CV Inbox | **CV Inbox**: drag and drop CVs, automatic extraction, duplicate check, review screen |
| Candidates + Candidate Profiles | **Candidates**: one master record each, with full profile page |
| Match Results | **Match Results** + the ranked shortlist on each **Vacancy** page |
| Recruiter Queue | **Recruiter Queue**: tasks created automatically |
| Clients, Vacancies, Licensing, Interviews, Placements | Pages of the same name |
| Recruiters | **Recruiters** (targets, focus areas). Performance is calculated automatically |
| AI Configuration | **Settings**: thresholds 0.80 / 0.85 / 80 / 65 are editable |
| Power Automate Blueprint | Built in. No Power Automate needed (see below) |

### What's automated

1. **CV upload:** each file gets a CV ID and is read (PDF, DOCX, TXT).
2. **Extraction:** name, contact, profession, specialty, emirate, license, experience, availability, salary, education, languages, plus a confidence score.
3. **Duplicate check:** same email or phone means *Confirmed*; a similar name plus the same profession, specialty or license means *Possible*. Nothing is merged without a recruiter.
4. **Assignment:** by specialty/emirate focus, workload, or round-robin (set in Settings).
5. **Recruiter review (human check):** CV on the left, editable fields on the right, with fields to verify highlighted. *Approve*, *Merge into existing*, *Needs edit* or *Reject*.
6. **Matching:** every approved candidate is scored 0–100 against every open vacancy of the same profession: specialty 25, license 25, experience 20, availability 10, salary 10, location 10. ≥80 is *Recommend*, 65–79 is *Recruiter Review*. The **Why?** button gives an AI explanation.
7. **Shortlist → Submit → Interview → Offer → Placement:** buttons on the vacancy page. Statuses update across candidate, vacancy and match automatically. A vacancy becomes *Filled* when all openings are placed.
8. **Recruiter Queue tasks are created automatically for:**
   - CV review and duplicate review
   - strong matches
   - client and candidate follow-up dates
   - interview prep (2 days before) and missing feedback (after the date)
   - offers, and recording placements
   - license expiry (60 days ahead) and licensing blockers
   - invoices, overdue payments (30 days) and replacement-window check-ins (14 days before)

   Tasks close themselves when the underlying work is done. The rules run on every save, every hour, and when you click **Run automation**.
9. **Audit log** of who changed what (Settings page), plus **CSV export** of every table for Excel.

"Acting as" (top right) records who is making changes. Real logins with passwords should be added before hosting online (see section 5).

## 4. Your data

Everything is stored in the `data` folder: `sevenseas.db` (a SQLite database built into Node, so nothing extra to install) and `data/cvs/` (original CV files). **Back up the `data` folder regularly**, for example by copying it to OneDrive. To move the app to another computer, copy the whole folder, including `data`.

## 5. Moving to the cloud later

1. **Add real login:** Microsoft 365 or Google sign-in, with roles so recruiters only see their own records. This is the one essential step before going online.
2. **Database:** swap SQLite for a managed PostgreSQL (Azure Database for PostgreSQL, Supabase, AWS RDS). The tables in `src/db.js` translate directly.
3. **CV files:** move `data/cvs` to private cloud storage (Azure Blob, S3, SharePoint).
4. **Deploy:** the included `Dockerfile` runs on Azure App Service, Google Cloud Run, AWS, Render or any VPS. Pick a region that meets UAE data-protection (PDPL) requirements for candidate data.
5. Optional: email/WhatsApp daily digests, an Outlook/Google calendar link for interviews, and Zoho Books/Xero for invoices.

## Project layout

```
server.js            web server + all API routes
src/db.js            database tables
src/entities.js      fields & dropdown lists for every module (edit here to add a field)
src/cv.js            CV reading + rule-based extraction
src/ai.js            AI provider + prompts from the workbook
src/dedupe.js        duplicate detection
src/matching.js      vacancy matching score
src/automation.js    task rules, assignment, status syncing
src/seed.js          sample data from the workbook
public/              the web interface (HTML/CSS/JS, no build step)
```
