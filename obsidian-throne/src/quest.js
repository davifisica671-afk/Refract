import { ROOMS } from './config.js';

/** Textos do diário para cada pista descoberta (sussurros, segredos, boatos). */
export const CLUES = {
  iron: 'O rei Aldric confessou: o irmão Doran morreu há vinte anos, mas alguém sobe doze degraus e senta no trono todas as noites.',
  iron_oath: 'Ser Garrick: "Enquanto um Vash respirar, o Ferro Negro dorme." O juramento é medo com uniforme.',
  poison: 'Mestre Corvin: chumbo, cicuta e coral moído. Alguém serve veneno ao rei e chama isso de remédio.',
  poison_name: 'A mistura tem nome de corte: "Lágrima de Doran". Chumbo, cicuta e coral da costa leste.',
  oven: 'A fornalha da cozinha chora como um pagem — e a pedra está quente sem fogo desde a lua nova.',
  boots: 'Três pares de botas pequenas, lavadas, apareceram no corredor dos servos.',
  jester: 'Odo, o bobo, diz que o copeiro bebe, a capitã tem medo de água, e ele mesmo ouviu o nome do veneno.',
  lero: 'Lyle pagou em prata da guarda velha, com o lobo de Doran cunhado. Um homem de luva, sem rosto.',
  lero_bridge: 'As entregas acontecem no arco sul da ponte, ao pé do terceiro pilar, quando a lua é fina.',
  bridge: 'A rainha marcou a ponte do Cinza quatro vezes. Alguém atravessa por baixo dela.',
  bridge_guard: 'Nara e Edda: a água sobe contra a correnteza e homens olham a lua sem piscar.',
  crypt_hand: 'Na cripta, o vigésimo rei de pedra abre a mão para o vazio — e a pedra está quente à noite.',
  doran_alive: 'Doran morreu na guerra e foi devolvido em sal. Alguém, porém, anda com o rosto dele.',
  throne_ghost: 'Odo viu um homem de manto antigo sentar no Trono de Obsidiana e cantar para a pedra.',
  rock: 'No rochedo do dragão, um altar na boca da pedra. O último dragão de Varenya dorme ali.',
  beast: 'A Coisa Magra uiva no bosque e devolve ossos arrumados. O silêncio do bosque é a boca aberta dela.',
  villagers: 'O moleiro e a filha voltaram do bosque contando pedras e esperando um homem de luva.',
  salt: 'Sal grosso que não é sal cruza a ponte em barris com peso errado. É coral moído.',
  oil: 'O castelo compra óleo de lamparina em triplo. Alguém quer o castelo bem aceso — ou bem queimado.',
  cell: 'Na terceira cela da masmorra, uma voz responde "está frio, irmão" para quem bate. A cela nunca esteve trancada.',
  ysolda_night: 'A princesa caminha de madrugada. "Não a chame três vezes — na segunda, quem responde não é ela."',
  oath: 'O Arquivo Real: a Ordem de Ferro assinou a rendição da ponte há cem anos. A assinatura foi feita com sangue de rei.',
  horse: 'Assobie e Bruma atende — o corcel do príncipe, que parou de comer nove dias quando ele morreu.',
  ruins: 'Ruínas do Septo Antigo, ao norte: pedra com dentes e neve que não derrete.',
  salt_oath: 'A Fé queima mortos. Se a fornalha guarda cinzas que choram, alguém desobedeceu o rito.',
};

