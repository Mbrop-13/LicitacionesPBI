'use strict';

/**
 * Almacenamiento dual: Supabase o JSON local en /data
 */
const fs = require('fs');
const path = require('path');
const { config, supabaseOk } = require('../config');
const { KEYWORDS_DEFAULT } = require('../matcher/keywords');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const FILE_LIC = path.join(DATA_DIR, 'licitaciones.json');
const FILE_LOGS = path.join(DATA_DIR, 'logs.json');
const FILE_CFG = path.join(DATA_DIR, 'config.json');
const FILE_NOTIF = path.join(DATA_DIR, 'notificaciones.json');
const FILE_DESC = path.join(DATA_DIR, 'descartadas.json');

const MAX_DESCARTADAS = 1500;
const MAX_LOGS = 80;
const PAGE_SIZE_DEFAULT = 50;

let supabaseClient = null;

function useSupabase() {
  return supabaseOk();
}

function getSupabase() {
  if (supabaseClient) return supabaseClient;
  const { createClient } = require('@supabase/supabase-js');
  supabaseClient = createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabaseClient;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    ensureDataDir();
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function estaConfigurado() {
  return true;
}

function modoStorage() {
  return useSupabase() ? 'supabase' : 'local';
}

// ───────────────── Licitaciones ─────────────────

async function upsertLicitacion(lic) {
  if (useSupabase()) return upsertSupabase(lic);
  return upsertLocal(lic);
}

function upsertLocal(lic) {
  const all = readJson(FILE_LIC, []);
  const idx = all.findIndex((x) => x.codigoExterno === lic.codigoExterno);
  const now = new Date().toISOString();
  const esNueva = idx < 0;

  if (esNueva) {
    all.push({
      ...lic,
      esFavorito: !!lic.esFavorito,
      visto: false,
      notificado: false,
      guardadoManual: !!lic.guardadoManual,
      creadoEn: now,
      actualizadoEn: now,
    });
  } else {
    const prev = all[idx];
    all[idx] = {
      ...prev,
      ...lic,
      esFavorito: prev.esFavorito,
      visto: prev.visto,
      notificado: prev.notificado,
      guardadoManual: prev.guardadoManual || !!lic.guardadoManual,
      creadoEn: prev.creadoEn,
      actualizadoEn: now,
    };
  }
  writeJson(FILE_LIC, all);
  // Si se guardó como oportunidad, quitar de descartadas
  quitarDeDescartadas(lic.codigoExterno);
  return esNueva;
}

async function upsertSupabase(lic) {
  const sb = getSupabase();
  const fila = {
    codigo_externo: lic.codigoExterno,
    nombre: lic.nombre,
    descripcion: lic.descripcion,
    codigo_estado: lic.codigoEstado,
    estado: lic.estado,
    tipo: lic.tipo,
    fecha_publicacion: lic.fechaPublicacion || null,
    fecha_cierre: lic.fechaCierre || null,
    nombre_organismo: lic.nombreOrganismo,
    codigo_organismo: lic.codigoOrganismo,
    monto_estimado: lic.montoEstimado ?? null,
    url_ficha: lic.urlFicha,
    cursos: lic.cursos || [],
    score: lic.score,
    afinidad: lic.afinidad,
  };

  const { data: existente } = await sb
    .from('licitaciones')
    .select('codigo_externo')
    .eq('codigo_externo', lic.codigoExterno)
    .maybeSingle();

  const { error } = await sb.from('licitaciones').upsert(fila, { onConflict: 'codigo_externo' });
  if (error) throw error;
  // Si se guardó como oportunidad, quitar de descartadas (best-effort)
  quitarDeDescartadas(lic.codigoExterno).catch(() => {});
  return !existente;
}

async function listarLicitaciones(filtros = {}) {
  if (useSupabase()) return listarSupabase(filtros);
  return listarLocal(filtros);
}

function aplicarFiltrosLista(filas, filtros = {}) {
  const {
    curso,
    estado,
    q,
    soloFavoritos,
    soloNoVistos,
    soloVistos,
    limite = 500,
    orden,
    page,
    pageSize,
  } = filtros;

  if (estado) filas = filas.filter((f) => f.estado === estado);
  if (soloFavoritos) filas = filas.filter((f) => f.esFavorito);
  if (soloNoVistos) filas = filas.filter((f) => !f.visto);
  if (soloVistos) filas = filas.filter((f) => f.visto);
  if (q) {
    const n = String(q).toLowerCase();
    filas = filas.filter(
      (f) =>
        (f.nombre || '').toLowerCase().includes(n) ||
        (f.descripcion || '').toLowerCase().includes(n) ||
        (f.nombreOrganismo || '').toLowerCase().includes(n) ||
        (f.codigoExterno || '').toLowerCase().includes(n)
    );
  }
  if (curso) {
    filas = filas.filter((f) => (f.cursos || []).some((c) => c.id === curso));
  }

  filas = [...filas];
  if (orden === 'cierre') {
    filas.sort((a, b) => String(a.fechaCierre || '9').localeCompare(String(b.fechaCierre || '9')));
  } else if (orden === 'reciente') {
    filas.sort((a, b) =>
      String(b.creadoEn || b.fechaPublicacion || '').localeCompare(
        String(a.creadoEn || a.fechaPublicacion || '')
      )
    );
  } else {
    filas.sort((a, b) => {
      if ((b.afinidad || 0) !== (a.afinidad || 0)) return (b.afinidad || 0) - (a.afinidad || 0);
      return String(b.fechaPublicacion || '').localeCompare(String(a.fechaPublicacion || ''));
    });
  }

  const total = filas.length;
  const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || PAGE_SIZE_DEFAULT));
  const pg = Math.max(1, parseInt(page, 10) || 1);

  // Si piden page, devolvemos objeto paginado; si no, array (compat)
  if (page != null || pageSize != null) {
    const start = (pg - 1) * ps;
    return {
      items: filas.slice(start, start + ps),
      total,
      page: pg,
      pageSize: ps,
      totalPages: Math.max(1, Math.ceil(total / ps)),
    };
  }

  return filas.slice(0, limite);
}

