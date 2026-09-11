import React from 'react';

/**
 * RefractLogoMark.tsx
 * Logomarca do Refract — o "prisma", fiel à arte oficial (assets/logo nova):
 * silhueta única e cheia, com o recorte em chevron do vértice de refração e
 * a ponta inferior afiada. Só preenchimento, cantos arredondados via
 * stroke-linejoin (o vértice côncavo permanece afiado, como no original).
 * Herda `color` (currentColor); estilizar com className.
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
        <path
            d="M16 12 H68 L50 50 L90 76 L58 82 L16 62 Z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="6"
            strokeLinejoin="round"
        />
    </svg>
);