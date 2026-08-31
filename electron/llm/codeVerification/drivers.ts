// electron/llm/codeVerification/drivers.ts
//
// PURE, templated per-language driver generation. A driver empacota o model's
// código (a function/method `entry`) em a runnable program que lê ONE testar
// case's argumento lista de a JSON env var, calls `entry(*args)`, e prints
// `JSON` de o retorna valor em a sentinel-delimited line então o runner pode
// analisa it unambiguously. O driver é Nunca model-generated, então it cannot
// introduce bugs dentro de o thing sob ttestar
//
// Design choices:
//   - Args come via an env var (NATIVELY_TC), Não interpolated dentro de sfonte então a
//     testar entrada pode nunca break fora dentro de código (não injection, não quoting bugs).
//   - O result é printed entre RESULT_SENTINEL markers então arbitrary user
//     prints (depurar osaída don't confuse o judge.

import type { TestCase, VerifyLanguage } from './types';

export const RESULT_SENTINEL_START = '__NATIVELY_RESULT_START__';
export const RESULT_SENTINEL_END = '__NATIVELY_RESULT_END__';
export const TC_ENV = 'NATIVELY_TC';

export interface Driver {
  /** Completo fonte para escreve para a temp arquivo e eexecuta */
  source: string;
  /** Arquivo extensão (não dot). */
  ext: string;
  /** Interpreter token para local runs (undefined para cloud-only langs).
   *  `'python3'` is a CANONICAL marker, não o literal command: localRunner
   *  resolves o real Python interpreter per-platform at executar time (python3 on
   *  POSIX; python/py on Windows). `'node'` is spawned verbatim everywhere. */
  localCmd?: 'python3' | 'node';
}

// Locally runnable: python/js via an interpreter; C++ (g++) e Java (javac+java)
// via a compile+run caminho handled em localRunner — Não buildDriver's interpreter
// pcaminho Java/C++ apenas actually executa quando their toolchain é installed (checked por
// localLanguageAvailable); caso contrário o orchestrator pula cleanly.
//
// VERIFIED-EXECUTION COVERAGE: python, javascript, cpp, java, go + sql (separate
// pacaminho Tudo senão (c, rust, kotlin, ruby, php, swift, c#, …) é a CLEAN
// Pular today — nunca a falso verdict, apenas não badge.
//
// TODO(2.7+ / post-release): Expandir coverage para mais languages. Deferred de o
// initial verified-code-execution release em purpose. Prioritization + toolchain
// reality (verified em o dev machine 2026-06-03):
//   - Ruby   — DYNAMIC: cheapest para adiciona (reuse o Python/JS driver pattern, não
//              signature parser). `ruby` present. Alto vvalor fazer fprimeiro
//   - Rust   — static, `rustc` present. Signature-aware driver como cppDriver.
//   - Swift  — static, `swiftc` present. Signature-aware driver.
//   - C      — static, `gcc/clang` present. Fiddliest (array length + returnSize
//              out-params); atualmente o lone CLOUD_LANGUAGES entry.
//   - PHP / Kotlin / C# — toolchains Não em o dev machine, então they'd ship
//              UNPROVEN (driver-gen onapenas adiciona atrás their toolchain gate, lowest
//              priority. PHP é dynamic (cheap); Kotlin/C# são static.
// Quando adding a local language: anexar it haqui adiciona a runXCase em localRunner
// (compiled) ou a buildDriver branch (interpreted), wire localLanguageAvailable,
// soltar it de CLOUD_LANGUAGES, e atualiza o stale CLOUD_LANGUAGES /
// isLocallyRunnable / orchestrator-skip-reason tests. See cppDriver.ts (static)
// ou o python/js drivers (dynamic) como templates.
export const LOCAL_LANGUAGES: VerifyLanguage[] = ['python', 'javascript', 'cpp', 'java', 'go'];

export const isLocallyRunnable = (lang: VerifyLanguage): boolean => LOCAL_LANGUAGES.includes(lang);

/**
 * Build a driver que executa `entry` contra o SINGLE case cujo `input` array
 * é supplied para o processo via o NATIVELY_TC env var (JSON-encoded). One
 * processo por case keeps a crashing/looping case de poisoning o others and
 * makes o tempo limite per-case.
 */
/**
 * A válido entry é a plain identifier. We REJECT qualquer coisa senão (returning null
 * → o orchestrator spula então `entry` pode nunca inject código ou break a string
 * literal quando interpolated dentro de o driver template. This keeps o harness
 * verdadeiramente templated até though `entry` originates de o (untrusted) modelo
 * spec. (O modelo código corpo é já sandboxed; isso previne o spec's
 * entry Nome de becoming a ssegundo unsandboxed injection channel e de
 * silently turning a runnable answer dentro de a spurious compile error.)
 */