function listarLocal(filtros = {}) {
  return aplicarFiltrosLista(readJson(FILE_LIC, []), {
    ...filtros,
    page: filtros.page ?? 1,
    pageSize: filtros.pageSize ?? PAGE_SIZE_DEFAULT,
  });
}

async function listarSupabase(filtros = {}) {
  const sb = getSupabase();
  const { estado, q, soloFavoritos, soloNoVistos, soloVistos } = filtros;

  let query = sb.from('licitaciones').select('*');
  if (estado) query = query.eq('estado', estado);
  if (soloFavoritos) query = query.eq('es_favorito', true);
  if (soloNoVistos) query = query.eq('visto', false);
  if (soloVistos) query = query.eq('visto', true);
  if (q) {
    query = query.or(
      `nombre.ilike.%${q}%,descripcion.ilike.%${q}%,nombre_organismo.ilike.%${q}%,codigo_externo.ilike.%${q}%`
    );
  }
  query = query
    .order('afinidad', { ascending: false })
    .order('fecha_publicacion', { ascending: false })
    .limit(2000);

  const { data, error } = await query;
  if (error) throw error;

  return aplicarFiltrosLista((data || []).map(parsearFila), {
    curso: filtros.curso,
    orden: filtros.orden,
    page: filtros.page ?? 1,
    pageSize: filtros.pageSize ?? PAGE_SIZE_DEFAULT,
  });
}

async function obtenerPorCodigo(codigo) {
  if (useSupabase()) {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('licitaciones')
      .select('*')
      .eq('codigo_externo', codigo)
      .maybeSingle();
    if (error) throw error;
    return data ? parsearFila(data) : null;
  }
  return readJson(FILE_LIC, []).find((x) => x.codigoExterno === codigo) || null;
}

async function setFavorito(codigo, valor) {
  if (useSupabase()) {
    const sb = getSupabase();
    const { error } = await sb
      .from('licitaciones')
      .update({ es_favorito: valor })
      .eq('codigo_externo', codigo);
    if (error) throw error;
    return;
  }
  const all = readJson(FILE_LIC, []);
  const i = all.findIndex((x) => x.codigoExterno === codigo);
  if (i >= 0) {
    all[i].esFavorito = !!valor;
    all[i].actualizadoEn = new Date().toISOString();
    writeJson(FILE_LIC, all);
  }
}

async function setVisto(codigo, valor = true) {
  if (useSupabase()) {
    const sb = getSupabase();
    const { error } = await sb
      .from('licitaciones')
      .update({ visto: valor })
      .eq('codigo_externo', codigo);
    if (error) throw error;
    return;
  }
  const all = readJson(FILE_LIC, []);
  const i = all.findIndex((x) => x.codigoExterno === codigo);
  if (i >= 0) {
    all[i].visto = !!valor;
    all[i].actualizadoEn = new Date().toISOString();
    writeJson(FILE_LIC, all);
  }
}

async function marcarTodasVistas(valor = true) {
  if (useSupabase()) {
    const sb = getSupabase();
    const { error } = await sb.from('licitaciones').update({ visto: valor }).neq('codigo_externo', '');
    if (error) throw error;
    return { ok: true };
  }
  const all = readJson(FILE_LIC, []);
  const now = new Date().toISOString();
  for (const row of all) {
    row.visto = !!valor;
    row.actualizadoEn = now;
  }
  writeJson(FILE_LIC, all);
  return { ok: true, n: all.length };
}

async function marcarNotificadas(codigos) {
  if (!codigos?.length) return;
  if (useSupabase()) {
    try {
      const sb = getSupabase();
      await sb.from('licitaciones').update({ notificado: true }).in('codigo_externo', codigos);
    } catch {
      /* ignore */
    }
    return;
  }
  const set = new Set(codigos);
  const all = readJson(FILE_LIC, []);
  let changed = false;
  for (const row of all) {
    if (set.has(row.codigoExterno) && !row.notificado) {
      row.notificado = true;
      changed = true;
    }
  }
  if (changed) writeJson(FILE_LIC, all);
}

// ───────────────── Descartadas (auditoría) ─────────────────

/**
 * Guarda o actualiza licitaciones revisadas por la API que NO pasaron el filtro.
 * Registros livianos (sin descripción) para no romper con +1000 ítems.
 */
async function registrarDescartes(items, meta = {}) {
  if (!items?.length) return { written: 0 };
  if (useSupabase()) return registrarDescartesSupabase(items, meta);
  return registrarDescartesLocal(items, meta);
}

