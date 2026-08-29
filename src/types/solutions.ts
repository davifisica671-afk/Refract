/**
 * Tipo que representa uma solução completa para um problema de programação.
 * Cada solução contém o código, scripts de apoio para o entrevistador e
 * informações de complexidade algorítmica.
 */
export interface Solution {
  problem_identifier_script: string; // Script que o entrevistador deve dizer para confirmar o entendimento do problema
  brainstorm_script: string;         // Script que o entrevistador deve dizer para discutir e comparar abordagens de resolução
  code: string;                      // O bloco de código da solução implementada em uma linguagem de programação
  dry_run_script: string;            // Script que o entrevistador deve dizer para executar um passo-a-passo mental do código (dry run)
  time_complexity: string;           // Notação Big-O da complexidade temporal (ex: "O(n log n)")
  space_complexity: string;          // Notação Big-O da complexidade espacial (ex: "O(1)")
}

/**
 * Tipo que representa a resposta da API contendo uma ou mais soluções.
 * As chaves são identificadores das soluções, e os valores são objetos Solution.
 */
export interface SolutionsResponse {
  [key: string] : Solution // Mapeia o nome/identificador da solução para o objeto Solution
}

/**
 * Tipo que representa os dados extraídos de um enunciado de problema de programação.
 * Contém todas as informações necessárias para resolver o problema: enunciado,
 * formatos de entrada/saída, casos de teste e metadados de dificuldade.
 */
export interface ProblemStatementData {
  problem_statement: string; // O texto completo do enunciado do problema
  input_format: {
    description: string;     // Descrição legível do formato de entrada
    parameters: any[];       // Lista de parâmetros com seus tipos e restrições
  };
  output_format: {
    description: string;     // Descrição legível do formato de saída esperado
    type: string;            // Tipo do dado de saída (ex: "array", "integer", "boolean")
    subtype: string;         // Subtipo mais específico (ex: "array of integers")
  };
  complexity: {
    time: string;            // Complexidade temporal esperada (ex: "O(n)")
    space: string;           // Complexidade espacial esperada (ex: "O(1)")
  };
  test_cases: any[];         // Lista de casos de teste com entradas e saídas esperadas
  validation_type: string;   // Tipo de validação (ex: "exact", "approximate")
  difficulty: string;        // Nível de dificuldade (ex: "easy", "medium", "hard")
}