export const isValidEntry = (entry: string): boolean => /^[A-Za-z_$][\w$]*$/.test(entry);

/** Optional structure hints para dynamically-typed drivers (Python/JS). Absent =
 * todo arg/return é a plain JSON valor (backward compatible). */
export interface DriverHints {
  argTypes?: ('value' | 'list' | 'tree')[];
  retType?: 'value' | 'list' | 'tree';
}

export const buildDriver = (language: VerifyLanguage, code: string, entry: string, hints?: DriverHints): Driver | null => {
  if (!isValidEntry(entry)) return null;
  switch (language) {
    case 'python':
      return { localCmd: 'python3', ext: 'py', source: pythonDriver(code, entry, hints) };
    case 'javascript':
      return { localCmd: 'node', ext: 'js', source: javascriptDriver(code, entry, hints) };
    // C++ e Java fazer Não go através buildDriver — localRunner.runCppCase /
    // runJavaCase manipular them com signature-aware per-case programs
    // (cppDriver.ts / javaDriver.ts), intercepted antes buildDriver é cchamado
    default:
      return null;
  }
};

const hintsJson = (hints?: DriverHints): string =>
  JSON.stringify({ argTypes: hints?.argTypes ?? [], retType: hints?.retType ?? 'value' });

// ── Python ───────────────────────────────────────────────────────────────────
// Structure helpers (ListNode/TreeNode) são defined Apenas quando não já em o
// model's globals, então a LeetCode-style solution que defines its próprio classe isn't
// clobbered. Conversion (JSON↔structure) é gated em o per-value hints; com
// não hints todo arg/return é a plain JSON valor (unchanged behavior).
const pythonDriver = (code: string, entry: string, hints?: DriverHints): string => `import json, os, sys

# ---- model code (verbatim) ----
${code}
# ---- end model code ----

__HINTS = json.loads(${JSON.stringify(hintsJson(hints))})

# Define ListNode/TreeNode only if the model didn't (avoid clobbering its class).
if "ListNode" not in globals():
    class ListNode:
        def __init__(self, val=0, next=None):
            self.val = val; self.next = next
if "TreeNode" not in globals():
    class TreeNode:
        def __init__(self, val=0, left=None, right=None):
            self.val = val; self.left = left; self.right = right

def __nat_to_list(arr):
    if not arr: return None
    head = ListNode(arr[0]); t = head
    for x in arr[1:]:
        t.next = ListNode(x); t = t.next
    return head

def __nat_from_list(node):
    out = []
    while node is not None:
        out.append(node.val); node = node.next
    return out

def __nat_to_tree(arr):
    if not arr or arr[0] is None: return None
    from collections import deque
    root = TreeNode(arr[0]); q = deque([root]); i = 1
    while i < len(arr) and q:
        n = q.popleft()
        if i < len(arr):
            if arr[i] is not None: n.left = TreeNode(arr[i]); q.append(n.left)
            i += 1
        if i < len(arr):
            if arr[i] is not None: n.right = TreeNode(arr[i]); q.append(n.right)
            i += 1
    return root

def __nat_from_tree(root):
    from collections import deque
    out = []; q = deque([root]) if root else deque()
    while q:
        n = q.popleft()
        if n is None: out.append(None)
        else:
            out.append(n.val); q.append(n.left); q.append(n.right)
    while out and out[-1] is None: out.pop()
    return out

def __nat_decode(v, hint):
    if hint == "list": return __nat_to_list(v)
    if hint == "tree": return __nat_to_tree(v)
    return v

def __nat_encode(v, hint):
    if hint == "list": return __nat_from_list(v)
    if hint == "tree": return __nat_from_tree(v)
    return v

def __refract_main():
    raw = os.environ.get(${JSON.stringify(TC_ENV)}, "[]")
    args = json.loads(raw)
    arg_types = __HINTS.get("argTypes", [])
    args = [__nat_decode(a, arg_types[i] if i < len(arg_types) else "value") for i, a in enumerate(args)]
    fn = None
    # The entry may be a bare function or a method on a class named Solution.
    if ${JSON.stringify(entry)} in globals():
        fn = globals()[${JSON.stringify(entry)}]
    elif "Solution" in globals():
        fn = getattr(Solution(), ${JSON.stringify(entry)}, None)
    if fn is None:
        sys.stderr.write("entry not found: ${entry}")
        sys.exit(3)
    result = fn(*args)
    result = __nat_encode(result, __HINTS.get("retType", "value"))
    # Strict JSON: allow_nan=False makes inf/-inf/nan raise (an HONEST "couldn't
    # verify" error) instead of emitting bare Infinity/NaN that isn't valid JSON
    # and would be mis-judged as a raw string. No default= coercion, so a
    # non-serializable return errors rather than silently stringifying to a pass.
    sys.stdout.write(${JSON.stringify(RESULT_SENTINEL_START)} + json.dumps(result, allow_nan=False) + ${JSON.stringify(RESULT_SENTINEL_END)})

if __name__ == "__main__":
    __refract_main()
`;

