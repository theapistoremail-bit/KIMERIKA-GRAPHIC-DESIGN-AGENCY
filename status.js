/**
 * GET /api/status
 * Verifica qué providers están activos (sin exponer las keys).
 * El cliente puede llamar esto al cargar para mostrar qué está disponible.
 */

export default function handler(req, res) {
  const providers = {
    anthropic: {
      active: !!process.env.CLAUDEAPIKEY,
      models:  ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
      label:   'Claude AI — Anthropic',
    },
    openai: {
      active: !!process.env.OPENAPIKEY,
      models:  ['gpt-4o', 'gpt-4o-mini'],
      label:   'GPT-4o — OpenAI',
    },
    deepseek: {
      active: !!process.env.DEEPSEAK,
      models:  ['deepseek-chat'],
      label:   'DeepSeek Chat',
    },
    leonardo: {
      active: !!process.env.LEONARDO,
      label:   'Leonardo AI — Images',
    },
    meshy: {
      active: !!process.env.MESHI,
      label:   'Meshy AI — 3D Generation',
    },
  };

  return res.status(200).json({
    ok: true,
    providers,
    activeCount: Object.values(providers).filter(p => p.active).length,
  });
}
