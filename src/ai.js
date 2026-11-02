// AI provider wrapper. Choose Ollama, OpenAI, or Anthropic in .env.
// With no provider configured, the app uses built-in rule-based extraction and matching.

const PROMPTS = {
  extraction: `You are a healthcare recruitment data-extraction assistant for SevenSeas Management Consultancy LLC.
Read the supplied CV and return ONLY structured JSON matching the approved candidate schema.
Do not invent missing information. Use null when a field is not present.
Normalize profession to Doctor, Nurse, Allied Health or Other.
Normalize license authority to DHA, DOH, MOHAP, SHA, Other or None.
Normalize license_status to Active, Eligible, In Process, Expired, None or Unknown.
Normalize current_location to a UAE emirate (Dubai, Abu Dhabi, Sharjah, Ajman, Umm Al Quwain, Ras Al Khaimah, Fujairah, Al Ain) or "Outside UAE".
Normalize availability to Immediate, 30 Days, 60 Days or 90 Days based on notice period.
Extract total experience and UAE experience as numeric years when possible.
Return an overall confidence score from 0 to 1 and a list of fields needing recruiter verification.
Do not make hiring or licensing decisions; extraction only.

Return JSON with exactly these keys:
{"full_name": string|null, "profession": string|null, "specialty": string|null, "mobile": string|null,
 "email": string|null, "total_experience_years": number|null, "uae_experience_years": number|null,
 "current_location": string|null, "current_employer": string|null, "license_authority": string|null,
 "license_status": string|null, "education": string|null, "languages": string[]|null,
 "nationality": string|null, "notice_period_days": number|null, "availability": string|null,
 "expected_salary": number|null, "ai_confidence": number, "verification_flags": string[]}`,

  matching: `You are assisting a healthcare recruiter at SevenSeas Management Consultancy LLC.
Evaluate the candidate against the vacancy using profession, specialty, regulator/license eligibility, years of experience, UAE experience, availability, location and salary where supplied.
Return a match score from 0 to 100.
Return Strong for >=80, Review for 65-79, Weak below 65.
Explain the top matching factors and key gaps.
Do not fabricate qualifications or licensing status. You assist the recruiter; you do not make hiring decisions.
Return ONLY JSON: {"match_score": number, "band": "Strong"|"Review"|"Weak", "strengths": string[], "key_gaps": string[], "rationale": string}`,
};

function provider() {
  const p = (process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (p === 'ollama') return 'ollama';
  if (p === 'openai' && process.env.OPENAI_API_KEY) return 'openai';
  if (p === 'anthropic' && process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

function parseJSON(text) {
  const cleaned = String(text).replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function callJSON(system, user) {
  const p = provider();
  if (!p) throw new Error('No AI provider configured');
  if (p === 'ollama') {
    const baseURL = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
    const res = await fetch(`${baseURL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
        format: 'json',
        stream: false,
        options: { temperature: 0 },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`Ollama error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    return parseJSON(j.message.content);
  }
  if (p === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    return parseJSON(j.choices[0].message.content);
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return parseJSON(j.content.map((c) => c.text || '').join(''));
}

module.exports = { PROMPTS, provider, callJSON };
