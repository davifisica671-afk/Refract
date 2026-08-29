import dns from 'dns';

// Cache de IP baseado em TTL para consultas DNS de WebSocket.
// A Railway define um TTL de 1 segundo em seus registros DNS, então sem isso todo WS
// reconect faz uma nova consulta ao resolver. Se o resolver falhar por até 2-3
// segundos, a tempestade de reconexões produz uma parede de ENOTFOUND embora o
// IP do servidor não tenha mudado. O cache sobrevive a essa janela servindo o último
// IP conhecido (mesmo se a entrada do cache estiver expirada — caminho stale-on-error abaixo)
const _dnsCache = new Map<string, { addr: string; expires: number }>();
const DNS_CACHE_TTL_MS = 60_000;

/**
 * Resolvedor DNS apenas-IPv4 para conexões WebSocket de STT.
 *
 * Por que isso existe: não macOS, a consulta padrão do Node `getaddrinfo(AF_UNSPEC)` em
 * hosts dual-stack pode retornar um `ENOTFOUND` definitivo para cadeias CNAME apenas-IPv4
 * (ex: api.refract.software → *.up.railway.app → 66.33.22.108) quando a
 * máquina tem um endereço IPv6 link-local (fe80::…) mas não tem uma rota real v6.
 * curl/libcurl gerencia isso gracefully voltando para v4; o libuv em Darwin
 * às vezes não faz. Sintoma: `nslookup` e `curl` resolvem normalmente na
 * mesma máquina, mas toda `new WebSocket('wss://…')` dispara
 * `error: getaddrinfo ENOTFOUND <host>` — nunca alcança o servidor, então
 * as transcrições nunca iniciam
 *
 * Forçar family=4 espelha o comportamento efetivo do curl: pular IPv6 completamente.
 * Os endpoints de streaming STT (Refract, ElevenLabs, Soniox, OpenAI Realtime) são
 * effectively apenas-IPv4 na borda hoje, então não perdemos nada fixando o
 * resolver aqui. Se um fornecedor depois migrar para apenas-IPv6 ou v6-preferred, trocar
 * para family=0 (AF_UNSPEC) com um alternativa v6→v4 personalizado.
 */
export const ipv4OnlyLookup = (hostname: string, options: any, callback?: any): void => {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }

    const cacheKey = hostname;
    const cached = _dnsCache.get(cacheKey);

    // Servir do cache se ainda estiver fresco — evita acessar o resolver completamente.
    if (cached && Date.now() < cached.expires) {
        return callback(null, cached.addr, 4);
    }

    const store = (addr: string) => {
        _dnsCache.set(cacheKey, { addr, expires: Date.now() + DNS_CACHE_TTL_MS });
        callback(null, addr, 4);
    };

    // Primário: usar dns.lookup com IPv4 family — caminho rápido quando funciona.
    // Fallback 1: dns.resolve4 se a consulta falhar (ignora o resolver do OS, consulta
    //   DNS autoritativo diretamente — mais confiável em algumas redes).
    // Fallback 2 (stale-on-error): se ambos falharem mas uma entrada em cache existir
    //   (mesmo expirada), servir o IP antigo em vez de propagar ENOTFOUND.
    //   O servidor nesse IP é quase certamente ainda ativo; apenas o DNS
    //   resolver está tendo um problema (padrão de oscilação TTL de 1s da Railway).
    dns.lookup(hostname, { ...options, family: 4 }, (err, addr) => {
        if (!err) return store(addr);

        dns.resolve4(hostname, (err4, addrs) => {
            if (!err4 && addrs?.length > 0) return store(addrs[0]);

            // Ambos os caminhos do resolver falharam — servir cache stale se disponível.
            if (cached) {
                console.warn(`[dnsHelpers] resolver failed for ${hostname}, serving stale IP ${cached.addr}`);
                return callback(null, cached.addr, 4);
            }

            const e = new Error('No A records for ' + hostname) as NodeJS.ErrnoException;
            e.code = 'ENOTFOUND';
            callback(e);
        });
    });
};

/**
 * Opções padrão `ws` para todo WebSocket de streaming-STT. Adiciona
 *   - lookup ipv4OnlyLookup          (evita o ENOTFOUND dual-stack do macOS)
 *   - family: 4                      (defesa em profundidade — `ws` encaminha isso para
 *                                     https.request → tls.connect)
 *   - handshakeTimeout: 15000        (limita quanto tempo aguardamos pelo handshake TLS+upgrade
 *                                     antes de desistir, sem isso
 *                                     um handshake travado segura o timer de keepalive TCP
 *                                     do kernel, que pode durar minutos)
 */
export function streamingStttWsOptions(extra?: Record<string, unknown>): Record<string, unknown> {
    return {
        lookup: ipv4OnlyLookup,
        family: 4,
        handshakeTimeout: 15_000,
        ...(extra || {}),
    };
}
