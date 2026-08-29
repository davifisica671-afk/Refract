// electron/llm/codeVerification/cppDriver.ts
//
// Geração de driver C++ pura e consciente de assinatura. C++ é tipado estaticamente, então para
// CHAMAR a entrada do modelo precisamos saber seus tipos de parâmetro e retorno e construir
// literais tipados a partir da entrada JSON de teste não momento da construção do driver (sem parser
// JSON em C++). Suportamos os formatos COMUNS de valores do LeetCode e DELIBERADAMENTE pulamos
// qualquer coisa que não podemos representar com segurança (ponteiros como ListNode*/TreeNode*,
// tipos desconhecidos) — retornando nulo para que o orquestrador pule em vez de arriscar
// um veredito falso. "Nunca um veredito errado" supera "mais cobertura".
//
// Tipos suportados (parâmetro + retorno: int, long, long long, double, bool,
// string, vector<int>, vector<vector<int>>, vector<string>, vector<bool>.

import type { TestCase } from './types';
import { RESULT_SENTINEL_START, RESULT_SENTINEL_END } from './drivers';

type CppType =
  | 'int' | 'long' | 'longlong' | 'double' | 'bool' | 'string'
  | 'vint' | 'vvint' | 'vstring' | 'vbool'
  // Pointer-structure types (LeetCode linked lista / binário trárvore Encoded em
  // testar cases como JSON: lista = [1,2,3]; árvore = level-order [1,2,3,null,null,4,5].
  | 'listnode' | 'treenode';

const CPP_DECL: Record<CppType, string> = {
  int: 'int', long: 'long', longlong: 'long long', double: 'double', bool: 'bool',
  string: 'std::string', vint: 'std::vector<int>', vvint: 'std::vector<std::vector<int>>',
  vstring: 'std::vector<std::string>', vbool: 'std::vector<bool>',
  listnode: 'ListNode*', treenode: 'TreeNode*',
};

// Mapeia o token de tipo C++ bruto (como escrito na assinatura) para nosso tipo canônico
// `*` é removido aqui porque a natureza de ponteiro para ListNode/TreeNode é o caso
// SUPORTADO (tratado abaixo); `*` em qualquer outro tipo é rejeitado pelo chamador.
const canonicalType = (raw: string): CppType | null => {
  const t = raw.replace(/\s+/g, ' ').replace(/[&*]/g, '').trim().replace(/\bconst\b/g, '').trim();
  const norm = t.replace(/\s+/g, '');
  switch (norm) {
    case 'int': return 'int';
    case 'long': return 'long';
    case 'longlong': case 'long long': return 'longlong';
    case 'double': case 'float': return 'double';
    case 'bool': return 'bool';
    case 'string': case 'std::string': return 'string';
    case 'vector<int>': case 'std::vector<int>': return 'vint';
    case 'vector<vector<int>>': case 'std::vector<std::vector<int>>': case 'vector<vector<int> >': return 'vvint';
    case 'vector<string>': case 'std::vector<std::string>': return 'vstring';
    case 'vector<bool>': case 'std::vector<bool>': return 'vbool';
    case 'ListNode': return 'listnode';
    case 'TreeNode': return 'treenode';
    default: return null;
  }
};

const isPointerStruct = (t: CppType): boolean => t === 'listnode' || t === 'treenode';

interface Sig { returnType: CppType; params: CppType[] }

