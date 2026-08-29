#!/usr/bin/env node
// translate-comments.mjs — extrai e traduz comentários do código (EN→PT-BR)
// Uso: node scripts/translate-comments.mjs [--apply] [caminhos...]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BACKUP_SUFFIX = '.bak';
let totalFiles = 0, totalComments = 0, modifiedFiles = 0;

// ─── Dicionário EN→PT-BR ───
// Palavras/frases mais longas primeiro p/ evitar casamento parcial
const DICT = new Map([
  // Frases completas comuns
  ['The number of', 'O número de'],
  ['the number of', 'o número de'],
  ['Called when', 'Chamado quando'],
  ['called when', 'chamado quando'],
  ['Fired when', 'Disparado quando'],
  ['fired when', 'disparado quando'],
  ['Emitted when', 'Emitido quando'],
  ['emitted when', 'emitido quando'],
  ['Triggered when', 'Acionado quando'],
  ['triggered when', 'acionado quando'],
  ['Whether the', 'Se o'],
  ['whether the', 'se o'],
  ['Whether this', 'Se este'],
  ['whether this', 'se este'],
  ['Used to', 'Usado para'],
  ['used to', 'usado para'],
  ['Responsible for', 'Responsável por'],
  ['responsible for', 'responsável por'],
  ['In order to', 'Para'],
  ['in order to', 'para'],
  ['This is used', 'Isto é usado'],
  ['this is used', 'isto é usado'],
  ['This is called', 'Isto é chamado'],
  ['this is called', 'isto é chamado'],
  ['This function', 'Esta função'],
  ['this function', 'esta função'],
  ['This method', 'Este método'],
  ['this method', 'este método'],
  ['This class', 'Esta classe'],
  ['this class', 'esta classe'],
  ['This module', 'Este módulo'],
  ['this module', 'este módulo'],
  ['This file', 'Este arquivo'],
  ['this file', 'este arquivo'],
  ['This value', 'Este valor'],
  ['this value', 'este valor'],
  ['This type', 'Este tipo'],
  ['this type', 'este tipo'],
  ['This should', 'Isto deve'],
  ['this should', 'isto deve'],
  ['Default value', 'Valor padrão'],
  ['default value', 'valor padrão'],
  ['Default is', 'Padrão é'],
  ['default is', 'padrão é'],
  ['Note that', 'Observe que'],
  ['note that', 'observe que'],
  ['Note:', 'Obs.:'],
  ['Warning:', 'Aviso:'],
  ['Important:', 'Importante:'],
  ['TODO:', 'PENDENTE:'],
  ['FIXME:', 'CORRIGIR:'],
  ['HACK:', 'GAMBIARRA:'],
  ['XXX:', 'REVER:'],
  ['See also', 'Veja também'],
  ['see also', 'veja também'],
  ['For example', 'Por exemplo'],
  ['for example', 'por exemplo'],
  ['E.g.', 'Ex.'],
  ['e.g.', 'ex.'],
  ['I.e.', 'Isto é'],
  ['i.e.', 'isto é'],
  ['Deprecated.', 'Obsoleto.'],
  ['deprecated', 'obsoleto'],
  ['Implementation detail', 'Detalhe de implementação'],
  ['implementation detail', 'detalhe de implementação'],
  ['Internal use only', 'Uso interno apenas'],
  ['internal use only', 'uso interno apenas'],
  ['Use with caution', 'Use com cuidado'],
  ['Do not use', 'Não use'],
  ['do not use', 'não use'],
  ['Should not', 'Não deve'],
  ['should not', 'não deve'],
  ['Must not', 'Não pode'],
  ['must not', 'não pode'],
  ['Will not', 'Não vai'],
  ['will not', 'não vai'],
  ['Has been', 'Foi'],
  ['has been', 'foi'],
  ['Have been', 'Foram'],
  ['have been', 'foram'],
  ['Built with', 'Construído com'],
  ['built with', 'construído com'],
  ['Based on', 'Baseado em'],
  ['based on', 'baseado em'],
  ['Part of', 'Parte de'],
  ['part of', 'parte de'],
  ['One of', 'Um dos'],
  ['one of', 'um dos'],
  ['Same as', 'Mesmo que'],
  ['same as', 'mesmo que'],
  ['Similar to', 'Similar a'],
  ['similar to', 'similar a'],
  ['Different from', 'Diferente de'],
  ['different from', 'diferente de'],
  ['Depending on', 'Dependendo de'],
  ['depending on', 'dependendo de'],
  ['According to', 'De acordo com'],
  ['according to', 'de acordo com'],
  ['Due to', 'Devido a'],
  ['due to', 'devido a'],
  ['In addition', 'Além disso'],
  ['in addition', 'além disso'],
  ['In other words', 'Em outras palavras'],
  ['in other words', 'em outras palavras'],
  ['In most cases', 'Na maioria dos casos'],
  ['in most cases', 'na maioria dos casos'],
  ['In some cases', 'Em alguns casos'],
  ['in some cases', 'em alguns casos'],
  ['As well as', 'Bem como'],
  ['as well as', 'bem como'],
  ['As opposed to', 'Ao contrário de'],
  ['as opposed to', 'ao contrário de'],
  ['Such as', 'Tal como'],
  ['such as', 'tal como'],
  ['Rather than', 'Em vez de'],
  ['rather than', 'em vez de'],
  ['More than', 'Mais de'],
  ['more than', 'mais de'],
  ['Less than', 'Menos de'],
  ['less than', 'menos de'],
  ['Rather than', 'Em vez de'],
  ['rather than', 'em vez de'],
  ['The following', 'O seguinte'],
  ['the following', 'o seguinte'],
  ['The above', 'O acima'],
  ['the above', 'o/a acima'],
  ['The current', 'O atual'],
  ['the current', 'o/a atual'],
  ['The previous', 'O anterior'],
  ['the previous', 'o/a anterior'],
  ['The next', 'O próximo'],
  ['the next', 'o/a próximo'],
  ['The last', 'O último'],
  ['the last', 'o/a último'],
  ['The first', 'O primeiro'],
  ['the first', 'o/a primeiro'],
  ['The second', 'O segundo'],
  ['the second', 'o/a segundo'],
  ['At least', 'Pelo menos'],
  ['at least', 'pelo menos'],
  ['At most', 'No máximo'],
  ['at most', 'no máximo'],
  ['Up to', 'Até'],
  ['up to', 'até'],
  ['As many', 'Quantos'],
  ['as many', 'quantos'],
  ['As much', 'Quanto'],
  ['as much', 'quanto'],
  ['As long as', 'Desde que'],
  ['as long as', 'desde que'],
  ['As soon as', 'Assim que'],
  ['as soon as', 'assim que'],
  ['No longer', 'Não mais'],
  ['no longer', 'não mais'],

  // Verbos comuns em comentários
  ['Returns', 'Retorna'],
  ['Return', 'Retorna'],
  ['return', 'retorna'],
  ['Retrieve', 'Recupera'],
  ['retrieve', 'recupera'],
  ['Retrieves', 'Recupera'],
  ['retrieves', 'recupera'],
  ['Fetch', 'Busca'],
  ['fetch', 'busca'],
  ['Fetches', 'Busca'],
  ['fetches', 'busca'],
  ['Get', 'Obtém'],
  ['get', 'obtém'],
  ['Gets', 'Obtém'],
  ['gets', 'obtém'],
  ['Set', 'Define'],
  ['set', 'define'],
  ['Sets', 'Define'],
  ['sets', 'define'],
  ['Create', 'Cria'],
  ['create', 'cria'],
  ['Creates', 'Cria'],
  ['creates', 'cria'],
  ['Build', 'Constrói'],
  ['build', 'constrói'],
  ['Builds', 'Constrói'],
  ['builds', 'constrói'],
  ['Generate', 'Gera'],
  ['generate', 'gera'],
  ['Generates', 'Gera'],
  ['generates', 'gera'],
  ['Compute', 'Calcula'],
  ['compute', 'calcula'],
  ['Computes', 'Calcula'],
  ['computes', 'calcula'],
  ['Calculate', 'Calcula'],
  ['calculate', 'calcula'],
  ['Calculates', 'Calcula'],
  ['calculates', 'calcula'],
  ['Find', 'Encontra'],
  ['find', 'encontra'],
  ['Finds', 'Encontra'],
  ['finds', 'encontra'],
  ['Search', 'Busca'],
  ['search', 'busca'],
  ['Searches', 'Busca'],
  ['searches', 'busca'],
  ['Lookup', 'Consulta'],
  ['lookup', 'consulta'],
  ['Convert', 'Converte'],
  ['convert', 'converte'],
  ['Converts', 'Converte'],
  ['converts', 'converte'],
  ['Transform', 'Transforma'],
  ['transform', 'transforma'],
  ['Transforms', 'Transforma'],
  ['transforms', 'transforma'],
  ['Parse', 'Analisa'],
  ['parse', 'analisa'],
  ['Parses', 'Analisa'],
  ['parses', 'analisa'],
  ['Serialize', 'Serializa'],
  ['serialize', 'serializa'],
  ['Deserialize', 'Desserializa'],
  ['deserialize', 'desserializa'],
  ['Format', 'Formata'],
  ['format', 'formata'],
  ['Formats', 'Formata'],
  ['formats', 'formata'],
  ['Validate', 'Valida'],
  ['validate', 'valida'],
  ['Validates', 'Valida'],
  ['validates', 'valida'],
  ['Verify', 'Verifica'],
  ['verify', 'verifica'],
  ['Verifies', 'Verifica'],
  ['verifies', 'verifica'],
  ['Check', 'Verifica'],
  ['check', 'verifica'],
  ['Checks', 'Verifica'],
  ['checks', 'verifica'],
  ['Ensure', 'Garante'],
  ['ensure', 'garante'],
  ['Ensures', 'Garante'],
  ['ensures', 'garante'],
  ['Make sure', 'Certifique-se'],
  ['make sure', 'certifique-se'],
  ['Configure', 'Configura'],
  ['configure', 'configura'],
  ['Configures', 'Configura'],
  ['configures', 'configura'],
  ['Initialize', 'Inicializa'],
  ['initialize', 'inicializa'],
  ['Initializes', 'Inicializa'],
  ['initializes', 'inicializa'],
  ['Setup', 'Configura'],
  ['setup', 'configura'],
  ['Register', 'Registra'],
  ['register', 'registra'],
  ['Registers', 'Registra'],
  ['registers', 'registra'],
  ['Start', 'Inicia'],
  ['start', 'inicia'],
  ['Starts', 'Inicia'],
  ['starts', 'inicia'],
  ['Stop', 'Para'],
  ['stop', 'para'],
  ['Stops', 'Para'],
  ['stops', 'para'],
  ['Begin', 'Começa'],
  ['begin', 'começa'],
  ['Begins', 'Começa'],
  ['begins', 'começa'],
  ['End', 'Termina'],
  ['end', 'termina'],
  ['Ends', 'Termina'],
  ['ends', 'termina'],
  ['Finish', 'Finaliza'],
  ['finish', 'finaliza'],
  ['Finishes', 'Finaliza'],
  ['finishes', 'finaliza'],
  ['Complete', 'Completa'],
  ['complete', 'completa'],
  ['Completes', 'Completa'],
  ['completes', 'completa'],
  ['Process', 'Processa'],
  ['process', 'processa'],
  ['Processes', 'Processa'],
  ['processes', 'processa'],
  ['Handle', 'Gerencia'],
  ['handle', 'gerencia'],
  ['Handles', 'Gerencia'],
  ['handles', 'gerencia'],
  ['Manage', 'Gerencia'],
  ['manage', 'gerencia'],
  ['Manages', 'Gerencia'],
  ['manages', 'gerencia'],
  ['Control', 'Controla'],
  ['control', 'controla'],
  ['Controls', 'Controla'],
  ['controls', 'controla'],
  ['Execute', 'Executa'],
  ['execute', 'executa'],
  ['Executes', 'Executa'],
  ['executes', 'executa'],
  ['Run', 'Executa'],
  ['run', 'executa'],
  ['Runs', 'Executa'],
  ['runs', 'executa'],
  ['Perform', 'Executa'],
  ['perform', 'executa'],
  ['Performs', 'Executa'],
  ['performs', 'executa'],
  ['Apply', 'Aplica'],
  ['apply', 'aplica'],
  ['Applies', 'Aplica'],
  ['applies', 'aplica'],
  ['Update', 'Atualiza'],
  ['update', 'atualiza'],
  ['Updates', 'Atualiza'],
  ['updates', 'atualiza'],
  ['Refresh', 'Atualiza'],
  ['refresh', 'atualiza'],
  ['Refreshes', 'Atualiza'],
  ['refreshes', 'atualiza'],
  ['Reload', 'Recarrega'],
  ['reload', 'recarrega'],
  ['Reloads', 'Recarrega'],
  ['reloads', 'recarrega'],
  ['Reset', 'Reinicia'],
  ['reset', 'reinicia'],
  ['Resets', 'Reinicia'],
  ['resets', 'reinicia'],
  ['Clear', 'Limpa'],
  ['clear', 'limpa'],
  ['Clears', 'Limpa'],
  ['clears', 'limpa'],
  ['Remove', 'Remove'],
  ['remove', 'remove'],
  ['Removes', 'Remove'],
  ['removes', 'remove'],
  ['Delete', 'Exclui'],
  ['delete', 'exclui'],
  ['Deletes', 'Exclui'],
  ['deletes', 'exclui'],
  ['Add', 'Adiciona'],
  ['add', 'adiciona'],
  ['Adds', 'Adiciona'],
  ['adds', 'adiciona'],
  ['Insert', 'Insere'],
  ['insert', 'insere'],
  ['Inserts', 'Insere'],
  ['inserts', 'insere'],
  ['Merge', 'Mescla'],
  ['merge', 'mescla'],
  ['Merges', 'Mescla'],
  ['merges', 'mescla'],
  ['Split', 'Divide'],
  ['split', 'divide'],
  ['Splits', 'Divide'],
  ['splits', 'divide'],
  ['Join', 'Junta'],
  ['join', 'junta'],
  ['Joins', 'Junta'],
  ['joins', 'junta'],
  ['Combine', 'Combina'],
  ['combine', 'combina'],
  ['Combines', 'Combina'],
  ['combines', 'combina'],
  ['Collect', 'Coleta'],
  ['collect', 'coleta'],
  ['Collects', 'Coleta'],
  ['collects', 'coleta'],
  ['Gather', 'Reúne'],
  ['gather', 'reúne'],
  ['Gathers', 'Reúne'],
  ['gathers', 'reúne'],
  ['Load', 'Carrega'],
  ['load', 'carrega'],
  ['Loads', 'Carrega'],
  ['loads', 'carrega'],
  ['Save', 'Salva'],
  ['save', 'salva'],
  ['Saves', 'Salva'],
  ['saves', 'salva'],
  ['Store', 'Armazena'],
  ['store', 'armazena'],
  ['Stores', 'Armazena'],
  ['stores', 'armazena'],
  ['Cache', 'Cache'],
  ['cache', 'cache'],
  ['Caches', 'Cache'],
  ['caches', 'cache em cache'],
  ['Write', 'Escreve'],
  ['write', 'escreve'],
  ['Writes', 'Escreve'],
  ['writes', 'escreve'],
  ['Read', 'Lê'],
  ['read', 'lê'],
  ['Reads', 'Lê'],
  ['reads', 'lê'],
  ['Output', 'Saída'],
  ['output', 'saída'],
  ['Input', 'Entrada'],
  ['input', 'entrada'],
  ['Send', 'Envia'],
  ['send', 'envia'],
  ['Sends', 'Envia'],
  ['sends', 'envia'],
  ['Receive', 'Recebe'],
  ['receive', 'recebe'],
  ['Receives', 'Recebe'],
  ['receives', 'recebe'],
  ['Dispatch', 'Despacha'],
  ['dispatch', 'despacha'],
  ['Dispatches', 'Despacha'],
  ['dispatches', 'despacha'],
  ['Emit', 'Emitir'],
  ['emit', 'emitir'],
  ['Emits', 'Emitir'],
  ['emits', 'emite'],
  ['Listen', 'Ouvir'],
  ['listen', 'ouvir'],
  ['Listens', 'Ouvir'],
  ['listens', 'ouve'],
  ['Subscribe', 'Inscrever'],
  ['subscribe', 'inscrever'],
  ['Notify', 'Notificar'],
  ['notify', 'notificar'],
  ['Notify', 'Notifica'],
  ['notifies', 'notifica'],
  ['Trigger', 'Acionar'],
  ['trigger', 'acionar'],
  ['Triggers', 'Aciona'],
  ['triggers', 'aciona'],
  ['Schedule', 'Agendar'],
  ['schedule', 'agendar'],
  ['Schedules', 'Agenda'],
  ['schedules', 'agenda'],
  ['Delay', 'Atrasar'],
  ['delay', 'atrasar'],
  ['Wait', 'Aguardar'],
  ['wait', 'aguardar'],
  ['Waits', 'Aguarda'],
  ['waits', 'aguarda'],
  ['Sleep', 'Dormir'],
  ['sleep', 'dormir'],
  ['Suspend', 'Suspender'],
  ['suspend', 'suspender'],
  ['Resume', 'Retomar'],
  ['resume', 'retomar'],
  ['Pause', 'Pausar'],
  ['pause', 'pausar'],
  ['Resume', 'Retomar'],
  ['resume', 'retomar'],
  ['Interrupt', 'Interromper'],
  ['interrupt', 'interromper'],
  ['Cancel', 'Cancelar'],
  ['cancel', 'cancelar'],
  ['Cancels', 'Cancela'],
  ['cancels', 'cancela'],
  ['Abort', 'Abortar'],
  ['abort', 'abortar'],
  ['Aborts', 'Aborta'],
  ['aborts', 'aborta'],
  ['Retry', 'Tentar novamente'],
  ['retry', 'tentar novamente'],
  ['Retries', 'Tenta novamente'],
  ['retries', 'tenta novamente'],
  ['Skip', 'Pular'],
  ['skip', 'pular'],
  ['Skips', 'Pula'],
  ['skips', 'pula'],
  ['Ignore', 'Ignorar'],
  ['ignore', 'ignorar'],
  ['Ignores', 'Ignora'],
  ['ignores', 'ignora'],
  ['Suppress', 'Suprimir'],
  ['suppress', 'suprimir'],
  ['Filter', 'Filtrar'],
  ['filter', 'filtrar'],
  ['Filters', 'Filtra'],
  ['filters', 'filtra'],
  ['Map', 'Mapear'],
  ['map', 'mapear'],
  ['Maps', 'Mapeia'],
  ['maps', 'mapeia'],
  ['Reduce', 'Reduzir'],
  ['reduce', 'reduzir'],
  ['Reduces', 'Reduz'],
  ['reduces', 'reduz'],
  ['Flatten', 'Achatar'],
  ['flatten', 'achatar'],
  ['Flattens', 'Achata'],
  ['flattens', 'achata'],
  ['Wrap', 'Empacotar'],
  ['wrap', 'empacotar'],
  ['Wraps', 'Empacota'],
  ['wraps', 'empacota'],
  ['Unwrap', 'Desempacotar'],
  ['unwrap', 'desempacotar'],
  ['Expand', 'Expandir'],
  ['expand', 'expandir'],
  ['Expands', 'Expande'],
  ['expands', 'expande'],
  ['Collapse', 'Colapsar'],
  ['collapse', 'colapsar'],
  ['Collapses', 'Colapsa'],
  ['collapses', 'colapsa'],
  ['Encrypt', 'Criptografar'],
  ['encrypt', 'criptografar'],
  ['Decrypt', 'Descriptografar'],
  ['decrypt', 'descriptografar'],
  ['Encode', 'Codificar'],
  ['encode', 'codificar'],
  ['Decode', 'Decodificar'],
  ['decode', 'decodificar'],
  ['Compress', 'Comprimir'],
  ['compress', 'comprimir'],
  ['Decompress', 'Descomprimir'],
  ['decompress', 'descomprimir'],
  ['Extract', 'Extrair'],
  ['extract', 'extrair'],
  ['Extracts', 'Extrai'],
  ['extracts', 'extrai'],
  ['Export', 'Exportar'],
  ['export', 'exportar'],
  ['Exports', 'Exporta'],
  ['exports', 'exporta'],
  ['Import', 'Importar'],
  ['import', 'importar'],
  ['Imports', 'Importa'],
  ['imports', 'importa'],
  ['Migrate', 'Migrar'],
  ['migrate', 'migrar'],
  ['Migrates', 'Migra'],
  ['migrates', 'migra'],
  ['Upgrade', 'Atualizar'],
  ['upgrade', 'atualizar'],
  ['Downgrade', 'Rebaixar'],
  ['downgrade', 'rebaixar'],
  ['Normalize', 'Normalizar'],
  ['normalize', 'normalizar'],
  ['Optimize', 'Otimizar'],
  ['optimize', 'otimizar'],
  ['Minimize', 'Minimizar'],
  ['minimize', 'minimizar'],
  ['Maximize', 'Maximizar'],
  ['maximize', 'maximizar'],
  ['Aggregate', 'Agregar'],
  ['aggregate', 'agregar'],
  ['Summarize', 'Resumir'],
  ['summarize', 'resumir'],
  ['Group', 'Agrupar'],
  ['group', 'agrupar'],
  ['Sort', 'Ordenar'],
  ['sort', 'ordenar'],
  ['Order', 'Ordenar'],
  ['order', 'ordenar'],
  ['Shuffle', 'Embaralhar'],
  ['shuffle', 'embaralhar'],
  ['Reverse', 'Reverter'],
  ['reverse', 'reverter'],
  ['Rotate', 'Rotacionar'],
  ['rotate', 'rotacionar'],
  ['Swap', 'Trocar'],
  ['swap', 'trocar'],
  ['Replace', 'Substituir'],
  ['replace', 'substituir'],
  ['Replaces', 'Substitui'],
  ['replaces', 'substitui'],
  ['Substitute', 'Substituir'],
  ['substitute', 'substituir'],
  ['Overwrite', 'Sobrescrever'],
  ['overwrite', 'sobrescrever'],
  ['Overrides', 'Sobrescreve'],
  ['overrides', 'sobrescreve'],
  ['Override', 'Sobrescrever'],
  ['override', 'sobrescrever'],
  ['Extend', 'Estender'],
  ['extend', 'estender'],
  ['Extends', 'Estende'],
  ['extends', 'estende'],
  ['Implement', 'Implementar'],
  ['implement', 'implementar'],
  ['Implement', 'Implementa'],
  ['implements', 'implementa'],
  ['Inherit', 'Herdar'],
  ['inherit', 'herdar'],
  ['Inherits', 'Herda'],
  ['inherits', 'herda'],
  ['Derive', 'Derivar'],
  ['derive', 'derivar'],
  ['Derives', 'Deriva'],
  ['derives', 'deriva'],
  ['Wrap', 'Encapsular'],
  ['wrap', 'encapsular'],
  ['Contain', 'Conter'],
  ['contain', 'conter'],
  ['Contains', 'Contém'],
  ['contains', 'contém'],
  ['Include', 'Incluir'],
  ['include', 'incluir'],
  ['Includes', 'Inclui'],
  ['includes', 'inclui'],
  ['Exclude', 'Excluir'],
  ['exclude', 'excluir'],
  ['Excludes', 'Exclui'],
  ['excludes', 'exclui'],
  ['Support', 'Suportar'],
  ['support', 'suportar'],
  ['Supports', 'Suporta'],
  ['supports', 'suporta'],
  ['Allow', 'Permitir'],
  ['allow', 'permitir'],
  ['Allows', 'Permite'],
  ['allows', 'permite'],
  ['Enable', 'Habilitar'],
  ['enable', 'habilitar'],
  ['Enables', 'Habilita'],
  ['enables', 'habilita'],
  ['Disable', 'Desabilitar'],
  ['disable', 'desabilitar'],
  ['Disables', 'Desabilita'],
  ['disables', 'desabilita'],
  ['Prevent', 'Prevenir'],
  ['prevent', 'prevenir'],
  ['Prevents', 'Previne'],
  ['prevents', 'previne'],
  ['Protect', 'Proteger'],
  ['protect', 'proteger'],
  ['Protects', 'Protege'],
  ['protects', 'protege'],
  ['Guard', 'Proteger'],
  ['guard', 'proteger'],
  ['Secure', 'Segurança'],
  ['secure', 'segurança'],
  ['Authenticate', 'Autenticar'],
  ['authenticate', 'autenticar'],
  ['Authorize', 'Autorizar'],
  ['authorize', 'autorizar'],
  ['Redirect', 'Redirecionar'],
  ['redirect', 'redirecionar'],
  ['Navigate', 'Navegar'],
  ['navigate', 'navegar'],
  ['Route', 'Rotea'],
  ['route', 'rotea'],
  ['Render', 'Renderizar'],
  ['render', 'renderizar'],
  ['Renders', 'Renderiza'],
  ['renders', 'renderiza'],
  ['Display', 'Exibir'],
  ['display', 'exibir'],
  ['Displays', 'Exibe'],
  ['displays', 'exibe'],
  ['Show', 'Mostrar'],
  ['show', 'mostrar'],
  ['Shows', 'Mostra'],
  ['shows', 'mostra'],
  ['Hide', 'Ocultar'],
  ['hide', 'ocultar'],
  ['Hides', 'Oculta'],
  ['hides', 'oculta'],
  ['Open', 'Abrir'],
  ['open', 'abrir'],
  ['Opens', 'Abre'],
  ['opens', 'abre'],
  ['Close', 'Fechar'],
  ['close', 'fechar'],
  ['Closes', 'Fecha'],
  ['closes', 'fecha'],
  ['Select', 'Selecionar'],
  ['select', 'selecionar'],
  ['Selects', 'Seleciona'],
  ['selects', 'seleciona'],
  ['Choose', 'Escolher'],
  ['choose', 'escolher'],
  ['Chooses', 'Escolhe'],
  ['chooses', 'escolhe'],
  ['Pick', 'Escolher'],
  ['pick', 'escolher'],
  ['Picks', 'Escolhe'],
  ['picks', 'escolhe'],
  ['Toggle', 'Alternar'],
  ['toggle', 'alternar'],
  ['Switch', 'Trocar'],
  ['switch', 'trocar'],
  ['Move', 'Mover'],
  ['move', 'mover'],
  ['Moves', 'Move'],
  ['moves', 'move'],
  ['Drag', 'Arrastar'],
  ['drag', 'arrastar'],
  ['Drop', 'Soltar'],
  ['drop', 'soltar'],
  ['Scroll', 'Rolar'],
  ['scroll', 'rolar'],
  ['Zoom', 'Ampliar'],
  ['zoom', 'ampliar'],
  ['Focus', 'Focar'],
  ['focus', 'focar'],
  ['Blur', 'Desfocar'],
  ['blur', 'desfocar'],
  ['Attach', 'Anexar'],
  ['attach', 'anexar'],
  ['Detach', 'Desanexar'],
  ['detach', 'desanexar'],
  ['Mount', 'Montar'],
  ['mount', 'montar'],
  ['Unmount', 'Desmontar'],
  ['unmount', 'desmontar'],
  ['Bind', 'Vincular'],
  ['bind', 'vincular'],
  ['Unbind', 'Desvincular'],
  ['unbind', 'desvincular'],
  ['Link', 'Linkar'],
  ['link', 'linkar'],
  ['Connect', 'Conectar'],
  ['connect', 'conectar'],
  ['Disconnect', 'Desconectar'],
  ['disconnect', 'desconectar'],
  ['Sync', 'Sincronizar'],
  ['sync', 'sincronizar'],
  ['Lock', 'Travar'],
  ['lock', 'travar'],
  ['Unlock', 'Destravar'],
  ['unlock', 'destravar'],
  ['Release', 'Liberar'],
  ['release', 'liberar'],
  ['Allocate', 'Alocar'],
  ['allocate', 'alocar'],
  ['Free', 'Liberar'],
  ['free', 'liberar'],
  ['Acquire', 'Adquirir'],
  ['acquire', 'adquirir'],
  ['Provide', 'Fornecer'],
  ['provide', 'fornecer'],
  ['Provides', 'Fornece'],
  ['provides', 'fornece'],
  ['Supply', 'Fornecer'],
  ['supply', 'fornecer'],
  ['Deliver', 'Entregar'],
  ['deliver', 'entregar'],
  ['Offer', 'Oferecer'],
  ['offer', 'oferecer'],
  ['Request', 'Solicitar'],
  ['request', 'solicitar'],
  ['Requests', 'Solicita'],
  ['requests', 'solicita'],
  ['Require', 'Exigir'],
  ['require', 'exigir'],
  ['Requires', 'Exige'],
  ['requires', 'exige'],
  ['Demand', 'Exigir'],
  ['demand', 'exigir'],
  ['Attempt', 'Tentar'],
  ['attempt', 'tentar'],
  ['Try', 'Tentar'],
  ['try', 'tentar'],
  ['Test', 'Testar'],
  ['test', 'testar'],
  ['Debug', 'Depurar'],
  ['debug', 'depurar'],
  ['Log', 'Registrar'],
  ['log', 'registrar'],
  ['Trace', 'Rastrear'],
  ['trace', 'rastrear'],
  ['Monitor', 'Monitorar'],
  ['monitor', 'monitorar'],
  ['Watch', 'Observar'],
  ['watch', 'observar'],
  ['Inspect', 'Inspecionar'],
  ['inspect', 'inspecionar'],
  ['Profile', 'Perfil'],
  ['profile', 'perfil'],
  ['Benchmark', 'Benchmark'],
  ['benchmark', 'benchmark'],

  // Substantivos técnicos
  ['Array', 'Array'],
  ['array', 'array'],
  ['Object', 'Objeto'],
  ['object', 'objeto'],
  ['Function', 'Função'],
  ['function', 'função'],
  ['Method', 'Método'],
  ['method', 'método'],
  ['Property', 'Propriedade'],
  ['property', 'propriedade'],
  ['Attribute', 'Atributo'],
  ['attribute', 'atributo'],
  ['Field', 'Campo'],
  ['field', 'campo'],
  ['Variable', 'Variável'],
  ['variable', 'variável'],
  ['Constant', 'Constante'],
  ['constant', 'constante'],
  ['Parameter', 'Parâmetro'],
  ['parameter', 'parâmetro'],
  ['Argument', 'Argumento'],
  ['argument', 'argumento'],
  ['Return value', 'Valor de retorno'],
  ['return value', 'valor de retorno'],
  ['Callback', 'Callback'],
  ['callback', 'callback'],
  ['Promise', 'Promise'],
  ['promise', 'promise'],
  ['Stream', 'Stream'],
  ['stream', 'stream'],
  ['Observer', 'Observador'],
  ['observer', 'observador'],
  ['Listener', 'Listener'],
  ['listener', 'listener'],
  ['Event', 'Evento'],
  ['event', 'evento'],
  ['Handler', 'Manipulador'],
  ['handler', 'manipulador'],
  ['Middleware', 'Middleware'],
  ['middleware', 'middleware'],
  ['Plugin', 'Plugin'],
  ['plugin', 'plugin'],
  ['Extension', 'Extensão'],
  ['extension', 'extensão'],
  ['Module', 'Módulo'],
  ['module', 'módulo'],
  ['Package', 'Pacote'],
  ['package', 'pacote'],
  ['Library', 'Biblioteca'],
  ['library', 'biblioteca'],
  ['Framework', 'Framework'],
  ['framework', 'framework'],
  ['Interface', 'Interface'],
  ['interface', 'interface'],
  ['Protocol', 'Protocolo'],
  ['protocol', 'protocolo'],
  ['Adapter', 'Adaptador'],
  ['adapter', 'adaptador'],
  ['Bridge', 'Ponte'],
  ['bridge', 'ponte'],
  ['Proxy', 'Proxy'],
  ['proxy', 'proxy'],
  ['Factory', 'Fábrica'],
  ['factory', 'fábrica'],
  ['Singleton', 'Singleton'],
  ['singleton', 'singleton'],
  ['Decorator', 'Decorador'],
  ['decorator', 'decorador'],
  ['Strategy', 'Estratégia'],
  ['strategy', 'estratégia'],
  ['Provider', 'Provedor'],
  ['provider', 'provedor'],
  ['Consumer', 'Consumidor'],
  ['consumer', 'consumidor'],
  ['Client', 'Cliente'],
  ['client', 'cliente'],
  ['Server', 'Servidor'],
  ['server', 'servidor'],
  ['Service', 'Serviço'],
  ['service', 'serviço'],
  ['Database', 'Banco de dados'],
  ['database', 'banco de dados'],
  ['Connection', 'Conexão'],
  ['connection', 'conexão'],
  ['Session', 'Sessão'],
  ['session', 'sessão'],
  ['Transaction', 'Transação'],
  ['transaction', 'transação'],
  ['Query', 'Consulta'],
  ['query', 'consulta'],
  ['Mutation', 'Mutação'],
  ['mutation', 'mutação'],
  ['Schema', 'Schema'],
  ['schema', 'schema'],
  ['Model', 'Modelo'],
  ['model', 'modelo'],
  ['View', 'Visão'],
  ['view', 'visão'],
  ['Controller', 'Controlador'],
  ['controller', 'controlador'],
  ['Component', 'Componente'],
  ['component', 'componente'],
  ['Element', 'Elemento'],
  ['element', 'elemento'],
  ['Node', 'Nó'],
  ['node', 'nó'],
  ['Container', 'Container'],
  ['container', 'container'],
  ['Wrapper', 'Wrapper'],
  ['wrapper', 'wrapper'],
  ['Utility', 'Utilitário'],
  ['utility', 'utilitário'],
  ['Helper', 'Auxiliar'],
  ['helper', 'auxiliar'],
  ['Manager', 'Gerenciador'],
  ['manager', 'gerenciador'],
  ['Registry', 'Registro'],
  ['registry', 'registro'],
  ['Repository', 'Repositório'],
  ['repository', 'repositório'],
  ['Store', 'Armazenamento'],
  ['store', 'armazenamento'],
  ['Cache', 'Cache'],
  ['cache', 'cache'],
  ['Buffer', 'Buffer'],
  ['buffer', 'buffer'],
  ['Queue', 'Fila'],
  ['queue', 'fila'],
  ['Stack', 'Pilha'],
  ['stack', 'pilha'],
  ['Heap', 'Heap'],
  ['heap', 'heap'],
  ['Map', 'Mapa'],
  ['map', 'mapa'],
  ['Set', 'Conjunto'],
  ['Collection', 'Coleção'],
  ['collection', 'coleção'],
  ['List', 'Lista'],
  ['list', 'lista'],
  ['Tree', 'Árvore'],
  ['tree', 'árvore'],
  ['Graph', 'Grafo'],
  ['graph', 'grafo'],
  ['Table', 'Tabela'],
  ['table', 'tabela'],
  ['Row', 'Linha'],
  ['row', 'linha'],
  ['Column', 'Coluna'],
  ['column', 'coluna'],
  ['Key', 'Chave'],
  ['key', 'chave'],
  ['Value', 'Valor'],
  ['value', 'valor'],
  ['Type', 'Tipo'],
  ['type', 'tipo'],
  ['String', 'String'],
  ['string', 'string'],
  ['Number', 'Número'],
  ['number', 'número'],
  ['Boolean', 'Booleano'],
  ['boolean', 'booleano'],
  ['Integer', 'Inteiro'],
  ['integer', 'inteiro'],
  ['Float', 'Flutuante'],
  ['float', 'flutuante'],
  ['Double', 'Duplo'],
  ['Record', 'Registro'],
  ['record', 'registro'],
  ['Pointer', 'Ponteiro'],
  ['pointer', 'ponteiro'],
  ['Reference', 'Referência'],
  ['reference', 'referência'],
  ['Handle', 'Handle'],
  ['handle', 'handle'],
  ['Token', 'Token'],
  ['token', 'token'],
  ['Flag', 'Flag'],
  ['flag', 'flag'],
  ['Option', 'Opção'],
  ['option', 'opção'],
  ['Setting', 'Configuração'],
  ['setting', 'configuração'],
  ['Configuration', 'Configuração'],
  ['configuration', 'configuração'],
  ['Preference', 'Preferência'],
  ['preference', 'preferência'],
  ['Policy', 'Política'],
  ['policy', 'política'],
  ['Rule', 'Regra'],
  ['rule', 'regra'],
  ['Condition', 'Condição'],
  ['condition', 'condição'],
  ['Constraint', 'Restrição'],
  ['constraint', 'restrição'],
  ['Boundary', 'Limite'],
  ['boundary', 'limite'],
  ['Scope', 'Escopo'],
  ['scope', 'escopo'],
  ['Context', 'Contexto'],
  ['context', 'contexto'],
  ['State', 'Estado'],
  ['state', 'estado'],
  ['Status', 'Status'],
  ['status', 'status'],
  ['Mode', 'Modo'],
  ['mode', 'modo'],
  ['Phase', 'Fase'],
  ['phase', 'fase'],
  ['Stage', 'Estágio'],
  ['stage', 'estágio'],
  ['Level', 'Nível'],
  ['level', 'nível'],
  ['Version', 'Versão'],
  ['version', 'versão'],
  ['Revision', 'Revisão'],
  ['revision', 'revisão'],
  ['Build', 'Build'],
  ['build', 'build'],
  ['Release', 'Release'],
  ['release', 'release'],
  ['Deploy', 'Deploy'],
  ['deploy', 'deploy'],
  ['Environment', 'Ambiente'],
  ['environment', 'ambiente'],
  ['Platform', 'Plataforma'],
  ['platform', 'plataforma'],
  ['Target', 'Alvo'],
  ['target', 'alvo'],
  ['Source', 'Fonte'],
  ['source', 'fonte'],
  ['Destination', 'Destino'],
  ['destination', 'destino'],
  ['Path', 'Caminho'],
  ['path', 'caminho'],
  ['Directory', 'Diretório'],
  ['directory', 'diretório'],
  ['Folder', 'Pasta'],
  ['folder', 'pasta'],
  ['File', 'Arquivo'],
  ['file', 'arquivo'],
  ['Binary', 'Binário'],
  ['binary', 'binário'],
  ['Process', 'Processo'],
  ['process', 'processo'],
  ['Thread', 'Thread'],
  ['thread', 'thread'],
  ['Worker', 'Worker'],
  ['worker', 'worker'],
  ['Task', 'Tarefa'],
  ['task', 'tarefa'],
  ['Job', 'Job'],
  ['job', 'job'],
  ['Operation', 'Operação'],
  ['operation', 'operação'],
  ['Action', 'Ação'],
  ['action', 'ação'],
  ['Command', 'Comando'],
  ['command', 'comando'],
  ['Instruction', 'Instrução'],
  ['instruction', 'instrução'],
  ['Request', 'Requisição'],
  ['request', 'requisição'],
  ['Response', 'Resposta'],
  ['response', 'resposta'],
  ['Message', 'Mensagem'],
  ['message', 'mensagem'],
  ['Signal', 'Sinal'],
  ['signal', 'sinal'],
  ['Payload', 'Payload'],
  ['payload', 'payload'],
  ['Header', 'Cabeçalho'],
  ['header', 'cabeçalho'],
  ['Footer', 'Rodapé'],
  ['footer', 'rodapé'],
  ['Body', 'Corpo'],
  ['body', 'corpo'],
  ['Metadata', 'Metadados'],
  ['metadata', 'metadados'],
  ['Permission', 'Permissão'],
  ['permission', 'permissão'],
  ['Privilege', 'Privilégio'],
  ['privilege', 'privilégio'],
  ['Access', 'Acesso'],
  ['access', 'acesso'],
  ['Grant', 'Conceder'],
  ['grant', 'conceder'],
  ['Deny', 'Negar'],
  ['deny', 'negar'],
  ['Revoke', 'Revogar'],
  ['revoke', 'revogar'],

  // Artigos/preposições/conjunções
  ['the', 'o'],
  ['The', 'O'],
  ['a ', 'um '],
  ['A ', 'Um '],
  ['an ', 'um '],
  ['An ', 'Um '],
  ['is', 'é'],
  ['Is', 'É'],
  ['are', 'são'],
  ['Are', 'São'],
  ['was', 'era'],
  ['Was', 'Era'],
  ['were', 'eram'],
  ['Were', 'Eram'],
  ['be', 'ser'],
  ['been', 'sido'],
  ['being', 'sendo'],
  ['have', 'ter'],
  ['has', 'tem'],
  ['had', 'tinha'],
  ['do', 'fazer'],
  ['does', 'faz'],
  ['did', 'fez'],
  ['done', 'feito'],
  ['doing', 'fazendo'],
  ['can', 'pode'],
  ['could', 'poderia'],
  ['will', 'vai'],
  ['would', 'iria'],
  ['should', 'deve'],
  ['must', 'precisa'],
  ['may', 'pode'],
  ['might', 'pode ser'],
  ['shall', 'deverá'],
  ['about', 'sobre'],
  ['above', 'acima'],
  ['across', 'através'],
  ['after', 'após'],
  ['again', 'novamente'],
  ['against', 'contra'],
  ['all', 'todos'],
  ['almost', 'quase'],
  ['along', 'ao longo'],
  ['already', 'já'],
  ['also', 'também'],
  ['although', 'embora'],
  ['always', 'sempre'],
  ['among', 'entre'],
  ['another', 'outro'],
  ['any', 'qualquer'],
  ['anything', 'qualquer coisa'],
  ['anywhere', 'em qualquer lugar'],
  ['around', 'ao redor'],
  ['as', 'como'],
  ['away', 'longe'],
  ['back', 'voltar'],
  ['because', 'porque'],
  ['before', 'antes'],
  ['behind', 'atrás'],
  ['below', 'abaixo'],
  ['beneath', 'debaixo'],
  ['beside', 'ao lado'],
  ['between', 'entre'],
  ['beyond', 'além'],
  ['both', 'ambos'],
  ['but', 'mas'],
  ['by', 'por'],
  ['called', 'chamado'],
  ['certain', 'certo'],
  ['certainly', 'certamente'],
  ['clear', 'claro'],
  ['clearly', 'claramente'],
  ['commonly', 'comumente'],
  ['currently', 'atualmente'],
  ['down', 'abaixo'],
  ['during', 'durante'],
  ['each', 'cada'],
  ['either', 'qualquer um'],
  ['else', 'senão'],
  ['especially', 'especialmente'],
  ['etc', 'etc'],
  ['even', 'até'],
  ['ever', 'já'],
  ['every', 'todo'],
  ['everyone', 'todos'],
  ['everything', 'tudo'],
  ['everywhere', 'em todo lugar'],
  ['exactly', 'exatamente'],
  ['far', 'longe'],
  ['few', 'poucos'],
  ['finally', 'finalmente'],
  ['first', 'primeiro'],
  ['following', 'seguinte'],
  ['for', 'para'],
  ['forth', 'adiante'],
  ['forward', 'para frente'],
  ['from', 'de'],
  ['full', 'completo'],
  ['fully', 'completamente'],
  ['further', 'mais'],
  ['furthermore', 'além disso'],
  ['generally', 'geralmente'],
  ['great', 'grande'],
  ['greatly', 'grandemente'],
  ['here', 'aqui'],
  ['high', 'alto'],
  ['highly', 'altamente'],
  ['how', 'como'],
  ['however', 'no entanto'],
  ['immediately', 'imediatamente'],
  ['in', 'em'],
  ['including', 'incluindo'],
  ['indeed', 'de fato'],
  ['inside', 'dentro'],
  ['instead', 'em vez disso'],
  ['into', 'dentro de'],
  ['itself', 'si mesmo'],
  ['just', 'apenas'],
  ['large', 'grande'],
  ['largely', 'amplamente'],
  ['last', 'último'],
  ['later', 'depois'],
  ['latter', 'último'],
  ['least', 'menos'],
  ['less', 'menos'],
  ['like', 'como'],
  ['likely', 'provavelmente'],
  ['little', 'pouco'],
  ['long', 'longo'],
  ['low', 'baixo'],
  ['lower', 'inferior'],
  ['main', 'principal'],
  ['mainly', 'principalmente'],
  ['many', 'muitos'],
  ['may', 'pode'],
  ['maybe', 'talvez'],
  ['mean', 'significar'],
  ['means', 'significa'],
  ['more', 'mais'],
  ['most', 'maioria'],
  ['mostly', 'majoritariamente'],
  ['much', 'muito'],
  ['name', 'nome'],
  ['near', 'perto'],
  ['nearly', 'quase'],
  ['necessary', 'necessário'],
  ['neither', 'nenhum'],
  ['never', 'nunca'],
  ['next', 'próximo'],
  ['no', 'não'],
  ['nobody', 'ninguém'],
  ['none', 'nenhum'],
  ['nor', 'nem'],
  ['normally', 'normalmente'],
  ['not', 'não'],
  ['nothing', 'nada'],
  ['now', 'agora'],
  ['nowhere', 'em lugar nenhum'],
  ['obviously', 'obviamente'],
  ['of', 'de'],
  ['off', 'fora'],
  ['often', 'frequentemente'],
  ['on', 'em'],
  ['once', 'uma vez'],
  ['only', 'apenas'],
  ['onto', 'para'],
  ['or', 'ou'],
  ['other', 'outro'],
  ['otherwise', 'caso contrário'],
  ['our', 'nosso'],
  ['out', 'fora'],
  ['outside', 'fora de'],
  ['over', 'sobre'],
  ['own', 'próprio'],
  ['particular', 'particular'],
  ['particularly', 'particularmente'],
  ['per', 'por'],
  ['perhaps', 'talvez'],
  ['please', 'por favor'],
  ['possible', 'possível'],
  ['possibly', 'possivelmente'],
  ['previous', 'anterior'],
  ['previously', 'anteriormente'],
  ['primary', 'primário'],
  ['probably', 'provavelmente'],
  ['proper', 'próprio'],
  ['properly', 'propriamente'],
  ['quick', 'rápido'],
  ['quickly', 'rapidamente'],
  ['quite', 'bastante'],
  ['rather', 'em vez'],
  ['really', 'realmente'],
  ['recent', 'recente'],
  ['recently', 'recentemente'],
  ['regardless', 'independentemente'],
  ['right', 'direito'],
  ['same', 'mesmo'],
  ['second', 'segundo'],
  ['seldom', 'raramente'],
  ['several', 'vários'],
  ['short', 'curto'],
  ['shortly', 'brevemente'],
  ['significantly', 'significativamente'],
  ['similar', 'similar'],
  ['similarly', 'similarmente'],
  ['simple', 'simples'],
  ['simply', 'simplesmente'],
  ['since', 'desde'],
  ['slightly', 'ligeiramente'],
  ['slow', 'lento'],
  ['slowly', 'lentamente'],
  ['small', 'pequeno'],
  ['so', 'então'],
  ['some', 'alguns'],
  ['somebody', 'alguém'],
  ['someone', 'alguém'],
  ['something', 'algo'],
  ['sometimes', 'às vezes'],
  ['somewhat', 'um pouco'],
  ['somewhere', 'em algum lugar'],
  ['soon', 'logo'],
  ['specific', 'específico'],
  ['specifically', 'especificamente'],
  ['still', 'ainda'],
  ['straight', 'direto'],
  ['strong', 'forte'],
  ['strongly', 'fortemente'],
  ['subsequent', 'subsequente'],
  ['subsequently', 'subsequentemente'],
  ['sufficient', 'suficiente'],
  ['sufficiently', 'suficientemente'],
  ['sure', 'certo'],
  ['surely', 'certamente'],
  ['then', 'então'],
  ['there', 'lá'],
  ['thereafter', 'após isso'],
  ['thereby', 'assim'],
  ['therefore', 'portanto'],
  ['therein', 'nisso'],
  ['thereof', 'disso'],
  ['thereon', 'nisso'],
  ['thereto', 'a isso'],
  ['thereupon', 'com isso'],
  ['therewith', 'com isso'],
  ['thorough', 'completo'],
  ['thoroughly', 'completamente'],
  ['through', 'através'],
  ['throughout', 'por todo'],
  ['thus', 'assim'],
  ['till', 'até'],
  ['together', 'juntos'],
  ['too', 'também'],
  ['toward', 'em direção a'],
  ['towards', 'em direção a'],
  ['true', 'verdadeiro'],
  ['truly', 'verdadeiramente'],
  ['typical', 'típico'],
  ['typically', 'tipicamente'],
  ['under', 'sob'],
  ['unless', 'a menos que'],
  ['unlike', 'diferente de'],
  ['unlikely', 'improvável'],
  ['until', 'até'],
  ['unto', 'para'],
  ['up', 'para cima'],
  ['upon', 'sobre'],
  ['us', 'nós'],
  ['use', 'uso'],
  ['useful', 'útil'],
  ['useless', 'inútil'],
  ['usual', 'usual'],
  ['usually', 'geralmente'],
  ['various', 'vários'],
  ['very', 'muito'],
  ['via', 'via'],
  ['well', 'bem'],
  ['what', 'o que'],
  ['whatever', 'qualquer que seja'],
  ['when', 'quando'],
  ['whenever', 'sempre que'],
  ['where', 'onde'],
  ['whereas', 'enquanto'],
  ['whereby', 'pelo qual'],
  ['wherein', 'no qual'],
  ['whereupon', 'após o que'],
  ['wherever', 'onde quer que'],
  ['whether', 'se'],
  ['which', 'que'],
  ['whichever', 'qualquer que'],
  ['while', 'enquanto'],
  ['who', 'quem'],
  ['whoever', 'quem quer que'],
  ['whom', 'quem'],
  ['whose', 'cujo'],
  ['why', 'por que'],
  ['wide', 'amplo'],
  ['widely', 'amplamente'],
  ['with', 'com'],
  ['within', 'dentro de'],
  ['without', 'sem'],
  ['worth', 'vale'],
  ['would', 'iria'],
  ['yet', 'ainda'],
  ['yes', 'sim'],
]);

