import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { BulkKeyRow, CmsPageLegacy, LanguageItem, LovItem } from '../models';
import { ApiService } from './api.service';
import { TranslateService } from './translate.service';

export interface RmVerifyRow {
  language_key_name: string;
  short_key_name: string;
  LanguageText: string;
  selected_lang_text: string;
  LanguageKeyId?: string;
  selected_content_id?: string;
}

/** Shape posted to SaveCMSLanguageKey (Resource Manager) */
export interface SaveCmsLanguageKeyItem {
  application_id: string;
  product_id: string;
  module_id: string;
  page_id: string;
  short_key_name: string;
  language_key_name: string;
  language_content: Array<{ language_id: string; key_value: string }>;
}

@Injectable({ providedIn: 'root' })
export class CmsService {
  private readonly api = inject(ApiService);
  private readonly translate = inject(TranslateService);

  getLov(keys: string) {
    return this.api.masterGet<LovItem[]>(`/lov/GetLOVByKeys/${keys}`);
  }

  getAllLanguages() {
    return this.api.masterPost<LanguageItem[] | { respObj?: LanguageItem[] }>(
      '/LanguageMaster/GetAllLanguage',
      {},
    );
  }

  getLegacyPages() {
    return this.api.masterGet<CmsPageLegacy[]>('/LanguageFile/GetAllCMSPages');
  }

  getCMSContent(post: {
    ProjectID: string;
    ProductId: string;
    ModuleId: string;
    PageId: string;
    LanguageId: string;
  }) {
    return this.api.masterPost<{ respObj: RmVerifyRow[] }>('/LanguageFile/GetCMSContent', post);
  }

  /**
   * Same contract as Resource Manager list + Add:
   * product_id comes from selected PRODUCT LOV (not hardcoded).
   * ONE array → ONE SaveCMSLanguageKey call.
   */
  buildSavePayload(params: {
    projectId: string;
    productId: string;
    moduleId: string;
    pageId: string;
    rows: BulkKeyRow[];
    languages: LanguageItem[];
  }): { ok: true; formData: SaveCmsLanguageKeyItem[] } | { ok: false; errors: string[] } {
    const errors: string[] = [];
    const { projectId, productId, moduleId, pageId, languages } = params;

    if (!projectId?.trim()) errors.push('Project (application_id) required');
    if (!productId?.trim()) errors.push('Product required');
    if (!moduleId?.trim()) errors.push('Module required');
    if (!pageId?.trim()) errors.push('Page required');
    if (!languages?.length) errors.push('Languages not loaded');

    const selected = (params.rows || []).filter((r) => r.selected);
    if (!selected.length) errors.push('No rows selected');

    const seen = new Set<string>();
    const uniqueRows: BulkKeyRow[] = [];
    for (const row of selected) {
      const key = (row.key || '').trim();
      if (!key) {
        errors.push('Empty key found — fix before save');
        continue;
      }
      const norm = key.toLowerCase();
      if (seen.has(norm)) continue;
      seen.add(norm);
      uniqueRows.push({ ...row, key });
    }

    if (errors.length) return { ok: false, errors };
    if (!uniqueRows.length) return { ok: false, errors: ['No valid keys to save'] };

    const formData: SaveCmsLanguageKeyItem[] = [];

    for (const row of uniqueRows) {
      const english = (row.englishContent || '').trim();
      if (!english) {
        errors.push(`English missing for key: ${row.key}`);
        continue;
      }

      const language_content: Array<{ language_id: string; key_value: string }> = [];

      for (const lang of languages) {
        const language_id = lang.LanguageMasterID;
        if (!language_id) {
          errors.push(`Invalid language (missing LanguageMasterID): ${lang.LanguageName}`);
          continue;
        }

        const isEn = this.translate.isEnglish(lang);
        const key_value = isEn
          ? english
          : (row.translations[language_id] || '').trim();

        if (!key_value) {
          errors.push(
            `Missing "${lang.LanguageName}" text for key: ${row.key}. Complete translate/review first.`,
          );
          continue;
        }

        language_content.push({ language_id, key_value });
      }

      if (language_content.length !== languages.length) continue;

      formData.push({
        application_id: projectId,
        product_id: productId,
        module_id: moduleId,
        page_id: pageId,
        short_key_name: row.key,
        language_key_name: row.key,
        language_content,
      });
    }

    if (errors.length) return { ok: false, errors };
    if (!formData.length) return { ok: false, errors: ['Nothing to save after validation'] };

    return { ok: true, formData };
  }

