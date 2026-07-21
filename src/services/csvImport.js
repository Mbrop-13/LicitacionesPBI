'use strict';

/**
 * Importador de CSV de Mercado Público / ChileCompra (y exports genéricos).
 * Soporta ; o , como separador, BOM UTF-8, y muchas variantes de cabeceras.
 */
const { config } = require('../config');
const { evaluar } = require('../matcher/matcher');
const store = require('../store/db');

/** Mapeo flexible: clave interna → posibles nombres de columna (normalizados) */
const ALIASES = {
  codigoExterno: [
    'codigo externo',
    'codigoexterno',
    'codigo',
    'código externo',
    'código',
    'id',
    'id licitacion',
    'id licitación',
    'code',
    'externalcode',
    'codigo de licitacion',
    'nro',
    'numero',
    'número',
  ],
  nombre: [
    'nombre',
    'name',
    'titulo',
    'título',
    'title',
    'nombre licitacion',
    'nombre de la licitacion',
    'descripcion breve',
  ],
  descripcion: [
    'descripcion',
    'descripción',
    'description',
    'detalle',
    'objeto',
    'objeto de la contratacion',
    'objeto de la contratación',
    'descripcion del producto',
  ],
  estado: ['estado', 'status', 'estado de la licitacion', 'estado licitacion'],
  tipo: ['tipo', 'type', 'tipo de licitacion', 'tipo licitacion', 'modalidad'],
  fechaPublicacion: [
    'fecha publicacion',
    'fecha de publicacion',
    'fecha publicación',
    'fecha de publicación',
    'publicacion',
    'publicación',
    'fecha_publicacion',
    'fechapublicacion',
  ],
  fechaCierre: [
    'fecha cierre',
    'fecha de cierre',
    'cierre',
    'fecha_cierre',
    'fechacierre',
    'fecha limite',
    'fecha límite',
    'closing date',
  ],
  nombreOrganismo: [
    'organismo',
    'nombre organismo',
    'nombre del organismo',
    'comprador',
    'institucion',
    'institución',
    'entidad',
    'organization',
    'buyer',
    'unidad de compra',
    'unidad compra',
  ],
  codigoOrganismo: ['codigo organismo', 'código organismo', 'rut organismo'],
  montoEstimado: [
    'monto',
    'monto estimado',
    'monto_estimado',
    'presupuesto',
    'amount',
    'valor',
    'monto total',
  ],
  urlFicha: ['url', 'link', 'ficha', 'url ficha', 'enlace'],
};

