// electron/llm/stripEmbeddedAnswerContract.ts
//
// HOT path with REAL logic (not a degraded stub): strips an embedded
// <answer_contract>...</answer_contract> block from a user-visible message so
// the contract never leaks into the chat bubble. Behavior-identical to the
// intent documented at every call site. No importer is modified.

export function stripEmbeddedAnswerContract(msg: string): string {
  return typeof msg === 'string' ? msg.replace(/<answer_contract>[\s\S]*?<\/answer_contract>/g, '') : msg;
}
