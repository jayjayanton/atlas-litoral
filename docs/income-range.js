// ENIGHUR groups use the same provincial age classes as the census household
// estimator. The first bin includes zero. Every finite upper bound is exclusive.
export function incomeRangeProvinces(data, lower, upper) {
  const step = data.stepUSD;
  const valid = value => Number.isInteger(value) && value >= 0 && value <= 100000 && value % step === 0;
  if (!valid(lower) || (upper !== null && (!valid(upper) || upper <= lower))) {
    throw new RangeError('Ingresa límites de 0 a 100.000 USD en pasos de 100, con el mínimo menor que el máximo.');
  }
  const first = lower / step;
  const end = upper === null ? Infinity : upper / step;
  return Object.fromEntries(Object.entries(data.provinces).map(([code, groups]) => {
    const refs = groups.map(({weights}) => {
      let total = 0, included = 0;
      for (let i = 0; i < weights.length; i++) {
        total += weights[i];
        if (i >= first && i < end) included += weights[i];
      }
      if (!(total > 0)) throw new RangeError('Falta la base de hogares para calcular el tramo.');
      return {shares:[included / total]};
    });
    return [code, refs];
  }));
}
