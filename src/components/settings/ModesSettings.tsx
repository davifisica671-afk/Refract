/**
 * ModesSettings.tsx
 *
 * Módulo stub público para configuração de Modos (personas especializadas).
 * A implementação real fica no submódulo privado premium/.
 * Este arquivo re-exporta via o carregador premium para que os chamadores
 * em src/ não precisem saber onde o código real está.
 *
 * Em builds open-source (sem pasta premium/), o carregador premium
 * retorna um componente nulo e este painel simplesmente não renderiza nada.
 */
export { ModesSettings as default } from '../../premium';