// ─── Utilitários ───

function isCodeIdentifier(word) {
  // camelCase, PascalCase, snake_case, UPPER_CASE, kebab-case, números, etc.
  return /^[a-z_$][a-zA-Z0-9_$]*$/.test(word) && !/^[A-Za-z]{2,12}$/.test(word);
}

function translateText(text) {
  // Preserva blocos de código entre backticks
  const codeBlocks = [];
  let i = 0;
  let result = '';

  while (i < text.length) {
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        codeBlocks.push(text.slice(i, end + 1));
        result += `\x00CODE${codeBlocks.length - 1}\x00`;
        i = end + 1;
        continue;
      }
    }
    result += text[i];
    i++;
  }

  // Traduz palavras usando dicionário
  let words = result.split(/(\s+)/);
  let translated = words.map(word => {
    // Preserva placeholders de código
    if (word.startsWith('\x00CODE')) return word;

    const clean = word.replace(/^[^a-zA-Z]*/, '').replace(/[^a-zA-Z]*$/, '');
    const punctBefore = word.slice(0, word.length - clean.length);
    const punctAfter = word.slice(clean.length + punctBefore.length);

    if (!clean || isCodeIdentifier(clean)) return word;

    const translated = DICT.get(clean);
    if (translated) return punctBefore + translated + punctAfter;

    // Tenta lowercase
    const lower = clean.toLowerCase();
    const capFirst = clean[0].toUpperCase() + clean.slice(1).toLowerCase();

    if (DICT.has(lower)) {
      const t = DICT.get(lower);
      if (clean[0] === clean[0].toUpperCase() && clean.length > 1) {
        return punctBefore + t[0].toUpperCase() + t.slice(1) + punctAfter;
      }
      return punctBefore + t + punctAfter;
    }

    if (DICT.has(capFirst)) {
      return punctBefore + DICT.get(capFirst) + punctAfter;
    }

    return word;
  }).join('');

  // Restaura blocos de código
  translated = translated.replace(/\x00CODE(\d+)\x00/g, (_, idx) => codeBlocks[parseInt(idx)]);

  return translated;
}

