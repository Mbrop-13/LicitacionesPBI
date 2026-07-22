'use strict';

// Sanity check del dashboard (frontend + backend)
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const html = read('public/index.html');
const js = read('public/app.js');
const css = read('public/styles.css');
const db = read('src/store/db.js');
const api = read('src/apiApp.js');
const bus = read('src/buscador.js');

const checks = [
  // HTML
  ['HTML: dashboard-host presente', /id="dashboard-host"/.test(html)],
  ['HTML: side-item data-view=inicio presente', /data-view="inicio"/.test(html)],
  // JS
  ['JS: VIEWS.inicio declarado', /inicio:\s*\{\s*title:\s*'Inicio'/.test(js)],
  ['JS: view inicial = inicio', /let view = 'inicio';/.test(js)],
  ['JS: cargarDashboard() definida', /async function cargarDashboard\(/.test(js)],
  ['JS: renderDashboard() definida', /function renderDashboard\(/.test(js)],
  ['JS: reEnriquecerAhora() definida', /async function reEnriquecerAhora\(/.test(js)],
  ['JS: setView() muestra dashboard solo en inicio', /dashboard-host.*hidden.*\!isInicio/.test(js)],
  // CSS
  ['CSS: .dash-hero', /\.dash-hero\s*\{/.test(css)],
  ['CSS: .dash-ventana', /\.dash-ventana\s*\{/.test(css)],
  ['CSS: .dash-bars', /\.dash-bars/.test(css)],
  ['CSS: .dash-ult-link', /\.dash-ult-link/.test(css)],
  ['CSS: .dash-progress', /\.dash-progress/.test(css)],
  // Backend DB
  ['DB: dashboard() definida', /async function dashboard\(/.test(db) || /function dashboard\(/.test(db)],
  ['DB: dashboardLocal()', /function dashboardLocal\(/.test(db)],
  ['DB: dashboardSupabase()', /async function dashboardSupabase\(/.test(db)],
  ['DB: reEnriquecerSinDescripcion()', /async function reEnriquecerSinDescripcion\(/.test(db)],
  ['DB: dashboard exportado', /^\s*dashboard\b/m.test(db.split('module.exports')[1] || '')],
  ['DB: reEnriquecerSinDescripcion exportado', /^\s*reEnriquecerSinDescripcion\b/m.test(db.split('module.exports')[1] || '')],
  // API endpoints
  ['API: GET /api/dashboard', /app\.get\(`\$\{BASE\}\/dashboard`/.test(api)],
  ['API: POST /api/licitaciones/re-enriquecer', /app\.post\(`\$\{BASE\}\/licitaciones\/re-enriquecer`/.test(api)],
  // Buscador
  ['BUS: enriquecerEnLocal', /enriquecerEnLocal/.test(bus)],
];

let pass = 0;
let fail = 0;
for (const [name, ok] of checks) {
  if (ok) { pass++; console.log('  OK   ' + name); }
  else    { fail++; console.log('  FAIL ' + name); }
}
console.log(`\n=== ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
