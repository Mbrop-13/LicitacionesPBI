'use strict';

const cron = require('node-cron');
const { config } = require('./config');
const { ejecutarBusqueda } = require('./buscador');
const control = require('./busquedaControl');

let tarea = null;
let corriendo = false;

/**
 * Solo arranca si AUTO_BUSCAR=1.
 * Por defecto la app NO busca sola: solo con el botón "Buscar ahora".
 */
function arrancar() {
  if (tarea) return;

  if (!config.autoBuscar) {
    console.log('[scheduler] Automático DESACTIVADO (solo búsqueda manual).');
    console.log('[scheduler] Para activarlo: AUTO_BUSCAR=1 en .env');
    return;
  }

  if (!cron.validate(config.cronExpresion)) {
    console.error(`[scheduler] Expresión cron inválida: ${config.cronExpresion}`);
    return;
  }

  tarea = cron.schedule(
    config.cronExpresion,
    async () => {
      if (corriendo || control.isActive()) {
        console.log('[scheduler] Omitido: ya hay una búsqueda en curso');
        return;
      }
      corriendo = true;
      console.log(`[scheduler] Inicio búsqueda automática ${new Date().toISOString()}`);
      try {
        const r = await ejecutarBusqueda({ origen: 'cron' });
        console.log(
          `[scheduler] OK: ${r.nuevas} nuevas / ${r.guardadas} guardadas de ${r.api} en API`
        );
        if (r.errores?.length) console.warn('[scheduler] errores:', r.errores.join(' | '));
      } catch (e) {
        console.error('[scheduler] Error:', e.message);
      } finally {
        corriendo = false;
      }
    },
    { timezone: config.cronTimezone }
  );

  console.log(`[scheduler] Automático ON: ${config.cronExpresion} (${config.cronTimezone})`);
}

function detener() {
  if (tarea) {
    tarea.stop();
    tarea = null;
  }
}

module.exports = { arrancar, detener };
