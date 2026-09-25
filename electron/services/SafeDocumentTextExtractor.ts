// Stub (build recovery): safe document-text extraction allow-list
// (TOP-level import; the single source of truth for both upload dialogs).
// List VERIFIED against: (1) ModeUploadHardening.test.mjs, which pins the
// server-side ALLOWED_EXTENSIONS to txt md json csv xml html pdf docx doc;
// (2) the RefractProSettings renderer badge (pdf docx txt json, a subset).
// Using the full 9-extension handler list so the dialog never hides a file
// the extractor accepts. Call sites map with `.slice(1)` for dialog filters.
export const SAFE_DOCUMENT_EXTENSIONS: readonly string[] = [
  '.txt',
  '.md',
  '.json',
  '.csv',
  '.xml',
  '.html',
  '.pdf',
  '.docx',
  '.doc',
];
