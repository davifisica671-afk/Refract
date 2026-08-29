/**
 * ProviderCard.tsx
 *
 * Cartão reutilizável para configuração de provedores de IA (API Key).
 * Cada cartão permite: entrada da chave, salvar, remover, testar conexão,
 * buscar modelos disponíveis e selecionar o modelo preferido.
 */
import React, { useState, useEffect, useRef } from 'react';
import { Trash2, AlertCircle, CheckCircle, ExternalLink, Loader2, ChevronDown, Check, RefreshCw } from 'lucide-react';

// Modelo obtido da busca de modelos do provedor
interface FetchedModel {
    id: string;
    label: string;
}

// Props do cartão de provedor: identificador, chave, modelo, status de teste, etc.
interface ProviderCardProps {
    providerId: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek' | 'opencode_zen';
    providerName: string;
    apiKey: string;
    preferredModel?: string;
    hasStoredKey: boolean;
    onKeyChange: (key: string) => void;
    onSaveKey: () => Promise<void>;
    onRemoveKey: () => void;
    onTestConnection: () => void;
    testStatus: 'idle' | 'testing' | 'success' | 'error';
    testError?: string;
    savingStatus: boolean;
    savedStatus: boolean;
    keyPlaceholder: string;
    keyUrl: string;
    onPreferredModelChange?: (modelId: string) => void;
}

