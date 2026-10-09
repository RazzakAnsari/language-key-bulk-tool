export interface LoginDetails {
  FirstName: string;
  LastLogin: string;
  IsLoggedIn: boolean;
  StaffId: string;
  StaffEmailId: string;
}

export interface LovItem {
  lov_id: string;
  lov_key: string;
  item_to_display: string;
  item_order?: number;
}

export interface LanguageItem {
  LanguageMasterID: string;
  LanguageName: string;
  LanguageCode?: string;
  ISOCode?: string;
}

export interface CmsPageLegacy {
  PageId: string;
  PageKey: string;
}

export type RowStatus =
  | 'draft'
  | 'translating'
  | 'translated'
  | 'error'
  | 'saving'
  | 'saved'
  | 'save_error';

export interface TranslationMap {
  [languageId: string]: string;
}

export interface BulkKeyRow {
  id: string;
  key: string;
  englishContent: string;
  translations: TranslationMap;
  selected: boolean;
  status: RowStatus;
  message?: string;
  cmsId?: string;
}

export type AiProvider = 'free' | 'openai' | 'gemini' | 'cursor';

export interface AiSettings {
  provider: AiProvider;
  openAiApiKey: string;
  geminiApiKey: string;
  cursorApiKey: string;
  openAiModel: string;
  geminiModel: string;
  cursorModel: string;
}

export type WizardStep = 1 | 2 | 3 | 4;
