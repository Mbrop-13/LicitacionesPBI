'use strict';

const { config } = require('../config');
const control = require('../busquedaControl');

/**
 * Cliente de la API pública de Mercado Público (ChileCompra).
 * Respeta cancelación vía busquedaControl (AbortSignal).
 */

function fechaADDMMAAAA(fecha) {
  const d = String(fecha.getDate()).padStart(2, '0');
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const a = fecha.getFullYear();
  return `${d}${m}${a}`;
}

function isAbortError(e) {
  return (
    e?.name === 'AbortError' ||
    e?.code === 'ABORT_ERR' ||
    /aborted|abort|cancel/i.test(e?.message || '')
  );
}

async function llamarApi(url) {
  if (!config.ticket || config.ticket === 'tu-ticket-aqui') {
    throw new Error(
      'Falta el ticket de Mercado Público. Configúralo en .env (MERCADOPUBLICO_TICKET).'
    );
  }

  // Si ya cancelaron, no dispares la red
  if (control.isCancelled()) {
    const err = new Error('CANCELLED');
    err.code = 'CANCELLED';
    throw err;
  }

  const sep = url.includes('?') ? '&' : '?';
  const urlFinal = `${url}${sep}ticket=${encodeURIComponent(config.ticket)}`;

  const timeoutCtrl = new AbortController();
  const timeout = setTimeout(() => timeoutCtrl.abort(), 20000);

  // Combina: timeout + cancelación de búsqueda
  let signal = timeoutCtrl.signal;
  const cancelSignal = control.getAbortSignal();
  if (cancelSignal) {
    if (cancelSignal.aborted) {
      clearTimeout(timeout);
      const err = new Error('CANCELLED');
      err.code = 'CANCELLED';
      throw err;
    }
    if (typeof AbortSignal.any === 'function') {
      signal = AbortSignal.any([timeoutCtrl.signal, cancelSignal]);
    } else {
      // Fallback Node sin AbortSignal.any
      cancelSignal.addEventListener(
        'abort',
        () => {
          try {
            timeoutCtrl.abort();
          } catch {
            /* ignore */
          }
        },
        { once: true }
      );
    }
  }

  try {
    const resp = await fetch(urlFinal, {
      signal,
      headers: { Accept: 'application/json' },
    });
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`API ${resp.status}: ${text.slice(0, 220)}`);
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Respuesta no es JSON válido: ' + text.slice(0, 200));
    }
    if (data.Message) throw new Error(`API Mercado Público: ${data.Message}`);
    return data;
  } catch (e) {
    if (control.isCancelled() || (isAbortError(e) && control.isCancelled())) {
      const err = new Error('CANCELLED');
      err.code = 'CANCELLED';
      throw err;
    }
    if (isAbortError(e)) {
      throw new Error('Timeout al consultar la API de Mercado Público (20s).');
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

async function buscarPorFecha(fecha) {
  const f = fechaADDMMAAAA(fecha);
  const data = await llamarApi(`${config.apiBase}?fecha=${f}`);
  return Array.isArray(data.Listado) ? data.Listado : [];
}

async function detallePorCodigo(codigoExterno) {
  const data = await llamarApi(
    `${config.apiBase}?codigo=${encodeURIComponent(codigoExterno)}`
  );
  return Array.isArray(data.Listado) && data.Listado.length ? data.Listado[0] : null;
}

function normalizarLicitacion(raw) {
  const comprador = raw.Comprador || {};
  return {
    codigoExterno: raw.CodigoExterno || '',
    nombre: raw.Nombre || '',
    descripcion: raw.Descripcion || '',
    codigoEstado: String(raw.CodigoEstado ?? ''),
    estado: raw.Estado || '',
    tipo: raw.Tipo || raw.TipoLicitacion || '',
    fechaPublicacion: raw.FechaPublicacion || '',
    fechaCierre: raw.FechaCierre || '',
    nombreOrganismo: comprador.NombreOrganismo || comprador.Nombre || '',
    codigoOrganismo: comprador.CodigoOrganismo || '',
    montoEstimado:
      raw.MontoEstimado != null && raw.MontoEstimado !== ''
        ? Number(raw.MontoEstimado)
        : null,
    urlFicha: raw.CodigoExterno
      ? `${config.fichaUrl}${encodeURIComponent(raw.CodigoExterno)}`
      : '',
  };
}

async function pingApi() {
  const t0 = Date.now();
  try {
    // ping no usa el abort de búsquedas: usa fetch directo
    const hoy = new Date();
    const f = fechaADDMMAAAA(hoy);
    if (!config.ticket || config.ticket === 'tu-ticket-aqui') {
      return { ok: false, latenciaMs: 0, licitacionesHoy: 0, mensaje: 'Sin ticket' };
    }
    const url = `${config.apiBase}?fecha=${f}&ticket=${encodeURIComponent(config.ticket)}`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 15000);
    try {
      const resp = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      const data = await resp.json();
      const list = Array.isArray(data.Listado) ? data.Listado : [];
      return {
        ok: true,
        latenciaMs: Date.now() - t0,
        licitacionesHoy: list.length,
        fecha: f,
        mensaje: 'Conectado a api.mercadopublico.cl',
      };
    } finally {
      clearTimeout(t);
    }
  } catch (e) {
    return {
      ok: false,
      latenciaMs: Date.now() - t0,
      licitacionesHoy: 0,
      mensaje: e.message,
    };
  }
}

module.exports = {
  fechaADDMMAAAA,
  buscarPorFecha,
  detallePorCodigo,
  normalizarLicitacion,
  pingApi,
};