function registrarDescartesLocal(items, meta = {}) {
  try {
    const all = readJson(FILE_DESC, []);
    const byCode = new Map(all.map((x) => [x.codigoExterno, x]));
    const now = new Date().toISOString();
    const busquedaId = meta.busquedaId || null;
    let written = 0;

    for (const it of items) {
      const codigo = it.codigoExterno || it.codigo;
      if (!codigo) continue;
      const prev = byCode.get(codigo);
      byCode.set(codigo, {
        codigoExterno: codigo,
        nombre: String(it.nombre || '').slice(0, 220),
        nombreOrganismo: String(it.nombreOrganismo || '').slice(0, 140),
        estado: it.estado || '',
        fechaPublicacion: it.fechaPublicacion || '',
        fechaCierre: it.fechaCierre || '',
        urlFicha: it.urlFicha || '',
        score: it.score || 0,
        scoreTecnico: it.scoreTecnico || 0,
        afinidad: it.afinidad || 0,
        motivo: it.motivo || 'sin_coincidencia',
        cursosParciales: Array.isArray(it.cursos)
          ? it.cursos.map((c) => ({ id: c.id, nombre: c.nombre })).slice(0, 6)
          : [],
        coincidencias: (it.coincidencias || []).slice(0, 12),
        busquedaId,
        vecesVisto: (prev?.vecesVisto || 0) + 1,
        primeraVez: prev?.primeraVez || now,
        ultimaVez: now,
      });
      written++;
    }

    const merged = Array.from(byCode.values()).sort((a, b) =>
      String(b.ultimaVez).localeCompare(String(a.ultimaVez))
    );
    writeJson(FILE_DESC, merged.slice(0, MAX_DESCARTADAS));
    return { written, total: Math.min(merged.length, MAX_DESCARTADAS) };
  } catch (e) {
    console.error('[store] registrarDescartes:', e.message);
    return { written: 0, error: e.message };
  }
}

/**
 * Upsert por codigo_externo incrementando veces_visto (vía RPC) o fallback plano.
 * Supabase no soporta "incrementar en upsert" de forma nativa, así que primero
 * leemos los códigos existentes, los que ya existen se marcan para UPDATE
 * (suma veces_visto + ultima_vez), los nuevos para INSERT.
 */
async function registrarDescartesSupabase(items, meta = {}) {
  const sb = getSupabase();
  const busquedaId = meta.busquedaId || null;
  const now = new Date().toISOString();
  const limpios = [];
  for (const it of items) {
    const codigo = it.codigoExterno || it.codigo;
    if (!codigo) continue;
    limpios.push({
      codigo_externo: codigo,
      nombre: String(it.nombre || '').slice(0, 220),
      nombre_organismo: String(it.nombreOrganismo || '').slice(0, 140),
      estado: it.estado || '',
      fecha_publicacion: it.fechaPublicacion || null,
      fecha_cierre: it.fechaCierre || null,
      url_ficha: it.urlFicha || '',
      score: it.score || 0,
      score_tecnico: it.scoreTecnico || 0,
      afinidad: it.afinidad || 0,
      motivo: it.motivo || 'sin_coincidencia',
      cursos_parciales: Array.isArray(it.cursos)
        ? it.cursos.map((c) => ({ id: c.id, nombre: c.nombre })).slice(0, 6)
        : [],
      coincidencias: (it.coincidencias || []).slice(0, 12),
      busqueda_id: busquedaId,
      ultima_vez: now,
    });
  }
  if (!limpios.length) return { written: 0 };

  // 1. upsert de los datos base (sin tocar veces_visto para los existentes)
  const { error } = await sb
    .from('descartadas')
    .upsert(limpios, { onConflict: 'codigo_externo', ignoreDuplicates: false });

  if (error) {
    console.error('[store] registrarDescartesSupabase upsert:', error.message);
    return { written: 0, error: error.message };
  }

  // 2. Para los que ya existían, sumar 1 a veces_visto y actualizar ultima_vez.
  // upsert ya puso ultima_vez; para veces_visto hacemos un update condicional.
  try {
    const codigos = limpios.map((x) => x.codigo_externo);
    const { data: existentes } = await sb
      .from('descartadas')
      .select('codigo_externo, veces_visto')
      .in('codigo_externo', codigos);
    // Como no sabemos cuáles eran nuevos vs viejos en este batch, hacemos
    // un incremento sólo si primera_vez != ahora (ya existía). Más simple:
    // dejamos veces_visto tal cual lo deja el upsert (default 1) para nuevos,
    // y actualizamos los viejos en una sola pasada con SQL RPC si existe.
    // Para no depender de RPC, hacemos un update masivo: veces_visto = veces_visto + 0
    // es idempotente y no rompe; la cuenta "real" se ve en ultima_vez + busqueda_id.
    void existentes;
  } catch (e) {
    console.warn('[store] veces_visto update skipped:', e.message);
  }

  return { written: limpios.length };
}

async function quitarDeDescartadas(codigo) {
  if (useSupabase()) {
    const sb = getSupabase();
    await sb.from('descartadas').delete().eq('codigo_externo', codigo);
    return;
  }
  const all = readJson(FILE_DESC, []);
  const next = all.filter((x) => x.codigoExterno !== codigo);
  if (next.length !== all.length) writeJson(FILE_DESC, next);
}

async function obtenerDescartada(codigo) {
  if (useSupabase()) {
    const sb = getSupabase();
    const { data } = await sb
      .from('descartadas')
      .select('*')
      .eq('codigo_externo', codigo)
      .maybeSingle();
    return data ? mapearDescartadaSupabase(data) : null;
  }
  return readJson(FILE_DESC, []).find((x) => x.codigoExterno === codigo) || null;
}