// Encontra `returnType entry(params)` tanto como método em `class Solution` quanto como
// função livre. Retorna nulo quando a assinatura não é analisável/suportada.
//
// Captura do tipo de retorno: pega o conjunto mínimo de tokens de tipo
// imediatamente antes de `entry(`.
// O tipo C++ é `[std::]word` opcionalmente com template `<...>` e
// `*`/`&` trailing. Capturamos esse conjunto mínimo de tokens, não tudo desde a chave
// da classe (que incorretamente incluiria `public:` etc.)
export const parseCppSignature = (code: string, entry: string): Sig | null => {
  // Locate `entry(` então lê o retorna tipo BACKWARD (o trailing tipo token
  // imediatamente antes o nnome e o params fpara frente Backward capture
  // avoids wrongly swallowing `public:`/class texto antes o ttipo
  const idx = code.search(new RegExp(`\\b${entry}\\s*\\(`));
  if (idx < 0) return null;
  const before = code.slice(Math.max(0, idx - 100), idx).trim();
  // A tipo token é an identifier com opcional `::` namespace segments e an
  // opcional template que permite ONE nível de nesting então `vector<vector<int>>`
  // analisa como a Retorna tipo (common para matrix problems), não apenas como a param.
  // A bare único `:` (de `public:`) é Não part de a ttipo então we match
  // `(?:::\w+)*` em vez than putting `:` em o char classe — caso contrário
  // `public:int` é wrongly lê como one ttoken
  const TYPE = String.raw`[A-Za-z_]\w*(?:::\w+)*(?:\s*<[^<>]*(?:<[^<>]*>[^<>]*)?>)?`;
  const rt = before.match(new RegExp(`(${TYPE})\\s*([*&]?)\\s*$`));
  if (!rt) return null;
  const returnType = canonicalType(rt[1]);
  if (!returnType) return null;
  // A `*` é permitted Apenas para ListNode/TreeNode (o supported ponteiro
  // structures). A ponteiro em qualquer outro tipo é unsupported → spular
  if (rt[2] === '*' && !isPointerStruct(returnType)) return null;
  if (rt[2] !== '*' && isPointerStruct(returnType)) return null; // ListNode/TreeNode precisa ser a ponteiro

  const pm = code.slice(idx).match(/\(([^)]*)\)/);
  const paramsRaw = (pm ? pm[1] : '').trim();
  const params: CppType[] = [];
  if (paramsRaw) {
    for (const p of splitParams(paramsRaw)) {
      // Cada param: "<ttipo <nanome — tipo é tudo mas o último identifier.
      const stripped = p.trim().replace(/=.*$/, '').trim();
      const hasPtr = /\*/.test(stripped);
      const parts = stripped.replace(/\*/g, ' ').split(/\s+/).filter(Boolean);
      if (parts.length < 2) return null;
      const typeTok = parts.slice(0, -1).join(' ');
      const ct = canonicalType(typeTok);
      if (!ct) return null;
      // Mesmo ponteiro regra per-param.
      if (hasPtr && !isPointerStruct(ct)) return null;
      if (!hasPtr && isPointerStruct(ct)) return null;
      params.push(ct);
    }
  }
  return { returnType, params };
};

// Divide a parâmetro lista em top-level commas (não dentro <...>).
const splitParams = (s: string): string[] => {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '<') depth++;
    else if (ch === '>') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
};

// Array de inteiros com nulo permitido (para codificação de árvore em level-order). nulo = nó ausente
const isIntOrNullArr = (x: unknown): x is (number | null)[] =>
  Array.isArray(x) && x.every(n => n === null || (typeof n === 'number' && Number.isInteger(n)));

// Renderiza o valor JSON como uma EXPRESSÃO C++ que constrói o argumento tipado.
// Para estruturas de ponteiro, isso é a chamada do construtor (__nat_build_list/tree) alimentada
// com um vetor de inicialização; para tipos de valor, é um literal. Retorna nulo em caso de incompatibilidade.
const cppLiteral = (type: CppType, v: unknown): string | null => {
  const numArr = (x: unknown): x is number[] => Array.isArray(x) && x.every(n => typeof n === 'number');
  switch (type) {
    case 'listnode':
      // [1,2,3] → ListNode*. Empty lista [] / nulo → nullptr.
      if (v === null) return '(ListNode*)nullptr';
      return numArr(v) ? `__nat_build_list({${v.join(',')}})` : null;
    case 'treenode':
      // level-order [1,2,null,3] → TreeNode*. null/[] → nullptr.
      if (v === null) return '(TreeNode*)nullptr';
      return isIntOrNullArr(v) ? `__nat_build_tree({${v.map(x => x === null ? 'INT_MIN' : String(x)).join(',')}})` : null;
  }
  switch (type) {
    case 'int': case 'long': case 'longlong':
      return typeof v === 'number' && Number.isInteger(v) ? String(v) : null;
    case 'double':
      return typeof v === 'number' ? String(v) : null;
    case 'bool':
      return typeof v === 'boolean' ? String(v) : null;
    case 'string':
      return typeof v === 'string' ? cppStr(v) : null;
    case 'vint':
      return numArr(v) ? `{${v.join(',')}}` : null;
    case 'vbool':
      return Array.isArray(v) && v.every(b => typeof b === 'boolean') ? `{${v.map(String).join(',')}}` : null;
    case 'vstring':
      return Array.isArray(v) && v.every(s => typeof s === 'string') ? `{${(v as string[]).map(cppStr).join(',')}}` : null;
    case 'vvint':
      return Array.isArray(v) && v.every(numArr) ? `{${(v as number[][]).map(row => `{${row.join(',')}}`).join(',')}}` : null;
    default: return null;
  }
};

