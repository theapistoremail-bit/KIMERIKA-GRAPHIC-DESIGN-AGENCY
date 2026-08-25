/**
 * POST /api/enhance
 * "Prompt Studio" — toma la visión corta del usuario y la expande en un
 * brief rico y editable (audiencia, emoción, paleta, textura, referencias).
 * Usa GPT-4o mini (rápido/barato); si no hay OPENAPIKEY, cae a Claude Haiku.
 * Body: { vision, selections }
 * Respuesta: { enhanced: "..." }
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { vision = '', selections = {} } = req.body || {};
  if (!vision.trim()) {
    return res.status(400).json({ error: 'vision is required' });
  }

  const objMap = { authority:'Brand Authority', identity:'Visual Identity', immersive:'Immersive 3D Experience', product:'Product Launch' };
  const visMap = { minimal:'Minimal & Refined', bold:'Bold & High Contrast', editorial:'Editorial & Elegant', futuristic:'Futuristic', abstract:'Conceptual / Abstract', luxury:'Luxury Black' };
  const context = `Objective: ${objMap[selections.obj]||'Brand Authority'}. Visual direction: ${visMap[selections.vis]||'open'}. Industry: ${selections.ind||'unspecified'}. Tone: ${selections.tone||'unspecified'}.`;

  const systemPrompt = `You are a world-class creative director and prompt engineer for a luxury branding studio. Take the client's short project vision and rewrite it as a single vivid, specific, well-structured paragraph (70-110 words) that a designer or an image-generation AI could act on directly. Include: who the brand serves, the emotional response desired, a suggested color/material direction (varied — do not default to only black/gold), and one distinctive visual idea. Do not use markdown, headers, or bullet points — one flowing paragraph, in the same language the client wrote in.`;

  const userMsg = `${context}\n\nClient's original vision: "${vision}"\n\nRewrite this as the enriched creative prompt.`;

  try {
    const openaiKey = process.env.OPENAPIKEY;
    const claudeKey = process.env.CLAUDEAPIKEY;

    if (openaiKey) {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 260,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMsg },
          ],
        }),
      });
      if (r.ok) {
        const data = await r.json();
        const enhanced = data.choices?.[0]?.message?.content?.trim();
        if (enhanced) return res.status(200).json({ enhanced, source: 'gpt-4o-mini' });
      }
    }

    if (claudeKey) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': claudeKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 260,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMsg }],
        }),
      });
      if (r.ok) {
        const data = await r.json();
        const enhanced = data.content?.[0]?.text?.trim();
        if (enhanced) return res.status(200).json({ enhanced, source: 'claude-haiku' });
      }
    }

    throw new Error('No enhancement provider configured or all failed');
  } catch (err) {
    console.error('[/api/enhance]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
