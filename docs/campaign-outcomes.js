const amounts = new Intl.NumberFormat('es-EC', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const metrics = [
  {name: 'inquiries', label: 'Consultas calificadas', unit: 'consulta calificada'},
  {name: 'visits', label: 'Visitas agendadas', unit: 'visita agendada'}
];

function armMarkup(label) {
  return `<fieldset class="outcomes-arm">
    <legend>${label}</legend>
    <div class="outcomes-fields">
      <label>Gasto publicitario (USD)<input name="spend" type="number" inputmode="decimal" min="0" step="0.01"></label>
      ${metrics.map(metric => `<label>${metric.label}<input name="${metric.name}" type="number" inputmode="numeric" min="0" step="1"></label>`).join('')}
    </div>
    <p class="outcomes-result" aria-live="polite" aria-atomic="true"></p>
  </fieldset>`;
}

function costPerResult(spend, count) {
  if (!spend.validity.valid || !count.validity.valid ||
      (spend.value !== '' && !Number.isSafeInteger(Math.round(spend.valueAsNumber * 100))) ||
      (count.value !== '' && !Number.isSafeInteger(count.valueAsNumber))) {
    return {label: 'revisa los valores'};
  }
  if (spend.value === '' || count.value === '') return {label: 'pendiente'};
  if (spend.valueAsNumber === 0) return {label: 'sin inversión'};
  if (count.valueAsNumber === 0) return {label: 'sin resultados registrados'};
  const cost = spend.valueAsNumber / count.valueAsNumber;
  return {cost, label: 'USD ' + amounts.format(cost)};
}

function describeDifference(first, second, unit) {
  // Compare the same two-decimal costs the reader sees for each territory.
  if (first.cost === undefined || second.cost === undefined) return '';
  const delta = Math.round(first.cost * 100) - Math.round(second.cost * 100);
  if (delta === 0) return 'El costo por ' + unit + ' coincide al centavo.';
  return 'El piloto costó USD ' + amounts.format(Math.abs(delta) / 100) +
    (delta < 0 ? ' menos' : ' más') + ' por ' + unit + ' que la referencia.';
}

export function initCampaignOutcomes(container) {
  const details = document.createElement('details');
  details.className = 'campaign-outcomes';
  details.hidden = true;
  details.innerHTML = `<summary>Comparar resultados de la campaña</summary>
    <p>Ingresa los resultados reales del piloto y de una zona comparable fuera del piloto. Usa el mismo proyecto, período, anuncio, canal y criterio de calificación en ambas zonas.</p>
    <div class="outcomes-arms">${armMarkup('Zona piloto')}${armMarkup('Zona de referencia')}</div>
    <p class="outcomes-result outcomes-difference" aria-live="polite" aria-atomic="true"></p>
    <small>Deja en blanco lo que aún no mediste. Los valores se borran al cambiar de plan o recargar la página.</small>`;
  container.append(details);
  const arms = [...details.querySelectorAll('fieldset')];
  const difference = details.querySelector('.outcomes-difference');
  let currentKey = null;

  function refresh() {
    const results = arms.map(arm => {
      const values = metrics.map(metric => costPerResult(arm.elements.spend, arm.elements[metric.name]));
      arm.querySelector('.outcomes-result').textContent = metrics.map((metric, index) =>
        'Costo por ' + metric.unit + ' · ' + values[index].label
      ).join('. ') + '.';
      return values;
    });
    difference.textContent = metrics.map((metric, index) =>
      describeDifference(results[0][index], results[1][index], metric.unit)
    ).filter(Boolean).join(' ');
  }

  details.addEventListener('input', refresh);
  return {
    setPlan(key) {
      if (key === currentKey) return;
      currentKey = key;
      details.open = false;
      details.hidden = key == null;
      for (const input of details.querySelectorAll('input')) input.value = '';
      refresh();
    }
  };
}