function normalizarHeader(h) {
  return String(h || '')
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/["']/g, '')
    .replace(/[_./\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectarSeparador(primeraLinea) {
  const comas = (primeraLinea.match(/,/g) || []).length;
  const puntos = (primeraLinea.match(/;/g) || []).length;
  const tabs = (primeraLinea.match(/\t/g) || []).length;
  if (tabs > comas && tabs > puntos) return '\t';
  if (puntos > comas) return ';';
  return ',';
}

/** Parse CSV simple con comillas y multilínea básica */
function parseCsv(texto, sep) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const s = String(texto || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const next = s[i + 1];

    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === sep) {
      row.push(field);
      field = '';
      continue;
    }
    if (c === '\n' || (c === '\r' && next === '\n') || c === '\r') {
      row.push(field);
      field = '';
      if (row.some((x) => String(x).trim() !== '')) rows.push(row);
      row = [];
      if (c === '\r' && next === '\n') i++;
      continue;
    }
    field += c;
  }
  row.push(field);
  if (row.some((x) => String(x).trim() !== '')) rows.push(row);
  return rows;
}

function mapearColumnas(headers) {
  const norms = headers.map(normalizarHeader);
  const map = {}; // key interna -> índice

  for (const [key, aliases] of Object.entries(ALIASES)) {
    for (let i = 0; i < norms.length; i++) {
      const h = norms[i];
      if (aliases.includes(h) || aliases.some((a) => h === a || h.includes(a))) {
        map[key] = i;
        break;
      }
    }
  }

  // Fallback: si no hay codigo, primera columna; si no hay nombre, segunda
  if (map.codigoExterno == null && norms.length) map.codigoExterno = 0;
  if (map.nombre == null && norms.length > 1) map.nombre = 1;
  if (map.descripcion == null) {
    const idx = norms.findIndex((h) => h.includes('desc') || h.includes('objeto'));
    if (idx >= 0) map.descripcion = idx;
  }

  return map;
}

function celda(row, idx) {
  if (idx == null || idx < 0 || idx >= row.length) return '';
  return String(row[idx] ?? '').trim();
}

function parseMonto(raw) {
  if (raw == null || raw === '') return null;
  // "1.234.567,89" o "1234567.89" o "$ 1,234"
  let s = String(raw).replace(/[$\s]/g, '').replace(/CLP|UF|USD/gi, '');
  if (s.includes(',') && s.includes('.')) {
    // 1.234.567,89 → quitar puntos de miles
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function urlFicha(codigo) {
  if (!codigo) return '';
  return `${config.fichaUrl}${encodeURIComponent(codigo)}`;
}

function filaALicitacion(row, colMap) {
  const codigo = celda(row, colMap.codigoExterno);
  const nombre = celda(row, colMap.nombre);
  if (!codigo && !nombre) return null;

  const codigoFinal = codigo || `CSV-${hashSimple(nombre)}`;
  return {
    codigoExterno: codigoFinal,
    nombre: nombre || '(sin nombre)',
    descripcion: celda(row, colMap.descripcion),
    codigoEstado: '',
    estado: celda(row, colMap.estado),
    tipo: celda(row, colMap.tipo),
    fechaPublicacion: celda(row, colMap.fechaPublicacion),
    fechaCierre: celda(row, colMap.fechaCierre),
    nombreOrganismo: celda(row, colMap.nombreOrganismo),
    codigoOrganismo: celda(row, colMap.codigoOrganismo),
    montoEstimado: parseMonto(celda(row, colMap.montoEstimado)),
    urlFicha: celda(row, colMap.urlFicha) || urlFicha(codigoFinal),
    origenImport: 'csv',
  };
}

function hashSimple(s) {
  let h = 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function motivoDescarte(res) {
  if (res.soloFormacion) return 'solo_formacion';
  if ((res.scoreTecnico || 0) === 0 && (res.score || 0) === 0) return 'sin_coincidencia';
  if ((res.score || 0) > 0 && !res.pasa) return 'bajo_umbral';
  return 'no_aplica';
}

/**
 * Procesa un CSV completo: parse → matcher → storage.
 */
async function importarCsv(textoCsv, opts = {}) {
  const raw = String(textoCsv || '');
  if (!raw.trim()) {
    throw new Error('El archivo CSV está vacío');
  }

  const primera = raw.split(/\r?\n/).find((l) => l.trim()) || '';
  const sep = opts.separador || detectarSeparador(primera);
  const rows = parseCsv(raw, sep);
  if (rows.length < 2) {
    throw new Error(
      'El CSV no tiene filas de datos. Exporta desde Mercado Público e incluye la fila de cabeceras.'
    );
  }

  const headers = rows[0];
  const colMap = mapearColumnas(headers);
  const perfil = (await store.cargarKeywords()) || undefined;

  let total = 0;
  let nuevas = 0;
  let guardadas = 0;
  let descartadas = 0;
  let sinCodigo = 0;
  const batchDescartes = [];
  const encontradas = [];
  const busquedaId = `csv_${Date.now()}`;

  for (let i = 1; i < rows.length; i++) {
    const lic = filaALicitacion(rows[i], colMap);
    if (!lic) {
      sinCodigo++;
      continue;
    }
    total++;

    const res = evaluar(lic, perfil);
    if (!res.pasa) {
      descartadas++;
      batchDescartes.push({
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
      });
      if (batchDescartes.length >= 80) {
        store.registrarDescartes(batchDescartes.splice(0, batchDescartes.length), { busquedaId });
      }
      continue;
    }

    lic.cursos = res.cursos;
    lic.score = res.score;
    lic.afinidad = res.afinidad;
    const esNueva = await store.upsertLicitacion(lic);
    guardadas++;
    if (esNueva) {
      nuevas++;
      encontradas.push({
        codigo: lic.codigoExterno,
        nombre: lic.nombre,
        cursos: (lic.cursos || []).map((c) => c.nombre),
        afinidad: lic.afinidad,
      });
    }
  }

  if (batchDescartes.length) {
    store.registrarDescartes(batchDescartes, { busquedaId });
  }

  await store.registrarBusqueda({
    origen: 'csv',
    api: total,
    nuevas,
    guardadas,
    descartadas,
    busquedaId,
    porFecha: [
      {
        fecha: new Date().toISOString().slice(0, 10),
        api: total,
        guardadas,
        descartadas,
        error: null,
      },
    ],
    detalle: `Importación CSV · sep="${sep}" · filas=${rows.length - 1} · sin_dato=${sinCodigo}`,
  });

  if (nuevas > 0) {
    store.pushNotificacionInbox(
      encontradas.slice(0, 20).map((e) => ({
        codigoExterno: e.codigo,
        nombre: e.nombre,
        nombreOrganismo: '',
        cursos: (e.cursos || []).map((n) => ({ nombre: n })),
        urlFicha: urlFicha(e.codigo),
        afinidad: e.afinidad,
      }))
    );
  }

  return {
    ok: true,
    origen: 'csv',
    separador: sep,
    columnasDetectadas: Object.keys(colMap),
    cabeceras: headers.map((h) => String(h).trim()),
    filasArchivo: rows.length - 1,
    total,
    nuevas,
    guardadas,
    descartadas,
    sinCodigo,
    items: encontradas.slice(0, 30),
  };
}

module.exports = {
  importarCsv,
  parseCsv,
  detectarSeparador,
  mapearColumnas,
  normalizarHeader,
};