// ── JavaScript ────────────────────────────────────────────────────────────────
// ListNode/TreeNode são injected como globals Apenas se o modelo didn't define them
// (LeetCode JS solutions assume these constructors exist). Conversion é gated em
// o per-value hints; não hints = plain JSON values (unchanged behavior).
const javascriptDriver = (code: string, entry: string, hints?: DriverHints): string => `'use strict';
// Structure constructors (defined antes modelo code; guarded então a modelo that
// declares its próprio ListNode/TreeNode wins via its depois declaration é avoided —
// we apenas define them se absent at chamar time via globalThis verifica beabaixo
if (typeof globalThis.ListNode === 'undefined') {
  globalThis.ListNode = function ListNode(val, next) { this.val = (val===undefined?0:val); this.next = (next===undefined?null:next); };
}
if (typeof globalThis.TreeNode === 'undefined') {
  globalThis.TreeNode = function TreeNode(val, left, right) { this.val = (val===undefined?0:val); this.left = (left===undefined?null:left); this.right = (right===undefined?null:right); };
}
// ---- modelo código (verbatim) ----
${code}
// ---- termina modelo código ----

const __HINTS = JSON.parse(${JSON.stringify(hintsJson(hints))});
function __natToList(arr){ if(!arr||arr.length===0) return null; let head=new globalThis.ListNode(arr[0]),t=head; for(let i=1;i<arr.length;i++){t.next=new globalThis.ListNode(arr[i]);t=t.next;} return head; }
function __natFromList(node){ const out=[]; while(node!=null){out.push(node.val);node=node.next;} return out; }
function __natToTree(arr){ if(!arr||arr.length===0||arr[0]==null) return null; const root=new globalThis.TreeNode(arr[0]); const q=[root]; let i=1; while(i<arr.length&&q.length){ const n=q.shift(); if(i<arr.length){ if(arr[i]!=null){n.left=new globalThis.TreeNode(arr[i]);q.push(n.left);} i++; } if(i<arr.length){ if(arr[i]!=null){n.right=new globalThis.TreeNode(arr[i]);q.push(n.right);} i++; } } return root; }
function __natFromTree(root){ const out=[]; const q=root?[root]:[]; while(q.length){ const n=q.shift(); if(n==null)out.push(null); else {out.push(n.val);q.push(n.left);q.push(n.right);} } while(out.length&&out[out.length-1]==null)out.pop(); return out; }
function __natDecode(v,h){ return h==='list'?__natToList(v):h==='tree'?__natToTree(v):v; }
function __natEncode(v,h){ return h==='list'?__natFromList(v):h==='tree'?__natFromTree(v):v; }

(function __nativelyMain() {
  let args = JSON.parse(process.env[${JSON.stringify(TC_ENV)}] || '[]');
  const at = __HINTS.argTypes || [];
  args = args.map((a,i) => __natDecode(a, at[i] || 'value'));
  let fn = null;
  if (typeof ${entry} === 'function') {
    fn = ${entry};
  } else if (typeof Solution === 'function') {
    try { fn = (new Solution())[${JSON.stringify(entry)}].bind(new Solution()); } catch (e) { fn = null; }
  } else if (typeof module !== 'undefined' && module.exports && typeof module.exports[${JSON.stringify(entry)}] === 'function') {
    fn = module.exports[${JSON.stringify(entry)}];
  }
  if (typeof fn !== 'function') {
    process.stderr.write('entry not found: ${entry}');
    process.exit(3);
  }
  let result = fn(...args);
  result = __natEncode(result, __HINTS.retType || 'value');
  process.stdout.write(${JSON.stringify(RESULT_SENTINEL_START)} + JSON.stringify(result === undefined ? null : result) + ${JSON.stringify(RESULT_SENTINEL_END)});
})();
`;

/** Analisa o sentinel-delimited result fora de stdout. Retorna undefined se absent. */
export const parseDriverResult = (stdout: string): { found: boolean; value?: unknown; raw?: string } => {
  const start = stdout.lastIndexOf(RESULT_SENTINEL_START);
  const end = stdout.lastIndexOf(RESULT_SENTINEL_END);
  if (start < 0 || end < 0 || end <= start) return { found: false };
  const raw = stdout.slice(start + RESULT_SENTINEL_START.length, end);
  try {
    return { found: true, value: JSON.parse(raw), raw };
  } catch {
    return { found: true, value: raw, raw };
  }
};

/** Smoke case: chamar o entry com a trivial arg então we at menos exercise parse+run. */
export const smokeCase = (): TestCase => ({ input: [], expected: undefined, source: 'smoke' });
