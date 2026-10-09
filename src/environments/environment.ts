export const environment = {
  production: true,
  masterDomain: 'admin.dev.futuretravelplatform.com',
  clientId: '2109111018200000022',
  MasterAPIBaseUrl: 'https://masadapi.dev.futuretravelplatform.com/api',
  MasterAPIGoBaseUrl: 'https://masadapigo.dev.futuretravelplatform.com/api',
  useProxy: false,
  /** Same-origin when UI+API share one host; override via deploy env if needed. */
  cursorTranslateUrl: '',
  /** Keys per AI request (per language). Large lists are auto-chunked. */
  translateBatchSize: 80,
  /** How many languages to translate in parallel (paid AI). */
  translateLangConcurrency: 2,
  /** Free MyMemory/GTX parallel requests. */
  freeTranslateConcurrency: 6,
  saveChunkSize: 50,
  updateConcurrency: 4,
};