/** A Crônica principal — passos em ordem. */
export const STEPS = [
  { id: 'maren', text: 'Falar com Ser Maren no pátio de treino (oeste do castelo).', done: s => s.seen.has('maren_talk') },
  { id: 'rooms', text: 'Explorar 5 quartos do castelo (o registro conta os que já vistes).', done: s => s.seen.size >= 5, prog: s => `${Math.min(s.seen.size, 5)}/5` },
  { id: 'crypt', text: 'Descer à Cripta dos Reis e olhar as mãos de pedra.', done: s => s.rooms.has('Cripta dos Reis') },
  { id: 'princess', text: 'Subir ao 2º andar e falar com a Princesa Ysolda.', done: s => s.seen.has('ysolda_talk') },
  { id: 'gift', text: 'Abrir o baú de obsidiana do quarto da princesa e trazer o Ferro Negro.', done: s => s.items.has('ferro') },
  { id: 'horse', text: 'Assobiar (H) no pátio e montar em Bruma (F).', done: s => s.seen.has('mounted') },
  { id: 'gate', text: 'Atravessar o portão do castelo e chegar à Vila Cinzalta.', done: s => s.rooms.has('Vila Cinzalta') },
  { id: 'bridge', text: 'Ir até a Ponte do Rio Cinza e olhar o terceiro pilar.', done: s => s.rooms.has('Ponte do Rio Cinza') },
  { id: 'rock', text: 'Subir ao Rochedo do Dragão, a leste, além do rio.', done: s => s.rooms.has('Rochedo do Dragão') },
  { id: 'ruins', text: 'Voltar às Ruínas do Septo Antigo, ao norte, onde a neve não derrete.', done: s => s.rooms.has('Ruínas do Septo Antigo') },
  { id: 'throne', text: 'Voltar ao castelo e sentar-te no Trono de Obsidiana.', done: s => s.seen.has('sat_throne') },
];

export const TITLES = [
  { need: 0, name: 'Escudeiro do Portão' },
  { need: 2, name: 'Escudeiro da Guarda' },
  { need: 4, name: 'Cavaleiro de Varn' },
  { need: 7, name: 'Cavaleiro do Reino' },
  { need: 9, name: 'Voz de Varenya' },
  { need: 11, name: 'Herdeiro de Varenya' },
];

export class Quest {
  constructor(game) {
    this.game = game;
    this.rooms = new Set();      // nomes de lugares visitados
    this.seen = new Set();       // eventos vistos
    this.flags = new Set();
    this.clues = new Set();
    this.items = new Set();
    this.gold = 0;
    this.stepIndex = 0;
    this.finished = false;
  }

  /* ---------- registros ---------- */
  visit(room) {
    if (!room || this.rooms.has(room.name)) return;
    this.rooms.add(room.name);
    const isRoom = ROOMS.some(r => r.name === room.name);
    this.game.notify((isRoom ? '◆ Quarto registrado: ' : '· Lugar: ') + room.name);
    this.game.log(`Descoberto: ${room.name}`);
    this.roomsSeenCount = (this.roomsSeenCount || 0) + 1;
  }
  mark(id) {
    if (this.seen.has(id)) return;
    this.seen.add(id);
  }
  clue(id) {
    if (this.clues.has(id)) return;
    this.clues.add(id);
    const txt = CLUES[id] || id;
    this.game.notify('Diário actualizado — ' + txt.slice(0, 78) + (txt.length > 78 ? '…' : ''));
    this.game.openJournal(txt);
  }
  give(item) {
    if (this.items.has(item)) return;
    this.items.add(item);
    const names = { tocha: 'Quatro tochas', vela: 'Vela de vidente', mapa: 'Mapa do reino', moeda: 'Moeda de prata velha', corcel: 'Licença de equitação', ferro: 'Ferro Negro', arquivo: 'Chave do Arquivo Real', taça: 'Taça de prata de Odo' };
    this.game.notify('Recebido: ' + (names[item] || item));
  }
  bless() { this.flags.add('blessed'); this.game.notify('Bênção do Septon: os cascos conhecem o caminho.'); }
  start(id) { this.flags.add('q_' + id); this.game.notify('Nova tarefa anotada na Crônica.'); }

  /* ---------- progresso ---------- */
  objective() {
    for (let i = 0; i < STEPS.length; i++) if (!STEPS[i].done(this)) return STEPS[i];
    return null;
  }
  objectiveIndex() {
    for (let i = 0; i < STEPS.length; i++) if (!STEPS[i].done(this)) return i;
    return STEPS.length;
  }
  progressCount() { return STEPS.filter(s => s.done(this)).length; }
  title() {
    const p = this.progressCount();
    let t = TITLES[0].name;
    for (const x of TITLES) if (p >= x.need) t = x.name;
    return t;
  }
  check() {
    const before = this.objectiveIndex();
    if (before !== this.stepIndex) {
      this.stepIndex = before;
      const st = STEPS[before];
      if (st) this.game.notify('Crônica: ' + st.text);
      if (before >= STEPS.length && !this.finished) {
        this.finished = true;
        this.game.onChronicleComplete();
      }
    }
  }
}
