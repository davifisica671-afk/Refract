// src/lib/utils.ts

/**
 * Função utilitária para combinar classes CSS condicionalmente.
 * 
 * COMO FUNCIONA:
 * Aceita uma quantidade variável de argumentos (strings de classes CSS)
 * e retorna apenas as que são "truthy" (não vazias, não undefined, não null).
 * Isso é útil para aplicar classes CSS condicionalmente em componentes React.
 * 
 * EXEMPLO DE USO:
 * cn("base-class", isActive && "active-class", isDisabled && "disabled")
 * Se isActive=true e isDisabled=false, retorna: "base-class active-class"
 * 
 * EQUIVALENTE A:
 * classnames() ou clsx() de bibliotecas populares, mas implementado do zero
 * para evitar dependências externas desnecessárias.
 * 
 * PARÂMETROS:
 * @param classes - Strings de classes CSS, ou valores condicionais (undefined/null são filtrados)
 * @returns String com as classes válidas separadas por espaço
 */
export function cn(...classes: (string | undefined)[]) {
  return classes.filter(Boolean).join(" ") // filter(Boolean) remove valores falsy, join combina com espaço
}
