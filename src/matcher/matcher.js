'use strict';

const { KEYWORDS_DEFAULT } = require('./keywords');

/** Quita tildes, pasa a minúsculas y colapsa espacios. */
function normalizar(texto) {
  return (texto || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s+.#/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Keywords muy cortas (bi, ia, sql, rpa, kpi…) deben coincidir como palabra completa,
 * no como subcadena de otras palabras.
 */
function esKeywordCorta(kw) {
  return kw.replace(/\s+/g, '').length <= 3;
}

function contieneKeyword(textoNorm, keywordNorm) {
  if (!keywordNorm) return false;
  if (esKeywordCorta(keywordNorm) || !keywordNorm.includes(' ')) {
    // palabra(s) completa(s)
    const partes = keywordNorm.split(/\s+/).filter(Boolean);
    if (partes.length === 1 && esKeywordCorta(partes[0])) {
      const re = new RegExp(`(?:^|\\s)${escapeRegex(partes[0])}(?:\\s|$)`, 'i');
      return re.test(textoNorm);
    }
  }
  return textoNorm.includes(keywordNorm);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Evalúa una licitación contra el perfil de ProgramBI.
 * @param {object} licitacion  normalizada
 * @param {object|null} perfil { umbral, cursos[] }
 */
function evaluar(licitacion, perfil) {
  const cfg = perfil || KEYWORDS_DEFAULT;
  const umbral = typeof cfg.umbral === 'number' ? cfg.umbral : 1;

  const texto = normalizar(
    `${licitacion.nombre || ''} ${licitacion.descripcion || ''} ${licitacion.tipo || ''}`
  );

  const cursosDetectados = [];
  let scoreTotal = 0;
  let scoreTecnico = 0; // sin contar solo "formación genérica"

  for (const curso of cfg.cursos || []) {
    const coincidencias = [];
    for (const kw of curso.keywords || []) {
      const k = normalizar(kw);
      if (!k) continue;
      if (contieneKeyword(texto, k)) coincidencias.push(kw);
    }
    if (coincidencias.length > 0) {
      cursosDetectados.push({
        id: curso.id,
        nombre: curso.nombre,
        coincidencias: [...new Set(coincidencias)],
      });
      scoreTotal += coincidencias.length;
      if (curso.id !== 'formacion') scoreTecnico += coincidencias.length;
    }
  }

  // Por defecto: hace falta al menos 1 keyword técnica (Excel, Power BI, etc.).
  // "Capacitación" sola genera demasiado ruido (primeros auxilios, seguridad, etc.).
  // Si umbral > 1, también se exige scoreTotal >= umbral.
  const requireTecnico = cfg.requireTecnico !== false;
  const pasa = requireTecnico
    ? scoreTecnico >= 1 && scoreTotal >= umbral
    : scoreTotal >= umbral;

  // Afinidad 0–100: prioriza coincidencias técnicas
  const base = scoreTecnico * 18 + (scoreTotal - scoreTecnico) * 6;
  const afinidad = Math.min(100, Math.round(base));

  return {
    cursos: cursosDetectados,
    score: scoreTotal,
    scoreTecnico,
    afinidad,
    pasa,
    soloFormacion: scoreTecnico === 0 && scoreTotal > 0,
  };
}

module.exports = { normalizar, evaluar, contieneKeyword };