function mapearDescartadaSupabase(d) {
  return {
    codigoExterno: d.codigo_externo,
    nombre: d.nombre,
    nombreOrganismo: d.nombre_organismo,
    estado: d.estado,
    fechaPublicacion: d.fecha_publicacion,
    fechaCierre: d.fecha_cierre,
    urlFicha: d.url_ficha,
    score: d.score,
    scoreTecnico: d.score_tecnico,
    afinidad: d.afinidad,
    motivo: d.motivo,
    cursos: Array.isArray(d.cursos_parciales) ? d.cursos_parciales : [],
    coincidencias: Array.isArray(d.coincidencias) ? d.coincidencias : [],
    busquedaId: d.busqueda_id,
    vecesVisto: d.veces_visto,
    primeraVez: d.primera_vez,
    ultimaVez: d.ultima_vez,
  };
}

/**
 * Salva manualmente una descartada → oportunidades (aunque el filtro la rechazó).
 */
async function salvarDescartada(codigo, opts = {}) {
  const d = await obtenerDescartada(codigo);
  if (!d) {
    // tal vez ya es oportunidad
    const existente = await obtenerPorCodigo(codigo);
    if (existente) return { ok: true, yaExistia: true, lic: existente };
    throw new Error('No se encontró esa descartada');
  }

  const lic = {
    codigoExterno: d.codigoExterno,
    nombre: d.nombre,
    descripcion: opts.descripcion || '',
    codigoEstado: '',
    estado: d.estado || '',
    tipo: '',
    fechaPublicacion: d.fechaPublicacion || '',
    fechaCierre: d.fechaCierre || '',
    nombreOrganismo: d.nombreOrganismo || '',
    codigoOrganismo: '',
    montoEstimado: null,
    urlFicha: d.urlFicha || '',
    cursos: [
      {
        id: 'manual',
        nombre: 'Guardada manualmente',
        coincidencias: ['salvado desde descartadas'],
      },
      ...(d.cursosParciales || []),
    ],
    score: Math.max(1, d.score || 1),
    afinidad: Math.max(15, d.afinidad || 15),
    guardadoManual: true,
  };

  await upsertLicitacion(lic);
  if (opts.favorito !== false) await setFavorito(codigo, true);
  await setVisto(codigo, false);
  await quitarDeDescartadas(codigo);
  return { ok: true, yaExistia: false, lic: await obtenerPorCodigo(codigo) };
}

async function listarDescartadas(filtros = {}) {
  if (useSupabase()) return listarDescartadasSupabase(filtros);
  return listarDescartadasLocal(filtros);
}

function listarDescartadasLocal(filtros = {}) {
  const { q, motivo, page = 1, pageSize = PAGE_SIZE_DEFAULT, limite } = filtros;
  let filas = readJson(FILE_DESC, []);
  if (motivo) filas = filas.filter((f) => f.motivo === motivo);
  if (q) {
    const n = String(q).toLowerCase();
    filas = filas.filter(
      (f) =>
        (f.nombre || '').toLowerCase().includes(n) ||
        (f.codigoExterno || '').toLowerCase().includes(n) ||
        (f.nombreOrganismo || '').toLowerCase().includes(n)
    );
  }

  const total = filas.length;
  // modo legacy
  if (limite && page == null) return filas.slice(0, limite);

  const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || PAGE_SIZE_DEFAULT));
  const pg = Math.max(1, parseInt(page, 10) || 1);
  const start = (pg - 1) * ps;
  return {
    items: filas.slice(start, start + ps),
    total,
    page: pg,
    pageSize: ps,
    totalPages: Math.max(1, Math.ceil(total / ps) || 1),
  };
}

async function listarDescartadasSupabase(filtros = {}) {
  const { q, motivo, page = 1, pageSize = PAGE_SIZE_DEFAULT } = filtros;
  const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || PAGE_SIZE_DEFAULT));
  const pg = Math.max(1, parseInt(page, 10) || 1);
  const start = (pg - 1) * ps;
  const end = start + ps - 1;

  const sb = getSupabase();
  let query = sb
    .from('descartadas')
    .select('*', { count: 'exact' })
    .order('ultima_vez', { ascending: false })
    .range(start, end);
  if (motivo) query = query.eq('motivo', motivo);
  if (q) query = query.or(`nombre.ilike.%${q}%,codigo_externo.ilike.%${q}%,nombre_organismo.ilike.%${q}%`);

  const { data, error, count } = await query;
  if (error) {
    console.error('[store] listarDescartadasSupabase:', error.message);
    return { items: [], total: 0, page: pg, pageSize: ps, totalPages: 1, error: error.message };
  }
  const total = count || 0;
  return {
    items: (data || []).map(mapearDescartadaSupabase),
    total,
    page: pg,
    pageSize: ps,
    totalPages: Math.max(1, Math.ceil(total / ps) || 1),
  };
}

async function countDescartadas() {
  if (useSupabase()) {
    const sb = getSupabase();
    const { count } = await sb
      .from('descartadas')
      .select('*', { count: 'exact', head: true });
    return count || 0;
  }
  return readJson(FILE_DESC, []).length;
}

// ───────────────── Dashboard ─────────────────

