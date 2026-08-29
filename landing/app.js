// Reveal on scroll — adiciona .in quando o elemento entra na viewport.
// IntersectionObserver é barato e nativo; nada de biblioteca.
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) {
      e.target.classList.add('in');
      io.unobserve(e.target); // revela uma vez só
    }
  }
}, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

document.querySelectorAll('[data-reveal]').forEach((el, i) => {
  // pequeno stagger por ordem de aparição dá o efeito "premium"
  el.style.transitionDelay = `${Math.min(i * 40, 240)}ms`;
  io.observe(el);
});

// Revela imediatamente o que já está acima da dobra (hero/nav) no load.
window.addEventListener('load', () => {
  document.querySelectorAll('[data-reveal]').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.9) el.classList.add('in');
  });
});