// ─── Parser char-a-char ───

function parseAndTranslate(content, filePath) {
  const lines = content.split('\n');
  const result = [];
  let inBlockComment = false;
  let blockAccum = [];
  let modified = false;
  let commentCount = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];

    if (inBlockComment) {
      blockAccum.push(line);
      const endIdx = line.indexOf('*/');
      if (endIdx !== -1) {
        // Fim do block comment
        inBlockComment = false;
        const fullComment = blockAccum.join('\n');
        const translated = translateBlockComment(fullComment);
        if (translated !== fullComment) {
          result.push(...translated.split('\n'));
          modified = true;
          commentCount++;
        } else {
          result.push(...blockAccum);
        }
        blockAccum = [];
      }
      continue;
    }

    // Verifica se a linha contém um block comment iniciando
    const blockStart = line.indexOf('/*');
    const lineComment = line.indexOf('//');

    if (blockStart !== -1) {
      const endIdx = line.indexOf('*/', blockStart + 2);
      if (endIdx !== -1) {
        // Block comment completo em uma linha
        const before = line.slice(0, blockStart);
        const comment = line.slice(blockStart, endIdx + 2);
        const after = line.slice(endIdx + 2);
        const translated = translateBlockComment(comment);
        if (translated !== comment) {
          result.push(before + translated + after);
          modified = true;
          commentCount++;
        } else {
          result.push(line);
        }
      } else {
        // Block comment multi-linha começa aqui
        inBlockComment = true;
        blockAccum = [line];
      }
      continue;
    }

    // Comentário de linha //
    if (lineComment !== -1) {
      // Verifica se // está dentro de uma string
      if (!isInString(line, lineComment)) {
        const before = line.slice(0, lineComment);
        const comment = line.slice(lineComment);
        const translated = translateLineComment(comment);
        if (translated !== comment) {
          result.push(before + translated);
          modified = true;
          commentCount++;
        } else {
          result.push(line);
        }
        continue;
      }
    }

    result.push(line);
  }

  if (inBlockComment) {
    // Comentário não fechado — mantém como está
    result.push(...blockAccum);
  }

  return { text: result.join('\n'), modified, commentCount };
}