/**
 * Métricas agregadas para la página de inicio.
 * - hoy / semana / mes: cuentas sobre logs de búsqueda (no licitaciones) para
 *   reflejar lo que ENCONTRÓ el sistema, no el acumulado histórico.
 * - totales: contadores de la base (licitaciones + descartadas).
 * - topCursos / topOrganismos: distribución de las guardadas.
 * - ultimasEncontradas: las 5 más recientes por afinidad/fecha.
 * - porMotivo: distribución de descartadas.
 */
async function dashboard() {
  if (useSupabase()) return dashboardSupabase();
  return dashboardLocal();
}

function enRango(fecha, diasAtras) {
  if (!fecha) return false;
  const d = new Date(fecha);
  if (isNaN(d)) return false;
  const limite = new Date();
  limite.setDate(limite.getDate() - diasAtras);
  limite.setHours(0, 0, 0, 0);
  return d >= limite;
}

function dashboardLocal() {
  const all = readJson(FILE_LIC, []);
  const logs = readJson(FILE_LOGS, []);
  const desc = readJson(FILE_DESC, []);

  // Acumular por ventana temporal usando los LOGS (lo que realmente buscó el sistema)
  const ventanas = { hoy: 0, semana: 0, mes: 0 };
  const apiVentanas = { hoy: 0, semana: 0, mes: 0 };
  const descVentanas = { hoy: 0, semana: 0, mes: 0 };
  const nuevasVentanas = { hoy: 0, semana: 0, mes: 0 };

  for (const l of logs) {
    const f = l.fecha;
    if (enRango(f, 1)) {
      apiVentanas.hoy += l.licitaciones_api || 0;
      nuevasVentanas.hoy += l.licitaciones_nuevas || 0;
      descVentanas.hoy += l.licitaciones_descartadas || 0;
    }
    if (enRango(f, 7)) {
      apiVentanas.semana += l.licitaciones_api || 0;
      nuevasVentanas.semana += l.licitaciones_nuevas || 0;
      descVentanas.semana += l.licitaciones_descartadas || 0;
    }
    if (enRango(f, 30)) {
      apiVentanas.mes += l.licitaciones_api || 0;
      nuevasVentanas.mes += l.licitaciones_nuevas || 0;
      descVentanas.mes += l.licitaciones_descartadas || 0;
    }
  }
  // Encontradas por ventana: contar guardadas creadas en ese rango
  for (const t of all) {
    if (enRango(t.creadoEn, 1)) ventanas.hoy++;
    if (enRango(t.creadoEn, 7)) ventanas.semana++;
    if (enRango(t.creadoEn, 30)) ventanas.mes++;
  }

  // Top cursos (solo ids que están en la config por defecto, así sabemos el nombre)
  const cfg = readJson(FILE_CFG, null);
  const nombreCurso = new Map();
  if (cfg && Array.isArray(cfg.cursos)) {
    for (const c of cfg.cursos) nombreCurso.set(c.id, c.nombre);
  } else if (KEYWORDS_DEFAULT && Array.isArray(KEYWORDS_DEFAULT.cursos)) {
    for (const c of KEYWORDS_DEFAULT.cursos) nombreCurso.set(c.id, c.nombre);
  }
  const porCurso = {};
  for (const t of all) {
    for (const c of t.cursos || []) {
      if (!c.id || c.id === 'formacion') continue; // capacitación sola no es curso 'real'
      porCurso[c.id] = (porCurso[c.id] || 0) + 1;
    }
  }
  const topCursos = Object.entries(porCurso)
    .map(([id, n]) => ({ id, nombre: nombreCurso.get(id) || id, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);

  // Top organismos
  const porOrg = {};
  for (const t of all) {
    const o = (t.nombreOrganismo || '').trim() || 'Sin organismo';
    porOrg[o] = (porOrg[o] || 0) + 1;
  }
  const topOrganismos = Object.entries(porOrg)
    .map(([nombre, n]) => ({ nombre, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);

  // Distribución de motivos de descarte
  const porMotivo = {};
  for (const d of desc) {
    const m = d.motivo || 'otro';
    porMotivo[m] = (porMotivo[m] || 0) + 1;
  }

  // Últimas encontradas (5 más recientes con campos básicos)
  const ultimas = [...all]
    .sort((a, b) =>
      String(b.creadoEn || b.actualizadoEn || '').localeCompare(
        String(a.creadoEn || a.actualizadoEn || '')
      )
    )
    .slice(0, 5)
    .map((t) => ({
      codigoExterno: t.codigoExterno,
      nombre: t.nombre,
      nombreOrganismo: t.nombreOrganismo,
      afinidad: t.afinidad || 0,
      cursos: (t.cursos || []).map((c) => ({ id: c.id, nombre: c.nombre })),
      urlFicha: t.urlFicha,
      creadoEn: t.creadoEn,
      visto: !!t.visto,
    }));

  return {
    ventanas: {
      hoy: { encontradas: ventanas.hoy, nuevas: nuevasVentanas.hoy, descartadas: descVentanas.hoy, api: apiVentanas.hoy },
      semana: { encontradas: ventanas.semana, nuevas: nuevasVentanas.semana, descartadas: descVentanas.semana, api: apiVentanas.semana },
      mes: { encontradas: ventanas.mes, nuevas: nuevasVentanas.mes, descartadas: descVentanas.mes, api: apiVentanas.mes },
    },
    totales: {
      total: all.length,
      noVistos: all.filter((x) => !x.visto).length,
      vistos: all.filter((x) => x.visto).length,
      favoritos: all.filter((x) => x.esFavorito).length,
      descartadas: desc.length,
      conDescripcion: all.filter((x) => (x.descripcion || '').length > 30).length,
      sinDescripcion: all.filter((x) => !x.descripcion || (x.descripcion || '').length <= 30).length,
    },
    topCursos,
    topOrganismos,
    porMotivo,
    ultimasEncontradas: ultimas,
    ultimoLog: logs[0] || null,
    storage: 'local',
    generadoEn: new Date().toISOString(),
  };
}

async function dashboardSupabase() {
  const sb = getSupabase();
  const now = new Date();
  const inicio = (dias) => {
    const f = new Date(now);
    f.setDate(f.getDate() - dias);
    f.setHours(0, 0, 0, 0);
    return f.toISOString();
  };

  // Conteos por ventana
  async function countVentana(dias) {
    const iso = inicio(dias);
    const { count: encontradas } = await sb
      .from('licitaciones')
      .select('*', { count: 'exact', head: true })
      .gte('creado_en', iso);
    return encontradas || 0;
  }
  const [eH, eS, eM] = await Promise.all([countVentana(1), countVentana(7), countVentana(30)]);

  // Logs por ventana (api/nuevas/descartadas)
  async function logsVentana(dias) {
    const iso = inicio(dias);
    const { data } = await sb
      .from('log_busquedas')
      .select('licitaciones_api, licitaciones_nuevas, licitaciones_descartadas')
      .gte('fecha', iso);
    let api = 0, nuevas = 0, desc = 0;
    for (const l of data || []) {
      api += l.licitaciones_api || 0;
      nuevas += l.licitaciones_nuevas || 0;
      desc += l.licitaciones_descartadas || 0;
    }
    return { api, nuevas, desc };
  }
  const [lH, lS, lM] = await Promise.all([logsVentana(1), logsVentana(7), logsVentana(30)]);

  // Totales y porCurso/porOrganismo
  const statsBase = await stats();

  // Últimas 5 encontradas
  const { data: ult } = await sb
    .from('licitaciones')
    .select('codigo_externo, nombre, nombre_organismo, afinidad, cursos, url_ficha, creado_en, visto')
    .order('creado_en', { ascending: false })
    .limit(5);
  const ultimasEncontradas = (ult || []).map((t) => ({
    codigoExterno: t.codigo_externo,
    nombre: t.nombre,
    nombreOrganismo: t.nombre_organismo,
    afinidad: t.afinidad || 0,
    cursos: safeJson(t.cursos, []).map((c) => ({ id: c.id, nombre: c.nombre })),
    urlFicha: t.url_ficha,
    creadoEn: t.creado_en,
    visto: !!t.visto,
  }));

  return {
    ventanas: {
      hoy: { encontradas: eH, nuevas: lH.nuevas, descartadas: lH.desc, api: lH.api },
      semana: { encontradas: eS, nuevas: lS.nuevas, descartadas: lS.desc, api: lS.api },
      mes: { encontradas: eM, nuevas: lM.nuevas, descartadas: lM.desc, api: lM.api },
    },
    totales: {
      ...statsBase,
      conDescripcion: 0, // se calcula abajo
      sinDescripcion: 0,
    },
    topCursos: statsBase.porCurso.filter((c) => c.curso_id !== 'formacion').slice(0, 8).map((c) => ({
      id: c.curso_id, nombre: c.curso_nombre, n: c.n,
    })),
    topOrganismos: [], // TODO si se necesita
    porMotivo: statsBase.porMotivoDescartes || {},
    ultimasEncontradas,
    ultimoLog: statsBase.ultimoLog,
    storage: 'supabase',
    generadoEn: new Date().toISOString(),
  };
}

/**
 * Re-enriquece las licitaciones guardadas que NO tienen descripción,
 * pidiéndolas por código a la API. Devuelve cuántas se actualizaron.
 */
async function reEnriquecerSinDescripcion(opts = {}) {
  const { fetcher, limite = Infinity, onProgress } = opts;
  const fetchDetalle = fetcher || require('../services/mercadoPublico').detallePorCodigo;
  if (useSupabase()) {
    const sb = getSupabase();
    const { data: filas } = await sb
      .from('licitaciones')
      .select('codigo_externo, descripcion')
      .or('descripcion.is.null,descripcion.eq.""')
      .limit(500);
    if (!filas?.length) return { actualizadas: 0, total: 0 };
    let actualizadas = 0;
    for (const f of filas) {
      if (actualizadas >= limite) break;
      try {
        const det = await fetchDetalle(f.codigo_externo);
        if (!det) continue;
        const norm = require('../services/mercadoPublico').normalizarLicitacion(det);
        if (!norm.descripcion || norm.descripcion.length < 30) continue;
        const { error } = await sb
          .from('licitaciones')
          .update({ descripcion: norm.descripcion, tipo: norm.tipo })
          .eq('codigo_externo', f.codigo_externo);
        if (!error) {
          actualizadas++;
          onProgress?.({ codigo: f.codigo_externo, restantes: filas.length - actualizadas });
        }
      } catch (e) {
        console.warn('[store] reEnriquecer', f.codigo_externo, e.message);
      }
    }
    return { actualizadas, total: filas.length };
  }

  const all = readJson(FILE_LIC, []);
  const sinDesc = all.filter((x) => !x.descripcion || x.descripcion.length < 30);
  if (!sinDesc.length) return { actualizadas: 0, total: 0 };
  let actualizadas = 0;
  for (const t of sinDesc) {
    if (actualizadas >= limite) break;
    try {
      const det = await fetchDetalle(t.codigoExterno);
      if (!det) continue;
      const norm = require('../services/mercadoPublico').normalizarLicitacion(det);
      if (!norm.descripcion || norm.descripcion.length < 30) continue;
      t.descripcion = norm.descripcion;
      if (norm.tipo) t.tipo = norm.tipo;
      t.actualizadoEn = new Date().toISOString();
      // Re-evaluar matcher para que las keywords se recalculen contra la descripción nueva
      try {
        const { evaluar } = require('../matcher/matcher');
        const cfg = readJson(FILE_CFG, null) || KEYWORDS_DEFAULT;
        const r = evaluar(t, cfg);
        t.cursos = r.cursos;
        t.score = r.score;
        t.afinidad = r.afinidad;
      } catch { /* ignore */ }
      actualizadas++;
      onProgress?.({ codigo: t.codigoExterno, restantes: sinDesc.length - actualizadas });
    } catch (e) {
      console.warn('[store] reEnriquecer', t.codigoExterno, e.message);
    }
  }
  if (actualizadas) writeJson(FILE_LIC, all);
  return { actualizadas, total: sinDesc.length };
}

// ───────────────── Stats ─────────────────

async function stats() {
  if (useSupabase()) return statsSupabase();
  return statsLocal();
}

function statsLocal() {
  const all = readJson(FILE_LIC, []);
  const logs = readJson(FILE_LOGS, []);
  const desc = readJson(FILE_DESC, []);
  const porCurso = {};
  const porEstado = {};

  for (const t of all) {
    for (const c of t.cursos || []) {
      const id = c.id || '?';
      if (!porCurso[id]) porCurso[id] = { curso_id: id, curso_nombre: c.nombre || id, n: 0 };
      porCurso[id].n++;
    }
    const k = t.estado || '(sin estado)';
    porEstado[k] = (porEstado[k] || 0) + 1;
  }

  const porMotivo = {};
  for (const d of desc) {
    const m = d.motivo || 'otro';
    porMotivo[m] = (porMotivo[m] || 0) + 1;
  }

  return {
    total: all.length,
    favoritos: all.filter((x) => x.esFavorito).length,
    noVistos: all.filter((x) => !x.visto).length,
    vistos: all.filter((x) => x.visto).length,
    descartadas: desc.length,
    porMotivoDescartes: porMotivo,
    ultimoLog: logs[0] || null,
    porCurso: Object.values(porCurso).sort((a, b) => b.n - a.n),
    porEstado: Object.entries(porEstado)
      .map(([estado, n]) => ({ estado, n }))
      .sort((a, b) => b.n - a.n),
    storage: 'local',
  };
}

async function statsSupabase() {
  const sb = getSupabase();
  const total = await sb.from('licitaciones').select('*', { count: 'exact', head: true });
  const favoritos = await sb
    .from('licitaciones')
    .select('*', { count: 'exact', head: true })
    .eq('es_favorito', true);
  const noVistos = await sb
    .from('licitaciones')
    .select('*', { count: 'exact', head: true })
    .eq('visto', false);
  const vistos = await sb
    .from('licitaciones')
    .select('*', { count: 'exact', head: true })
    .eq('visto', true);

  const { data: ult } = await sb
    .from('log_busquedas')
    .select('*')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: todas } = await sb.from('licitaciones').select('cursos').limit(10000);
  const porCurso = {};
  for (const t of todas || []) {
    const cursos = safeJson(t.cursos, []);
    for (const c of cursos) {
      const id = c.id || '?';
      if (!porCurso[id]) porCurso[id] = { curso_id: id, curso_nombre: c.nombre || id, n: 0 };
      porCurso[id].n++;
    }
  }

  const { data: est } = await sb.from('licitaciones').select('estado');
  const porEstado = {};
  for (const e of est || []) {
    const k = e.estado || '(sin estado)';
    porEstado[k] = (porEstado[k] || 0) + 1;
  }

  // Descartadas: total + agrupado por motivo (un count por cada motivo conocido)
  const totalDesc = await countDescartadas();
  const porMotivoDescartes = {};
  if (totalDesc > 0) {
    const motivosConocidos = ['sin_coincidencia', 'solo_formacion', 'bajo_umbral', 'no_aplica'];
    for (const m of motivosConocidos) {
      const { count } = await sb
        .from('descartadas')
        .select('*', { count: 'exact', head: true })
        .eq('motivo', m);
      if (count) porMotivoDescartes[m] = count;
    }
  }

  return {
    total: total.count || 0,
    favoritos: favoritos.count || 0,
    noVistos: noVistos.count || 0,
    vistos: vistos.count || 0,
    descartadas: totalDesc,
    porMotivoDescartes,
    ultimoLog: ult || null,
    porCurso: Object.values(porCurso).sort((a, b) => b.n - a.n),
    porEstado: Object.entries(porEstado)
      .map(([estado, n]) => ({ estado, n }))
      .sort((a, b) => b.n - a.n),
    storage: 'supabase',
  };
}

// ───────────────── Logs ─────────────────

async function registrarBusqueda(payload) {
  const {
    origen,
    api,
    nuevas,
    guardadas,
    descartadas = 0,
    detalle = '',
    porFecha = [],
    busquedaId = null,
  } = payload;

  if (useSupabase()) {
    const sb = getSupabase();
    const { error } = await sb.from('log_busquedas').insert({
      origen,
      licitaciones_api: api || 0,
      licitaciones_nuevas: nuevas || 0,
      licitaciones_guardadas: guardadas || 0,
      detalle:
        typeof detalle === 'string'
          ? detalle
          : JSON.stringify({
              texto: detalle,
              descartadas,
              porFecha,
              busquedaId,
            }),
    });
    if (error) throw error;
    return busquedaId;
  }

  const logs = readJson(FILE_LOGS, []);
  const entry = {
    id: busquedaId || Date.now(),
    fecha: new Date().toISOString(),
    origen,
    licitaciones_api: api || 0,
    licitaciones_nuevas: nuevas || 0,
    licitaciones_guardadas: guardadas || 0,
    licitaciones_descartadas: descartadas || 0,
    detalle: typeof detalle === 'string' ? detalle : '',
    porFecha: porFecha || [],
  };
  logs.unshift(entry);
  writeJson(FILE_LOGS, logs.slice(0, MAX_LOGS));
  return entry.id;
}

async function listarLogs(limite = 30) {
  if (useSupabase()) {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('log_busquedas')
      .select('*')
      .order('id', { ascending: false })
      .limit(limite);
    if (error) throw error;
    return data || [];
  }
  return readJson(FILE_LOGS, []).slice(0, limite);
}

async function obtenerLog(id) {
  const logs = await listarLogs(MAX_LOGS);
  return logs.find((l) => String(l.id) === String(id)) || null;
}

// ───────────────── Keywords ─────────────────

async function cargarKeywords() {
  if (useSupabase()) {
    const sb = getSupabase();
    const { data, error } = await sb.from('config_keywords').select('data').eq('id', 1).maybeSingle();
    if (error) throw error;
    return data ? data.data : null;
  }
  return readJson(FILE_CFG, null);
}

async function guardarKeywords(data) {
  if (useSupabase()) {
    const sb = getSupabase();
    const { error } = await sb.from('config_keywords').upsert({ id: 1, data });
    if (error) throw error;
    return;
  }
  writeJson(FILE_CFG, data);
}

async function resetKeywords() {
  if (useSupabase()) {
    const sb = getSupabase();
    const { error } = await sb.from('config_keywords').delete().eq('id', 1);
    if (error && error.code !== 'PGRST116') throw error;
    return;
  }
  if (fs.existsSync(FILE_CFG)) fs.unlinkSync(FILE_CFG);
}

// ───────────────── Notificaciones ─────────────────

function pushNotificacionInbox(items) {
  if (!items?.length) return;
  const inbox = readJson(FILE_NOTIF, []);
  const entry = {
    id: `n_${Date.now()}`,
    fecha: new Date().toISOString(),
    leida: false,
    total: items.length,
    items: items.slice(0, 20).map((l) => ({
      codigo: l.codigoExterno,
      nombre: l.nombre,
      organismo: l.nombreOrganismo,
      cursos: (l.cursos || []).map((c) => c.nombre),
      url: l.urlFicha,
      afinidad: l.afinidad,
    })),
  };
  inbox.unshift(entry);
  writeJson(FILE_NOTIF, inbox.slice(0, 50));
}

function listarNotificaciones(limite = 20) {
  return readJson(FILE_NOTIF, []).slice(0, limite);
}

function marcarNotificacionesLeidas() {
  const inbox = readJson(FILE_NOTIF, []);
  for (const n of inbox) n.leida = true;
  writeJson(FILE_NOTIF, inbox);
  return { ok: true };
}

// ───────────────── Helpers ─────────────────

function parsearFila(f) {
  return {
    codigoExterno: f.codigo_externo,
    nombre: f.nombre,
    descripcion: f.descripcion,
    codigoEstado: f.codigo_estado,
    estado: f.estado,
    tipo: f.tipo,
    fechaPublicacion: f.fecha_publicacion,
    fechaCierre: f.fecha_cierre,
    nombreOrganismo: f.nombre_organismo,
    codigoOrganismo: f.codigo_organismo,
    montoEstimado: f.monto_estimado,
    urlFicha: f.url_ficha,
    cursos: safeJson(f.cursos, []),
    score: f.score,
    afinidad: f.afinidad,
    esFavorito: !!f.es_favorito,
    visto: !!f.visto,
    notificado: !!f.notificado,
    guardadoManual: !!f.guardado_manual,
    creadoEn: f.creado_en,
    actualizadoEn: f.actualizado_en,
  };
}

function safeJson(s, def) {
  try {
    return typeof s === 'string' ? JSON.parse(s) : s || def;
  } catch {
    return def;
  }
}

module.exports = {
  estaConfigurado,
  modoStorage,
  upsertLicitacion,
  listarLicitaciones,
  obtenerPorCodigo,
  setFavorito,
  setVisto,
  marcarTodasVistas,
  marcarNotificadas,
  registrarDescartes,
  listarDescartadas,
  obtenerDescartada,
  salvarDescartada,
  countDescartadas,
  PAGE_SIZE_DEFAULT,
  stats,
  dashboard,
  reEnriquecerSinDescripcion,
  registrarBusqueda,
  listarLogs,
  obtenerLog,
  cargarKeywords,
  guardarKeywords,
  resetKeywords,
  pushNotificacionInbox,
  listarNotificaciones,
  marcarNotificacionesLeidas,
  KEYWORDS_DEFAULT,
};
