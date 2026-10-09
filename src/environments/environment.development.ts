export const environment = {
  production: false,
  masterDomain: 'admin.dev.futuretravelplatform.com',
  clientId: '2109111018200000022',
  MasterAPIBaseUrl: '/master-api',
  MasterAPIGoBaseUrl: '/master-go-api',
  useProxy: true,
  /** Proxied to local Cursor translate server (port 4310) */
  cursorTranslateUrl: '/cursor-translate',
  /** Keys per AI request (per language). Large lists are auto-chunked. */
  translateBatchSize: 80,
  /** How many languages to translate in parallel (paid AI). */
  translateLangConcurrency: 2,
  /** Free MyMemory/GTX parallel requests. */
  freeTranslateConcurrency: 6,
  saveChunkSize: 50,
  updateConcurrency: 4,
};
