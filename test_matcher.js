'use strict';

// Test del matcher por word boundary. Corre con: node test_matcher.js

const { normalizar, contieneKeyword, evaluar } = require('./src/matcher/matcher');
const { KEYWORDS_DEFAULT } = require('./src/matcher/keywords');

let pass = 0;
let fail = 0;
const failures = [];

function check(label, texto, keyword, esperado) {
  const t = normalizar(texto);
  const k = normalizar(keyword);
  const got = contieneKeyword(t, k);
  const ok = got === esperado;
  if (ok) {
    pass++;
    console.log(`  PASS  "${keyword}" vs "${texto}" -> ${got}`);
  } else {
    fail++;
    failures.push({ label, texto, keyword, esperado, got });
    console.log(`  FAIL  "${keyword}" vs "${texto}" -> esperaba ${esperado}, dio ${got}`);
  }
}

console.log('\n=== POSITIVOS (deben matchear) ===');
check('pos', 'Curso de Excel', 'excel', true);
check('pos', 'EXCEL AVANZADO', 'excel', true);
check('pos', 'capacitacion en excel', 'excel', true);
check('pos', 'Curso SQL basico', 'sql', true);
check('pos', 'SQL SERVER 2019', 'sql', true);
check('pos', 'curso de IA aplicada', 'ia', true);
check('pos', 'Inteligencia Artificial', 'inteligencia artificial', true);
check('pos', 'I.A. para docentes', 'i.a.', true);
check('pos', 'I.A. para docentes', 'i.a', true);
check('pos', 'curso de ia basica', 'ia', true);
check('pos', 'curso de Python', 'python', true);
check('pos', 'Microsoft Power BI', 'power bi', true);
check('pos', 'Capacitacion Power-BI', 'power bi', true);
check('pos', 'Curso Power_BI Desktop', 'power bi', true);

console.log('\n=== NEGATIVOS (NO deben matchear) ===');
check('neg', 'excelente capacitacion', 'excel', false);
check('neg', 'excelencia academica', 'excel', false);
check('neg', 'excelsior', 'excel', false);
check('neg', 'mysql administrador', 'sql', false);
check('neg', 'postgresql tuning', 'sql', false);
check('neg', 'mariadb server', 'sql', false);
check('neg', 'secretaria administrativa', 'ia', false);
check('neg', 'garantia extendida', 'ia', false);
check('neg', 'policial', 'ia', false);
check('neg', 'asistencia tecnica', 'ia', false);
check('neg', 'analisis de datos', 'analisis', true);
check('neg-check-analsis-vs-analiticos', 'materiales analiticos', 'analisis', false);
check('neg', 'powerbi avanzado', 'bi', false); // "bi" suelto no debe matchear dentro de "powerbi" (transicion sin word boundary)

console.log('\n=== NORMALIZACION DE SEPARADORES ===');
check('norm', 'Power-BI', 'power bi', true);
check('norm', 'Power.BI', 'power bi', true);
check('norm', 'Power_BI', 'power bi', true);
check('norm', 'power-bi desktop', 'power bi', true);
check('norm', 'POWER BI', 'power bi', true);
check('norm', 'power  bi', 'power bi', true);

console.log('\n=== ACENTOS / CASE ===');
check('acc', 'Curso Analisis de Datos', 'analisis', true);
check('acc', 'CURSO ANÁLISIS DE DATOS', 'analisis', true);
check('acc', 'Capacitacion Programacion', 'programacion', true);

console.log('\n=== evaluar() sobre licitaciones de ejemplo ===');
const casosEval = [
  { nombre: 'Curso de Excel avanzado', descripcion: '40 horas', esperado: true },
  { nombre: 'Excelente capacitacion docente', descripcion: 'primer ciclo', esperado: false },
  { nombre: 'Servicio de soporte para MySQL', descripcion: 'mantenimiento', esperado: false },
  { nombre: 'Curso SQL Server y Power BI', descripcion: 'capacitacion', esperado: true },
  { nombre: 'Servicio de garantia extendida', descripcion: 'secretaria tecnica', esperado: false },
];
for (const c of casosEval) {
  const r = evaluar({ nombre: c.nombre, descripcion: c.descripcion }, KEYWORDS_DEFAULT);
  const ok = r.pasa === c.esperado;
  if (ok) {
    pass++;
    console.log(`  PASS  evaluar("${c.nombre}") -> pasa=${r.pasa}, afinidad=${r.afinidad}, cursos=[${r.cursos.map(x => x.id).join(',')}]`);
  } else {
    fail++;
    failures.push({ label: 'eval', texto: c.nombre, esperado: c.esperado, got: r.pasa });
    console.log(`  FAIL  evaluar("${c.nombre}") -> esperaba pasa=${c.esperado}, dio pasa=${r.pasa}, afinidad=${r.afinidad}, cursos=[${r.cursos.map(x => x.id).join(',')}]`);
  }
}

console.log(`\n=== RESULTADO: ${pass} pass, ${fail} fail ===`);
if (fail > 0) {
  console.log('\nFallos:');
  for (const f of failures) console.log(' -', JSON.stringify(f));
  process.exit(1);
}
process.exit(0);
