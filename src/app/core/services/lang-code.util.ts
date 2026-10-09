import { LanguageItem } from '../models';

/** Map CMS language names → ISO codes for free Google translate */
const NAME_TO_ISO: Record<string, string> = {
  english: 'en',
  arabic: 'ar',
  hindi: 'hi',
  french: 'fr',
  german: 'de',
  spanish: 'es',
  italian: 'it',
  portuguese: 'pt',
  russian: 'ru',
  chinese: 'zh-CN',
  'chinese (simplified)': 'zh-CN',
  'chinese (traditional)': 'zh-TW',
  japanese: 'ja',
  korean: 'ko',
  turkish: 'tr',
  dutch: 'nl',
  polish: 'pl',
  swedish: 'sv',
  norwegian: 'no',
  danish: 'da',
  finnish: 'fi',
  greek: 'el',
  hebrew: 'he',
  thai: 'th',
  vietnamese: 'vi',
  indonesian: 'id',
  malay: 'ms',
  urdu: 'ur',
  bengali: 'bn',
  tamil: 'ta',
  telugu: 'te',
  marathi: 'mr',
  gujarati: 'gu',
  kannada: 'kn',
  malayalam: 'ml',
  punjabi: 'pa',
  persian: 'fa',
  farsi: 'fa',
  ukrainian: 'uk',
  czech: 'cs',
  hungarian: 'hu',
  romanian: 'ro',
  bulgarian: 'bg',
  croatian: 'hr',
  serbian: 'sr',
  slovak: 'sk',
  slovenian: 'sl',
  catalan: 'ca',
  filipino: 'tl',
  tagalog: 'tl',
  swahili: 'sw',
  afrikaans: 'af',
};

export function resolveLangCode(lang: LanguageItem): string | null {
  const code = (lang.LanguageCode || lang.ISOCode || '').trim();
  if (code && code.length <= 10 && !code.includes(' ')) {
    return code.toLowerCase() === 'zh' ? 'zh-CN' : code;
  }
  const name = (lang.LanguageName || '').trim().toLowerCase();
  if (!name) return null;
  if (NAME_TO_ISO[name]) return NAME_TO_ISO[name];
  for (const [k, v] of Object.entries(NAME_TO_ISO)) {
    if (name.includes(k)) return v;
  }
  return null;
}