function isInString(line, pos) {
  // Simplificado: verifica se pos está entre aspas (última aspa antes é ímpar)
  let inSingle = false, inDouble = false;
  for (let i = 0; i < pos; i++) {
    if (line[i] === '\\') { i++; continue; }
    if (line[i] === "'" && !inDouble) inSingle = !inSingle;
    if (line[i] === '"' && !inSingle) inDouble = !inDouble;
  }
  return inSingle || inDouble;
}

function translateLineComment(comment) {
  const prefix = comment.startsWith('//') ? '//' : '';
  const text = comment.slice(prefix.length);
  const translated = translateText(text);
  if (translated === text) return comment;
  return prefix + translated;
}

function translateBlockComment(comment) {
  if (!comment.startsWith('/*') || !comment.endsWith('*/')) return comment;
  const inner = comment.slice(2, -2);
  const translated = translateText(inner);
  if (translated === inner) return comment;
  return '/*' + translated + '*/';
}

// ─── IO ───

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.rs', '.mjs']);
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'out', '.git', 'target', 'build', '.claude']);

function* walkDir(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) yield* walkDir(full);
      } else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
        yield full;
      }
    }
  } catch {
    // skip dirs sem permissão
  }
}

function processFile(filePath) {
  const ext = path.extname(filePath);
  if (!EXTENSIONS.has(ext)) return;

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return;
  }

  // Verifica se tem comentários antes de processar
  if (!/(\/\/|\/\*)/.test(content)) return;

  const { text, modified, commentCount } = parseAndTranslate(content, filePath);

  if (modified) {
    // Backup
    const bakPath = filePath + BACKUP_SUFFIX;
    if (!fs.existsSync(bakPath)) {
      fs.writeFileSync(bakPath, content, 'utf8');
    }

    fs.writeFileSync(filePath, text, 'utf8');
    totalComments += commentCount;
    totalFiles++;
    console.log(`  ✓ ${path.relative(ROOT, filePath)} (${commentCount} comentários)`);
  }
}

