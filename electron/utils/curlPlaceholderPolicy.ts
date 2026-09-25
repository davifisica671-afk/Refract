// electron/utils/curlPlaceholderPolicy.ts
//
// Shared {{TEXT}} placeholder policy: the single source of truth for the
// curl-template gate, matching curlUtils.ts + src/lib/curl-validator.ts
// inline semantics (spacing tolerated). No importer is modified.

export const TEXT_PLACEHOLDER_RE = /\{\{\s*TEXT\s*\}\}/;
