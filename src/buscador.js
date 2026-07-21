'use strict';

const { config } = require('./config');
const {
  buscarPorFecha,
  detallePorCodigo,
  normalizarLicitacion,
} = require('./services/mercadoPublico');
const { evaluar } = require('./matcher/matcher');
const store = require('./store/db');
const { notificarDiscordCompatible } = require('./services/notificaciones');
const control = require('./busquedaControl');

const FLUSH_CADA = 40; // persiste descartadas en disco cada N ítems

/**
 * Búsqueda completa con auditoría y persistencia incremental de descartadas.
 * Soporta cancelación vía busquedaControl.requestCancel().
 */
async function ejecutarBusqueda(opts = {}) {
  const origen = opts.origen || 'manual';
  const diasAtras = opts.diasExtra ?? config.diasHaciaAtras;
  const busquedaId = `b_${Date.now()}`;
  const manageControl = opts.manageControl !== false;
  const myRunId = manageControl ? control.begin() : control.currentRunId();

  try {
  const perfil = (await store.cargarKeywords()) || undefined;

  let totalApi = 0;
  let nuevas = 0;
  let guardadas = 0;
  let descartadas = 0;
  let cancelada = false;
  const errores = [];
  const nuevasLicitaciones = [];
  const batchDescartes = [];
  const porFecha = [];

  const esCancel = (e) =>
    e?.code === 'CANCELLED' || e?.message === 'CANCELLED' || control.isCancelled();

  for (let offset = 0; offset <= diasAtras; offset++) {
    if (control.isCancelled()) {
      cancelada = true;
      break;
    }

    const fecha = new Date();
    fecha.setDate(fecha.getDate() - offset);
    const fechaKey = fecha.toISOString().slice(0, 10);

    if (offset > 0) await control.sleepCancelable(900);
    if (control.isCancelled()) {
      cancelada = true;
      break;
    }

    let crudas = [];
    let errDia = null;
    try {
      crudas = await buscarPorFecha(fecha);
    } catch (e) {
      if (esCancel(e)) {
        cancelada = true;
        break;
      }
      errDia = e.message;
      if (/429|simult[aá]neas/i.test(e.message)) {
        await control.sleepCancelable(2800);
        if (control.isCancelled()) {
          cancelada = true;
          break;
        }
        try {
          crudas = await buscarPorFecha(fecha);
          errDia = null;
        } catch (e2) {
          if (esCancel(e2)) {
            cancelada = true;
            break;
          }
          errDia = e2.message;
          errores.push(`${fechaKey}: ${e2.message}`);
          porFecha.push({ fecha: fechaKey, api: 0, guardadas: 0, descartadas: 0, error: e2.message });
          continue;
        }
      } else {
        errores.push(`${fechaKey}: ${e.message}`);
        porFecha.push({ fecha: fechaKey, api: 0, guardadas: 0, descartadas: 0, error: e.message });
        continue;
      }
    }

    totalApi += crudas.length;
    let gDia = 0;
    let dDia = 0;

    for (const cruda of crudas) {
      if (control.isCancelled()) {
        cancelada = true;
        break;
      }

      let lic = normalizarLicitacion(cruda);
      if (!lic.codigoExterno) continue;

      let res = evaluar(lic, perfil);

      // Solo pedir detalle si hay indicios (más rápido y menos 429)
      const necesitaDetalle =
        config.enriquecerDetalle &&
        (!lic.descripcion || res.soloFormacion) &&
        (res.pasa ||
          res.soloFormacion ||
          res.score > 0 ||
          /capaci|formaci|curso|taller|entren|excel|power\s*bi|sql|dato|python|machine|anal[ií]tica|inteligencia|office|microsoft/i.test(
            lic.nombre || ''
          ));

      if (necesitaDetalle) {
        if (control.isCancelled()) {
          cancelada = true;
          break;
        }
        try {
          await control.sleepCancelable(280);
          if (control.isCancelled()) {
            cancelada = true;
            break;
          }
          const det = await detallePorCodigo(lic.codigoExterno);
          if (det) {
            lic = normalizarLicitacion(det);
            res = evaluar(lic, perfil);
          }
        } catch (e) {
          if (esCancel(e)) {
            cancelada = true;
            break;
          }
          if (/429|simult/i.test(e.message || '')) await control.sleepCancelable(1500);
        }
      }

      if (!res.pasa) {
        descartadas++;
        dDia++;
        batchDescartes.push(slimDescarte(lic, res));
        if (batchDescartes.length >= FLUSH_CADA) {
          store.registrarDescartes(batchDescartes.splice(0, batchDescartes.length), {
            busquedaId,
          });
        }
        continue;
      }

      lic.cursos = res.cursos;
      lic.score = res.score;
      lic.afinidad = res.afinidad;

      const esNueva = await store.upsertLicitacion(lic);
      guardadas++;
      gDia++;
      if (esNueva) {
        nuevas++;
        nuevasLicitaciones.push(lic);
      }
    }

    // flush al terminar cada día
    if (batchDescartes.length) {
      store.registrarDescartes(batchDescartes.splice(0, batchDescartes.length), { busquedaId });
    }

    porFecha.push({
      fecha: fechaKey,
      api: crudas.length,
      guardadas: gDia,
      descartadas: dDia,
      error: errDia,
    });

    if (cancelada) break;
  }

  if (batchDescartes.length) {
    store.registrarDescartes(batchDescartes, { busquedaId });
  }

  const detalleParts = [];
  if (cancelada) detalleParts.push('CANCELADA por el usuario');
  if (errores.length) detalleParts.push(errores.join(' | '));

  await store.registrarBusqueda({
    origen: cancelada ? origen + '+cancel' : origen,
    api: totalApi,
    nuevas,
    guardadas,
    descartadas,
    busquedaId,
    porFecha,
    detalle: detalleParts.join(' · '),
  });

  let notif = { enviada: false };
  if (nuevasLicitaciones.length && !cancelada) {
    store.pushNotificacionInbox(nuevasLicitaciones);
    try {
      notif = await notificarDiscordCompatible(nuevasLicitaciones, { origen });
      if (notif.enviada) {
        await store.marcarNotificadas(nuevasLicitaciones.map((l) => l.codigoExterno));
      }
    } catch (e) {
      console.warn('[buscador] notificaciones:', e.message);
    }
  } else if (nuevasLicitaciones.length && cancelada) {
    // Aun cancelada, notificar lo ya encontrado
    store.pushNotificacionInbox(nuevasLicitaciones);
  }

  const result = {
    busquedaId,
    api: totalApi,
    nuevas,
    guardadas,
    descartadas,
    cancelada,
    errores,
    porFecha,
    notificacion: notif,
    items: nuevasLicitaciones.map((l) => ({
      codigo: l.codigoExterno,
      nombre: l.nombre,
      cursos: (l.cursos || []).map((c) => c.nombre),
      afinidad: l.afinidad,
      url: l.urlFicha,
    })),
  };
  control.setPartial(result);
  return result;
  } finally {
    if (manageControl) control.end(myRunId);
  }
}

