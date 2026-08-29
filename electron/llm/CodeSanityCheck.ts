// CodeSanityCheck.ts
//
// Verificação de sanidade pós-geração para respostas de código produzidas pelo LLM.
// As verificações aqui são executadas no texto final do assistente (após o streaming
// finalizar) e procuram por padrões de bugs de alta confiança que o modelo
// ocasionalmente emite apesar das invariantes ao nível do prompt em SHARED_CODING_RULES.
//
// Intenção de design:
//   - Determinístico e livre de efeitos colaterais (retorna o resultado estruturado).
//   - O chamador decide o que fazer com o hit (telemetry / registro / tentar novamente / remover).
//   - Não reescrevemos automaticamente a resposta. Reescrever uma linha enquanto deixa
//     a narração do dry-run inalterada produz uma resposta internamente inconsistente
//     que é pior que o bug original. A resposta correta do produto é
//     marcar a resposta para regeneração ou mostrar o aviso para o usuário.
//
// Verificar: docs/testing/MODES_PROFILE_INTELLIGENCE_BUGFIX_LOG.md FINDING-012.

// Tipos de problemas de sanidade de código que podem ser detectados
export type CodeSanityIssueCode =
    | 'subtraction_as_tuple'           // Subtração expressa como tupla
    | 'assignment_in_conditional'      // Atribuição dentro de condicional
    | 'narration_subtraction_as_tuple' // Narração de subtração como tupla
    | 'truncated_code';               // Código truncado/incompleto

// Representa um problema de sanidade encontrado em uma resposta de código
export interface CodeSanityIssue {
    code: CodeSanityIssueCode;       // Código do tipo de problema
    /** Rótulo curto e seguro para redação para telemetry / logs. */
    label: string;
    /** A linha correspondente, truncada para 200 caracteres. */
    excerpt: string;
}

// Resultado da verificação de sanidade de código
export interface CodeSanityResult {
    ok: boolean;                     // true se nenhum problema foi encontrado
    issues: CodeSanityIssue[];       // Lista de problemas encontrados
}

// Comprimento máximo do trecho exibido em cada problema
const MAX_EXCERPT_LENGTH = 200;

// Trunca uma linha para o comprimento máximo, adicionando reticências se necessário
function truncate(line: string): string {
    if (line.length <= MAX_EXCERPT_LENGTH) return line;
    return line.slice(0, MAX_EXCERPT_LENGTH - 1) + '…';
}

/**
 * Detecta um pequeno conjunto de padrões de bugs de alta confiança em blocos de código
 * na saída do modelo. Apenas inspeciona conteúdo entre cercas de três crases
 * (assim, texto mencionando esses tokens não é sinalizado) — exceto para padrões
 * de narração que espelham explicitamente o bug em inglês simples.
 */
