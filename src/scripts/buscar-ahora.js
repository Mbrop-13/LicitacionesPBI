'use strict';

require('dotenv').config();
const { ejecutarBusqueda } = require('../buscador');

(async () => {
  console.log('ProgramBI · Búsqueda manual de licitaciones…\n');
  try {
    const r = await ejecutarBusqueda({ origen: 'cli' });
    console.log('Resultado:');
    console.log(`  API revisadas : ${r.api}`);
    console.log(`  Coincidencias : ${r.guardadas}`);
    console.log(`  Nuevas        : ${r.nuevas}`);
    console.log(`  Descartadas   : ${r.descartadas}`);
    if (r.errores?.length) console.log('  Errores       :', r.errores.join(' | '));
    if (r.items?.length) {
      console.log('\nNuevas:');
      for (const i of r.items) {
        console.log(`  · [${i.afinidad}%] ${i.codigo} — ${i.nombre}`);
        console.log(`    ${(i.cursos || []).join(', ')}`);
      }
    }
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
