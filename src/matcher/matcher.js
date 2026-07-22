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

/** Escapa caracteres especiales de expresiones regulares. */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Coincidencia flexible de keywords como palabra o frase completa (word boundaries).
 * Permite que espacios, guiones, guiones bajos y puntos dentro de la keyword o texto
 * coincidan de forma equivalente (ej: "power-bi" coincide con "power bi").
 * Evita falsos positivos como "excel" en "excelencia", "bi" en "biblioteca",
 * "sql" en "mysql", "ia" en "secretaria", "kpi" en "explicito", etc.
 */
function contieneKeyword(textoNorm, keywordNorm) {
  if (!keywordNorm) return false;
  const escaped = escapeRegex(keywordNorm);
  const flex = escaped.replace(/(?:\\ |\s|-|\\\.|_)+/g, '[\\s\\-_.]+');
  const re = new RegExp(`(?:^|[^\\w])${flex}(?:[^\\w]|$)`, 'i');
  return re.test(textoNorm);
}

/**
 * Evalúa una licitación contra el perfil de ProgramBI.
 * @param {object} licitacion  normalizada
 * @param {object|null} perfil { umbral, requireTecnico, cursos[] }
 */
function evaluar(licitacion, perfil) {
  const lic = licitacion || {};
  const cfg = perfil || KEYWORDS_DEFAULT;
  const umbral = typeof cfg.umbral === 'number' ? cfg.umbral : 1;

  const texto = normalizar(
    `${lic.nombre || ''} ${lic.descripcion || ''} ${lic.tipo || ''}`
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
    const coincidenciasUnicas = [...new Set(coincidencias)];
    if (coincidenciasUnicas.length > 0) {
      cursosDetectados.push({
        id: curso.id,
        nombre: curso.nombre,
        coincidencias: coincidenciasUnicas,
      });
      scoreTotal += coincidenciasUnicas.length;
      if (curso.id !== 'formacion') scoreTecnico += coincidenciasUnicas.length;
    }
  }

  // Por defecto: hace falta al menos 1 keyword técnica (Excel, Power BI, SQL, IA, etc.).
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
