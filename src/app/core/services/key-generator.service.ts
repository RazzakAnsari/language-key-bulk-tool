import { Injectable } from '@angular/core';
import { BulkKeyRow } from '../models';

export interface ReferencePattern {
  prefix: string;
  separator: string;
  caseStyle: 'lower' | 'upper' | 'pascal' | 'camel';
}

/** Leading fillers only — mid-phrase words like your/is stay for short natural keys. */
const LEAD_FILLER = new Set([
  'a',
  'an',
  'the',
  'please',
  'kindly',
  'click',
  'tap',
  'press',
  'here',
  'now',
  'to',
  'for',
  'from',
]);

@Injectable({ providedIn: 'root' })
export class KeyGeneratorService {
  /**
   * Detect prefix/separator/case from one reference key.
   * k_referKeys → prefix k_, camel
   * btn_continue → prefix btn_, lower
   */
  analyzeReference(referenceKey: string): ReferencePattern {
    const key = (referenceKey || '').trim();
    if (!key) {
      return { prefix: 'k_', separator: '_', caseStyle: 'camel' };
    }

    let separator = '_';
    if (key.includes('.') && !key.includes('_')) separator = '.';
    else if (key.includes('-') && !key.includes('_')) separator = '-';
    else if (key.includes('_')) separator = '_';

    const parts = key.split(separator).filter(Boolean);
    let prefix = '';
    let sample = key;

    if (parts.length >= 2) {
      // Short category prefix (k, btn, lbl, msg…) — keep only first segment
      if (parts[0].length <= 5) {
        prefix = parts[0] + separator;
        sample = parts.slice(1).join(separator);
      } else {
        prefix = parts.slice(0, -1).join(separator) + separator;
        sample = parts[parts.length - 1] || key;
      }
    }

    return { prefix, separator, caseStyle: this.detectCaseStyle(sample) };
  }

  /**
   * Short shortcut slug from English.
   * "Print itinerary" → printItinerary (camel)
   * "Your booking is confirmed…" → yourBookingIs
   */
  slugFromEnglish(english: string, pattern: ReferencePattern, maxLen = 28): string {
    const words = this.shortcutWords(english);
    if (!words.length) return this.applyCase(['key'], pattern);

    let slug = this.applyCase(words, pattern);

    if (slug.length > maxLen) {
      // Drop last words until it fits, keep at least one
      let trimmed = [...words];
      while (trimmed.length > 1 && this.applyCase(trimmed, pattern).length > maxLen) {
        trimmed = trimmed.slice(0, -1);
      }
      slug = this.applyCase(trimmed, pattern);
      if (slug.length > maxLen) {
        slug = slug.slice(0, maxLen).replace(/[^a-zA-Z0-9]+$/g, '');
      }
    }
    return slug || 'key';
  }

  keyFromReference(english: string, referenceKey: string): string {
    const pattern = this.analyzeReference(referenceKey);
    return `${pattern.prefix}${this.slugFromEnglish(english, pattern)}`;
  }

  ensureUnique(keys: string[]): string[] {
    const seen = new Map<string, number>();
    return keys.map((base) => {
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      return count === 0 ? base : `${base}_${count + 1}`;
    });
  }

  /**
   * Build rows from English lines using one reference key style.
   * Lines can still override with key|text if needed.
   */
  buildFromReference(
    rawTexts: string,
    referenceKey: string,
    existingKeys: string[] = [],
  ): BulkKeyRow[] {
    const lines = rawTexts
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const englishList: string[] = [];
    const keyHints: Array<string | null> = [];

    for (const line of lines) {
      if (line.includes('|') || line.includes('\t')) {
        const sep = line.includes('|') ? '|' : '\t';
        const [k, ...rest] = line.split(sep);
        const english = rest.join(sep).trim();
        if (!english) continue;
        keyHints.push(k.trim() || null);
        englishList.push(english);
      } else {
        keyHints.push(null);
        englishList.push(line);
      }
    }

    const generated = this.ensureUnique([
      ...existingKeys,
      ...englishList.map((e, i) => keyHints[i] || this.keyFromReference(e, referenceKey)),
    ]).slice(existingKeys.length);

    return englishList.map((english, i) => ({
      id: `${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`,
      key: generated[i],
      englishContent: english,
      translations: {},
      selected: true,
      status: 'draft' as const,
    }));
  }

  private detectCaseStyle(sample: string): ReferencePattern['caseStyle'] {
    if (!sample) return 'camel';
    if (sample === sample.toUpperCase() && /[A-Z]/.test(sample)) return 'upper';
    if (/^[A-Z][a-z0-9]*([A-Z][a-z0-9]*)+$/.test(sample)) return 'pascal';
    // camelCase: starts lower, has an upper later (testKeys, printItinerary)
    if (/^[a-z][a-z0-9]*[A-Z]/.test(sample)) return 'camel';
    if (/^[A-Z]/.test(sample) && sample !== sample.toLowerCase() && !sample.includes('_')) {
      return 'pascal';
    }
    return 'lower';
  }

  /** Pick a few leading words so long sentences become short keys. */
  private shortcutWords(english: string): string[] {
    const raw = (english || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/['’]/g, '');

    const tokens = raw.match(/[a-zA-Z0-9]+/g) || [];
    if (!tokens.length) return ['key'];

    let start = 0;
    while (start < tokens.length && LEAD_FILLER.has(tokens[start].toLowerCase())) {
      start++;
    }
    const words = (start < tokens.length ? tokens.slice(start) : tokens).map((w) =>
      w.toLowerCase(),
    );

    // Longer source text → fewer words (keep keys short)
    const len = (english || '').trim().length;
    let maxWords = 3;
    if (len > 70) maxWords = 2;
    else if (len <= 18) maxWords = Math.min(4, words.length);

    return words.slice(0, Math.min(maxWords, words.length));
  }

  private applyCase(words: string[], pattern: ReferencePattern): string {
    const clean = words.map((w) => w.replace(/[^a-zA-Z0-9]/g, '')).filter(Boolean);
    if (!clean.length) return 'key';

    if (pattern.caseStyle === 'upper') {
      return clean.join(pattern.separator).toUpperCase();
    }
    if (pattern.caseStyle === 'pascal') {
      return clean.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
    }
    if (pattern.caseStyle === 'camel') {
      return clean
        .map((w, i) =>
          i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
        )
        .join('');
    }
    // snake / lower with separator
    return clean.map((w) => w.toLowerCase()).join(pattern.separator);
  }
}
