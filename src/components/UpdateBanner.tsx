import React, { useEffect, useState, useRef } from 'react';
import UpdateModal from './UpdateModal';

/**
 * UpdateBanner.tsx
 * Banner de atualização que notifica o usuário sobre novas versões disponíveis.
 * Gerencia o ciclo completo: detecção → download → instalação, com suporte a
 * auto-update (versões empacotadas) e fallback manual (DMG no macOS).
 */

type UpdateInfo = {
    version?: string;
    parsedNotes?: ParsedReleaseNotes;
};

type ParsedReleaseNotes = {
    version: string;
    summary: string;
    sections: Array<{ title: string; items: string[] }>;
    fullBody?: string;
    url?: string;
};

const LATEST_RELEASE_URL = 'https://github.com/davifisica671-afk/Refract/releases/latest';

const UpdateBanner: React.FC = () => {
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [parsedNotes, setParsedNotes] = useState<ParsedReleaseNotes | null>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [status, setStatus] = useState<'idle' | 'downloading' | 'ready' | 'error' | 'instructions'>('idle');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [instructionsArch, setInstructionsArch] = useState<'arm64' | 'x64' | null>(null);
    // Se esta versão pode instalar + reiniciar não local (versão macOS assinada ou
    // qualquer versão empacotada Windows/Linux). Se "Instalar" executa o fluxo real de
    // download dentro do app ou volta para as instruções manuais de download DMG.
    const [canAutoUpdate, setCanAutoUpdate] = useState(false);
    // Rastreia se o usuário dispensou explicitamente o notificação — eventos de progresso
    // não devem sobrescrever a dispensa deliberada.
    const userDismissedRef = useRef(false);

    useEffect(() => {
        const api = window.electronAPI;
        if (!api?.getCanAutoUpdate) return;

        let cancelled = false;
        api.getCanAutoUpdate()
            .then(({ canAutoUpdate }) => { if (!cancelled) setCanAutoUpdate(canAutoUpdate); })
            .catch((err) => {
                if (cancelled) return;
                // Falha silenciosa cai não padrão falso (fallback manual) — registrar para observabilidade.
                console.warn('[UpdateBanner] getCanAutoUpdate failed, using manual fallback:', err);
            });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        const api = window.electronAPI;
        if (!api) return;

        // Ouvir atualização disponível
        const unsubAvailable = api.onUpdateAvailable((info: UpdateInfo) => {
            console.log('[UpdateBanner] Update available:', info);
            setUpdateInfo(info);
            setErrorMessage(null);
            setStatus('idle'); // Reiniciar de qualquer erro/estado anterior antes de mostrar info de atualização
            // Se notas processadas estão incluídas no objeto info (vindo do backend)
            if (info.parsedNotes) {
                setParsedNotes(info.parsedNotes);
            }
            setIsVisible(true);
            // Novo ciclo de atualização — limpar qualquer estado de dispensa anterior para que o notificação seja exibido
            userDismissedRef.current = false;
        });

        // Ouvir progresso de download
        const unsubProgress = api.onDownloadProgress((progressObj) => {
            // Re-exibir notificação apenas se o usuário não dispensou explicitamente
            if (!userDismissedRef.current) {
                setIsVisible(true);
            }
            setStatus('downloading');
            setDownloadProgress(progressObj.percent);
        });

        // Ouvir evento de atualização baixada
        const unsubDownloaded = api.onUpdateDownloaded((info) => {
            console.log('[UpdateBanner] Update downloaded:', info);
            setUpdateInfo(info); // Atualiza info novamente apenas por segurança
            if (info.parsedNotes) setParsedNotes(info.parsedNotes);
            // Protege transição para pronto apenas se temos uma versão. Se a versão
            // estiver ausente (não deveria acontecer), cai no tratamento de erro em
            // vez de mostrar silenciosamente "pronto" sem versão para instalar.
            if (info?.version) {
                setStatus('ready');
                setIsVisible(true);
            } else {
                console.warn('[UpdateBanner] update-downloaded received with no version');
                setStatus('error');
                setErrorMessage('Update downloaded but version is unknown. Please download from GitHub releases.');
            }
        });

        // Ouvir erros de atualização
        const unsubError = api.onUpdateError((err: string) => {
            console.error('[UpdateBanner] Update error:', err);
            setStatus('error');
            setErrorMessage(err);
        });

        return () => {
            unsubAvailable();
            unsubProgress();
            unsubDownloaded();
            unsubError();
        };
    }, []);

        // Modo Demo/Teste: pressione Cmd+I para acionar teste de busca no backend ou Cmd+J para mock da interface
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!import.meta.env.DEV) return;
            
            if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'i') {
                e.preventDefault();
                console.log("[UpdateBanner] Cmd+I pressed: Triggering Test Release Fetch...");
                window.electronAPI.testReleaseFetch().catch(console.error);
            }
            
            if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'j') {
                e.preventDefault();
                console.log("[UpdateBanner] Cmd+J pressed: Triggering Instruction UI mock...");
                setUpdateInfo({ version: '2.0.8' });
                setParsedNotes({ version: '2.0.8', summary: 'Test Update', fullBody: 'Testing', sections: [{ title: 'Notes', items: ['UI Test'] }] });
                setStatus('idle');
                setIsVisible(true);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleInstall = async () => {
        // Versões macOS assinadas (e todas as versões empacotadas Windows/Linux) podem baixar
        // e instalar não local, então sempre usar o fluxo real dentro do app: download via
        // IPC, depois "Reiniciar e Instalar" quando pronto.
        if (canAutoUpdate) {
            setStatus('downloading');
            window.electronAPI.downloadUpdate();
            return;
        }

        // FALLBACK (versão macOS não assinada não pode trocar+reiniciar não local, então enviar
        // o user para o signed DMG on GitHub e mostrar o manual installation steps.
        // Proteger se a versão estiver ausente, voltar para acionar download (que vai
        // mostrar erro) em vez de enviar o usuário para uma URL quebrada do GitHub.
        if (window.electronAPI.platform === 'darwin') {
            if (!updateInfo?.version) {
                console.warn('[UpdateBanner] No version in updateInfo — opening latest GitHub release instead of in-app download');
                window.electronAPI.openExternal(LATEST_RELEASE_URL);
                setStatus('instructions');
                return;
            }
            try {
                const arch = await window.electronAPI.getArch();
                const isArm = arch === 'arm64';
                const dmgSuffix = isArm ? 'arm64' : 'x64';
                setInstructionsArch(dmgSuffix);
                const version = updateInfo.version.replace('v', '');
                const url = `https://github.com/davifisica671-afk/Refract/releases/download/v${version}/Refract-${version}-${dmgSuffix}.dmg`;
                window.electronAPI.openExternal(url);
                setStatus('instructions');
            } catch (err) {
                console.error("Failed to get arch", err);
                window.electronAPI.openExternal(LATEST_RELEASE_URL);
                setStatus('instructions');
            }
        } else {
            setStatus('downloading');
            // Acionar download via IPC
            window.electronAPI.downloadUpdate();
        }
    };

    const handleDismiss = () => {
        userDismissedRef.current = true;
        setIsVisible(false);
        setStatus('idle'); // Reiniciar estado de erro/download para que o próximo evento comece limpo
    };

    if (!isVisible) return null;

    return (
        <UpdateModal
            isOpen={isVisible}
            updateInfo={updateInfo}
            parsedNotes={parsedNotes}
            onDismiss={handleDismiss}
            onInstall={handleInstall}
            downloadProgress={downloadProgress}
            status={status}
            errorMessage={errorMessage}
            instructionsArch={instructionsArch}
            canAutoUpdate={canAutoUpdate}
        />
    );
};

export default UpdateBanner;
