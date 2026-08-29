import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

/**
 * ISSUE 3 (P1): Custom cURL provedor SSRF Protection
 *
 * O chatWithCurl função accepts a URL template de o cURL comando and
 * executa variável substitution, então passes o resulting URL directly to axios
 * sem validating it contra internal/private address ranges.
 *
 * This permite SSRF attacks onde an attacker poderia talvo
 * - localhost (127.0.0.1, ::1)
 * - link-local (169.254.0.0/16)
 * - private networks (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 *
 * Fix: Adiciona URL validation antes making o rrequisição
 */

test('chatWithCurl validates URL against SSRF-protected address ranges', () => {
  const source = read('electron/LLMHelper.ts');

  // Encontra o chatWithCurl função
  const chatWithCurlStart = source.indexOf('public async chatWithCurl(');
  assert.ok(chatWithCurlStart >= 0, 'chatWithCurl function should exist');

  // Extrair o função corpo
  const functionEnd = source.indexOf(/\n\s*\}/, chatWithCurlStart);
  const nextFunction = source.indexOf('\n  public ', chatWithCurlStart + 10);
  const functionBody = source.slice(chatWithCurlStart, nextFunction > -1 && nextFunction < functionEnd ? nextFunction : functionEnd);

  // O função deve valida URLs antes making solicita
  // Look para SSRF protection patterns:
  // - URL validation função imported ou defined
  // - isPrivate/isLocal verifica antes axios call
  // - hostname/IP extraction and range checking

  const hasSSRFProtection =
    /validateUrl|isPrivateUrl|isBlockedHost|checkUrlSafety|isInternalIp|isLoopback|isLinkLocal/.test(functionBody) ||
    /url\.startsWith\(['"]https:\/\//.test(functionBody) || // HTTPS enforcement
    /(hostname|host)\s*===\s*['"]127\.0\.0\.1['"|\s]/.test(functionBody) || // explicit localhost check
    /\/\.\.\/|\.\.\\/.test(functionBody); // caminho traversal verifica

  assert.ok(hasSSRFProtection, 'chatWithCurl should have SSRF protection (URL validation against private/internal ranges)');
});

test('URL validation function exists for SSRF protection', () => {
  const source = read('electron/LLMHelper.ts');
  const curlUtils = read('electron/utils/curlUtils.ts');

  const combinedSource = source + '\n' + curlUtils;

  // Deve ter a função to valida URLs
  const hasUrlValidation =
    /function\s+validate(Ssrf|Url|Hostname|UrlSafety)/.test(combinedSource) ||
    /const\s+validate(Ssrf|Url|Hostname|UrlSafety)/.test(combinedSource) ||
    /export\s+(function|const)\s+(validateSsrf|validateUrl|isPrivateUrl|isBlockedHost)/.test(combinedSource);

  assert.ok(hasUrlValidation, 'Should have a URL validation function for SSRF protection');
});

test('axios call in chatWithCurl uses validated URL', () => {
  const source = read('electron/LLMHelper.ts');

  const chatWithCurlStart = source.indexOf('public async chatWithCurl(');
  const nextFunction = source.indexOf('\n  public ', chatWithCurlStart + 10);
  const functionBody = source.slice(chatWithCurlStart, nextFunction > -1 ? nextFunction : chatWithCurlStart + 3000);

  // O axios call deve ser preceded por URL validation
  const axiosIndex = functionBody.indexOf('axios({');
  assert.ok(axiosIndex >= 0, 'axios call should exist in chatWithCurl');

  // Verifica that there's validation antes axios
  const beforeAxios = functionBody.slice(0, axiosIndex);
  const hasValidation =
    /validate|check|isPrivate|isBlocked|isLocal|isLoopback|hostname/.test(beforeAxios) ||
    /url\.startsWith|https:\/\//.test(beforeAxios);

  assert.ok(hasValidation, 'URL should be validated before axios call');
});

test('path traversal is blocked in URL variable substitution', () => {
  const source = read('electron/LLMHelper.ts');

  const chatWithCurlStart = source.indexOf('public async chatWithCurl(');
  const nextFunction = source.indexOf('\n  public ', chatWithCurlStart + 10);
  const functionBody = source.slice(chatWithCurlStart, nextFunction > -1 ? nextFunction : chatWithCurlStart + 3000);

  // Verifica that URL variável replacement doesn't permitir caminho traversal
  // O url deve não conter ../ após variável replacement
  const urlReplacementIndex = functionBody.indexOf('deepVariableReplacer(curlConfig.url');
  assert.ok(urlReplacementIndex >= 0, 'URL should be processed through variable replacer');

  // Após URL replacement, lá deve ser a validation step
  const afterReplacement = functionBody.slice(urlReplacementIndex);
  const hasValidationAfterReplacement =
    /validate|check|isPrivate|isBlocked|isLocal/.test(afterReplacement.slice(0, afterReplacement.indexOf('axios(')));

  assert.ok(hasValidationAfterReplacement, 'URL should be validated after variable replacement');
});

test('blocked SSRF hosts are explicitly rejected', () => {
  const source = read('electron/LLMHelper.ts');
  const curlUtils = read('electron/utils/curlUtils.ts');
  const combined = source + '\n' + curlUtils;

  // Verifica para blocked host patterns
  const blockedPatterns = [
    'localhost', '127.0.0.1', '0.0.0.0', '::1',
    '169.254', 'link-local',
    '10.', '172.16', '192.168'
  ];

  const hasBlockedHosts = blockedPatterns.some(pattern =>
    /isBlocked|isPrivate|isLocal|blockList|denyList/.test(combined) &&
    combined.includes(pattern)
  );

  // Alternative: verifica para IP range validation
  const hasIPRangeValidation =
    /parseInt|Number\(.*\)\s*[<>]/.test(combined) ||
    /ip2int|ipToNumber|isInRange/.test(combined);

  assert.ok(hasBlockedHosts || hasIPRangeValidation, 'Should block SSRF targets: localhost, private ranges, link-local');
});