  /** ONE MasterPost('/LanguageFile/SaveCMSLanguageKey', formData) — no chunk loop */
  async saveResourceManager(params: {
    projectId: string;
    productId: string;
    moduleId: string;
    pageId: string;
    rows: BulkKeyRow[];
    languages: LanguageItem[];
  }): Promise<{
    saved: number;
    failed: number;
    errors: string[];
    message: string;
    formData?: SaveCmsLanguageKeyItem[];
  }> {
    const built = this.buildSavePayload(params);
    if (!built.ok) {
      params.rows
        .filter((r) => r.selected)
        .forEach((r) => {
          r.status = 'save_error';
          r.message = 'Validation failed';
        });
      return {
        saved: 0,
        failed: params.rows.filter((r) => r.selected).length,
        errors: built.errors,
        message: built.errors.slice(0, 3).join(' | '),
      };
    }

    const { formData } = built;

    try {
      console.log('res', formData);
      const res = await firstValueFrom(
        this.api.masterPost<{ resp: boolean; respMsg: string }>(
          '/LanguageFile/SaveCMSLanguageKey',
          formData,
        ),
      );
      // const res = { resp: true, respMsg: 'Saved' };
      

      if (res?.resp) {
        const savedKeys = new Set(formData.map((x) => x.short_key_name.toLowerCase()));
        params.rows.forEach((r) => {
          if (r.selected && savedKeys.has(r.key.trim().toLowerCase())) {
            r.status = 'saved';
            r.message = res.respMsg || 'Saved';
          }
        });
        return {
          saved: formData.length,
          failed: 0,
          errors: [],
          message: res.respMsg || `Saved ${formData.length} keys (SaveCMSLanguageKey)`,
          formData,
        };
      }

      params.rows
        .filter((r) => r.selected)
        .forEach((r) => {
          r.status = 'save_error';
          r.message = res?.respMsg || 'Save failed';
        });
      return {
        saved: 0,
        failed: formData.length,
        errors: [res?.respMsg || 'SaveCMSLanguageKey failed'],
        message: res?.respMsg || 'SaveCMSLanguageKey failed',
        formData,
      };
    } catch (e: any) {
      const msg = e?.error?.respMsg || e?.error?.Message || e?.message || 'SaveCMSLanguageKey error';
      params.rows
        .filter((r) => r.selected)
        .forEach((r) => {
          r.status = 'save_error';
          r.message = msg;
        });
      return {
        saved: 0,
        failed: formData.length,
        errors: [msg],
        message: msg,
        formData,
      };
    }
  }

  /** GetCMSContent — same ProductId user selected (Resource Manager list) */
  async verifySavedKeys(params: {
    projectId: string;
    productId: string;
    moduleId: string;
    pageId: string;
    languageId: string;
    keys: string[];
  }): Promise<{ found: string[]; missing: string[]; rows: RmVerifyRow[] }> {
    const res = await firstValueFrom(
      this.getCMSContent({
        ProjectID: params.projectId,
        ProductId: params.productId,
        ModuleId: params.moduleId,
        PageId: params.pageId,
        LanguageId: params.languageId,
      }),
    );
    const rows = Array.isArray(res?.respObj) ? res.respObj : [];
    const byKey = new Set(
      rows.map((r) => (r.short_key_name || r.language_key_name || '').toLowerCase()),
    );
    const found: string[] = [];
    const missing: string[] = [];
    for (const k of params.keys) {
      if (byKey.has(k.toLowerCase())) found.push(k);
      else missing.push(k);
    }
    return { found, missing, rows };
  }
}
