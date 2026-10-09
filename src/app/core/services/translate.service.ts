import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { LanguageItem } from '../models';
import { resolveLangCode } from './lang-code.util';
import { SettingsService } from './settings.service';

export interface TranslateBatchItem {
  id: string;
  english: string;
}

/** itemId → languageId → text */
export type TranslateBatchResult = Record<string, Record<string, string>>;

/** Flat map for one language: itemId → text */
export type LangTranslateMap = Record<string, string>;

export interface TranslateProgress {
  languageName: string;
  languageIndex: number;
  languageTotal: number;
  keysDone: number;
  keysTotal: number;
  batchIndex: number;
  batchTotal: number;
}

@Injectable({ providedIn: 'root' })
export class TranslateService {
  private readonly http = inject(HttpClient);
  private readonly settings = inject(SettingsService);

  isEnglish(lang: LanguageItem): boolean {
    const name = (lang.LanguageName || '').toLowerCase();
    const code = (lang.LanguageCode || lang.ISOCode || '').toLowerCase();
    return name.includes('english') || code === 'en' || code === 'eng';
  }

  /**
   * Bulk translate: one AI request per language (chunked for large lists).
   * Response is mapped by item id → language id.
   */
  async translateBatch(
    items: TranslateBatchItem[],
    targetLanguages: LanguageItem[],
    onProgress?: (p: TranslateProgress) => void,
    onChunkMapped?: (langId: string, map: LangTranslateMap) => void,
  ): Promise<TranslateBatchResult> {
    const nonEnglish = targetLanguages.filter((l) => !this.isEnglish(l));
    if (!items.length || !nonEnglish.length) return {};

    const out: TranslateBatchResult = {};
    for (const item of items) out[item.id] = {};

    const provider = this.settings.settings().provider;
    if (provider === 'free') {
      return this.translateWithFreeGoogle(items, nonEnglish, onProgress, onChunkMapped);
    }

    const key = this.settings.activeKey();
    if (!key || key === 'free') {
      throw new Error('No AI API key set. Switch to Built-in Free, or paste a key in AI Settings.');
    }

    try {
      await this.translatePerLanguage(
        items,
        nonEnglish,
        provider,
        key,
        out,
        onProgress,
        onChunkMapped,
      );
      return out;
    } catch (err) {
      console.warn('[translate] paid provider failed, falling back to free', err);
      const free = await this.translateWithFreeGoogle(items, nonEnglish, onProgress, onChunkMapped);
      (free as any).__fallbackFrom = provider;
      return free;
    }
  }

  private async translatePerLanguage(
    items: TranslateBatchItem[],
    languages: LanguageItem[],
    provider: string,
    apiKey: string,
    out: TranslateBatchResult,
    onProgress?: (p: TranslateProgress) => void,
    onChunkMapped?: (langId: string, map: LangTranslateMap) => void,
  ): Promise<void> {
    const batchSize = this.optimalBatchSize(items);
    const concurrency = Math.max(1, environment.translateLangConcurrency || 2);
    let langIndex = 0;

    const workers = Array.from({ length: Math.min(concurrency, languages.length) }, async () => {
      while (langIndex < languages.length) {
        const i = langIndex++;
        const lang = languages[i];
        const chunks = this.chunk(items, batchSize);

        for (let b = 0; b < chunks.length; b++) {
          const chunkItems = chunks[b];
          onProgress?.({
            languageName: lang.LanguageName,
            languageIndex: i + 1,
            languageTotal: languages.length,
            keysDone: b * batchSize,
            keysTotal: items.length,
            batchIndex: b + 1,
            batchTotal: chunks.length,
          });

          const flat = await this.translateLanguageChunk(chunkItems, lang, provider, apiKey);
          const mapped: LangTranslateMap = {};
          for (const item of chunkItems) {
            const text = flat[item.id];
            if (text != null && String(text).trim()) {
              const clean = String(text).trim();
              out[item.id][lang.LanguageMasterID] = clean;
              mapped[item.id] = clean;
            }
          }
          if (Object.keys(mapped).length) {
            onChunkMapped?.(lang.LanguageMasterID, mapped);
          }

          onProgress?.({
            languageName: lang.LanguageName,
            languageIndex: i + 1,
            languageTotal: languages.length,
            keysDone: Math.min((b + 1) * batchSize, items.length),
            keysTotal: items.length,
            batchIndex: b + 1,
            batchTotal: chunks.length,
          });
        }
      }
    });

    await Promise.all(workers);
  }

