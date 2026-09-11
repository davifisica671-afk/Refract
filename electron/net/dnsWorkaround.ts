/**
 * net/dnsWorkaround.ts — Workaround escopado de resolução DNS (IPv6).
 *
 * CAUSA RAIZ (documentada, ver main.ts histórico):
 * Em alguns ambientes macOS, o resolvedor do Node/Electron devolve endereços
 * IPv6 para hosts alvo que não os suportam, e o `dns.lookup` default entrega
 * o endereço IPv6 — quebrando clientes que usam `dns.lookup` internamente
 * (ex.: electron-updater → api.refract.software).
 *
 * ESCOLO: o patch afeta APENAS os hostnames em WORKAROUND_HOSTS. Todos os
 * outros hostnames passam pelo `dns.lookup` original, intocado.
 *
 * Criterios de permanencia/remocao (do plano de engenharia #8):
 * - Causa raiz documentada: este arquivo.
 * - Teste de regressao: electron/services/__tests__/DnsWorkaround.test.mjs
 *   (prova que hosts fora da lista NAO sao afetados).
 * - Candidato a substituicao canonica quando Electron/Node permitirem
 *   verificar em produção: `dns.setDefaultResultOrder('ipv4first')` OU
 *   mover electron-updater para `net.request` (stack própria do Chromium,
 *   que não usa dns.lookup do Node). Quando uma das duas soluções estiver
 *   verificada em produção, REMOVER este módulo inteiro.
 *
 * TODO(REMOVE-DNS-WORKAROUND): eliminar este patch quando o updater rodar
 * com `net.request` (ou ipv4first verificado) em produção.
 */
import dns from 'dns';

type LookupCallback = (err: NodeJS.ErrnoException | null, address?: string | Array<{ address: string; family: number }>, family?: number) => void;

/** Hostnames conhecidos por falhar com o resolvedor default (IPv6). */
const WORKAROUND_HOSTS = new Set<string>(['api.refract.software']);

let originalLookup: typeof dns.lookup | null = null;

/**
 * Instala o patch de dns.lookup (idempotente). Sem opções, replica o
 * comportamento histórico de main.ts: intercepta `api.refract.software`,
 * resolve via `dns.resolve4` (IPv4) e cai no lookup original em caso de
 * erro/sem endereços. Hostnames fora da lista passam direto ao original.
 */
export function installDnsWorkaround(options?: {
  /** Hostnames alvo (default: WORKAROUND_HOSTS). */
  hosts?: string[];
  /** Resolver IPv4 injetável (default: dns.resolve4). Para testes. */
  resolve4?: (
    hostname: string,
    callback: (err: NodeJS.ErrnoException | null, addresses: string[]) => void,
  ) => void;
}): void {
  if (originalLookup) return; // já instalado

  const hosts = options?.hosts ? new Set(options.hosts) : WORKAROUND_HOSTS;
  const resolve4 = options?.resolve4 ?? dns.resolve4.bind(dns);

  originalLookup = dns.lookup;
  dns.lookup = function (hostname: any, options: any, callback: any) {
    // Normalização idêntica ao comportamento do Node (forma (host, callback)).
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    if (!hosts.has(hostname)) {
      return originalLookup!(hostname, options, callback);
    }
    resolve4(hostname, (err: NodeJS.ErrnoException | null, addresses: string[]) => {
      if (err || !addresses.length) {
        originalLookup!(hostname, options, callback);
      } else {
        const addr = addresses[0];
        if (options && (options as any).all) {
          callback(null, [{ address: addr, family: 4 }] as any);
        } else {
          callback(null, addr, 4);
        }
      }
    });
  } as any;
}

/** Restaura o dns.lookup original (usado pelos testes e desinstalação futura). */
export function restoreDnsWorkaround(): void {
  if (originalLookup) {
    dns.lookup = originalLookup;
    originalLookup = null;
  }
}
