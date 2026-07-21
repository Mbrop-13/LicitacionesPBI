'use strict';

const express = require('express');
const serverless = require('serverless-http');
const { config, ticketOk, supabaseOk } = require('../src/config');
const { KEYWORDS_DEFAULT } = require('../src/matcher/keywords');
const store = require('../src/store/db');
const { reevaluarCodigo } = require('../src/buscador');
const { pingApi } = require('../src/services/mercadoPublico');
const control = require('../src/busquedaControl');
const job = require('../src/busquedaJob');
const { importarCsv } = require('../src/services/csvImport');

const app = express();
app.use(express.json({ limit: '40mb' }));
app.use(express.text({ type: ['text/*', 'text/csv', 'application/csv'], limit: '40mb' }));

// Middleware para normalizar rutas en Vercel (si Vercel remueve /api de req.url)
app.use((req, _res, next) => {
  if (!req.url.startsWith('/api')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  next();
});

const BASE = '/api';

app.get(`${BASE}/status`, (_req, res) => {
  res.json({
    ok: true,
    app: 'ProgramBI Licitaciones',
    ticketConfigurado: ticketOk(),
    supabaseConfigurado: supabaseOk(),
    storage: store.modoStorage(),
    notifyWebhook: !!config.notifyWebhook,
    notifyEmail: config.notifyEmail || null,
    autoBuscar: !!config.autoBuscar,
    cronExpresion: config.cronExpresion,
    cronTimezone: config.cronTimezone,
    diasHaciaAtras: config.diasHaciaAtras,
    apiBase: config.apiBase,
    pageSizeDefault: store.PAGE_SIZE_DEFAULT || 50,
    busquedaEnCurso: control.isActive(),
  });
});

app.get(`${BASE}/ping`, async (_req, res) => {
  if (!ticketOk()) {
    return res.json({
      ok: false,
      mensaje: 'Falta MERCADOPUBLICO_TICKET en .env',
      latenciaMs: 0,
    });
  }
  try {
    res.json(await pingApi());
  } catch (e) {
    res.status(500).json({ ok: false, mensaje: e.message });
  }
});

// ── Licitaciones (paginadas) ──
app.get(`${BASE}/licitaciones`, async (req, res) => {
  try {
    const filtros = {
      curso: req.query.curso,
      estado: req.query.estado,
      q: req.query.q,
      soloFavoritos: req.query.favoritos === '1',
      soloNoVistos: req.query.noVistos === '1',
      soloVistos: req.query.vistos === '1',
      orden: req.query.orden || '',
      page: parseInt(req.query.page || '1', 10),
      pageSize: parseInt(req.query.pageSize || '50', 10),
    };
    res.json(await store.listarLicitaciones(filtros));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get(`${BASE}/licitaciones/:codigo`, async (req, res) => {
  try {
    const lic = await store.obtenerPorCodigo(req.params.codigo);
    if (!lic) return res.status(404).json({ error: 'No encontrada' });
    await store.setVisto(req.params.codigo, true);
    res.json({ ...lic, visto: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post(`${BASE}/licitaciones/:codigo/favorito`, async (req, res) => {
  try {
    await store.setFavorito(req.params.codigo, !!req.body.valor);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post(`${BASE}/licitaciones/:codigo/visto`, async (req, res) => {
  try {
    await store.setVisto(req.params.codigo, req.body.valor !== false);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post(`${BASE}/licitaciones/marcar-vistas`, async (req, res) => {
  try {
    res.json(await store.marcarTodasVistas(req.body?.valor !== false));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Descartadas ──
app.get(`${BASE}/descartadas`, (req, res) => {
  try {
    res.json(
      store.listarDescartadas({
        q: req.query.q,
        motivo: req.query.motivo,
        page: parseInt(req.query.page || '1', 10),
        pageSize: parseInt(req.query.pageSize || '50', 10),
      })
    );
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Salvar manualmente (aunque el filtro la rechazó) */
app.post(`${BASE}/descartadas/:codigo/salvar`, async (req, res) => {
  try {
    const r = await store.salvarDescartada(req.params.codigo, {
      favorito: req.body?.favorito !== false,
      descripcion: req.body?.descripcion || '',
    });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post(`${BASE}/reevaluar/:codigo`, async (req, res) => {
  try {
    if (!ticketOk()) {
      return res.status(400).json({ error: 'Ticket de Mercado Público no configurado' });
    }
    res.json(await reevaluarCodigo(req.params.codigo));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Stats / Logs ──
app.get(`${BASE}/stats`, async (_req, res) => {
  try {
    res.json(await store.stats());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get(`${BASE}/logs`, async (req, res) => {
  try {
    res.json(await store.listarLogs(parseInt(req.query.limite || '40', 10)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get(`${BASE}/logs/:id`, async (req, res) => {
  try {
    const log = await store.obtenerLog(req.params.id);
    if (!log) return res.status(404).json({ error: 'Log no encontrado' });
    res.json(log);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Notificaciones ──
app.get(`${BASE}/notificaciones`, (_req, res) => {
  try {
    res.json(store.listarNotificaciones(parseInt(_req.query.limite || '20', 10)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post(`${BASE}/notificaciones/leer`, (_req, res) => {
  try {
    res.json(store.marcarNotificacionesLeidas());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Importar CSV (respaldo Mercado Público / ChileCompra) ──
app.post(`${BASE}/importar-csv`, async (req, res) => {
  try {
    let texto = '';
    if (typeof req.body === 'string') {
      texto = req.body;
    } else if (req.body && typeof req.body.csv === 'string') {
      texto = req.body.csv;
    } else if (req.body && typeof req.body.contenido === 'string') {
      texto = req.body.contenido;
    } else {
      return res.status(400).json({
        error:
          'Envía el CSV como texto o JSON { "csv": "..." }. Exporta desde Mercado Público e impórtalo aquí.',
      });
    }

    if (!texto || texto.trim().length < 10) {
      return res.status(400).json({ error: 'CSV vacío o demasiado corto' });
    }

    const r = await importarCsv(texto, {
      separador: req.body?.separador || req.query?.separador || null,
    });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Buscar (en Vercel espera la ejecución para no congelarse) ──
app.post(`${BASE}/buscar`, async (req, res) => {
  try {
    // Por si quedó un lock fantasma sin job real
    if (control.isActive() && !job.getJob().enCurso) {
      control.forceRelease();
    }
    const started = await job.startJob({
      origen: 'manual',
      diasExtra: req.body?.diasExtra,
    });
    res.json({ ok: true, started: true, ...started, ...job.getJob() });
  } catch (e) {
    const code = e.code === 'BUSY' ? 409 : 500;
    res.status(code).json({ error: e.message, ...job.getJob() });
  }
});

app.post(`${BASE}/buscar/cancelar`, (_req, res) => {
  const r = job.stopJob();
  res.json({
    ok: true,
    detenida: true,
    mensaje: 'Búsqueda detenida.',
    ...r,
    ...job.getJob(),
  });
});

app.post(`${BASE}/buscar/forzar-parada`, (_req, res) => {
  job.stopJob();
  res.json({ ok: true, mensaje: 'Búsqueda liberada.', ...job.getJob() });
});

app.get(`${BASE}/buscar/estado`, (_req, res) => {
  res.json({
    ...job.getJob(),
    autoBuscar: !!config.autoBuscar,
  });
});

app.get(`${BASE}/cron`, async (req, res) => {
  const auth = req.headers.authorization || '';
  if (config.cronSecret && auth !== `Bearer ${config.cronSecret}`) {
    if (req.query.secret !== config.cronSecret) {
      return res.status(401).json({ error: 'No autorizado' });
    }
  }
  try {
    const started = await job.startJob({ origen: 'cron' });
    res.json({ ok: true, started: true, ...started });
  } catch (e) {
    res.status(409).json({ error: e.message });
  }
});

// ── Config ──
app.get(`${BASE}/config`, async (_req, res) => {
  try {
    res.json((await store.cargarKeywords()) || KEYWORDS_DEFAULT);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put(`${BASE}/config`, async (req, res) => {
  try {
    const body = req.body || {};
    if (body._reset) {
      await store.resetKeywords();
      return res.json({ ok: true, reset: true, data: KEYWORDS_DEFAULT });
    }
    const { umbral, cursos, requireTecnico } = body;
    if (typeof umbral !== 'number' || !Array.isArray(cursos)) {
      return res.status(400).json({ error: 'Se esperan { umbral: number, cursos: [] }' });
    }
    await store.guardarKeywords({
      umbral,
      cursos,
      requireTecnico: requireTecnico !== false,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = app;
module.exports.handler = serverless(app);