  private async translateLanguageChunk(
    items: TranslateBatchItem[],
    lang: LanguageItem,
    provider: string,
    apiKey: string,
  ): Promise<LangTranslateMap> {
    if (provider === 'openai') return this.translateWithOpenAi(items, lang, apiKey);
    if (provider === 'gemini') return this.translateWithGemini(items, lang, apiKey);
    return this.translateWithCursor(items, lang, apiKey);
  }

  /** Adaptive chunk size: short UI strings → larger batches; long copy → smaller. */
  optimalBatchSize(items: TranslateBatchItem[]): number {
    const configured = Math.max(10, environment.translateBatchSize || 80);
    if (!items.length) return configured;
    const avg =
      items.reduce((sum, i) => sum + (i.english?.length || 0), 0) / Math.max(items.length, 1);
    if (avg > 220) return Math.min(configured, 35);
    if (avg > 120) return Math.min(configured, 50);
    if (avg > 60) return Math.min(configured, 70);
    return configured;
  }

  private async translateWithFreeGoogle(
    items: TranslateBatchItem[],
    languages: LanguageItem[],
    onProgress?: (p: TranslateProgress) => void,
    onChunkMapped?: (langId: string, map: LangTranslateMap) => void,
  ): Promise<TranslateBatchResult> {
    const out: TranslateBatchResult = {};
    for (const item of items) out[item.id] = {};

    const concurrency = Math.max(3, environment.freeTranslateConcurrency || 6);

    for (let li = 0; li < languages.length; li++) {
      const lang = languages[li];
      const tl = resolveLangCode(lang);
      onProgress?.({
        languageName: lang.LanguageName,
        languageIndex: li + 1,
        languageTotal: languages.length,
        keysDone: 0,
        keysTotal: items.length,
        batchIndex: 1,
        batchTotal: 1,
      });

      if (!tl || tl.toLowerCase() === 'en') {
        const mapped: LangTranslateMap = {};
        for (const item of items) {
          out[item.id][lang.LanguageMasterID] = item.english;
          mapped[item.id] = item.english;
        }
        onChunkMapped?.(lang.LanguageMasterID, mapped);
        continue;
      }

      let done = 0;
      let index = 0;
      const mapped: LangTranslateMap = {};
      const runners = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
        while (index < items.length) {
          const i = index++;
          const item = items[i];
          try {
            const text = await this.freeTranslate(item.english, tl);
            out[item.id][lang.LanguageMasterID] = text;
            mapped[item.id] = text;
          } catch {
            /* leave empty for manual edit */
          }
          done++;
          if (done % 5 === 0 || done === items.length) {
            onProgress?.({
              languageName: lang.LanguageName,
              languageIndex: li + 1,
              languageTotal: languages.length,
              keysDone: done,
              keysTotal: items.length,
              batchIndex: 1,
              batchTotal: 1,
            });
          }
          await new Promise((r) => setTimeout(r, 80));
        }
      });
      await Promise.all(runners);
      if (Object.keys(mapped).length) {
        onChunkMapped?.(lang.LanguageMasterID, mapped);
      }
    }

    return out;
  }

  private async freeTranslate(text: string, targetLang: string): Promise<string> {
    if (!text?.trim()) return '';
    const tl = targetLang.toLowerCase().startsWith('zh') ? 'zh-CN' : targetLang;
    try {
      return await this.myMemoryTranslate(text, tl);
    } catch {
      return this.gtxTranslate(text, tl);
    }
  }

  private async myMemoryTranslate(text: string, targetLang: string): Promise<string> {
    const q = encodeURIComponent(text.slice(0, 450));
    const path = `/get?q=${q}&langpair=en|${encodeURIComponent(targetLang)}`;
    const url = environment.useProxy
      ? `/mymemory-api${path}`
      : `https://api.mymemory.translated.net${path}`;

    const res = await firstValueFrom(this.http.get<any>(url));
    const translated = res?.responseData?.translatedText;
    if (res?.responseStatus === 200 && translated && !String(translated).includes('MYMEMORY WARNING')) {
      return String(translated).trim();
    }
    throw new Error(res?.responseDetails || 'MyMemory failed');
  }

  private async gtxTranslate(text: string, targetLang: string): Promise<string> {
    const q = encodeURIComponent(text);
    const path = `/translate_a/single?client=gtx&sl=en&tl=${encodeURIComponent(targetLang)}&dt=t&q=${q}`;
    const url = environment.useProxy ? `/gtx-api${path}` : `https://translate.googleapis.com${path}`;

    const res = await firstValueFrom(this.http.get<any>(url));
    if (Array.isArray(res?.[0])) {
      return res[0]
        .map((chunk: any) => (Array.isArray(chunk) ? chunk[0] : ''))
        .join('')
        .trim();
    }
    throw new Error(`Free translate failed for ${targetLang}`);
  }

  private langMeta(lang: LanguageItem) {
    return {
      id: lang.LanguageMasterID,
      name: lang.LanguageName,
      code: resolveLangCode(lang) || '',
    };
  }

  private bulkPrompt(lang: LanguageItem, items: TranslateBatchItem[]): string {
    const meta = this.langMeta(lang);
    return `You are a travel-platform UI localization engine.
Translate the English UI strings below into ${meta.name} (${meta.code || 'target language'}).
Rules:
- Keep placeholders like {0}, {{name}}, %s, HTML tags and brand names unchanged.
- Return ONLY valid JSON (no markdown, no explanation).
- JSON shape must be a flat object: { "<itemId>": "<translated text>" }
- Include every item id exactly once.

language = ${JSON.stringify(meta)}
items = ${JSON.stringify(items.map((i) => ({ id: i.id, text: i.english })))}`;
  }

  private async translateWithOpenAi(
    items: TranslateBatchItem[],
    lang: LanguageItem,
    apiKey: string,
  ): Promise<LangTranslateMap> {
    const model = this.settings.activeModel();
    const url = environment.useProxy
      ? '/openai-api/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';

    const res = await firstValueFrom(
      this.http.post<any>(
        url,
        {
          model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `You translate English UI strings into one target language.
Return ONLY JSON: { "<itemId>": "<translated text>" }. Keep placeholders and brand names unchanged.`,
            },
            {
              role: 'user',
              content: this.bulkPrompt(lang, items),
            },
          ],
        },
        {
          headers: new HttpHeaders({
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          }),
        },
      ),
    );
    return this.parseLangResult(res?.choices?.[0]?.message?.content, lang.LanguageMasterID, items);
  }

  private async translateWithGemini(
    items: TranslateBatchItem[],
    lang: LanguageItem,
    apiKey: string,
  ): Promise<LangTranslateMap> {
    const candidates = [
      this.settings.activeModel(),
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-1.5-flash-latest',
      'gemini-pro',
    ].filter((m, i, arr) => !!m?.trim() && arr.indexOf(m) === i);

    const prompt = this.bulkPrompt(lang, items);
    let lastError: unknown;

    for (const model of candidates) {
      const path = `/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const url = environment.useProxy
        ? `/gemini-api${path}?key=${encodeURIComponent(apiKey)}`
        : `https://generativelanguage.googleapis.com${path}?key=${encodeURIComponent(apiKey)}`;
      try {
        const res = await firstValueFrom(
          this.http.post<any>(url, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2,
              responseMimeType: 'application/json',
            },
          }),
        );
        if (model !== this.settings.settings().geminiModel) {
          this.settings.save({ geminiModel: model });
        }
        return this.parseLangResult(
          res?.candidates?.[0]?.content?.parts?.[0]?.text,
          lang.LanguageMasterID,
          items,
        );
      } catch (e) {
        lastError = e;
        if (e instanceof HttpErrorResponse && (e.status === 404 || e.status === 400)) {
          continue;
        }
        throw new Error(this.httpErr(e, 'Gemini'));
      }
    }
    throw new Error(this.httpErr(lastError, 'Gemini'));
  }

  private async translateWithCursor(
    items: TranslateBatchItem[],
    lang: LanguageItem,
    apiKey: string,
  ): Promise<LangTranslateMap> {
    const res = await firstValueFrom(
      this.http.post<{
        ok: boolean;
        translations?: TranslateBatchResult | LangTranslateMap;
        message?: string;
      }>(`${environment.cursorTranslateUrl}/api/translate`, {
        mode: 'per-language',
        items: items.map((i) => ({ id: i.id, english: i.english })),
        language: this.langMeta(lang),
        languages: [this.langMeta(lang)],
        apiKey,
        model: this.settings.activeModel(),
      }),
    );
    if (!res?.ok || !res.translations) {
      throw new Error(res?.message || 'Cursor translate failed');
    }
    return this.normalizeLangMap(res.translations, lang.LanguageMasterID, items);
  }

  /** Accept flat map, nested map, array rows, or { translations }. */
  private parseLangResult(
    content: string,
    languageId: string,
    items: TranslateBatchItem[],
  ): LangTranslateMap {
    if (!content) throw new Error('Empty AI response');
    let text = content.trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) text = text.slice(start, end + 1);

    // Array form: [{id, text}]
    if (text.trimStart().startsWith('[')) {
      const arr = JSON.parse(text);
      return this.normalizeLangMap(arr, languageId, items);
    }

    const parsed = JSON.parse(text);
    return this.normalizeLangMap(parsed, languageId, items);
  }

  private normalizeLangMap(
    raw: unknown,
    languageId: string,
    items: TranslateBatchItem[],
  ): LangTranslateMap {
    const out: LangTranslateMap = {};
    if (!raw) return out;

    let data: unknown = raw;
    if (typeof raw === 'object' && raw && 'translations' in (raw as object)) {
      data = (raw as { translations: unknown }).translations;
    }

    if (Array.isArray(data)) {
      for (const row of data) {
        if (!row || typeof row !== 'object') continue;
        const id = String((row as any).id ?? (row as any).itemId ?? '');
        const text = String(
          (row as any).text ?? (row as any).translation ?? (row as any).value ?? '',
        ).trim();
        if (id && text) out[id] = text;
      }
      // Order fallback if ids missing
      if (!Object.keys(out).length && data.length === items.length) {
        data.forEach((row, i) => {
          const text =
            typeof row === 'string'
              ? row
              : String((row as any)?.text ?? (row as any)?.translation ?? '').trim();
          if (text) out[items[i].id] = text;
        });
      }
      return out;
    }

    if (typeof data !== 'object' || !data) return out;

    for (const [itemId, value] of Object.entries(data as Record<string, unknown>)) {
      if (value == null) continue;
      if (typeof value === 'string') {
        out[itemId] = value.trim();
        continue;
      }
      if (typeof value === 'object') {
        const nested = value as Record<string, unknown>;
        const byLang = nested[languageId];
        if (typeof byLang === 'string' && byLang.trim()) {
          out[itemId] = byLang.trim();
          continue;
        }
        const first = Object.values(nested).find((v) => typeof v === 'string' && String(v).trim());
        if (typeof first === 'string') out[itemId] = first.trim();
      }
    }
    return out;
  }

  private httpErr(e: unknown, provider: string): string {
    if (e instanceof HttpErrorResponse) {
      const body = e.error;
      const msg =
        (typeof body === 'object' &&
          body &&
          (body.message || body.error?.message || body.error)) ||
        (typeof body === 'string' ? body : '') ||
        e.message;
      return `${provider}: ${msg || e.statusText || 'request failed'} (${e.status})`;
    }
    return e instanceof Error ? e.message : `${provider} failed`;
  }

  chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    const n = Math.max(1, size);
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }
}
