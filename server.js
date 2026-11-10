import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const dist = join(root, 'dist');
const port = Number(process.env.PORT || 5173);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const schemaHint = `Return JSON with query, generatedAt, products, summary. Each product must include name, website, description, consumerAudience, payer, problemSolved, businessModel, pricing, evidence, and unknowns. Every pricing item needs sourceUrl, quote, checkedAt. Every claim must have evidence. Use unknown rather than inventing data.`;

function validBody(body) { return body && typeof body.query === 'string' && body.query.trim().length >= 8 && Math.min(Number(body.limit) || 10, 10) > 0; }
async function scan(body) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const filters = JSON.stringify(body.filters || {});
  const productSchema = { type: 'object', properties: {
    name: { type: 'string' }, website: { type: 'string' }, description: { type: 'string' }, consumerAudience: { type: 'string' }, payer: { type: 'string' }, problemSolved: { type: 'string' }, businessModel: { type: 'string' },
    pricing: { type: 'array', items: { type: 'object', properties: { plan: { type: 'string' }, price: { type: 'string' }, billingPeriod: { type: 'string' }, sourceUrl: { type: 'string' }, quote: { type: 'string' }, checkedAt: { type: 'string' } }, required: ['plan', 'price', 'billingPeriod', 'sourceUrl', 'quote', 'checkedAt'], additionalProperties: false } },
    evidence: { type: 'array', items: { type: 'object', properties: { claim: { type: 'string' }, sourceUrl: { type: 'string' }, quote: { type: 'string' }, type: { type: 'string', enum: ['fact', 'estimate', 'hypothesis'] }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] } }, required: ['claim', 'sourceUrl', 'quote', 'type', 'confidence'], additionalProperties: false } },
    unknowns: { type: 'array', items: { type: 'string' } }
  }, required: ['name', 'website', 'description', 'consumerAudience', 'payer', 'problemSolved', 'businessModel', 'pricing', 'evidence', 'unknowns'], additionalProperties: false };
  const schema = { type: 'object', properties: {
    query: { type: 'string' }, generatedAt: { type: 'string' }, products: { type: 'array', items: productSchema },
    summary: { type: 'object', properties: { marketPattern: { type: 'string' }, pricingPattern: { type: 'string' }, audiencePattern: { type: 'string' }, caveats: { type: 'array', items: { type: 'string' } } }, required: ['marketPattern', 'pricingPattern', 'audiencePattern', 'caveats'], additionalProperties: false }
  }, required: ['query', 'generatedAt', 'products', 'summary'], additionalProperties: false };
  const abort = AbortSignal.timeout(180000);
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, signal: abort, body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-6-luna', tools: [{ type: 'web_search_preview' }], input: `Research this market: ${body.query}. Filters: ${filters}. Find up to ${Math.min(body.limit || 10, 10)} relevant products. ${schemaHint}`, text: { format: { type: 'json_schema', name: 'market_scan', strict: true, schema } } }) });
  if (!response.ok) {
    const details = await response.text();
    let message = details;
    try { message = JSON.parse(details)?.error?.message || details; } catch { /* keep raw response */ }
    throw new Error(`OpenAI request failed: ${response.status} — ${message}`);
  }
  const raw = await response.json(); const text = raw.output_text || raw.output?.find(x => x.type === 'message')?.content?.find(x => x.type === 'output_text')?.text; if (!text) throw new Error('No structured output'); return JSON.parse(text);
}
async function serve(path, res) { try { let target = join(dist, path === '/' ? 'index.html' : path); try { await stat(target); } catch { target = join(dist, 'index.html'); } const data = await readFile(target); res.writeHead(200, { 'Content-Type': mime[extname(target)] || 'text/plain' }); res.end(data); } catch { res.writeHead(404); res.end('Not found'); } }

async function start() {
  const isDev = process.env.NODE_ENV !== 'production';
  const vite = isDev ? await createViteServer({ server: { middlewareMode: true }, appType: 'spa' }) : null;
  const server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/scan') {
      let raw = '';
      req.on('data', chunk => { raw += chunk; if (raw.length > 100000) req.destroy(); });
      req.on('end', async () => {
        try {
          const body = JSON.parse(raw);
          if (!validBody(body)) throw new Error('Invalid query');
          const result = await scan(body);
          if (!result) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'OPENAI_API_KEY is not configured' })); return; }
          res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result));
        } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
      });
      return;
    }
    if (vite) return vite.middlewares(req, res, () => {});
    return serve(req.url?.split('?')[0] || '/', res);
  });
  server.listen(port, () => console.log(`Signal Scout running at http://localhost:${port}`));
}
start();
