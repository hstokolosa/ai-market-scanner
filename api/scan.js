const schemaHint = `Return JSON with query, generatedAt, products, summary. Each product must include name, website, description, consumerAudience, payer, problemSolved, businessModel, pricing, evidence, and unknowns. Every pricing item needs sourceUrl, quote, checkedAt. Every claim must have evidence. Use unknown rather than inventing data.`;

export const maxDuration = 180;

function productSchema() {
  return {
    type: 'object',
    properties: {
      name: { type: 'string' }, website: { type: 'string' }, description: { type: 'string' },
      consumerAudience: { type: 'string' }, payer: { type: 'string' }, problemSolved: { type: 'string' }, businessModel: { type: 'string' },
      pricing: { type: 'array', items: { type: 'object', properties: {
        plan: { type: 'string' }, price: { type: 'string' }, billingPeriod: { type: 'string' }, sourceUrl: { type: 'string' }, quote: { type: 'string' }, checkedAt: { type: 'string' }
      }, required: ['plan', 'price', 'billingPeriod', 'sourceUrl', 'quote', 'checkedAt'], additionalProperties: false } },
      evidence: { type: 'array', items: { type: 'object', properties: {
        claim: { type: 'string' }, sourceUrl: { type: 'string' }, quote: { type: 'string' }, type: { type: 'string', enum: ['fact', 'estimate', 'hypothesis'] }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
      }, required: ['claim', 'sourceUrl', 'quote', 'type', 'confidence'], additionalProperties: false } },
      unknowns: { type: 'array', items: { type: 'string' } }
    },
    required: ['name', 'website', 'description', 'consumerAudience', 'payer', 'problemSolved', 'businessModel', 'pricing', 'evidence', 'unknowns'],
    additionalProperties: false
  };
}

function responseSchema() {
  return { type: 'object', properties: {
    query: { type: 'string' }, generatedAt: { type: 'string' },
    products: { type: 'array', items: productSchema() },
    summary: { type: 'object', properties: {
      marketPattern: { type: 'string' }, pricingPattern: { type: 'string' }, audiencePattern: { type: 'string' }, caveats: { type: 'array', items: { type: 'string' } }
    }, required: ['marketPattern', 'pricingPattern', 'audiencePattern', 'caveats'], additionalProperties: false }
  }, required: ['query', 'generatedAt', 'products', 'summary'], additionalProperties: false };
}

function send(res, status, body) {
  res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Method not allowed' });
  }

  const body = req.body || {};
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  const limit = Math.min(Math.max(Number(body.limit) || 10, 1), 10);
  if (query.length < 8) return send(res, 400, { error: 'Query must be at least 8 characters long' });
  if (!process.env.OPENAI_API_KEY) return send(res, 503, { error: 'OPENAI_API_KEY is not configured in Vercel Environment Variables' });

  const filters = JSON.stringify(body.filters || {});
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-6-luna',
        tools: [{ type: 'web_search_preview' }],
        input: `Research this market: ${query}. Filters: ${filters}. Find up to ${limit} relevant products. ${schemaHint}`,
        text: { format: { type: 'json_schema', name: 'market_scan', strict: true, schema: responseSchema() } }
      })
    });
    if (!response.ok) {
      const raw = await response.text();
      let message = raw;
      try { message = JSON.parse(raw)?.error?.message || raw; } catch { /* keep raw response */ }
      return send(res, response.status, { error: `OpenAI request failed: ${message}` });
    }
    const raw = await response.json();
    const text = raw.output_text || raw.output?.find(x => x.type === 'message')?.content?.find(x => x.type === 'output_text')?.text;
    if (!text) return send(res, 502, { error: 'OpenAI returned no structured output' });
    return send(res, 200, JSON.parse(text));
  } catch (error) {
    if (error?.name === 'AbortError') return send(res, 504, { error: 'Market scan timed out after 180 seconds' });
    return send(res, 500, { error: error?.message || 'Unexpected server error' });
  } finally {
    clearTimeout(timeout);
  }
}
