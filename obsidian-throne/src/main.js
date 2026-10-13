import { Game, buildSpecialTargets } from './game.js';

const bar = document.querySelector('#bar i');
const loadTxt = document.getElementById('loadTxt');

async function boot() {
  let game;
  try {
    game = new Game(document.getElementById('game'));
  } catch (err) {
    fatal(err);
    return;
  }
  try {
    await game.init((p, txt) => {
      bar.style.width = Math.round(p * 100) + '%';
      if (txt) { loadTxt.textContent = txt; }
    });
  } catch (err) {
    fatal(err);
    return;
  }
  game.specialTargets = buildSpecialTargets(game);
  bar.style.width = '100%';
  loadTxt.textContent = 'Pronto — clique em Entrar no Castelo';
  game.updateHUD();
  game.start();
  window.game = game;   // útil para inspeção no console
  const loader = document.getElementById('loader');
  loader.style.opacity = '0';
  setTimeout(() => { loader.style.display = 'none'; }, 800);
  document.getElementById('menuFps').textContent = `Cena pronta · ${game.world.b.count} peças de geometria mescladas · ${game.npcs.length} NPCs`;
  // HUD aparece ao entrar
  document.getElementById('btnStart').addEventListener('click', () => {
    document.getElementById('hud').classList.add('on');
    setTimeout(() => { document.getElementById('hud').classList.add('on'); }, 100);
  });
}

function fatal(err) {
  console.error(err);
  const el = document.createElement('div');
  el.className = 'fatal';
  el.innerHTML = `<div><div style="font-size:22px;color:#e6cd7a;letter-spacing:.2em;margin-bottom:14px">O REINO NÃO PÔDE SER ERGUIDO</div>
    <div>Seu navegador não conseguiu iniciar o WebGL 2. Tente outro navegador (Chrome/Edge/Firefox atualizados)<br>ou habilite a aceleração de hardware.</div>
    <div style="margin-top:14px;color:#8d8578;font-size:12px">${String(err && err.message || err)}</div></div>`;
  document.body.appendChild(el);
}

boot();