// Componente de cartão de provedor de IA
export const ProviderCard: React.FC<ProviderCardProps> = ({
    providerId,
    providerName,
    apiKey,
    preferredModel,
    hasStoredKey,
    onKeyChange,
    onSaveKey,
    onRemoveKey,
    onTestConnection,
    testStatus,
    testError,
    savingStatus,
    savedStatus,
    keyPlaceholder,
    keyUrl,
    onPreferredModelChange,
}) => {
    // Estado local: modelos buscados, status de busca, erro, modelo selecionado e dropdown
    const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
    const [isFetching, setIsFetching] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [selectedModel, setSelectedModel] = useState<string>(preferredModel || '');
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = React.useRef<HTMLDivElement>(null);

    // Refs para evitar stale closures no timer de auto-save
    const savedRef = useRef(savedStatus);
    const savingRef = useRef(savingStatus);
    savedRef.current = savedStatus;
    savingRef.current = savingStatus;

    // Auto-save da chave de API após 5 segundos de inatividade
    useEffect(() => {
        if (!apiKey.trim()) return;
        const timer = setTimeout(() => {
            if (!savedRef.current && !savingRef.current) {
                onSaveKey().catch(console.error);
            }
        }, 5000);
        return () => clearTimeout(timer);
    }, [apiKey]);

    // Sincroniza o modelo preferido recebido via props
    useEffect(() => {
        if (preferredModel) setSelectedModel(preferredModel);
    }, [preferredModel]);

    // Fecha o dropdown ao clicar fora dele
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Busca a lista de modelos disponíveis no provedor via IPC
    const handleFetchModels = async () => {
        setIsFetching(true);
        setFetchError(null);

        try {
            // Se uma nova chave foi inserida, salva antes de buscar
            if (apiKey.trim()) {
                await onSaveKey();
            }

            // Usa a chave informada ou a chave já armazenada
            const keyToUse = apiKey.trim() || '';
            // @ts-ignore
            const result = await window.electronAPI?.fetchProviderModels(providerId, keyToUse);

            if (result?.success && result.models) {
                setFetchedModels(result.models);
                // Se o modelo preferido existe na lista, mantém; senão seleciona o primeiro automaticamente
                if (result.models.length > 0) {
                    const existsInList = result.models.some((m: FetchedModel) => m.id === selectedModel);
                    if (!existsInList) {
                        const firstModel = result.models[0].id;
                        setSelectedModel(firstModel);
                        // @ts-ignore
                        await window.electronAPI?.setProviderPreferredModel(providerId, firstModel);
                        if (onPreferredModelChange) {
                            onPreferredModelChange(firstModel);
                        }
                    }
                }
            } else {
                setFetchError(result?.error || 'Failed to fetch models');
            }
        } catch (e: any) {
            setFetchError(e.message || 'Failed to fetch models');
        } finally {
            setIsFetching(false);
        }
    };

    // Salva o modelo selecionado como preferido do provedor
    const handleSelectModel = async (modelId: string) => {
        setSelectedModel(modelId);
        setIsDropdownOpen(false);
        try {
            // @ts-ignore
            await window.electronAPI?.setProviderPreferredModel(providerId, modelId);
            if (onPreferredModelChange) {
                onPreferredModelChange(modelId);
            }
        } catch (e) {
            console.error('Failed to save preferred model:', e);
        }
    };

    // Opção atualmente selecionada no dropdown
    const selectedOption = fetchedModels.find(m => m.id === selectedModel);

    return (
        <div className="settings-card rounded-xl p-5 border border-border-subtle">
            <div className="mb-3 flex items-center justify-between gap-4">
                <label className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-text-primary">
                    <span className="truncate">{providerName}</span>
                    {hasStoredKey && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-500">
                            <Check size={10} strokeWidth={2.5} />
                            Connected
                        </span>
                    )}
                </label>
                <button
                    onClick={() => {
                        // @ts-ignore
                        window.electronAPI?.openExternal(keyUrl);
                    }}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-text-tertiary hover:bg-bg-item-active hover:text-text-primary transition-colors"
                    title={`Get ${providerName} API Key`}
                >
                    <span>Get key</span>
                    <ExternalLink size={12} />
                </button>
            </div>
            <div className="flex gap-2 mb-4">
                <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => onKeyChange(e.target.value)}
                    placeholder={hasStoredKey ? "••••••••••••" : keyPlaceholder}
                    className="h-10 min-w-0 flex-1 bg-bg-input border border-border-subtle rounded-lg px-3.5 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary transition-colors"
                />
                <button
                    onClick={onSaveKey}
                    disabled={savingStatus || !apiKey.trim()}
                    className={`h-10 min-w-[76px] px-4 rounded-lg text-xs font-medium transition-all active:scale-[0.98] ${savedStatus
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-accent-primary hover:brightness-110 border border-accent-primary text-white shadow-sm disabled:bg-bg-input disabled:border-border-subtle disabled:text-text-tertiary disabled:shadow-none'
                        }`}
                >
                    {savingStatus ? 'Saving...' : savedStatus ? 'Saved!' : 'Save'}
                </button>
                {hasStoredKey && (
                    <button
                        onClick={onRemoveKey}
                        className="h-10 w-10 flex items-center justify-center rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-all active:scale-95"
                        title="Remove API Key"
                    >
                        <Trash2 size={16} strokeWidth={1.5} />
                    </button>
                )}
            </div>

            {/* Linha de ações: Testar Conexão + Dropdown de Modelo + Buscar Modelos */}
            <div className="flex items-center justify-between gap-3 w-full">
                {/* Botão de teste de conexão com o provedor */}
                <button
                    onClick={onTestConnection}
                    disabled={(!apiKey.trim() && !hasStoredKey) || testStatus === 'testing'}
                    className={`h-8 px-3 rounded-lg text-[11px] font-medium transition-colors border border-border-subtle flex items-center gap-2 shrink-0 ${testStatus === 'success' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                        testStatus === 'error' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                            'bg-bg-input hover:bg-bg-elevated text-text-primary'
                        }`}
                    title={testError || "Test Connection"}
                >
                    {testStatus === 'testing' ? <><Loader2 size={12} className="animate-spin" /> Testing...</> :
                        testStatus === 'success' ? <><CheckCircle size={12} /> Connected</> :
                            testStatus === 'error' ? <><AlertCircle size={12} /> Error</> :
                                <>{/* Ícone vazio */} Test Connection</>}
                </button>

                {/* Dropdown inline para seleção de modelo */}
                {fetchedModels.length > 0 || preferredModel ? (
                    <div className="relative min-w-0 flex-1 max-w-[240px]" ref={dropdownRef}>
                        <button
                            onClick={() => fetchedModels.length > 0 && setIsDropdownOpen(!isDropdownOpen)}
                            className={`w-full h-8 bg-bg-input border border-border-subtle rounded-lg px-3 text-[11px] text-text-primary focus:outline-none focus:border-accent-primary flex items-center justify-between transition-colors ${fetchedModels.length > 0 ? 'hover:bg-bg-elevated' : 'opacity-80 cursor-default'}`}
                            type="button"
                        >
                            <span className="truncate pr-2">{selectedOption ? selectedOption.label : (preferredModel || 'Select model')}</span>
                            <ChevronDown size={14} className={`text-text-secondary transition-transform ${isDropdownOpen ? 'rotate-180' : ''} ${fetchedModels.length === 0 ? 'opacity-50' : ''}`} />
                        </button>

                        {isDropdownOpen && fetchedModels.length > 0 && (
                            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 w-full min-w-[200px] bg-bg-elevated border border-border-subtle rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto animated fadeIn">
                                <div className="p-1 space-y-0.5">
                                    {fetchedModels.map((model) => (
                                        <button
                                            key={model.id}
                                            onClick={() => handleSelectModel(model.id)}
                                            className={`w-full text-left px-3 py-2 text-xs rounded-md flex items-center justify-between group transition-colors ${selectedModel === model.id ? 'bg-bg-input hover:bg-bg-elevated text-text-primary' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                                            type="button"
                                        >
                                            <span className="truncate">{model.label}</span>
                                            {selectedModel === model.id && <Check size={14} className="text-accent-primary shrink-0 ml-2" />}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex-1" />
                )}

                {/* Botão para buscar modelos disponíveis no provedor */}
                {hasStoredKey ? (
                    <button
                        onClick={handleFetchModels}
                        disabled={isFetching}
                        className={`h-8 px-3 rounded-lg text-[11px] font-medium transition-colors border border-border-subtle flex items-center gap-2 shrink-0 ${isFetching
                            ? 'bg-bg-input text-text-secondary'
                            : 'bg-accent-primary/10 text-accent-primary border-accent-primary/20 hover:bg-accent-primary/20'
                            }`}
                    >
                        {isFetching ? (
                            <><Loader2 size={12} className="animate-spin" /> Fetching...</>
                        ) : (
                            <><RefreshCw size={12} /> Fetch Models</>
                        )}
                    </button>
                ) : (
                    // Espaço reservado para manter o alinhamento flex quando o botão não está visível
                    <span className="w-[110px]" />
                )}
            </div>

            {/* Mensagens de erro de teste ou busca de modelos */}
            {testError && <p className="text-[10px] text-red-400 mt-1.5 mb-2">{testError}</p>}
            {fetchError && <p className="text-[10px] text-red-400 mt-1.5 mb-2">Model fetch error: {fetchError}</p>}


        </div>
    );
};
