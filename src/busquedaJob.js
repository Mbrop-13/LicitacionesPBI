'use strict';

/**
 * Búsqueda en segundo plano (no bloquea el HTTP del botón).
 * Así "Detener" siempre funciona: solo cancela el job y libera la UI.
 */
const { ejecutarBusqueda } = require('./buscador');
const control = require('./busquedaControl');

let job = null; // { id, status, startedAt, result, error, origen }

function getJob() {
  if (!job) {
    return {
      enCurso: false,
      status: 'idle',
      segundos: 0,
      result: null,
      error: null,
      cancelando: false,
    };
  }
  // Solo "en curso" si el job dice running (no mezclar con flags viejos de control)
  const enCurso = job.status === 'running';
  return {
    enCurso,
    status: job.status,
    id: job.id,
    origen: job.origen,
    segundos: Math.round((Date.now() - job.startedAt) / 1000),
    result: job.result,
    error: job.error,
    cancelando: enCurso && control.isCancelled(),
  };
}

/**
 * Lanza búsqueda. En Vercel (serverless) espera a que termine (sync)
 * para evitar congelamiento de la función serverless.
 */
async function startJob(opts = {}) {
  if (control.isActive() || (job && job.status === 'running')) {
    const err = new Error(
      `Ya hay una búsqueda en curso (~${getJob().segundos}s). Pulsa Detener primero.`
    );
    err.code = 'BUSY';
    throw err;
  }

  const id = `job_${Date.now()}`;
  job = {
    id,
    status: 'running',
    startedAt: Date.now(),
    result: null,
    error: null,
    origen: opts.origen || 'manual',
  };

  const runPromise = (async () => {
    try {
      const r = await ejecutarBusqueda({
        origen: opts.origen || 'manual',
        diasExtra: opts.diasExtra,
      });
      if (job && job.id === id) {
        job.status = r.cancelada ? 'cancelled' : 'done';
        job.result = r;
      }
      return r;
    } catch (e) {
      if (job && job.id === id) {
        job.status = 'error';
        job.error = e.message || String(e);
      }
      throw e;
    } finally {
      if (job && job.id === id && control.isActive()) {
        try {
          control.forceRelease();
        } catch {
          /* ignore */
        }
      }
    }
  })();

  const isSync = opts.sync || !!process.env.VERCEL;
  if (isSync) {
    await runPromise.catch(() => {});
    return { id, status: job.status, result: job.result, error: job.error };
  }

  return { id, status: 'running' };
}

function stopJob() {
  control.requestCancel();
  control.forceRelease();
  if (job && job.status === 'running') {
    job.status = 'cancelled';
  }
  return { ok: true, detenida: true };
}

function clearIdleJob() {
  if (job && job.status !== 'running') {
    // deja el último result un rato; no hace falta borrar
  }
}

module.exports = { getJob, startJob, stopJob, clearIdleJob };
