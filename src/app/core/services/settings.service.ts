import { Injectable, computed, signal } from '@angular/core';
import { AiProvider, AiSettings } from '../models';

const STORAGE_KEY = 'lkb_ai_settings_v3';

const DEFAULTS: AiSettings = {
  provider: 'free',
  openAiApiKey: '',
  geminiApiKey: '',
  cursorApiKey: '',
  openAiModel: 'gpt-4o-mini',
  geminiModel: 'gemini-2.0-flash',
  cursorModel: 'composer-2.5',
};

@Injectable({ providedIn: 'root' })
export class SettingsService {
  readonly settings = signal<AiSettings>(this.load());

  readonly statusLabel = computed(() => {
    const s = this.settings();
    if (s.provider === 'free') return 'Built-in Free Translator ready (no key)';
    const key = this.activeKey();
    if (!key) return `No ${s.provider.toUpperCase()} key — open AI Settings`;
    return `${s.provider.toUpperCase()} key ready`;
  });

  readonly hasActiveKey = computed(() => {
    if (this.settings().provider === 'free') return true;
    return !!this.activeKey();
  });

  private load(): AiSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return this.normalize({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<AiSettings>) });
      }
      const old = localStorage.getItem('lkb_ai_settings_v2');
      if (old) {
        const parsed = JSON.parse(old) as Partial<AiSettings>;
        return this.normalize({ ...DEFAULTS, ...parsed, provider: parsed.provider || 'free' });
      }
    } catch {
      /* ignore */
    }
    return { ...DEFAULTS };
  }

  save(partial: Partial<AiSettings>): void {
    const next = this.normalize({ ...this.settings(), ...partial });
    this.settings.set(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  private normalize(s: AiSettings): AiSettings {
    const provider = (s.provider || DEFAULTS.provider) as AiProvider;
    return {
      ...s,
      provider: ['free', 'openai', 'gemini', 'cursor'].includes(provider) ? provider : 'free',
      openAiApiKey: (s.openAiApiKey || '').trim(),
      geminiApiKey: (s.geminiApiKey || '').trim(),
      cursorApiKey: (s.cursorApiKey || '').trim(),
      openAiModel: (s.openAiModel || '').trim() || DEFAULTS.openAiModel,
      geminiModel: (s.geminiModel || '').trim() || DEFAULTS.geminiModel,
      cursorModel: (s.cursorModel || '').trim() || DEFAULTS.cursorModel,
    };
  }

  activeKey(): string {
    const s = this.settings();
    if (s.provider === 'free') return 'free';
    if (s.provider === 'gemini') return (s.geminiApiKey || '').trim();
    if (s.provider === 'cursor') return (s.cursorApiKey || '').trim();
    return (s.openAiApiKey || '').trim();
  }

  activeModel(): string {
    const s = this.normalize(this.settings());
    if (s.provider === 'gemini') return s.geminiModel;
    if (s.provider === 'cursor') return s.cursorModel;
    if (s.provider === 'openai') return s.openAiModel;
    return 'free-gtx';
  }
}
