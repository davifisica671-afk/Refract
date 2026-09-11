/**
 * ============================================================
 * PONTO DE ENTRADA DA APLICAÇÃO REACT (main.tsx)
 * ============================================================
 * 
 * Este é o primeiro arquivo JavaScript/TypeScript executado pelo React.
 * Ele faz três coisas principais:
 * 
 * 1. CONFIGURAÇÃO PRÉ-RENDERIZAÇÃO:
 *    - Define o atributo data-platform no <html> para que seletores CSS
 *      como [data-platform="win32"] funcionem antes do React carregar
 *    - Aplica o tema (claro/escuro) armazenado em cache no localStorage
 *      para evitar um "flash" de tema errado na primeira renderização
 * 
 * 2. SINCRONIZAÇÃO COM O PROCESSO PRINCIPAL:
 *    - Após o React carregar, confirma o tema correto com o processo
 *      principal do Electron (que é a fonte autoritativa)
 *    - Escuta mudanças de tema em tempo real via IPC
 * 
 * 3. RENDERIZAÇÃO:
 *    - Cria a raiz React e renderiza o componente <App />
 *    - Usa React.StrictMode para detectar problemas durante o desenvolvimento
 * 
 * ARQUITETURA: Este arquivo roda no RENDERER PROCESS do Electron,
 * que é essencialmente uma janela Chromium carregando um app React.
 * ============================================================
 */

// ============================================================
// IMPORTAÇÕES
// ============================================================

import React from "react"       // Biblioteca principal do React para criar componentes
import ReactDOM from "react-dom/client" // API de renderização do React 18+ (createRoot)
import App from "./App"          // Componente raiz da aplicação
import "./index.css"             // Estilos globais (Tailwind CSS + estilos base)

// ============================================================
// CONSTANTE: CHAVE DO CACHE DO TEMA
// ============================================================
// Usada para armazenar o tema resolvido (light/dark) no localStorage
// do navegador, permitindo aplicação instantânea na próxima inicialização
const THEME_CACHE_KEY = 'refract_resolved_theme';

// ============================================================
// Compatibilidade: chaves legadas do localStorage → chaves atuais
// ============================================================
// Preserva preferências de instalações anteriores (migração única por chave).
// As entradas legadas podem ser removidas em versão futura, após janela
// suficiente de migração.
function migrateLocalStorageKey(oldKey: string, newKey: string): void {
  if (localStorage.getItem(newKey) !== null) return;
  const old = localStorage.getItem(oldKey);
  if (old !== null) {
    localStorage.setItem(newKey, old);
    localStorage.removeItem(oldKey);
  }
}

const LOCAL_STORAGE_MIGRATIONS: [string, string][] = [
  ['natively_resolved_theme', 'refract_resolved_theme'],
  ['natively_meeting_interface_theme', 'refract_meeting_interface_theme'],
  ['natively_has_launched', 'refract_has_launched'],
  ['natively_user_name', 'refract_user_name'],
  ['natively_feature_interest', 'refract_feature_interest'],
  ['natively_app_opens_count', 'refract_app_opens_count'],
  ['natively_session_open_tracked', 'refract_session_open_tracked'],
  ['natively_session_toaster_shown', 'refract_session_toaster_shown'],
  ['natively_groq_fast_text', 'refract_groq_fast_text'],
];

LOCAL_STORAGE_MIGRATIONS.forEach(([oldKey, newKey]) => migrateLocalStorageKey(oldKey, newKey));

// ============================================================
// CONFIGURAÇÃO PRÉ-RENDERIZAÇÃO DA PLATAFORMA
// ============================================================
// Define o atributo data-platform no elemento <html> SYNCRONAMENTE,
// antes do React começar a renderizar. Isso permite que seletores CSS
// como html[data-platform="win32"] ou html[data-platform="darwin"]
// funcionem imediatamente, sem esperar o React inicializar.
// 
// Por que isso importa? Sem isso, haveria um "flash" onde elementos
// que dependem da plataforma apareceriam incorretamente por alguns
// milissegundos antes do React aplicar as classes corretas.
// 
// window.electronAPI?.platform é a forma preferida (injetada pelo preload)
// process?.platform é o fallback para ambientes de desenvolvimento web
document.documentElement.setAttribute(
  'data-platform',
  window.electronAPI?.platform ??
    (typeof process !== 'undefined' ? process.platform : navigator.platform) ??
    ''
);

// ============================================================
// CONFIGURAÇÃO PRÉ-RENDERIZAÇÃO DO TEMA
// ============================================================
// Lê o tema armazenado em cache no localStorage e aplica IMEDIATAMENTE
// no elemento <html>. Isso garante que o useState inicial do hook
// useResolvedTheme() leia o valor correto do tema (light ou dark).
//
// Se não houver tema em cache, assume 'dark' como padrão.
// O tipo 'as' faz uma afirmação de tipo (type assertion) para o TypeScript.
const cachedTheme = localStorage.getItem(THEME_CACHE_KEY) as 'light' | 'dark' | null;
document.documentElement.setAttribute('data-theme', cachedTheme ?? 'dark');

// ============================================================
// SINCRONIZAÇÃO COM O PROCESSO PRINCIPAL DO ELECTRON
// ============================================================
// O processo principal (main.ts) é a "fonte autoritativa" do tema.
// Após o React carregar, buscamos o tema correto do processo principal
// e atualizamos o DOM + localStorage para manter tudo sincronizado.
//
// Também escutamos o evento onThemeChanged para atualizar o tema
// em tempo real quando o usuário muda nas configurações.
if (window.electronAPI?.getThemeMode) {
  // Buscar tema do processo principal e aplicar
  window.electronAPI.getThemeMode().then(({ resolved }) => {
    document.documentElement.setAttribute('data-theme', resolved); // Atualizar o DOM
    localStorage.setItem(THEME_CACHE_KEY, resolved);               // Atualizar o cache
  }).catch(() => {}); // Ignorar erros silenciosamente (o tema em cache já foi aplicado)

  // Escutar mudanças de tema em tempo real via IPC (Inter-Process Communication)
  window.electronAPI?.onThemeChanged?.(({ resolved }) => {
    document.documentElement.setAttribute('data-theme', resolved); // Atualizar o DOM
    localStorage.setItem(THEME_CACHE_KEY, resolved);               // Atualizar o cache
  });
}

// ============================================================
// RENDERIZAÇÃO DA APLICAÇÃO
// ============================================================
// ReactDOM.createRoot() é a API do React 18+ para criar a raiz de renderização.
// document.getElementById("root")! busca o elemento <div id="root"> no index.html.
// O operador ! (non-null assertion) diz ao TypeScript que o elemento não é null.
//
// React.StrictMode é um wrapper que ativa verificações extras durante o desenvolvimento:
// - Renderiza componentes duas vezes (para detectar efeitos colaterais)
// - Deprecia funções de lifecycle obsoletas
// - Detecta problemas de performance
// NÃO afeta a produção - apenas o modo desenvolvimento.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