function slimDescarte(lic, res) {
  return {
    codigoExterno: lic.codigoExterno,
    nombre: lic.nombre,
    nombreOrganismo: lic.nombreOrganismo,
    estado: lic.estado,
    fechaPublicacion: lic.fechaPublicacion,
    fechaCierre: lic.fechaCierre,
    urlFicha: lic.urlFicha,
    score: res.score,
    scoreTecnico: res.scoreTecnico,
    afinidad: res.afinidad,
    cursos: (res.cursos || []).map((c) => ({ id: c.id, nombre: c.nombre })),
    coincidencias: (res.cursos || []).flatMap((c) => c.coincidencias || []).slice(0, 10),
    motivo: motivoDescarte(res),
  };
}

async function reevaluarCodigo(codigo) {
  const perfil = (await store.cargarKeywords()) || undefined;
  const det = await detallePorCodigo(codigo);
  if (!det) {
    return { ok: false, error: 'La API no devolvió detalle para ese código' };
  }
  const lic = normalizarLicitacion(det);
  const res = evaluar(lic, perfil);

  if (!res.pasa) {
    store.registrarDescartes([slimDescarte(lic, res)], { busquedaId: 'reeval' });
    return {
      ok: true,
      guardada: false,
      motivo: motivoDescarte(res),
      score: res.score,
      scoreTecnico: res.scoreTecnico,
      cursos: res.cursos,
      lic,
    };
  }

  lic.cursos = res.cursos;
  lic.score = res.score;
  lic.afinidad = res.afinidad;
  const esNueva = await store.upsertLicitacion(lic);
  return {
    ok: true,
    guardada: true,
    esNueva,
    afinidad: res.afinidad,
    cursos: res.cursos,
    lic,
  };
}

function motivoDescarte(res) {
  if (res.soloFormacion) return 'solo_formacion';
  if ((res.scoreTecnico || 0) === 0 && (res.score || 0) === 0) return 'sin_coincidencia';
  if ((res.score || 0) > 0 && !res.pasa) return 'bajo_umbral';
  return 'no_aplica';
}

module.exports = { ejecutarBusqueda, reevaluarCodigo };