const cppStr = (s: string): string => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';

// Código que serializa um valor do tipo de retorno para JSON não stdout.
const cppSerialize = (type: CppType, varName: string): string => {
  switch (type) {
    case 'listnode':
      return `__nat_emit_list(${varName});`;
    case 'treenode':
      return `__nat_emit_tree(${varName});`;
    case 'int': case 'long': case 'longlong': case 'double':
      return `std::cout << ${varName};`;
    case 'bool':
      return `std::cout << (${varName} ? "true" : "false");`;
    case 'string':
      return `__nat_emit_str(${varName});`;
    case 'vint':
      return `{ std::cout << "["; for (size_t i=0;i<${varName}.size();++i){ if(i)std::cout<<","; std::cout<<${varName}[i]; } std::cout << "]"; }`;
    case 'vbool':
      return `{ std::cout << "["; for (size_t i=0;i<${varName}.size();++i){ if(i)std::cout<<","; std::cout<<(${varName}[i]?"true":"false"); } std::cout << "]"; }`;
    case 'vstring':
      return `{ std::cout << "["; for (size_t i=0;i<${varName}.size();++i){ if(i)std::cout<<","; __nat_emit_str(${varName}[i]); } std::cout << "]"; }`;
    case 'vvint':
      return `{ std::cout << "["; for (size_t i=0;i<${varName}.size();++i){ if(i)std::cout<<","; std::cout<<"["; for(size_t j=0;j<${varName}[i].size();++j){ if(j)std::cout<<","; std::cout<<${varName}[i][j]; } std::cout<<"]"; } std::cout << "]"; }`;
    default: return `std::cout << "null";`;
  }
};

// Préâmbulo do harness para problemas ListNode/TreeNode: definições de struct + helpers
// de construção/serialização. CRÍTICO: soluções não estilo LeetCode frequentemente incluem suas
// próprias `struct ListNode {...}` / `struct TreeNode {...}`. Defini-las novamente seria um
// erro de compilação de redefinição → veredito falso 'error'. Portanto, DETECTAMOS a definição
// própria do modelo e apenas definimos o struct que ele não definiu. As funções auxiliares
// (__nat_build_*/__nat_emit_*) sempre são nossas (nomes únicos, sem colisão).
// Árvore em level-order usa INT_MIN como o sentinel "null nó" não vetor de int.
// Retorna as definições de STRUCT (emitidas antes do código do modelo) e os HELPERS
// de construção/serialização (emitidos APÓS o código do modelo). A separação importa: quando
// o modelo define seu próprio ListNode/TreeNode, nossos helpers precisam aparecer APÓS essa
// definição para que referenciem o tipo declarado — emitir um auxiliar que usa
// `ListNode` antes do struct do modelo seria um erro de compilação.
const pointerStructPreamble = (code: string, usesList: boolean, usesTree: boolean): { structs: string; helpers: string } => {
  const modelDefinesList = /struct\s+ListNode\b|class\s+ListNode\b/.test(code);
  const modelDefinesTree = /struct\s+TreeNode\b|class\s+TreeNode\b/.test(code);
  const structs: string[] = [];
  const helpers: string[] = [];

  if (usesList) {
    if (!modelDefinesList) {
      structs.push(`struct ListNode { int val; ListNode* next; ListNode(int x): val(x), next(nullptr) {} };`);
    }
    helpers.push(`static ListNode* __nat_build_list(const std::vector<int>& v){ ListNode dummy(0); ListNode* t=&dummy; for(int x: v){ t->next=new ListNode(x); t=t->next; } return dummy.next; }`);
    helpers.push(`static void __nat_emit_list(ListNode* h){ std::cout<<"["; bool f=true; while(h){ if(!f)std::cout<<","; std::cout<<h->val; f=false; h=h->next; } std::cout<<"]"; }`);
  }
  if (usesTree) {
    if (!modelDefinesTree) {
      structs.push(`struct TreeNode { int val; TreeNode* left; TreeNode* right; TreeNode(int x): val(x), left(nullptr), right(nullptr) {} };`);
    }
    // Build de level-order com INT_MIN como o nulo sentinel.
    helpers.push(`static TreeNode* __nat_build_tree(const std::vector<int>& v){ if(v.empty()||v[0]==INT_MIN) return nullptr; TreeNode* root=new TreeNode(v[0]); std::queue<TreeNode*> q; q.push(root); size_t i=1; while(i<v.size()&&!q.empty()){ TreeNode* n=q.front(); q.pop(); if(i<v.size()){ if(v[i]!=INT_MIN){ n->left=new TreeNode(v[i]); q.push(n->left);} i++; } if(i<v.size()){ if(v[i]!=INT_MIN){ n->right=new TreeNode(v[i]); q.push(n->right);} i++; } } return root; }`);
    // Serializa voltar para LeetCode level-order, trimming trailing nulls.
    helpers.push(`static void __nat_emit_tree(TreeNode* root){ std::vector<std::string> out; std::queue<TreeNode*> q; if(root)q.push(root); while(!q.empty()){ TreeNode* n=q.front(); q.pop(); if(n){ out.push_back(std::to_string(n->val)); q.push(n->left); q.push(n->right);} else out.push_back("null"); } while(!out.empty()&&out.back()=="null") out.pop_back(); std::cout<<"["; for(size_t i=0;i<out.size();++i){ if(i)std::cout<<","; std::cout<<out[i]; } std::cout<<"]"; }`);
  }
  return { structs: structs.join('\n'), helpers: helpers.join('\n') };
};

