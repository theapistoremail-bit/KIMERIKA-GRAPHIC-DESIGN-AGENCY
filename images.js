/**
 * POST /api/images
 * FASE 1 — DIRECCIÓN ESTÉTICA (GPT-4o mini, texto):
 *   ChatGPT analiza el vision/brief y produce un "Art Direction Brief" —
 *   paleta de color (hex, variada, NO limitada a negro/dorado), mood,
 *   texturas, iluminación — que se usa para enriquecer TODOS los prompts
 *   de imagen de este request.
 *
 * FASE 2 — GENERACIÓN DE IMAGEN (Leonardo + GPT-image-1 EN PARALELO):
 *   Por cada "set" (logo, packaging, social, moodboard) se llama a AMBOS
 *   proveedores con el prompt ya enriquecido por la dirección estética.
 *
 * Respuesta: { direction: {...}, results: { [key]: [{url, provider}] } }
 * Las keys viven solo en Vercel env vars (LEONARDO, OPENAPIKEY).
 */

export const config = {
  maxDuration: 60, // Leonardo hace polling; requiere plan Pro de Vercel
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { sets, brief = '', directionOnly = false, direction: providedDirection = null } = req.body || {};

  const leonardoKey = process.env.LEONARDO;
  const openaiKey   = process.env.OPENAPIKEY;

  // ── Fast path: only the ChatGPT aesthetic direction (no images) ──
  // Used by the frontend to seed Claude's website prompt BEFORE image
  // generation finishes, so the whole pipeline follows one visual DNA.
  if (directionOnly) {
    if (!openaiKey) return res.status(200).json({ direction: null });
    try {
      const direction = await getArtDirection(brief, openaiKey);
      return res.status(200).json({ direction });
    } catch (e) {
      console.error('[/api/images:directionOnly]', e.message);
      return res.status(200).json({ direction: null });
    }
  }

  if (!Array.isArray(sets) || !sets.length) {
    return res.status(400).json({ error: 'sets[] is required, e.g. [{key,prompt,count}]' });
  }

  if (!leonardoKey && !openaiKey) {
    return res.status(500).json({ error: 'No image provider configured (LEONARDO / OPENAPIKEY)' });
  }

  // ── FASE 1: Dirección estética via GPT-4o mini (rápido, barato) ──
  // Si el cliente ya obtuvo la dirección (llamada directionOnly previa,
  // usada para el sitio web de Claude), la reutilizamos — misma "visual DNA"
  // para el sitio y las imágenes, sin pagar el llamado dos veces.
  let direction = providedDirection;
  if (!direction && openaiKey && brief.trim()) {
    try {
      direction = await getArtDirection(brief, openaiKey);
    } catch (e) {
      console.error('[/api/images] art-direction failed:', e.message);
    }
  }

  const paletteLine = direction?.colors?.length
    ? `Color palette: ${direction.colors.join(', ')} — diverse, elegant, NOT limited to only black/gold or black/white.`
    : 'Diverse elegant color palette appropriate to the brand — avoid defaulting only to black/gold or black/white.';
  const moodLine = direction?.mood ? `Mood: ${direction.mood}.` : '';
  const textureLine = direction?.textures ? `Textures/materials: ${direction.textures}.` : '';
  const directionSuffix = [paletteLine, moodLine, textureLine].filter(Boolean).join(' ');

  const results = {};

  await Promise.all(sets.map(async (set) => {
    const key = set.key || 'default';
    const count = Math.min(Math.max(set.count || 2, 1), 4);
    const enrichedPrompt = `${set.prompt} ${directionSuffix}`.trim();

    const [leoRes, oaiRes] = await Promise.allSettled([
      leonardoKey ? generateLeonardo({ ...set, prompt: enrichedPrompt }, count, leonardoKey) : Promise.resolve([]),
      openaiKey   ? generateOpenAI({ ...set, prompt: enrichedPrompt }, count, openaiKey)     : Promise.resolve([]),
    ]);

    const leoImgs = (leoRes.status === 'fulfilled' ? leoRes.value : []).map(url => ({ url, provider: 'leonardo' }));
    const oaiImgs = (oaiRes.status === 'fulfilled' ? oaiRes.value : []).map(url => ({ url, provider: 'openai' }));

    if (leoRes.status === 'rejected') console.error(`[/api/images:${key}] Leonardo`, leoRes.reason?.message);
    if (oaiRes.status === 'rejected') console.error(`[/api/images:${key}] OpenAI`, oaiRes.reason?.message);

    const merged = [];
    const max = Math.max(leoImgs.length, oaiImgs.length);
    for (let i = 0; i < max; i++) {
      if (leoImgs[i]) merged.push(leoImgs[i]);
      if (oaiImgs[i]) merged.push(oaiImgs[i]);
    }
    results[key] = merged;
  }));

  return res.status(200).json({ direction, results });
}

