# O Trono de Obsidiana

Jogo 3D de fantasia sombria (tom *A Crônica do Gelo e do Fogo*) feito com three.js puro,
sem assets externos: toda a geometria é procedural e mesclada por cor de vértice.

## Como rodar

```bash
cd obsidian-throne
npm install          # só na primeira vez
npm run dev          # http://localhost:5199  (0.0.0.0:5199)
npm run build        # build de produção em dist/
node scripts/verify.mjs   # verificação headless do mundo (ver abaixo)
```

## Controles

| Tecla | Ação |
| --- | --- |
| W A S D | andar |
| Shift | correr (gasta vigor) |
| Espaço | pular |
| E | interagir (NPCs, portão, baús, santuários, cavalo) |
| H | assobiar (chama o corcel) |
| F | montar / desmontar |
| M | mapa do reino (com viagem rápida nos santuários) |
| Tab | registro / diário da crônica |
| 1–9 | usar itens da mochila |
| ESC | pausa / menu |

Câmera em terceira pessoa no ombro, com colisão contra paredes e teto.

## O castelo

- **3 andares** + subsolo:
  - **Térreo**: Grande Salão, Cozinha & Despensa, Aposentos dos Servos, Salão de Armas,
    Câmara da Guarda, Vestíbulo, Pátios, Estrebaria, Adega.
  - **1º andar**: Biblioteca Real, Salão do Conselho, Aposentos Reais, Capela dos Sussurros,
    Torre do Mestre, Arquivo Real.
  - **2º andar**: Salão do Trono (com o Trono de Obsidiana), Quarto da Princesa,
    Solar de Bordado, Câmara do Sussurro.
  - **Subsolo**: Cripta dos Reis e Masmorra (descida pelo Salão de Armas;
    escadaria em dois lances na torre leste liga os três andares).
- **10 quartos** registrados (`ROOMS`) + 11 lugares (`PLACES`), **53 NPCs** com rotina
  diária (rei, rainha, princesa, conselheiro, guardas, criados, clero, povo, animais).
- **Reino exterior**: Vila Cinzalta, Ponte do Rio Cinza, Rochedo do Dragão,
  Ruínas do Septo Antigo, Bosque de Varenya e 6 santuários — alcançáveis a pé
  ou a galope, abrindo o portão do castelo.

## Crônica (missão principal)

11 passos encadeados em `src/quest.js` (de *Escudeiro do Portão* a *Herdeiro de Varenya*),
com pistás de diário (`CLUES`) desbloqueadas por diálogo, e teleporte final pelo trono.

## Verificação headless (`node scripts/verify.mjs`)

Como não há navegador headless no ambiente, o mundo é validado sem WebGL:

1. constrói o castelo + reino e reporta estatísticas (peças, colisores, triângulos);
2. percorre o mapa com a **mesma física do jogo** (BFS de 8 direções, passo 0,45 m no
   castelo e 2 m no reino, usando `groundAt`/`blocked` com a referência de degrau `yRef`)
   e prova que os 10 quartos, os 3 andares, a cripta, os pátios e todos os pontos do
   reino são alcançáveis a pé, e que o telhado **não** é;
3. verifica que cada NPC nasce sobre piso sólido e fora de paredes.

Saída esperada no fim: `OK — todos os quartos, andares e lugares do reino são alcançáveis a pé.`