export function checkAnswerForCodeBugs(answer: string): CodeSanityResult {
    if (!answer || typeof answer !== 'string') return { ok: true, issues: [] };

    const issues: CodeSanityIssue[] = [];

    // 1) SUBTRAÇÃO-COMO-TUPLA dentro de blocos de código delimitados.
    //    `complement = target, num` — uma tupla de 2, não subtração.
    //    Permite qualquer '=' ou '==' ou ':=' no LHS para capturar python walrus também
    //    Os nomes de variáveis são deliberadamente permissivos para capturar todo
    //    padrão comum: complement/diff/remainder/needed/missing/target.
    const fencedBlocks = extractFencedCodeBlocks(answer);
    const tupleBugRe =
        /^\s*(?:const|let|var)?\s*(?:complement|diff|difference|remainder|needed|missing|gap|delta)\s*(?:=|:=)\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*;?\s*$/m;
    for (const block of fencedBlocks) {
        const match = block.content.match(tupleBugRe);
        if (match) {
            issues.push({
                code: 'subtraction_as_tuple',
                label: 'code block assigns a tuple where a subtraction is expected',
                excerpt: truncate(match[0]),
            });
        }
    }

    // 2) ATRIBUÇÃO-EM-CONDICIONAL dentro de blocos de código delimitados.
    //    `if x = target` — único `=` dentro de `if (...)` ou `if x = ...:`.
    //    JavaScript: `if (x = foo)` é legal mas quase sempre um erro de digitação para `==`.
    //    Python: `if x = foo:` é erro de sintaxe; ainda sinalizamos.
    const assignInIfRe =
        /^\s*if\s*(?:\(\s*)?[A-Za-z_$][\w$.\[\]]*\s*=\s*[^=!<>]/m;
    for (const block of fencedBlocks) {
        const match = block.content.match(assignInIfRe);
        if (match) {
            // Exclui `if x === y` (===) e `if x !== y` (!==) — esses são
            // seguros; a regex acima já os exclui via a classe de caracteres
            // negativa `[^=!<>]`. Verificação dupla re-correspondendo a linha
            // para atribuição especificamente, não igualdade.
            const line = match[0];
            if (!/===|!==|==/.test(line)) {
                issues.push({
                    code: 'assignment_in_conditional',
                    label: 'conditional uses assignment (`=`) instead of equality (`==`/`===`)',
                    excerpt: truncate(line),
                });
            }
        }
    }

    // 3) BUG DE NARRAÇÃO-DE-TUPLA — mesmo se o bloco de código foi reescrito por
    //    uma edição posterior, o texto do dry-run às vezes ainda lê
    //    "calcula `9, 7 = 2`" que é o mesmo bug apresentado na narração.
    //    Procura por: dígitos ou nomes, vírgula, dígitos ou nomes, '=' dígito/nome —
    //    dentro de texto entre crases ou texto simples.
    const narrationBugRe = /`?\s*[\w\d-]+\s*,\s*[\w\d-]+\s*=\s*[\w\d-]+\s*`?/;
    // Restringe para linhas que incluem as palavras 'calculate', 'compute', 'find',
    // ou 'gives' para não ter falsos positivos em narração de tupla legítima.
    const proseLines = answer.split(/\n+/);
    for (const line of proseLines) {
        if (!/calculat|comput|find|gives|see\s/i.test(line)) continue;
        if (narrationBugRe.test(line)) {
        // Ignora linhas que parecem narração de subtração correta:
        // "calcula 9 - 7 = 2".
            if (/\s-\s/.test(line)) continue;
            issues.push({
                code: 'narration_subtraction_as_tuple',
                label: 'dry-run narration writes "X, Y = Z" where "X - Y = Z" was intended',
                excerpt: truncate(line.trim()),
            });
            break;
        }
    }

    return { ok: issues.length === 0, issues };
}

interface FencedBlock {
    lang: string;
    content: string;
}

function extractFencedCodeBlocks(text: string): FencedBlock[] {
    const blocks: FencedBlock[] = [];
    const re = /```([A-Za-z0-9_+-]*)\s*\n([\s\S]*?)\n```/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
        blocks.push({ lang: m[1] || '', content: m[2] });
    }
    return blocks;
}

// ── COMPLETUDÃO DE CÓDIGO-APENAS (sprint de qualidade de resposta falada, 2026-06-15) ──
//
// Uma resposta de código-apenas que ultrapassou max-tokens ou foi cortada por erro de rede
// envia código TRUNCADO (chaves desbalanceadas, função sem fechamento, operador
// pendente, string sem terminação). Exibi-la é pior que nada. Este detector é CONSERVATIVO:
// primeiro mascara strings/comentários, apenas sinaliza um desequilíbrio SEM FECHAR
// (mais abertores que fechamentos) — a assinatura de truncamento — nunca um fechamento
// extra, e recorre para sinais genéricos da linguagem (string sem terminação, operador
// pendente) quando a linguagem é desconhecida.

const PROGRAMMING_LANGS = new Set([
    'python', 'py', 'javascript', 'js', 'typescript', 'ts', 'java', 'cpp', 'c++', 'c',
    'csharp', 'cs', 'go', 'golang', 'rust', 'rs', 'kotlin', 'swift', 'scala', 'php', 'ruby', 'rb', 'sql',
]);

// Linguagens onde aspas simples NÃO são delimitadores de string (literais de char, lifetimes),
// então não precisamos escanear `'…'` como string — fazendo isso consome lifetimes Rust ('a)
// e literais de char C/C++/Java como '{' (code-review Alto 2026-06-15).
const SINGLE_QUOTE_NOT_STRING = new Set(['rust', 'rs', 'c', 'cpp', 'c++', 'java', 'csharp', 'cs', 'go', 'golang', 'kotlin', 'swift', 'scala']);
// Linguagens com literais de regex (/…/) que contêm chaves que precisamos mascarar
const HAS_REGEX_LITERALS = new Set(['javascript', 'js', 'typescript', 'ts']);

