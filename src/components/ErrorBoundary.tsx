// src/components/ErrorBoundary.tsx
// Error Boundary de nível superior do React para capturar erros de renderização
// não tratados e exibir uma alternativa graciosa em vez de uma tela branca
// (White Screen of Death).
//
// Uso: Envolver a árvore de componentes raiz em <ErrorBoundary> no App.tsx.

import React, { Component, ReactNode } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';

interface Props {
    children: ReactNode;
    /** Optional contexto label shown em logs e alternativa UI (e.g. "Launcher", "Overlay"). */
    context?: string;
}

interface State {
    hasError: boolean;
    errorMessage: string;
    componentStack: string;
}

export class ErrorBoundary extends Component<Props, State> {
    state: State = {
        hasError: false,
        errorMessage: '',
        componentStack: ''
    };

    static getDerivedStateFromError(error: Error): Partial<State> {
        return {
            hasError: true,
            errorMessage: error?.message ?? String(error)
        };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo): void {
        const context = this.props.context ?? 'App';
        console.error(`[ErrorBoundary:${context}] Uncaught render error:`, error, info.componentStack);
        this.setState({ componentStack: info.componentStack ?? '' });

        // Reporta para analytics se IPC está disponível (não bloqueante)
        try {
            // @ts-ignore  
            window.electronAPI?.logErrorToMain?.({
                type: 'uncaught-render-error',
                context,
                message: error?.message,
                stack: error?.stack,
                componentStack: info.componentStack
            });
        } catch { /* analytics nunca deve derrubar o manipulador */ }
    }

    private handleReload = (): void => {
        // Tenta reinício suave da UI primeiro (reseta o estado)
        this.setState({ hasError: false, errorMessage: '', componentStack: '' });
    };

    private handleHardReload = (): void => {
        window.location.reload();
    };

    render(): ReactNode {
        if (!this.state.hasError) {
            return this.props.children;
        }

        const context = this.props.context ?? 'Application';

        return (
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    minHeight: '200px',
                    padding: '32px',
                    backgroundColor: '#111111',
                    color: '#E0E0E0',
                    fontFamily: 'Inter, system-ui, sans-serif',
                    gap: '16px',
                    textAlign: 'center'
                }}
            >
                <AlertTriangle size={36} color="#ff4444" style={{ marginBottom: '4px' }} />
                <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#fff' }}>
                    {context} crashed
                </h2>
                <p style={{ margin: 0, fontSize: '12px', color: '#888', maxWidth: '320px', lineHeight: 1.5 }}>
                    An unexpected error occurred. Your data is safe — click below to recover.
                </p>
                {this.state.errorMessage && (
                    <code style={{
                        fontSize: '11px',
                        color: '#ff6666',
                        backgroundColor: 'rgba(255,68,68,0.08)',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        maxWidth: '360px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        display: 'block'
                    }}>
                        {this.state.errorMessage}
                    </code>
                )}
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button
                        onClick={this.handleReload}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            padding: '8px 14px', borderRadius: '8px', border: 'none',
                            background: '#222', color: '#ccc', fontSize: '12px',
                            cursor: 'default', fontWeight: 500
                        }}
                    >
                        <RefreshCw size={13} />
                        Try to recover
                    </button>
                    <button
                        onClick={this.handleHardReload}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            padding: '8px 14px', borderRadius: '8px', border: 'none',
                            background: '#ff4444', color: '#fff', fontSize: '12px',
                            cursor: 'default', fontWeight: 500
                        }}
                    >
                        <RefreshCw size={13} />
                        Reload UI
                    </button>
                </div>
            </div>
        );
    }
}

export default ErrorBoundary;
