'use strict';
function interpolate(str, vars) {
  if (typeof str !== 'string' || !vars) return str;
  return str.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) => {
    const v = vars[key];
    return v === undefined || v === null ? match : String(v);
  });
}
function resolveStepValues(values, vars) {
  if (!vars || values === null || typeof values !== 'object') return values;
  const out = Array.isArray(values) ? [] : {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === 'string') out[k] = interpolate(v, vars);
    else if (v && typeof v === 'object') out[k] = resolveStepValues(v, vars);
    else out[k] = v;
  }
  return out;
}
function normalizeVariables(indices, variables) {
  if (!variables) return {};
  if (Array.isArray(variables)) {
    const out = {};
    (indices || []).forEach((idx, pos) => {
      if (variables[pos] !== undefined) out[idx] = variables[pos];
    });
    return out;
  }
  if (typeof variables === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(variables)) {
      const idx = Number(k);
      if (Number.isFinite(idx)) out[idx] = v;
    }
    return out;
  }
  return {};
}
module.exports = { interpolate, resolveStepValues, normalizeVariables };