/**
 * Local translate API.
 * Supports Cursor SDK. API key can come from:
 * - request body.apiKey / header x-cursor-api-key (from UI Settings)
 * - env CURSOR_API_KEY
 *
 * POST /api/translate
 * body (preferred): { mode: 'per-language', items, language, apiKey?, model? }
 * body (legacy):    { items, languages, apiKey?, model? }
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Agent, CursorAgentError } from '@cursor/sdk';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const app = express();
const PORT = process.env.TRANSLATE_PORT || 4310;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

function envKey() {
  return (process.env.CURSOR_API_KEY || '').trim();
}

function extractJson(text) {
  if (!text) throw new Error('Empty Cursor response');
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasCursorKey: !!envKey(),
    model: process.env.CURSOR_MODEL || 'composer-2.5',
    note: 'UI can also send apiKey in request body (AI Settings).',
  });
});

app.post('/api/translate', async (req, res) => {
  const apiKey =
    String(req.body?.apiKey || req.headers['x-cursor-api-key'] || envKey() || '').trim();

  if (!apiKey) {
    return res.status(400).json({
      ok: false,
      message:
        'No Cursor API key. Paste it in AI Settings (provider = Cursor), or set CURSOR_API_KEY in .env',
    });
  }

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const singleLang = req.body?.language || null;
  const languages = Array.isArray(req.body?.languages)
    ? req.body.languages
    : singleLang
      ? [singleLang]
      : [];

  if (!items.length || !languages.length) {
    return res.status(400).json({ ok: false, message: 'items and language(s) required' });
  }

  const modelId = String(req.body?.model || process.env.CURSOR_MODEL || 'composer-2.5');
  const perLanguage = req.body?.mode === 'per-language' || languages.length === 1;

  const prompt = perLanguage
    ? `You are a travel-platform UI localization engine.
Translate English UI strings into ${languages[0].name || 'the target language'} (${languages[0].code || ''}).
Rules:
- Keep placeholders like {0}, {{name}}, %s, HTML tags unchanged.
- Keep brand names unchanged.
- Return ONLY valid JSON, no markdown, no explanation.
- JSON shape: { "<itemId>": "<translated text>" }

language = ${JSON.stringify(languages[0])}
items = ${JSON.stringify(items.map((i) => ({ id: i.id, text: i.english })))}`
    : `You are a travel-platform UI localization engine.
Translate English UI strings into the listed languages.
Rules:
- Keep placeholders like {0}, {{name}}, %s, HTML tags unchanged.
- Keep brand names unchanged.
- Return ONLY valid JSON, no markdown, no explanation.
- JSON shape: { "<itemId>": { "<languageId>": "<translated text>" } }

languages = ${JSON.stringify(languages)}
items = ${JSON.stringify(items.map((i) => ({ id: i.id, text: i.english })))}`;

  try {
    const result = await Agent.prompt(prompt, {
      apiKey,
      model: { id: modelId },
      local: { cwd: root },
    });

    if (result.status === 'error') {
      return res.status(502).json({
        ok: false,
        message: `Cursor agent run failed (${result.id || 'no-id'}). Check API key / model.`,
      });
    }

    const translations = extractJson(result.result || '');
    return res.json({ ok: true, translations, provider: 'cursor', mode: perLanguage ? 'per-language' : 'multi' });
  } catch (err) {
    const msg =
      err instanceof CursorAgentError
        ? `Cursor auth/config: ${err.message}`
        : err?.message || 'Translate failed';
    return res.status(500).json({ ok: false, message: msg });
  }
});

// Production: serve Angular build from same origin (Render / Railway / Docker).
const distDir = path.join(root, 'dist', 'LanguageKeyBulkTool', 'browser');
app.use(express.static(distDir));
app.get(/^(?!\/api).*/, (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  res.sendFile(path.join(distDir, 'index.html'), (err) => {
    if (err) next();
  });
});

const listenPort = process.env.PORT || PORT;
app.listen(listenPort, () => {
  console.log(`[translate-server] http://localhost:${listenPort}`);
  console.log(
    `[translate-server] env CURSOR_API_KEY: ${envKey() ? 'set' : 'not set (UI Settings key OK)'}`,
  );
});
