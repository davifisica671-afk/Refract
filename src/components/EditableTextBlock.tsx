import React, { useState, useRef, useEffect, useCallback } from 'react';

/**
 * EditableTextBlock.tsx
 * Bloco de texto inline editável com suporte a conteúdo editável (contentEditable).
 * Permite ao usuário editar texto diretamente na interface com auto-salvamento
 * (debounce), revert por Escape e detecção de duplo-Enter para finalizar edição.
 */

interface EditableTextBlockProps {
    initialValue: string;
    onSave: (value: string) => void;
    tagName?: 'h1' | 'h2' | 'h3' | 'p' | 'span' | 'div';
    className?: string;
    placeholder?: string;
    multiline?: boolean;
    onEnter?: () => void;
    autoFocus?: boolean;
}

const EditableTextBlock: React.FC<EditableTextBlockProps> = ({
    initialValue,
    onSave,
    tagName = 'div',
    className = '',
    placeholder = 'Type here...',
    multiline = true,
    onEnter,
    autoFocus = false
}) => {
    const [isEditing, setIsEditing] = useState(autoFocus); // Inicia edição se autoFocus é verdadeiro
    const [localValue, setLocalValue] = useState(initialValue);
    const contentRef = useRef<HTMLElement>(null);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Sincroniza mudanças externas se não está editando
    useEffect(() => {
        if (!isEditing) {
            setLocalValue(initialValue);
            if (contentRef.current && contentRef.current.innerText !== initialValue) {
                contentRef.current.innerText = initialValue;
            }
        }
    }, [initialValue, isEditing]);

    const handleSave = useCallback((newValue: string) => {
        const trimmed = newValue.trim();
        // Apenas salva se mudou (permite salvar string vazia se for a intenção,
        // mas geralmente queremos manter limpo)
        if (trimmed !== initialValue) {
            onSave(trimmed);
        }
    }, [initialValue, onSave]);

    const handleChange = useCallback(() => {
        if (!contentRef.current) return;
        const newValue = contentRef.current.innerText;
        setLocalValue(newValue);

        // Salvo com debounce
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        saveTimeoutRef.current = setTimeout(() => {
            handleSave(newValue);
        }, 600); // 600ms debounce
    }, [handleSave]);

    const handleBlur = useCallback(() => {
        setIsEditing(false);
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }
        if (contentRef.current) {
            handleSave(contentRef.current.innerText);
        }
    }, [handleSave]);

    const lastEnterTime = useRef<number>(0);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            // Revert
            setIsEditing(false);
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
            if (contentRef.current) {
                contentRef.current.innerText = initialValue;
            }
            setLocalValue(initialValue);
        } else if (e.key === 'Enter') {
            if (!multiline) {
                e.preventDefault();
                contentRef.current?.blur();
            } else if (onEnter) {
                // Detecção de Enter duplo (limite de 500ms)
                const now = Date.now();
                if (now - lastEnterTime.current < 500) {
                    // Enter duplo detectado!
                    e.preventDefault();
                    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
                    if (contentRef.current) handleSave(contentRef.current.innerText);
                    onEnter();
                    lastEnterTime.current = 0; // Reseta
                } else {
                    // Primeiro Enter: permite comportamento padrão (nova linha)
                    // Mas rastreia o tempo
                    lastEnterTime.current = now;
                    // Comportamento padrão permite que contentEditable insira <div> ou <br>
                    // Não chamamos preventDefault aqui
                }
            }
        }
    };

    const handleClick = () => {
        setIsEditing(true);
    };

    // Gerenciamento de foco
    useEffect(() => {
        if (isEditing && contentRef.current) {
            contentRef.current.focus();
            // Se autoFocus era relevante (recentemente criado), podemos querer
            // o cursor no início ou no fim. Comportamento padrão geralmente é no fim,
            // mas para novo item vazio não importa.
        }
    }, [isEditing]);

    const Tag = tagName as any;

    return (
        <Tag
            ref={contentRef}
            contentEditable={isEditing}
            suppressContentEditableWarning={true}
            onClick={handleClick}
            onBlur={handleBlur}
            onInput={handleChange}
            onKeyDown={handleKeyDown}
            className={`
                outline-none min-w-[10px] cursor-text transition-colors duration-200
                bg-transparent
                ${!localValue && placeholder ? 'empty:before:content-[attr(data-placeholder)] empty:before:text-white/20' : ''}
                ${className}
            `}
            data-placeholder={placeholder}
            spellCheck={false} // Aparência limpa
        >
            {initialValue}
        </Tag>
    );
};

export default EditableTextBlock;