function cleanBackups(root) {
  let count = 0;
  for (const file of walkDir(root)) {
    if (file.endsWith(BACKUP_SUFFIX)) {
      fs.unlinkSync(file);
      count++;
    }
  }
  return count;
}

// ─── Main ───

function main() {
  const args = process.argv.slice(2);
  const cleanMode = args.includes('--clean');
  const apply = args.includes('--apply');
  const showBackup = args.includes('--backup');
  const showRestore = args.includes('--restore');

  if (cleanMode) {
    const n = cleanBackups(ROOT);
    console.log(`🧹 ${n} arquivos .bak removidos.`);
    return;
  }

  if (showBackup) {
    console.log('\n📦 Arquivos de backup (.bak) criados durante a tradução:');
    let count = 0;
    for (const file of walkDir(ROOT)) {
      if (file.endsWith(BACKUP_SUFFIX)) {
        console.log(`  ${path.relative(ROOT, file)}`);
        count++;
      }
    }
    if (count === 0) console.log('  (nenhum)');
    return;
  }

  if (showRestore) {
    console.log('\n🔄 Restaurando arquivos dos backups...');
    let restored = 0;
    for (const file of walkDir(ROOT)) {
      if (file.endsWith(BACKUP_SUFFIX)) {
        const original = file.slice(0, -4);
        fs.copyFileSync(file, original);
        fs.unlinkSync(file);
        console.log(`  ✓ ${path.relative(ROOT, original)}`);
        restored++;
      }
    }
    console.log(`\n✅ ${restored} arquivos restaurados.`);
    return;
  }

  if (!apply) {
    console.log('\n🔍 MODO SIMULAÇÃO (nenhum arquivo será modificado)');
    console.log('   Use --apply para realmente traduzir.\n');

    for (const dir of [path.join(ROOT, 'electron'), path.join(ROOT, 'src'), path.join(ROOT, 'native-module', 'src')]) {
      if (!fs.existsSync(dir)) continue;
      const dirName = path.relative(ROOT, dir);
      console.log(`\n📁 ${dirName}/`);
      let fileCount = 0;
      for (const file of walkDir(dir)) {
        const content = fs.readFileSync(file, 'utf8');
        if (/(\/\/|\/\*)/.test(content)) {
          console.log(`  ${path.relative(ROOT, file)}`);
          fileCount++;
        }
      }
      if (fileCount === 0) console.log('  (sem comentários)');
      console.log(`  Total: ${fileCount} arquivos com comentários`);
    }

    console.log('\n🏁 Simulação completa. Execute com --apply para traduzir.');
    return;
  }

  // Modo apply
  console.log('\n🔄 Traduzindo comentários...\n');

  const dirs = [
    path.join(ROOT, 'electron'),
    path.join(ROOT, 'src'),
    path.join(ROOT, 'native-module', 'src'),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const dirName = path.relative(ROOT, dir);
    console.log(`📁 ${dirName}/`);
    for (const file of walkDir(dir)) {
      processFile(file);
    }
  }

  console.log(`\n✅ ${totalFiles} arquivos modificados, ${totalComments} comentários traduzidos.`);
  console.log('📦 Backups salvos com .bak (use --restore para restaurar)');
}

main();