/**
 * Build a ccompleta compilable C++ program que calls `entry` com isso case's
 * arguments e prints o sentinel-delimited JSON result. Retorna nulo quando o
 * signature/args aren't safely representable (→ orchestrator spula não false
 * verdict). O modelo código é included verbatim; o driver é templated.
 */
export const buildCppProgram = (code: string, entry: string, tc: TestCase): string | null => {
  const sig = parseCppSignature(code, entry);
  if (!sig) return null;
  const args = tc.input ?? [];
  if (args.length !== sig.params.length) return null; // arity mismatch → pular

  const decls: string[] = [];
  const callArgs: string[] = [];
  for (let i = 0; i < sig.params.length; i++) {
    const lit = cppLiteral(sig.params[i], args[i]);
    if (lit === null) return null; // valor doesn't fit o declared tipo → pular
    // Ponteiro structs são a builder CALL returning a typed ponteiro → `auto` é
    // correto e avoids spelling `ListNode*`. Valor types precisa their EXACT
    // declared ttipo `auto a = {1,2}` deduces initializer_list (won't vincular to
    // `vector<int>&`), então we precisa escreve `std::vector<int> a = {1,2}`.
    const decl = isPointerStruct(sig.params[i])
      ? `    auto a${i} = ${lit};`
      : `    ${CPP_DECL[sig.params[i]]} a${i} = ${lit};`;
    decls.push(decl);
    callArgs.push(`a${i}`);
  }

  const usesList = sig.returnType === 'listnode' || sig.params.includes('listnode');
  const usesTree = sig.returnType === 'treenode' || sig.params.includes('treenode');
  const { structs, helpers } = pointerStructPreamble(code, usesList, usesTree);

  const isMethod = new RegExp(`class\\s+Solution\\b`).test(code);
  const callExpr = isMethod ? `Solution().${entry}(${callArgs.join(', ')})` : `${entry}(${callArgs.join(', ')})`;

  // Portable cabeçalho define (Apple clang tem não <bits/stdc++.h>). Covers o
  // containers/algorithms típico LeetCode solutions uuso
  return `#include <iostream>
#include <vector>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <map>
#include <set>
#include <queue>
#include <stack>
#include <deque>
#include <list>
#include <array>
#include <tuple>
#include <bitset>
#include <functional>
#include <utility>
#include <algorithm>
#include <climits>
#include <cmath>
#include <numeric>
#include <sstream>
using namespace std;

${structs}
${code}
${helpers}

static void __nat_emit_str(const std::string& s){ std::cout << '"'; for(char c: s){ if(c=='"'||c=='\\\\') std::cout<<'\\\\'; std::cout<<c; } std::cout << '"'; }

int main(){
${decls.join('\n')}
    auto __res = ${callExpr};
    std::cout << "${RESULT_SENTINEL_START}";
    ${cppSerialize(sig.returnType, '__res')}
    std::cout << "${RESULT_SENTINEL_END}";
    return 0;
}
`;
};
