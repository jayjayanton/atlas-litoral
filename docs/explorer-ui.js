const $ = id => document.getElementById(id);
const panels = [...document.querySelectorAll('[data-analysis]')];

export function showAnalysis(id, scroll = false) {
  const active = panels.find(panel => panel.id === id);
  panels.forEach(panel => { panel.hidden = panel !== active; });
  $('tool-choice').value = active?.id || '';
  if (scroll && active) active.scrollIntoView({block:'start'});
}

function revealHash(hash) {
  const target = document.getElementById(hash.slice(1));
  const panel = target?.closest('[data-analysis]');
  if (panel) showAnalysis(panel.id);
  if (target?.id === 'datos') target.querySelector('details').open = true;
  return panel;
}

$('tool-choice')?.addEventListener('change', event => {
  const id = event.target.value;
  showAnalysis(id);
  const url = new URL(location.href);
  url.hash = id || 'herramientas';
  history.pushState(null, '', url);
});
document.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#"]');
  if (link) revealHash(link.hash);
});
window.addEventListener('hashchange', () => {
  if (revealHash(location.hash)) document.getElementById(location.hash.slice(1)).scrollIntoView();
  else if (location.hash === '#herramientas' || !location.hash) showAnalysis('');
});
if (revealHash(location.hash)) requestAnimationFrame(() => document.getElementById(location.hash.slice(1)).scrollIntoView());