// ── FASE 1: GPT-4o mini produce la dirección estética (JSON) ────────
async function getArtDirection(brief, key) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `You are an elite art director. Given a brand brief, output ONLY a JSON object with:
{"colors": ["#hex1","#hex2","#hex3","#hex4"], "mood": "short mood phrase", "textures": "short texture/material phrase"}
Rules: colors must be a cohesive, ELEGANT, DIVERSE palette of 3-5 hex codes appropriate to the brand's industry and tone. Do NOT default to only black+gold or black+white — explore the full spectrum (jewel tones, warm neutrals, muted pastels, deep greens/blues/burgundies/terracottas, etc) unless the brief explicitly asks for monochrome. Be specific and original.` },
        { role: 'user', content: brief.slice(0, 600) },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenAI direction ${res.status}`);
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '{}';
  try { return JSON.parse(raw); } catch { return null; }
}

// ── Leonardo AI (Phoenix, alchemy) ──────────────────────────────────
async function generateLeonardo(set, count, key) {
  const genRes = await fetch('https://cloud.leonardo.ai/api/rest/v1/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      prompt: set.prompt,
      modelId: 'b24e16ff-06e3-43eb-8d33-4416c2d75876', // Leonardo Phoenix
      width: set.width || 768,
      height: set.height || 768,
      num_images: count,
      guidance_scale: 7,
      negative_prompt: 'low quality, blurry, amateur, watermark, text, signature, deformed',
      photoReal: false,
      alchemy: true,
    }),
  });

  if (!genRes.ok) {
    const err = await genRes.json().catch(() => ({}));
    throw new Error(err.error || `Leonardo ${genRes.status}`);
  }

  const { sdGenerationJob } = await genRes.json();
  const generationId = sdGenerationJob?.generationId;
  if (!generationId) throw new Error('No generation ID returned');

  for (let attempt = 0; attempt < 14; attempt++) {
    await new Promise(r => setTimeout(r, 2000));
    const pollRes = await fetch(
      `https://cloud.leonardo.ai/api/rest/v1/generations/${generationId}`,
      { headers: { 'Authorization': `Bearer ${key}` } }
    );
    if (!pollRes.ok) continue;
    const data = await pollRes.json();
    const gen = data.generations_by_pk;
    if (gen?.status === 'COMPLETE') {
      return (gen.generated_images || []).map(img => img.url);
    }
    if (gen?.status === 'FAILED') throw new Error('Leonardo generation failed');
  }
  throw new Error('Leonardo generation timed out');
}

// ── OpenAI (gpt-image-1) ─────────────────────────────────────────────
async function generateOpenAI(set, count, key) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: set.prompt,
      size: set.size || '1024x1024',
      n: count,
      quality: set.quality || 'high',
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenAI images ${res.status}`);
  }

  const data = await res.json();
  return (data.data || [])
    .map(d => d.url || (d.b64_json ? `data:image/png;base64,${d.b64_json}` : null))
    .filter(Boolean);
}
