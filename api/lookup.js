// Скрытый помощник. Держит ключ, обращается к Claude с веб-поиском.
// Ключ берётся из настроек Vercel (ANTHROPIC_API_KEY), НЕ из этого файла.

const RULES = `You are the sugar/dosage lookup engine for a sparkling-wine community.
Given a wine name (and optional vintage), find its sugar data using web search.

SOURCE PRIORITY (strict):
1. The PRODUCER's official site — highest authority. Do NOT trust the search snippet;
   actively find and open the page for the SPECIFIC vintage. Look for a downloadable
   technical sheet (fiche technique), often a PDF — search "<wine> fiche technique pdf"
   or "<wine> tech sheet filetype:pdf", follow the link, and READ the PDF.
2. A SWISS importer, if any.
3. Other European importers.
4. Any other retailer/critic, by data availability.
Collect 2-4 sources, not just the first. Cross-check them.

HONESTY ABOUT THE PRODUCER:
Distinguish three states clearly:
 - "confirmed on producer site: X"
 - "checked producer site, this vintage not listed"
 - "could not verify on producer site"
NEVER report the third as "no data exists". Absence from a search is not absence from the site.

DOSAGE vs RESIDUAL SUGAR:
- Headline number = DOSAGE (added sugar from liqueur d'expédition), what producers publish.
- Below it, FINAL residual sugar (RS) if available, noting RS = natural remainder + dosage.
- Label which one each source gives; never pass dosage off as RS or vice versa.

CATEGORY: set by FINAL RS, with the legal ±3 g/L tolerance (overlap zones).
BRUT NATURE: dosage = 0 (adding dosage is forbidden); its sugar is purely natural remainder.
Different vintages/disgorgements = different numbers: return a by-batch breakdown.
If a number is not found, say so honestly and give the category range as fallback.

NEVER TRANSLATE: numbers, wine names, producer names, categories (Brut Nature, Extra Brut,
g/L), disgorgement dates, source URLs. These stay international.
TRANSLATE only your explanatory text and produce it in the requested language: {{LANG}}.

CRITICAL OUTPUT RULE: Your entire response must be ONLY the raw JSON object below — no reasoning, no preamble, no explanation before it, no markdown code fences, nothing after it. Start your response with { and end with }. Do all your thinking silently. Keep the JSON compact; put explanation only inside the "note" field.
Respond with a JSON object:
{
 "wine": "...", "region": "...",
 "dosage_gl": number|string|null,     // e.g. 0, 5, "4-6"
 "rs_gl": number|string|null,
 "rs_published": true|false,
 "category": "...", "category_range": "...",
 "producer_state": "confirmed"|"vintage_not_listed"|"unverified",
 "note": "explanatory text IN {{LANG}}",
 "sources": [ {"rank":1,"name":"...","country":"...","kind":"producer|importer|critic|shop","value":"...","meta":"...","url":"..."} ],
 "batches": [ {"label":"...","meta":"...","value":"..."} ]
}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({error:'POST only'}); return; }

  const { wine, lang } = req.body || {};
  if (!wine || String(wine).length > 200) { res.status(400).json({error:'bad wine'}); return; }
  const language = ({en:'English', ru:'Russian', de:'German'})[lang] || 'English';

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{ role:'user',
          content: RULES.replaceAll('{{LANG}}', language) + '\n\nWine: ' + wine }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      })
    });
    const data = await r.json();
    const text = (data.content||[]).map(b=>b.type==='text'?b.text:'').join('\n');
    res.status(200).json({ raw: text });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
