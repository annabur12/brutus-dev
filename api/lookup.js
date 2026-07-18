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

CATEGORY: set by FINAL RS. State the category range with BOTH bounds, exactly and briefly:
Brut Nature 0-3, Extra Brut 0-6, Brut 0-12, Extra Dry 12-17, Sec/Dry 17-32, Demi-Sec 32-50, Doux 50+ g/L.
Never invent a lower bound, never extend an upper bound by the tolerance, and do not add
phrases like "legal maximum" or "legal threshold" to the range itself. The ±3 g/L tolerance
is a labelling allowance — mention it only when it actually matters, as a separate remark.
For non-Champagne appellations use that appellation's own limits and say which appellation.

NEVER MIX THE TWO FIGURES: if a source gives only residual sugar (RS), put it in rs_gl and
leave dosage_gl null. If a source gives only dosage, put it in dosage_gl and leave rs_gl null.
Even when the numbers would be close, never copy one into the other field. Only fill both when
two separate figures are actually published.

BATCH VARIABILITY WARNING: when the dosage figure comes from a source that does not state a
disgorgement date, or when this cuvée is known to vary between disgorgements, say so plainly
in "note": the figure belongs to an unidentified batch and the bottle in the user's hand may
differ. Add that many growers print the exact dosage and disgorgement date on the BACK LABEL,
and that this is the most reliable figure for their specific bottle.
BRUT NATURE: dosage = 0 (adding dosage is forbidden); its sugar is purely natural remainder.
DISTINGUISH TWO DIFFERENT THINGS — this is critical:
(a) SAME wine, different batches (different disgorgement dates or base years of one NV cuvée).
    These belong in "batches" and MAY be shown as a range in dosage_gl.
(b) DIFFERENT wines sold under a similar name (separate lieux-dits, single-vineyard bottlings
    vs assemblage, different cuvée names from the same producer and vintage).
    These are SEPARATE PRODUCTS. NEVER average them and NEVER merge them into one range.
If you find case (b), do NOT put a blended range in dosage_gl. Instead:
 - set "ambiguous": true
 - list each distinct wine in "versions" with its own name, dosage and source
 - set dosage_gl to the figure of the single best-matching wine if the query clearly
   identifies one, otherwise null
 - keep "note" SHORT in this case (2-3 sentences maximum): state only that several distinct
   wines exist under this name and ask the user to specify which one. Do NOT repeat the
   per-wine details, dosages, sources or vinification in "note" — all of that belongs in
   "versions" only. Never duplicate the same information in both fields.
A range in dosage_gl is ONLY allowed when all the numbers come from case (a).
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
 "sources": [ {"rank":1,"name":"...","country":"...","kind":"producer|importer|critic|shop","primary":true|false,"value":"...","meta":"...","url":"..."} ],
 // set primary to true ONLY for a source that actually yielded data for the requested wine
 // never mark a source primary if it was unreachable, empty, or about a different cuvee
 "batches": [ {"label":"...","meta":"...","value":"..."} ],
 "ambiguous": true|false,
 "versions": [ {"name":"...","dosage":"...","meta":"...","url":"..."} ]
}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({error:'POST only'}); return; }

  const { wine, lang, image, imageType } = req.body || {};
  if (!wine && !image) { res.status(400).json({error:'no input'}); return; }
  if (wine && String(wine).length > 200) { res.status(400).json({error:'bad wine'}); return; }
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
        messages: [{ role:'user', content: image ? [
            { type:'image', source:{ type:'base64', media_type: imageType || 'image/jpeg', data: image } },
            { type:'text', text: RULES.replaceAll('{{LANG}}', language) +
              '\n\nFIRST identify the wine from this bottle label photo: read the producer, cuvée name, ' +
              'lieu-dit if present, vintage, and sweetness category exactly as printed. Put the full ' +
              'identified name in "wine". If the label is unreadable or not a wine label, say so in "note" ' +
              'and set found fields to null. Report ONLY what is actually printed on the label. ' +
              'Never guess a similar-looking wine term: non filtree is NOT non dose. ' +
              'If a word is unclear, say it is unclear instead of substituting a plausible term. ' +
              'Never state that something appears on the label when you actually found it online; ' +
              'keep read-from-label and found-by-search clearly separate. ' +
              'THEN look up its sugar data following all rules above.' }
          ] : RULES.replaceAll('{{LANG}}', language) + '\n\nWine: ' + wine }],
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
