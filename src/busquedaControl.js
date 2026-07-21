'use strict';

/**
 * Control de búsquedas: cancelación real (aborta fetch a Mercado Público)
 * + generación para no pisar una búsqueda nueva con el finally de una vieja.
 */
let runId = 0;
let cancelRequested = false;
let active = false;
let startedAt = 0;
let lastPartial = null;
let apiAbort = null;

function begin() {
  runId += 1;
  const myId = runId;
  cancelRequested = false;
  active = true;
  startedAt = Date.now();
  lastPartial = null;
  try {
    apiAbort?.abort();
  } catch {
    /* ignore */
  }
  apiAbort = new AbortController();
  return myId;
}

/** Solo cierra el run actual; si ya hay otro, no toca nada. */
function end(myId) {
  if (myId != null && myId !== runId) return;
  active = false;
  cancelRequested = false;
  startedAt = 0;
  // no reutilizamos el abort controller
  apiAbort = null;
}

function requestCancel() {
  cancelRequested = true;
  try {
    apiAbort?.abort();
  } catch {
    /* ignore */
  }
  return { ok: true, active, cancelando: true, runId };
}

/** Parada dura: libera el lock YA (la UI puede volver a buscar). */
function forceRelease() {
  cancelRequested = true;
  active = false;
  startedAt = 0;
  try {
    apiAbort?.abort();
  } catch {
    /* ignore */
  }
  // Invalidamos el run actual para que el finally viejo no “reviva” el estado
  runId += 1;
  apiAbort = null;
  return { ok: true };
}

/** Reset total al arrancar el servidor (no deja cancel “pegado”). */
function hardReset() {
  try {
    apiAbort?.abort();
  } catch {
    /* ignore */
  }
  apiAbort = null;
  cancelRequested = false;
  active = false;
  startedAt = 0;
  lastPartial = null;
  runId += 1;
  return { ok: true };
}

function isCancelled() {
  return cancelRequested;
}

function isActive() {
  return active;
}

function seconds() {
  return startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
}

function getAbortSignal() {
  return apiAbort ? apiAbort.signal : null;
}

function setPartial(p) {
  lastPartial = p;
}

function getPartial() {
  return lastPartial;
}

function currentRunId() {
  return runId;
}

/** Sleep interrumpible al cancelar */
function sleepCancelable(ms) {
  return new Promise((resolve) => {
    const step = 80;
    let left = ms;
    const tick = () => {
      if (isCancelled() || left <= 0) {
        resolve();
        return;
      }
      const wait = Math.min(step, left);
      left -= wait;
      setTimeout(tick, wait);
    };
    tick();
  });
}

module.exports = {
  begin,
  end,
  requestCancel,
  forceRelease,
  hardReset,
  isCancelled,
  isActive,
  seconds,
  getAbortSignal,
  setPartial,
  getPartial,
  currentRunId,
  sleepCancelable,
};
