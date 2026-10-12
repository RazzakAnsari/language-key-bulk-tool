import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { NgSelectComponent } from '@ng-select/ng-select';
import {
  AiProvider,
  BulkKeyRow,
  CmsPageLegacy,
  LanguageItem,
  LovItem,
  RowStatus,
  WizardStep,
} from '../../core/models';
import { AuthService } from '../../core/services/auth.service';
import { CmsService, RmVerifyRow } from '../../core/services/cms.service';
import { KeyGeneratorService } from '../../core/services/key-generator.service';
import { SettingsService } from '../../core/services/settings.service';
import { TranslateService } from '../../core/services/translate.service';
import { ToastService } from '../../shared/services/toast.service';

type KeyRowGroup = FormGroup<{
  id: FormControl<string>;
  selected: FormControl<boolean>;
  key: FormControl<string>;
  englishContent: FormControl<string>;
  status: FormControl<RowStatus>;
  message: FormControl<string>;
  translations: FormGroup<Record<string, FormControl<string>>>;
}>;

@Component({
  selector: 'app-workspace',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, NgSelectComponent],
  templateUrl: './workspace.component.html',
  styleUrl: './workspace.component.scss',
})
export class WorkspaceComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly cms = inject(CmsService);
  private readonly keys = inject(KeyGeneratorService);
  private readonly translate = inject(TranslateService);
  private readonly toastSvc = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  readonly settingsSvc = inject(SettingsService);

  userName = this.auth.userName;
  step = signal<WizardStep>(1);

  projects = signal<LovItem[]>([]);
  products = signal<LovItem[]>([]);
  modules = signal<LovItem[]>([]);
  pages = signal<CmsPageLegacy[]>([]);
  languages = signal<LanguageItem[]>([]);

  activeLangId = signal('');
  verifyRows = signal<RmVerifyRow[]>([]);
  busy = signal(false);
  isTranslating = signal(false);
  progressMsg = signal('');
  progressDone = signal(0);
  progressTotal = signal(0);
  menuOpen = signal(false);
  /** Side menu: Master workspace vs Settings (API keys) */
  activePage = signal<'master' | 'settings'>('master');
  inputMode = signal<'fields' | 'json'>('fields');
  jsonHint = signal('');
  jsonHintOk = signal(false);
  /** bump when FormArray mutates so computed() re-reads values */
  private formTick = signal(0);

  readonly contextForm = this.fb.nonNullable.group({
    projectId: ['', Validators.required],
    productId: ['', Validators.required],
    moduleId: ['', Validators.required],
    pageId: ['', Validators.required],
  });

  readonly generateForm = this.fb.nonNullable.group({
    referenceKey: ['k_referKeys', Validators.required],
    provider: this.fb.nonNullable.control<AiProvider>(this.settingsSvc.settings().provider),
    texts: this.fb.array([this.createTextGroup()]),
  });

  readonly keysForm = this.fb.array<KeyRowGroup>([]);
  readonly filterCtrl = this.fb.nonNullable.control('');
  readonly jsonInput = this.fb.nonNullable.control('');
  readonly jsonPlaceholder = `{
  "k_transferNotAllowed": "Transfer not allowed",
  "k_transferSoldOut": "The $vehicleName transfer on $date is no longer available."
}`;

  readonly settingsForm = this.fb.nonNullable.group({
    provider: this.fb.nonNullable.control<AiProvider>('free'),
    openAiApiKey: [''],
    openAiModel: ['gpt-4o-mini'],
    geminiApiKey: [''],
    geminiModel: ['gemini-2.0-flash'],
    cursorApiKey: [''],
    cursorModel: ['composer-2.5'],
  });

  selectedCount = computed(() => {
    this.formTick();
    return this.keysForm.controls.filter((c) => c.controls.selected.value).length;
  });

  targetLanguages = computed(() => this.languages().filter((l) => !this.translate.isEnglish(l)));
  englishLanguage = computed(() => this.languages().find((l) => this.translate.isEnglish(l)));
  providerLabel = computed(() => {
    const p = this.settingsSvc.settings().provider;
    if (p === 'free') return 'Free';
    return p.charAt(0).toUpperCase() + p.slice(1);
  });

  stepTitle = computed(() => {
    switch (this.step()) {
      case 1:
        return this.inputMode() === 'json' ? 'JSON keys' : 'English texts';
      case 2:
        return 'Keys';
      case 3:
        return 'Translations';
      case 4:
        return 'Save';
    }
  });

  contextReady = computed(() => {
    this.formTick();
    const v = this.contextForm.getRawValue();
    return !!(v.projectId && v.productId && v.moduleId && v.pageId);
  });

  hasKeys = computed(() => {
    this.formTick();
    return this.keysForm.length > 0;
  });

  translatedPct = computed(() => {
    this.formTick();
    const rows = this.keysForm.controls.filter((c) => c.controls.selected.value);
    const langs = this.targetLanguages();
    if (!rows.length || !langs.length) return 0;
    let filled = 0;
    let total = 0;
    for (const r of rows) {
      for (const l of langs) {
        total++;
        if ((r.controls.translations.get(l.LanguageMasterID)?.value || '').trim()) filled++;
      }
    }
    return Math.round((filled / total) * 100);
  });

  filteredKeys = computed(() => {
    this.formTick();
    const q = this.filterCtrl.value.trim().toLowerCase();
    const all = this.keysForm.controls;
    if (!q) return all;
    return all.filter(
      (r) =>
        r.controls.key.value.toLowerCase().includes(q) ||
        r.controls.englishContent.value.toLowerCase().includes(q),
    );
  });

  activeLang = computed(() => {
    const id = this.activeLangId();
    const list = this.targetLanguages();
    return list.find((l) => l.LanguageMasterID === id) || list[0] || null;
  });

  get texts(): FormArray {
    return this.generateForm.controls.texts;
  }

  ngOnInit(): void {
    this.auth.syncServerTime().subscribe(() => this.auth.startJwtTimer());
    this.contextForm.valueChanges.subscribe(() => this.bumpForm());
    this.keysForm.valueChanges.subscribe(() => this.bumpForm());
    this.filterCtrl.valueChanges.subscribe(() => this.bumpForm());
    this.jsonInput.valueChanges.subscribe(() => this.refreshJsonHint());
    this.generateForm.controls.provider.valueChanges.subscribe((provider) => {
      this.settingsSvc.save({ provider });
    });
    this.loadMeta();
  }

  setInputMode(mode: 'fields' | 'json'): void {
    this.inputMode.set(mode);
    if (mode === 'json') this.refreshJsonHint();
  }

  readonly searchLov = (term: string, item: LovItem): boolean => {
    const q = (term || '').trim().toLowerCase();
    if (!q || !item) return true;
    return (
      (item.item_to_display || '').toLowerCase().includes(q) ||
      (item.lov_id || '').toLowerCase().includes(q)
    );
  };

  readonly searchPage = (term: string, item: CmsPageLegacy): boolean => {
    const q = (term || '').trim().toLowerCase();
    if (!q || !item) return true;
    return (
      (item.PageKey || '').toLowerCase().includes(q) ||
      (item.PageId || '').toLowerCase().includes(q)
    );
  };

  readonly compareId = (a: unknown, b: unknown): boolean => String(a ?? '') === String(b ?? '');

  onJsonPaste(ev: ClipboardEvent): void {
    const text = ev.clipboardData?.getData('text') || '';
    if (!text.trim()) return;
    ev.preventDefault();
    this.jsonInput.setValue(text);
    this.applyJsonKeys(true);
  }

  logout(): void {
    this.auth.loginOut();
  }

  toggleMenu(): void {
    this.menuOpen.update((v) => !v);
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  go(step: WizardStep): void {
    if (step >= 2 && !this.keysForm.length) return;
    this.step.set(step);
  }

  openMaster(): void {
    this.activePage.set('master');
    this.closeMenu();
  }

  openSettingsPage(): void {
    this.settingsForm.patchValue(this.settingsSvc.settings());
    this.activePage.set('settings');
    this.closeMenu();
  }

  selectLang(langId: string): void {
    if (!langId) return;
    this.activeLangId.set(langId);
  }

  openSettings(): void {
    this.openSettingsPage();
  }

  saveSettings(): void {
    const v = this.settingsForm.getRawValue();
    this.settingsSvc.save(v);
    this.generateForm.controls.provider.setValue(v.provider, { emitEvent: false });
    this.toastSvc.ok(`Translator: ${v.provider}`);
    this.activePage.set('master');
  }

  async loadMeta(): Promise<void> {
    this.busy.set(true);
    this.progressMsg.set('Loading Resource Manager LOVs & languages…');
    try {
      const [lov, langs, pages] = await Promise.all([
        firstValueFrom(this.cms.getLov('MODULE,PROJECT,PRODUCT')),
        firstValueFrom(this.cms.getAllLanguages()),
        firstValueFrom(this.cms.getLegacyPages()),
      ]);
      const items = this.asArray<LovItem>(lov).map((x) => ({ ...x, lov_id: String(x.lov_id ?? '') }));
      this.projects.set(this.sortLov(items.filter((x) => x.lov_key === 'PROJECT')));
      this.products.set(this.sortLov(items.filter((x) => x.lov_key === 'PRODUCT')));
      this.modules.set(this.sortLov(items.filter((x) => x.lov_key === 'MODULE')));
      this.pages.set(
        this.asArray<CmsPageLegacy>(pages).map((p) => ({
          ...p,
          PageId: String(p.PageId ?? ''),
          PageKey: String(p.PageKey ?? ''),
        })),
      );

      const languageList = this.asArray<LanguageItem>(langs);
      this.languages.set(languageList);

      // Keep selected product if still in LOV; else first PRODUCT (same LOV as Resource Manager)
      let productId = this.contextForm.controls.productId.value;
      if (!this.products().some((p) => p.lov_id === productId)) {
        productId = this.products()[0]?.lov_id || '';
      }
      this.contextForm.patchValue({ productId });
      this.activeLangId.set(this.targetLanguages()[0]?.LanguageMasterID || '');
      this.toastSvc.ok(`Resource Manager ready · ${languageList.length} languages`);
    } catch (e: any) {
      this.toastSvc.err(e?.message || 'Failed to load Resource Manager metadata');
    } finally {
      this.busy.set(false);
      this.progressMsg.set('');
    }
  }

  addEnglishField(): void {
    this.texts.push(this.createTextGroup());
  }

  removeEnglishField(index: number): void {
    if (this.texts.length <= 1) {
      this.texts.at(0).reset({ value: '' });
      return;
    }
    this.texts.removeAt(index);
  }

  buildKeys(): void {
    if (this.inputMode() === 'json') {
      this.applyJsonKeys(false);
      return;
    }
    if (this.generateForm.controls.referenceKey.invalid) {
      this.generateForm.controls.referenceKey.markAsTouched();
      this.toastSvc.err('Reference key required');
      return;
    }
    const texts = this.texts.controls
      .map((c) => (c.get('value')?.value || '').trim())
      .filter(Boolean);
    if (!texts.length) {
      this.toastSvc.err('Add at least one English text');
      return;
    }
    const created = this.keys.buildFromReference(
      texts.join('\n'),
      this.generateForm.controls.referenceKey.value.trim(),
      [],
    );
    this.replaceKeys(created);
    this.texts.clear();
    this.texts.push(this.createTextGroup());
    this.verifyRows.set([]);
    this.step.set(2);
    this.toastSvc.ok(`${created.length} keys generated`);
  }

  applyJsonKeys(fromPaste: boolean): void {
    const raw = this.jsonInput.value.trim();
    if (!raw) {
      if (!fromPaste) this.toastSvc.err('Paste JSON with language keys');
      return;
    }
    try {
      const created = this.keys.buildFromJson(raw);
      this.replaceKeys(created);
      this.verifyRows.set([]);
      this.refreshJsonHint();
      this.step.set(2);
      this.toastSvc.ok(`${created.length} keys loaded from JSON`);
    } catch (e: any) {
      this.jsonHintOk.set(false);
      this.jsonHint.set(e?.message || 'Invalid JSON');
      if (!fromPaste) this.toastSvc.err(e?.message || 'Invalid JSON');
    }
  }

  private refreshJsonHint(): void {
    const raw = this.jsonInput.value.trim();
    if (!raw) {
      this.jsonHint.set('');
      this.jsonHintOk.set(false);
      return;
    }
    try {
      const n = this.keys.parseJsonKeyValues(raw).length;
      this.jsonHintOk.set(true);
      this.jsonHint.set(n ? `${n} keys ready — next tab will fill automatically` : 'No string key/value pairs found');
      if (!n) this.jsonHintOk.set(false);
    } catch (e: any) {
      this.jsonHintOk.set(false);
      this.jsonHint.set(e?.message || 'Invalid JSON');
    }
  }

  async translateAll(): Promise<void> {
    if (this.isTranslating()) return;

    const selected = this.toRows().filter((r) => r.selected);
    if (!selected.length) {
      this.toastSvc.err('Select at least one key');
      return;
    }
    if (!this.targetLanguages().length) {
      this.toastSvc.err('No languages loaded');
      return;
    }
    if (!this.settingsSvc.hasActiveKey()) {
      this.openSettings();
      return;
    }

    this.isTranslating.set(true);
    this.step.set(3);
    if (!this.activeLangId()) {
      this.activeLangId.set(this.targetLanguages()[0]?.LanguageMasterID || '');
    }

    const provider = this.settingsSvc.settings().provider;
    const langs = this.targetLanguages();
    const batchHint = this.translate.optimalBatchSize(
      selected.map((r) => ({ id: r.id, english: r.englishContent })),
    );
    this.progressMsg.set(
      `Bulk translating ${selected.length} keys × ${langs.length} languages (${provider.toUpperCase()}, ~${batchHint}/request)…`,
    );
    this.progressDone.set(0);
    this.progressTotal.set(selected.length * langs.length);

    selected.forEach((r) => this.patchRowStatus(r.id, 'translating', 'Bulk translating…'));

    try {
      const result = await this.translate.translateBatch(
        selected.map((r) => ({ id: r.id, english: r.englishContent })),
        this.languages(),
        (p) => {
          const cells = (p.languageIndex - 1) * p.keysTotal + p.keysDone;
          this.progressDone.set(Math.min(cells, this.progressTotal()));
          this.progressMsg.set(
            `${p.languageName} · batch ${p.batchIndex}/${p.batchTotal} · ${p.keysDone}/${p.keysTotal} keys · lang ${p.languageIndex}/${p.languageTotal}`,
          );
        },
        (langId, map) => {
          for (const [id, text] of Object.entries(map)) {
            this.patchRowTranslations(id, { [langId]: text });
          }
        },
      );

      for (const row of selected) {
        const map = result[row.id] || {};
        const filled = Object.values(map).filter((v) => !!String(v || '').trim()).length;
        this.patchRowTranslations(row.id, map);
        this.patchRowStatus(
          row.id,
          filled ? 'translated' : 'error',
          filled ? `${filled}/${langs.length} languages` : 'Empty translations',
        );
      }
      this.progressDone.set(this.progressTotal());
      this.toastSvc.ok(`Fill ${this.translatedPct()}% — review tabs, then Save`);
    } catch (e: any) {
      selected.forEach((r) => this.patchRowStatus(r.id, 'error', e?.message || 'Translate failed'));
      this.toastSvc.err(e?.message || 'Translate failed');
    } finally {
      this.isTranslating.set(false);
      this.progressMsg.set('');
    }
  }

  clearRows(): void {
    if (!this.keysForm.length) return;
    if (!confirm('Clear all rows?')) return;
    this.keysForm.clear();
    this.verifyRows.set([]);
    this.bumpForm();
    this.step.set(1);
  }

  toggleAll(selected: boolean): void {
    this.keysForm.controls.forEach((c) => c.controls.selected.setValue(selected));
  }

  removeRow(index: number): void {
    this.keysForm.removeAt(index);
    this.bumpForm();
  }

  async insertSelected(): Promise<void> {
    if (!this.contextReady()) {
      this.activePage.set('master');
      this.toastSvc.err('Select Project, Product, Module, Page');
      return;
    }
    const rows = this.toRows();
    const selected = rows.filter((r) => r.selected);
    if (!selected.length) {
      this.toastSvc.err('Select rows to save');
      return;
    }

    const ctx = this.contextForm.getRawValue();
    const preview = this.cms.buildSavePayload({
      projectId: String(ctx.projectId || ''),
      productId: String(ctx.productId || ''),
      moduleId: String(ctx.moduleId || ''),
      pageId: String(ctx.pageId || ''),
      rows,
      languages: this.languages(),
    });
    if (!preview.ok) {
      this.toastSvc.err(preview.errors.slice(0, 2).join(' | '));
      return;
    }

    const productLabel =
      this.products().find((p) => p.lov_id === String(ctx.productId || ''))?.item_to_display ||
      String(ctx.productId || '');
    if (
      !confirm(
        `Save ${preview.formData.length} keys?\n\nProduct: ${productLabel}\nONE SaveCMSLanguageKey call`,
      )
    ) {
      return;
    }

    this.busy.set(true);
    this.progressDone.set(0);
    this.progressTotal.set(preview.formData.length);
    this.progressMsg.set(`Saving ${preview.formData.length} keys (single API call)…`);
    try {
      const result = await this.cms.saveResourceManager({
        projectId: String(ctx.projectId || ''),
        productId: String(ctx.productId || ''),
        moduleId: String(ctx.moduleId || ''),
        pageId: String(ctx.pageId || ''),
        rows,
        languages: this.languages(),
      });
      for (const r of rows) {
        this.patchRowStatus(r.id, r.status, r.message || '');
      }
      this.progressDone.set(result.saved || preview.formData.length);
      if (result.failed && result.errors.length) {
        this.toastSvc.err(result.errors.slice(0, 2).join(' | '));
      } else {
        this.toastSvc.ok(result.message);
      }

      if (result.saved > 0) {
        this.step.set(4);
        await this.verifyInResourceManager();
      }
    } catch (e: any) {
      this.toastSvc.err(e?.message || 'Save failed');
    } finally {
      this.busy.set(false);
      this.progressMsg.set('');
    }
  }

  async verifyInResourceManager(): Promise<void> {
    const en = this.englishLanguage();
    if (!en || !this.contextReady()) return;
    const ctx = this.contextForm.getRawValue();
    try {
      this.progressMsg.set('Verifying with GetCMSContent…');
      const keys = this.toRows()
        .filter((r) => r.selected && r.status === 'saved')
        .map((r) => r.key.trim());
      const result = await this.cms.verifySavedKeys({
        projectId: String(ctx.projectId || ''),
        productId: String(ctx.productId || ''),
        moduleId: String(ctx.moduleId || ''),
        pageId: String(ctx.pageId || ''),
        languageId: en.LanguageMasterID,
        keys,
      });
      this.verifyRows.set(
        result.rows.filter((r) =>
          keys.some(
            (k) =>
              (r.short_key_name || r.language_key_name || '').toLowerCase() === k.toLowerCase(),
          ),
        ),
      );
      if (result.missing.length) {
        this.toastSvc.err(
          `Saved, but not found in GetCMSContent: ${result.missing.join(', ')}`,
        );
      } else {
        this.toastSvc.ok(`Verified ${result.found.length} keys in Resource Manager`);
      }
    } catch (e: any) {
      this.toastSvc.err(e?.message || 'Verify (GetCMSContent) failed');
    } finally {
      this.progressMsg.set('');
    }
  }

  translationControl(row: KeyRowGroup, langId: string): FormControl<string> {
    let ctrl = row.controls.translations.get(langId) as FormControl<string> | null;
    if (!ctrl) {
      ctrl = this.fb.nonNullable.control('');
      row.controls.translations.addControl(langId, ctrl);
    }
    return ctrl;
  }

  private createTextGroup(): FormGroup {
    return this.fb.nonNullable.group({ value: [''] });
  }

  private createKeyGroup(row: BulkKeyRow): KeyRowGroup {
    const translations: Record<string, FormControl<string>> = {};
    for (const lang of this.languages()) {
      translations[lang.LanguageMasterID] = this.fb.nonNullable.control(
        row.translations[lang.LanguageMasterID] || '',
      );
    }
    return this.fb.nonNullable.group({
      id: [row.id],
      selected: [row.selected],
      key: [row.key, Validators.required],
      englishContent: [row.englishContent, Validators.required],
      status: this.fb.nonNullable.control<RowStatus>(row.status),
      message: [row.message || ''],
      translations: this.fb.group(translations),
    });
  }

  private replaceKeys(rows: BulkKeyRow[]): void {
    this.keysForm.clear();
    for (const row of rows) {
      this.keysForm.push(this.createKeyGroup(row));
    }
    this.bumpForm();
  }

  private toRows(): BulkKeyRow[] {
    return this.keysForm.controls.map((c) => {
      const v = c.getRawValue();
      const translations: Record<string, string> = {};
      for (const [k, val] of Object.entries(v.translations || {})) {
        translations[k] = String(val ?? '');
      }
      return {
        id: v.id,
        key: v.key,
        englishContent: v.englishContent,
        selected: v.selected,
        status: v.status,
        message: v.message,
        translations,
      };
    });
  }

  private patchRowStatus(id: string, status: RowStatus, message: string): void {
    const row = this.keysForm.controls.find((c) => c.controls.id.value === id);
    if (!row) return;
    row.controls.status.setValue(status);
    row.controls.message.setValue(message);
  }

  private patchRowTranslations(id: string, map: Record<string, string>): void {
    const row = this.keysForm.controls.find((c) => c.controls.id.value === id);
    if (!row) return;
    for (const [langId, value] of Object.entries(map)) {
      this.translationControl(row, langId).setValue(value || '');
    }
  }

  private bumpForm(): void {
    this.formTick.update((n) => n + 1);
  }

  private sortLov(items: LovItem[]): LovItem[] {
    return [...items].sort((a, b) => (a.item_order ?? 0) - (b.item_order ?? 0));
  }

  private asArray<T>(value: unknown): T[] {
    if (Array.isArray(value)) return value as T[];
    const obj = value as Record<string, unknown> | null;
    if (!obj) return [];
    for (const key of ['respObj', 'Result', 'result', 'data', 'Data']) {
      if (Array.isArray(obj[key])) return obj[key] as T[];
    }
    return [];
  }

}
