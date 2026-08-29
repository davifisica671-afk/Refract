import React, { useState, useEffect, useRef } from 'react';
import { X, Mail, RotateCcw, ExternalLink, Loader2, Paperclip } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * FollowUpEmailModal.tsx
 * Modal para criação de e-mails de acompanhamento pós-reunião.
 * Gera automaticamente o conteúdo do e-mail com base no resumo da reunião,
 * incluindo destinatário, assunto e corpo editáveis. Suporta envio via Gmail.
 */

interface Meeting {
    id: string;
    title: string;
    date: string;
    summary?: string;
    detailedSummary?: {
        overview?: string;
        actionItems: string[];
        keyPoints: string[];
    };
    transcript?: Array<{
        speaker: string;
        text: string;
        timestamp: number;
    }>;
    calendarEventId?: string;
}

interface FollowUpEmailModalProps {
    isOpen: boolean;
    onClose: () => void;
    meeting: Meeting;
}

const FollowUpEmailModal: React.FC<FollowUpEmailModalProps> = ({ isOpen, onClose, meeting }) => {
    const [recipientEmail, setRecipientEmail] = useState('');
    const [senderName, setSenderName] = useState('');
    const [recipientName, setRecipientName] = useState('');

    // Assunto e corpo
    const [subject, setSubject] = useState('');
    const [emailBody, setEmailBody] = useState('');

    // Estado
    const [isGenerating, setIsGenerating] = useState(false);
    const [hasGeneratedOnce, setHasGeneratedOnce] = useState(false);

    // Montagem - inicializa e gera conteúdo
    useEffect(() => {
        if (isOpen) {
            initializeFields();
        }
    }, [isOpen, meeting]);

    const initializeFields = async () => {
        // 1. Define o assunto
        const cleanTitle = meeting.title.replace(/["\*]/g, '').trim();
        setSubject(`Follow up - ${cleanTitle}`); // Default subject

        // 2. Carrega o nome do remetente
        const storedName = localStorage.getItem('refract_user_name');
        if (storedName) setSenderName(storedName);

        // 3. Carrega destinatário (assíncrono)
        let loadedRecipientEmail = '';
        let loadedRecipientName = '';

        try {
            // Tenta pelo calendário
            if (meeting.calendarEventId) {
                // @ts-ignore
                const attendees = await window.electronAPI?.invoke('get-calendar-attendees', meeting.calendarEventId);
                if (attendees && attendees.length > 0) {
                    loadedRecipientEmail = attendees[0].email;
                    if (attendees[0].name) loadedRecipientName = attendees[0].name.split(' ')[0];
                }
            }

            // Fallback: pela transcrição
            if (!loadedRecipientEmail && meeting.transcript) {
                // @ts-ignore
                const extracted = await window.electronAPI?.invoke('extract-emails-from-transcript', meeting.transcript);
                if (extracted && extracted.length > 0) {
                    loadedRecipientEmail = extracted[0];
                }
            }
        } catch (e) {
            console.error(e);
        }

        if (loadedRecipientEmail) setRecipientEmail(loadedRecipientEmail);
        if (loadedRecipientName) setRecipientName(loadedRecipientName);

        // 4. Gera conteúdo automaticamente se não feito
        if (!emailBody && !isGenerating) {
            generateEmail(loadedRecipientName, storedName || '');
        }
    };

    const generateEmail = async (rName?: string, sName?: string) => {
        setIsGenerating(true);
        try {
            const input = {
                meeting_type: 'meeting' as const,
                title: meeting.title,
                summary: meeting.detailedSummary?.overview || meeting.summary,
                action_items: meeting.detailedSummary?.actionItems || [],
                key_points: meeting.detailedSummary?.keyPoints || [],
                recipient_name: rName || recipientName,
                sender_name: sName || senderName,
                tone: 'neutral' as const // Padrão neutro para geração automática
            };

            // @ts-ignore
            const generatedBody = await window.electronAPI?.invoke('generate-followup-email', input);
            if (generatedBody) {
                setEmailBody(generatedBody);
            }
        } catch (error) {
            console.error('Failed to generate email:', error);
            setEmailBody('Hi there,\n\nI enjoyed our conversation. Let me know if you have any questions.\n\nBest,');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleReset = () => {
        generateEmail();
    };

    const handleSendGmail = async () => {
        const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(recipientEmail)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailBody)}`;
        // @ts-ignore
        await window.electronAPI?.invoke('open-external', gmailUrl);
        onClose();
    };

    const handleSendDefault = async () => {
        // @ts-ignore
        await window.electronAPI?.invoke('open-mailto', {
            to: recipientEmail,
            subject: subject,
            body: emailBody
        });
        onClose();
    };


    if (!isOpen) return null;

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/60 backdrop-blur-[10px] z-50 transition-opacity"
                    />

                    {/* Modal Container */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        transition={{ duration: 0.3, type: "spring", damping: 25, stiffness: 300 }}
                        className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
                    >
                        {/* Janela */}
                        <div className="dialog-surface w-full max-w-[660px] flex flex-col pointer-events-auto overflow-hidden">

                            {/* Cabeçalho / Barra Superior */}
                            <div className="flex px-6 py-4 justify-between items-center border-b border-border-subtle">
                                <div>
                                    <h2 className="text-[14px] font-semibold text-text-primary">Draft follow-up</h2>
                                    <p className="mt-1 text-[11px] text-text-tertiary">Review the message before opening your email client</p>
                                </div>
                                <button onClick={onClose} className="refract-topbar-button flex items-center justify-center text-text-tertiary">
                                    <X size={14} />
                                </button>
                            </div>

                            {/* Área de Inputs */}
                            <div className="px-8 pt-6 space-y-5">

                                {/* Campo Para */}
                                <div className="flex items-start gap-6 group">
                                    <label className="text-text-tertiary text-[12px] w-[50px] font-medium pt-2">To</label>
                                    <div className="flex-1 min-h-[34px] flex items-center border-b border-border-subtle group-focus-within:border-accent-primary/50 transition-colors pb-1">
                                        {recipientEmail ? (
                                            <div className="inline-flex items-center gap-2 px-3 py-1 bg-bg-item-active border border-border-subtle rounded-lg text-text-primary text-[12px] shadow-sm animate-in fade-in zoom-in duration-200">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                                {recipientEmail}
                                                <button
                                                    onClick={() => setRecipientEmail('')}
                                                    className="hover:text-text-primary text-text-tertiary transition-colors ml-1"
                                                >
                                                    <X size={12} />
                                                </button>
                                            </div>
                                        ) : (
                                            <input
                                                type="email"
                                                value={recipientEmail}
                                                onChange={(e) => setRecipientEmail(e.target.value)}
                                                placeholder="Recipient email"
                                                className="w-full bg-transparent text-text-primary placeholder:text-text-tertiary focus:outline-none text-[14px]"
                                                autoFocus
                                            />
                                        )}
                                    </div>
                                </div>

                                {/* Campo Assunto */}
                                <div className="flex items-center gap-6 group">
                                    <label className="text-text-tertiary text-[12px] w-[50px] font-medium">Subject</label>
                                    <div className="flex-1 border-b border-border-subtle group-focus-within:border-accent-primary/50 transition-colors pb-1">
                                        <input
                                            type="text"
                                            value={subject}
                                            onChange={(e) => setSubject(e.target.value)}
                                            className="w-full bg-transparent text-text-primary focus:outline-none text-[14px] font-medium placeholder:text-text-tertiary"
                                            placeholder="Subject line"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Área do Corpo */}
                            <div className="flex-1 px-8 py-6 min-h-[320px] relative">
                                {isGenerating ? (
                                    <div className="absolute inset-0 flex items-center justify-center z-10 bg-bg-elevated/70 backdrop-blur-[3px]">
                                        <div className="flex flex-col items-center gap-4">
                                            <div className="relative">
                                                <div className="w-10 h-10 border-2 border-[#27272A] border-t-blue-500 rounded-full animate-spin"></div>
                                                <div className="absolute inset-0 flex items-center justify-center">
                                                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                                                </div>
                                            </div>
                                            <span className="text-xs font-medium text-text-tertiary animate-pulse">Drafting follow-up...</span>
                                        </div>
                                    </div>
                                ) : (
                                    <textarea
                                        value={emailBody}
                                        onChange={(e) => setEmailBody(e.target.value)}
                                        className="w-full h-full bg-transparent text-text-secondary text-[14px] leading-7 focus:outline-none resize-none placeholder:text-text-tertiary font-normal"
                                        placeholder="Write your email..."
                                        spellCheck={false}
                                    />
                                )}
                            </div>

                            {/* Rodapé */}
                            <div className="flex items-center justify-between px-6 py-4 bg-bg-main/45 border-t border-border-subtle">
                                <div className="flex items-center gap-3">
                                    {/* Envia com Gmail */}
                                    <button
                                        onClick={handleSendGmail}
                                        className="h-9 flex items-center gap-2 px-4 bg-text-primary text-bg-primary hover:brightness-95 rounded-lg border border-transparent transition-all active:scale-[0.98] group"
                                    >
                                        <div className="w-4 h-4 relative flex items-center justify-center">
                                            <span className="font-bold text-lg leading-none bg-clip-text text-transparent bg-gradient-to-r from-blue-500 via-red-500 to-yellow-500">G</span>
                                        </div>
                                        <span className="text-[12px] font-semibold">Open in Gmail</span>
                                    </button>
                                </div>

                                {/* Ações do lado direito */}
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleReset}
                                        disabled={isGenerating}
                                        className="h-9 flex items-center gap-2 px-3 hover:bg-bg-item-active rounded-lg transition-colors text-text-tertiary hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed group"
                                        title="Regenerate"
                                    >
                                        <RotateCcw size={15} className={`group-hover:rotate-180 transition-transform duration-500 ${isGenerating ? 'animate-spin' : ''}`} />
                                        <span className="text-[13px] font-medium">Reset</span>
                                    </button>
                                </div>
                            </div>

                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};

export default FollowUpEmailModal;
