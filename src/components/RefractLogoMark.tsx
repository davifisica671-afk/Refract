import React from 'react';

/**
 * RefractLogoMark.tsx
 * Logomarca do Refract — o "prisma": duas facetas de vidro angulares que se
 * encontram no ponto central (refração). Geometria vetorizada a partir da
 * arte oficial (assets/logo nova), normalizada para viewBox 0 0 100 100.
 * Herda `color` (currentColor) e pode ser estilizado com className.
 */
export const RefractLogoMark: React.FC<{
    size?: number;
    className?: string;
}> = ({ size = 18, className = '' }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-hidden="true"
    >
        <g
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinejoin="round"
        >
            {/* Faceta superior */}
            <path d="M9 0 H89 L96 4 L28 50 H13 L0 39 Z" />
            {/* Faceta inferior (espelho) */}
            <path d="M9 100 H89 L96 96 L28 50 H13 L0 61 Z" />
        </g>
    </svg>
);