/**
 * Mascara literais de string, comentários e (para JS/TS) literais de regex para um preenchimento
 * neutro para que verificações de balanço de chaves e tokens pendentes vejam apenas a
 * estrutura real do código. Retorna o esqueleto mascarado E uma flag para string
 * SEM TERMINAÇÃO no EOF (um sinal forte de truncamento). Conservador: uma string sem
 * terminação só conta quando a aspa de abertura não está pareada no final da entrada.
 * `lang` ajusta o tratamento de aspas simples (literais de char / lifetimes) e regex.
 */
function maskStringsAndComments(code: string, lang = ''): { skeleton: string; unterminatedString: boolean } {
    const singleQuoteIsChar = SINGLE_QUOTE_NOT_STRING.has(lang);
    const hasRegex = HAS_REGEX_LITERALS.has(lang);
    let out = '';
    let unterminated = false;
    let i = 0;
    let lastSignificant = ''; // último caractere não-espaço emitido no esqueleto (para detecção de regex)
    const n = code.length;
    while (i < n) {
        const c = code[i];
        const two = code.slice(i, i + 2);
        const three = code.slice(i, i + 3);
        // Comentários de linha: // e #
        if (two === '//' || c === '#') {
            const nl = code.indexOf('\n', i);
            i = nl === -1 ? n : nl;
            continue;
        }
        // Comentários de bloco: /* ... */
        if (two === '/*') {
            const end = code.indexOf('*/', i + 2);
            i = end === -1 ? n : end + 2;
            continue;
        }
        // Strings com três aspas (python): ''' ou """
        if (three === "'''" || three === '"""') {
            const q = three;
            const end = code.indexOf(q, i + 3);
            if (end === -1) { unterminated = true; i = n; } else { out += ' '; i = end + 3; }
            continue;
        }
        // Literal de regex JS/TS: uma '/' em posição permitida para regex, escaneada até o '/'
        // final sem escape. Mascara chaves dentro de /[(){}]/ para que não sinalizem falsamente.
        if (hasRegex && c === '/' && two !== '//' && two !== '/*' && /^$|[=([{,;:!&|?+\-*%<>~^]/.test(lastSignificant)) {
            let j = i + 1;
            let closed = false;
            let inClass = false;
            while (j < n) {
                if (code[j] === '\\') { j += 2; continue; }
                if (code[j] === '\n') break; // literais de regex não atravessam linhas
                if (code[j] === '[') inClass = true;
                else if (code[j] === ']') inClass = false;
                else if (code[j] === '/' && !inClass) { closed = true; break; }
                j++;
            }
            if (closed) { out += ' '; lastSignificant = ' '; i = j + 1; continue; }
            // Não é regex (ex: divisão) — cai e trata '/' como caractere normal.
        }
        // Aspas simples em famílias C/Rust: é um LITERAL DE CHAR ou um lifetime, NÃO uma string.
        // Um literal de char é curto: '<um caractere ou escape>'. Mascara exatamente isso (assim '{' ou '('
        // não desbalancem a contagem de chaves). Um lifetime ('a) ou algo mais longo é emitido
        // como está (a verificação de chaves tolera uma aspa solta). Nunca escaneia até a próxima aspa
        // (isso consumia lifetimes Rust — code-review Alto 2026-06-15).
        if (c === "'" && singleQuoteIsChar) {
            // '\x' (escape) → 4 caracteres incluindo aspas; 'x' → 3 caracteres incluindo aspas.
            if (code[i + 1] === '\\' && code[i + 3] === "'") { out += ' '; lastSignificant = ' '; i += 4; continue; }
            if (code[i + 1] !== '\\' && code[i + 1] !== "'" && code[i + 2] === "'") { out += ' '; lastSignificant = ' '; i += 3; continue; }
            // Não é literal de char curto → um lifetime ou apóstrofo em contexto; emite como está.
            out += c; lastSignificant = c; i++;
            continue;
        }
        // Strings com aspas simples/duplas/backtick.
        if (c === '"' || c === "'" || c === '`') {
            let j = i + 1;
            let closed = false;
            while (j < n) {
                if (code[j] === '\\') { j += 2; continue; } // escape
                if (code[j] === c) { closed = true; break; }
                if (code[j] === '\n' && c !== '`') break; // strings normais não atravessam linhas
                j++;
            }
            if (!closed) {
                // Sem terminação apenas quando esgotamos o FIM da entrada (truncamento), não uma
                // quebra de linha no meio do código (que é apenas uma string de uma linha normal que o modelo escreveu de forma estranha).
                if (j >= n) unterminated = true;
                i = j >= n ? n : j + 1;
            } else {
                out += ' ';
                i = j + 1;
            }
            lastSignificant = ' ';
            continue;
        }
        out += c;
        if (!/\s/.test(c)) lastSignificant = c;
        i++;
    }
    return { skeleton: out, unterminatedString: unterminated };
}

/** O esqueleto mascarado está faltando um fechador (mais abertores que fechamentos)? Assinatura de truncamento. */
function hasUnclosedBracket(skeleton: string): boolean {
    const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
    const stack: string[] = [];
    for (const ch of skeleton) {
        if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
        else if (ch === ')' || ch === ']' || ch === '}') {
            // Um fechamento EXTRA (pilha vazia / incompatível) NÃO é truncamento — ignora para
            // manter conservador; só nos importamos com abertores sem fechar no final.
            if (stack.length && stack[stack.length - 1] === pairs[ch]) stack.pop();
        }
    }
    return stack.length > 0;
}

/** O código termina no meio de um token (operador pendente / continuação / delimitador aberto)? */
function endsMidToken(skeleton: string): boolean {
    const trimmed = skeleton.replace(/\s+$/g, '');
    if (!trimmed) return false;
    // Um ponto após um dígito é um float válido ("x = 3."), não truncamento — exclui.
    if (/\.$/.test(trimmed) && /\d\.$/.test(trimmed)) return false;
    // Barra de continuação pendente, ou um operador binário/de atribuição sem nada depois.
    return /[+\-*/%=&|^<>,.([{\\]$/.test(trimmed) && !/[)}\]]$/.test(trimmed);
}

/**
 * Verifica blocos de código delimitados para TRUNCAMENTO. Apenas significativo para respostas que produzem código;
 * o chamador condiciona nisso. Retorna ok=true (sem problemas) para texto, diagramas ou
 * cercas não-programação. Conservador: código balanceado e terminado nunca sinaliza.
 */
export function checkCodeCompleteness(answer: string): CodeSanityResult {
    if (!answer || typeof answer !== 'string') return { ok: true, issues: [] };
    const issues: CodeSanityIssue[] = [];
    for (const block of extractFencedCodeBlocks(answer)) {
        const lang = (block.lang || '').toLowerCase();
        // Pula diagramas / pseudo / cercas desconhecidas não-programação para verificações de chaves.
        const isProgramming = PROGRAMMING_LANGS.has(lang);
        const code = block.content;
        if (!code.trim()) continue;

        const { skeleton, unterminatedString } = maskStringsAndComments(code, lang);
        const isPython = lang === 'python' || lang === 'py';
        const isSql = lang === 'sql';

        let truncated = false;
        let why = '';
        if (unterminatedString) { truncated = true; why = 'unterminated string at end of code'; }
        // Balanço de chaves: pula para python (chaves não são estruturais) e para linguagens desconhecidas
        // (confiança inferior). SQL também pula balanço de chaves.
        else if (isProgramming && !isPython && !isSql && hasUnclosedBracket(skeleton)) {
            truncated = true; why = 'unclosed bracket/brace/paren (code appears cut off)';
        }
        else if (endsMidToken(skeleton)) { truncated = true; why = 'code ends mid-token (dangling operator/delimiter)'; }

        if (truncated) {
            issues.push({
                code: 'truncated_code',
                label: `code-only answer looks truncated: ${why}`,
                excerpt: truncate(code.slice(-Math.min(code.length, MAX_EXCERPT_LENGTH))),
            });
        }
    }
    return { ok: issues.length === 0, issues };
}
