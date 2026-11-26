const $ = id => document.getElementById(id);
const workspace = $('herramientas');
const menu = $('tool-menu');
const campaign = $('campana');
const choice = $('tool-choice');
const panels = [...document.querySelectorAll('[data-analysis]')];
let current = '';

function render(id) {
  const panel = panels.find(item => item.id === id);
  current = panel?.id || '';
  for (const item of panels) item.hidden = item !== panel;
  workspace.classList.toggle('tool-open', !!panel);
  menu.hidden = !!panel;
  $('tool-actions').hidden = !panel;
  choice.value = current;
}

function navigate(id, scroll) {
  const previous = current;
  const isCampaign = id === campaign.id;
  render(id);
  const destination = isCampaign ? campaign : workspace;
  const hash = '#' + (current || destination.id);
  if (location.hash !== hash) history.pushState(null, '', hash);
  if (!scroll) return;
  destination.scrollIntoView({block:'start'});
  if (isCampaign) {
    campaign.querySelector('h2').focus({preventScroll:true});
    return;
  }
  const target = current ? $(current).querySelector('h2') : menu.querySelector('a[href="#' + previous + '"]');
  (target || $('analysis-heading')).focus({preventScroll:true});
}

export function showAnalysis(id, scroll = false) {
  if (menu) navigate(id, scroll);
}

function restore(scroll) {
  const target = $(location.hash.slice(1));
  const panel = target?.closest('[data-analysis]');
  render(panel?.id);
  if (target?.id === 'datos') target.querySelector('details').open = true;
  if (!scroll || !target) return;
  if (target === panel || target === workspace) workspace.scrollIntoView({block:'start'});
  else {
    for (let parent = target.closest('details'); parent; parent = parent.parentElement?.closest('details')) parent.open = true;
    target.scrollIntoView({block:'start'});
  }
}

if (menu) {
  choice.add(new Option('Elegir una herramienta…', ''));
  for (const group of menu.children) {
    const options = document.createElement('optgroup');
    options.label = group.querySelector('h3').textContent;
    for (const link of group.querySelectorAll('a')) options.append(new Option(link.textContent, link.hash.slice(1)));
    choice.append(options);
  }
  for (const panel of panels) panel.querySelector('h2').tabIndex = -1;
  choice.addEventListener('change', () => navigate(choice.value, true));
  $('tool-close').addEventListener('click', () => navigate('', true));
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const link = event.target.closest('a[href^="#"]');
    if (!link || link.target === '_blank') return;
    const target = $(link.hash.slice(1));
    if (target === workspace || target === campaign || panels.includes(target)) {
      event.preventDefault();
      navigate(target === workspace ? '' : target.id, true);
    }
  });
  window.addEventListener('hashchange', () => restore(true));
  restore(false);
  if (location.hash) requestAnimationFrame(() => restore(true));
}
