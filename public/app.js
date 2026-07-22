'use strict';

const api = (url, opts) =>
  fetch(url, opts).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw data.error ? { error: data.error } : data;
    return data;
  });

const PAGE_SIZE = 50;

const VIEWS = {
  pendientes: { title: 'Sin revisar', sub: 'Oportunidades pendientes de lectura' },
  todas: { title: 'Encontradas', sub: 'Licitaciones que coinciden con el perfil ProgramBI' },
  procesadas: { title: 'Procesadas', sub: 'Ya revisadas' },
  favoritas: { title: 'Favoritas', sub: 'Marcadas para seguimiento' },
  descartadas: {
    title: 'Descartadas',
    sub: 'Traídas por la API pero no pasaron el filtro — puedes salvarlas a mano',
  },
  historial: {
    title: 'Historial',
    sub: 'Cada escaneo: API / guardadas / descartadas por día',
  },
};

let view = 'pendientes';
let page = 1;
let totalPages = 1;
let totalItems = 0;
let listaActual = [];
let detalleActual = null;
let cursosEdicion = [];
let requireTecnico = true;

const filtros = { q: '', curso: '', estado: '', orden: '' };
const filtrosDesc = { q: '', motivo: '' };

document.addEventListener('DOMContentLoaded', () => {
  // Estado limpio al abrir: NUNCA mostrar "Buscando" sin que el usuario pulse
  setSearchUI(false);
  wire();
  initSidebarState();
  initTopbarScroll();
  setView(view, false);
  // Si el servidor tenía un job colgado, lo mata (no inicia búsqueda nueva)
  liberarServidorAlCargar();
  comprobarStatus();
  pingApi(false);
  cargarStats();
  cargarNotificaciones();
  cargarVista();
  // Notificaciones automáticas mientras la web está abierta
  iniciarVigilanciaNotificaciones();
  registrarBotonNotificaciones();
});

function wire() {
  document.querySelectorAll('.side-item[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  document.getElementById('btn-buscar').addEventListener('click', buscarAhora);
  document.getElementById('btn-detener').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    detenerBusqueda();
  });
  document.getElementById('btn-csv').addEventListener('click', exportarCsv);
  document.getElementById('btn-import-csv').addEventListener('click', () => {
    document.getElementById('input-csv').click();
  });
  document.getElementById('input-csv').addEventListener('change', onCsvFileSelected);
  document.getElementById('btn-notif').addEventListener('click', toggleNotifPanel);
  document.getElementById('btn-notif-leer').addEventListener('click', marcarNotifLeidas);
  document.getElementById('btn-ping').addEventListener('click', () => pingApi(true));
  document.getElementById('btn-mark-all').addEventListener('click', marcarTodasProcesadas);
  document.getElementById('overlay').addEventListener('click', cerrarDrawer);
  document.getElementById('btn-close-drawer').addEventListener('click', cerrarDrawer);
  document.getElementById('drawer-fav').addEventListener('click', toggleFavDetalle);

  document.getElementById('btn-menu').addEventListener('click', () => {
    if (window.innerWidth <= 960) openSidebarMobile();
    else toggleSidebar();
  });
  document.getElementById('btn-sidebar-close').addEventListener('click', closeSidebarMobile);
  document.getElementById('sidebar-backdrop').addEventListener('click', closeSidebarMobile);
  document.getElementById('btn-sidebar-collapse').addEventListener('click', toggleSidebar);

  document.getElementById('btn-open-config').addEventListener('click', openConfig);
  document.getElementById('btn-close-config').addEventListener('click', closeConfig);
  document.getElementById('config-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'config-overlay') closeConfig();
  });
  document.getElementById('btn-save-config').addEventListener('click', guardarConfig);
  document.getElementById('btn-reset-config').addEventListener('click', resetConfig);
  document.getElementById('btn-add-curso').addEventListener('click', () => {
    cursosEdicion.push({ id: 'curso_' + Date.now(), nombre: 'Nuevo curso', keywords: [] });
    renderEditor();
  });
  document.getElementById('cfg-btn-ping').addEventListener('click', async () => {
    const msg = document.getElementById('cfg-ping-msg');
    msg.textContent = 'Consultando…';
    try {
      const p = await api('/api/ping');
      msg.style.color = p.ok ? 'var(--ok)' : 'var(--danger)';
      msg.textContent = p.ok
        ? `OK · ${p.licitacionesHoy} hoy · ${p.latenciaMs} ms`
        : p.mensaje || 'Error';
    } catch (e) {
      msg.style.color = 'var(--danger)';
      msg.textContent = e.error || e.message || 'Error';
    }
  });

  document.getElementById('btn-page-prev').addEventListener('click', () => {
    if (page > 1) {
      page--;
      cargarVista();
    }
  });
  document.getElementById('btn-page-next').addEventListener('click', () => {
    if (page < totalPages) {
      page++;
      cargarVista();
    }
  });

  const debVista = debounce(() => {
    page = 1;
    cargarVista();
  }, 280);

  document.getElementById('f-q').addEventListener('input', (e) => {
    filtros.q = e.target.value;
    debVista();
  });
  document.getElementById('f-curso').addEventListener('change', (e) => {
    filtros.curso = e.target.value;
    page = 1;
    cargarVista();
  });
  document.getElementById('f-estado').addEventListener('change', (e) => {
    filtros.estado = e.target.value;
    page = 1;
    cargarVista();
  });
  document.getElementById('f-orden').addEventListener('change', (e) => {
    filtros.orden = e.target.value;
    page = 1;
    cargarVista();
  });
  document.getElementById('f-q-desc').addEventListener('input', (e) => {
    filtrosDesc.q = e.target.value;
    debVista();
  });
  document.getElementById('f-motivo').addEventListener('change', (e) => {
    filtrosDesc.motivo = e.target.value;
    page = 1;
    cargarVista();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      cerrarDrawer();
      closeNotifPanel();
      closeConfig();
      closeSidebarMobile();
    }
  });
  document.addEventListener('click', (e) => {
    const wrap = document.querySelector('.notif-wrap');
    if (wrap && !wrap.contains(e.target)) closeNotifPanel();
  });
}

/* ── Sidebar: expandida o rail de iconos ── */
function initSidebarState() {
  if (localStorage.getItem('pbi_sidebar') === 'collapsed' && window.innerWidth > 960) {
    document.getElementById('layout').classList.add('sidebar-collapsed');
  }
  syncSidebarCollapseBtn();
}
function toggleSidebar() {
  const layout = document.getElementById('layout');
  const collapsed = layout.classList.toggle('sidebar-collapsed');
  localStorage.setItem('pbi_sidebar', collapsed ? 'collapsed' : 'open');
  syncSidebarCollapseBtn();
}
function collapseSidebar() {
  document.getElementById('layout').classList.add('sidebar-collapsed');
  localStorage.setItem('pbi_sidebar', 'collapsed');
  syncSidebarCollapseBtn();
}
function expandSidebar() {
  document.getElementById('layout').classList.remove('sidebar-collapsed');
  localStorage.setItem('pbi_sidebar', 'open');
  syncSidebarCollapseBtn();
}
function syncSidebarCollapseBtn() {
  const btn = document.getElementById('btn-sidebar-collapse');
  if (!btn) return;
  const collapsed = document.getElementById('layout').classList.contains('sidebar-collapsed');
  btn.title = collapsed ? 'Expandir panel' : 'Minimizar panel';
  btn.setAttribute('aria-label', btn.title);
}
function openSidebarMobile() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-backdrop').classList.add('open');
}
function closeSidebarMobile() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.remove('open');
}

/* ── Topbar hide on scroll ── */
function initTopbarScroll() {
  const topbar = document.getElementById('topbar');
  let lastY = 0;
  let ticking = false;
  window.addEventListener(
    'scroll',
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY || document.documentElement.scrollTop;
        if (y > lastY && y > 72) topbar.classList.add('topbar-hidden');
        else topbar.classList.remove('topbar-hidden');
        lastY = y;
        ticking = false;
      });
    },
    { passive: true }
  );
}

/* ── Views ── */
function setView(name, load = true) {
  view = name;
  page = 1;
  document.querySelectorAll('.side-item[data-view]').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === name);
  });
  const meta = VIEWS[name] || VIEWS.todas;
  setText('view-title', meta.title);
  setText('view-sub', meta.sub);

  const isDesc = name === 'descartadas';
  const isHist = name === 'historial';
  document.getElementById('filters-oportunidades').hidden = isDesc || isHist;
  document.getElementById('filters-descartadas').hidden = !isDesc;
  document.getElementById('lista').hidden = isHist;
  document.getElementById('historial-host').hidden = !isHist;
  document.getElementById('btn-csv').hidden = isHist;
  document.getElementById('btn-mark-all').hidden = isDesc || isHist;
  document.getElementById('pagination').hidden = isHist;

  closeSidebarMobile();
  if (load) cargarVista();
}

async function cargarVista() {
  if (view === 'historial') {
    document.getElementById('pagination').hidden = true;
    return cargarHistorial();
  }
  if (view === 'descartadas') return cargarDescartadas();
  return cargarOportunidades();
}

function setNavCount(viewName, n) {
  const el = document.querySelector(`.side-item[data-view="${viewName}"]`);
  if (!el) return;
  if (n > 0) el.setAttribute('data-count', n > 99 ? '99+' : String(n));
  else el.removeAttribute('data-count');
}

/* ── Status / ping ── */
async function comprobarStatus() {
  try {
    const s = await api('/api/status');
    if (!s.ticketConfigurado) {
      flash(
        'warn',
        '<b>Ticket no configurado.</b> Define <code>MERCADOPUBLICO_TICKET</code> en <code>.env</code>.'
      );
      setConn(false, 'Sin ticket configurado');
    }
    // Aviso sutil si el auto quedó activado por error
    if (s.autoBuscar) {
      flash(
        'info',
        'Búsqueda automática <b>activada</b> (AUTO_BUSCAR=1). Para que solo busque cuando tú quieras, pon <code>AUTO_BUSCAR=0</code> y reinicia el servidor.'
      );
    }
  } catch {
    flash('error', 'No se pudo conectar con el servidor.');
    setConn(false, 'Error de servidor');
  }
}

async function pingApi(manual) {
  const dot = document.getElementById('conn-dot');
  const meta = document.getElementById('conn-meta');
  dot.className = 'conn-dot loading';
  meta.textContent = 'Consultando api.mercadopublico.cl…';
  try {
    const p = await api('/api/ping');
    if (p.ok) {
      setConn(true, `${p.mensaje} · ${p.licitacionesHoy} hoy · ${p.latenciaMs} ms`);
      if (manual) toast(`API OK · ${p.licitacionesHoy} licitaciones hoy`);
    } else {
      setConn(false, p.mensaje || 'Error de API');
      if (manual) toast(p.mensaje || 'Error', true);
    }
  } catch (e) {
    setConn(false, e.error || e.message || 'Sin respuesta');
    if (manual) toast(e.error || e.message || 'Error', true);
  }
}

function setConn(ok, text) {
  document.getElementById('conn-dot').className = 'conn-dot ' + (ok ? 'ok' : 'bad');
  document.getElementById('conn-meta').textContent = text;
}

/* ── Stats ── */
async function cargarStats() {
  try {
    const s = await api('/api/stats');
    // KPIs eliminados del header (redundantes con el sidebar). Solo sidebar.
    setText('nav-pendientes', s.noVistos);
    setText('nav-todas', s.total);
    setText('nav-procesadas', s.vistos ?? 0);
    setText('nav-favoritas', s.favoritos);
    setText('nav-descartadas', s.descartadas ?? 0);
    // Badges en modo rail (solo números > 0)
    setNavCount('pendientes', s.noVistos);
    setNavCount('todas', s.total);
    setNavCount('procesadas', s.vistos ?? 0);
    setNavCount('favoritas', s.favoritos);
    setNavCount('descartadas', s.descartadas ?? 0);

    const selCurso = document.getElementById('f-curso');
    const cur = filtros.curso;
    selCurso.innerHTML =
      '<option value="">Todos los cursos</option>' +
      (s.porCurso || [])
        .map((c) => `<option value="${esc(c.curso_id)}">${esc(c.curso_nombre)} (${c.n})</option>`)
        .join('');
    selCurso.value = cur;

    const selEst = document.getElementById('f-estado');
    const est = filtros.estado;
    selEst.innerHTML =
      '<option value="">Todos los estados</option>' +
      (s.porEstado || [])
        .map(
          (e) =>
            `<option value="${esc(e.estado || '')}">${esc(e.estado || 'Sin estado')} (${e.n})</option>`
        )
        .join('');
    selEst.value = est;
  } catch {
    /* silent */
  }
}

function updatePagination(meta) {
  totalItems = meta.total || 0;
  totalPages = meta.totalPages || 1;
  page = meta.page || 1;
  const pag = document.getElementById('pagination');
  if (totalItems === 0) {
    pag.hidden = true;
    return;
  }
  pag.hidden = false;
  setText('page-info', `Pág. ${page} / ${totalPages} · ${totalItems} total`);
  document.getElementById('btn-page-prev').disabled = page <= 1;
  document.getElementById('btn-page-next').disabled = page >= totalPages;
}

/* ── Oportunidades ── */
async function cargarOportunidades() {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));
  if (filtros.q) params.set('q', filtros.q);
  if (filtros.curso) params.set('curso', filtros.curso);
  if (filtros.estado) params.set('estado', filtros.estado);
  if (filtros.orden) params.set('orden', filtros.orden);
  if (view === 'pendientes') params.set('noVistos', '1');
  if (view === 'procesadas') params.set('vistos', '1');
  if (view === 'favoritas') params.set('favoritos', '1');

  const host = document.getElementById('lista');
  host.innerHTML = skeletonCards(3);
  setText('results-count', 'Cargando…');

  try {
    const data = await api('/api/licitaciones?' + params.toString());
    const items = data.items || data;
    const meta = data.items
      ? data
      : { items, total: items.length, page: 1, totalPages: 1 };
    listaActual = meta.items || items;
    updatePagination(meta);
    renderOportunidades(listaActual);
  } catch (e) {
    host.innerHTML = stateBox('Error', esc(e.error || e.message));
    setText('results-count', 'Error');
  }
}

function renderOportunidades(lista) {
  const host = document.getElementById('lista');
  setText(
    'results-count',
    totalItems
      ? `Mostrando ${lista.length} de ${totalItems}`
      : '0 resultados'
  );
  if (!lista.length) {
    host.innerHTML = stateBox(
      'Nada en esta bandeja',
      view === 'pendientes'
        ? 'Pulsa <b>Buscar ahora</b> para escanear Mercado Público.'
        : 'No hay elementos con estos filtros.',
      view === 'pendientes'
        ? `<button type="button" class="btn btn-primary" id="empty-search">Buscar ahora</button>`
        : ''
    );
    document.getElementById('empty-search')?.addEventListener('click', buscarAhora);
    return;
  }
  host.innerHTML = lista.map(cardOportunidad).join('');
  bindOportunidadCards(host);
}

function cardOportunidad(lic) {
  const cursos = lic.cursos || [];
  const chips = cursos
    .slice(0, 4)
    .map(
      (c) =>
        `<span class="chip ${c.id !== 'formacion' && c.id !== 'manual' ? 'tech' : ''}">${esc(c.nombre)}</span>`
    )
    .join('');
  const more = cursos.length > 4 ? `<span class="chip">+${cursos.length - 4}</span>` : '';
  const aff = Math.min(100, lic.afinidad || 0);
  return `
  <article class="lic-card ${lic.visto ? '' : 'unread'}" data-cod="${esc(lic.codigoExterno)}" role="button" tabindex="0">
    <div class="lic-card-main">
      <div class="lic-card-top">
        <span class="lic-code">${esc(lic.codigoExterno)}</span>
        <span class="estado ${claseEstado(lic.estado)}">${esc(lic.estado || '—')}</span>
        ${lic.guardadoManual ? '<span class="chip warn">Manual</span>' : ''}
        ${lic.visto ? '<span class="chip">Procesada</span>' : '<span class="chip tech">Nueva</span>'}
      </div>
      <div class="lic-title">${esc(lic.nombre || '(sin nombre)')}</div>
      <div class="lic-meta">
        <span>${esc(lic.nombreOrganismo || 'Organismo no indicado')}</span>
        <span>Cierre ${formatearFechaCorta(lic.fechaCierre)}</span>
        <span>${relativo(lic.creadoEn)}</span>
      </div>
    </div>
    <div class="lic-side">
      <div class="chips">${chips}${more}</div>
      <div class="aff"><div class="aff-bar"><i style="width:${aff}%"></i></div>${aff}%</div>
      <button type="button" class="star-btn ${lic.esFavorito ? 'on' : ''}" data-star="${esc(lic.codigoExterno)}">${lic.esFavorito ? starFilled() : starEmpty()}</button>
    </div>
  </article>`;
}

function bindOportunidadCards(host) {
  host.querySelectorAll('.lic-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-star]')) return;
      abrirDetalle(card.dataset.cod);
    });
  });
  host.querySelectorAll('[data-star]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleFav(btn.dataset.star, btn);
    });
  });
}

/* ── Descartadas ── */
async function cargarDescartadas() {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));
  if (filtrosDesc.q) params.set('q', filtrosDesc.q);
  if (filtrosDesc.motivo) params.set('motivo', filtrosDesc.motivo);

  const host = document.getElementById('lista');
  host.innerHTML = skeletonCards(3);
  setText('results-count', 'Cargando…');

  try {
    const data = await api('/api/descartadas?' + params.toString());
    const meta = data.items
      ? data
      : { items: data, total: data.length, page: 1, totalPages: 1 };
    listaActual = meta.items || [];
    updatePagination(meta);
    renderDescartadas(listaActual);
  } catch (e) {
    host.innerHTML = stateBox('Error', esc(e.error || e.message));
  }
}

function renderDescartadas(lista) {
  const host = document.getElementById('lista');
  setText(
    'results-count',
    totalItems
      ? `Mostrando ${lista.length} de ${totalItems} descartadas · 50 por página`
      : '0 descartadas — ejecuta Buscar ahora para llenar esta lista'
  );

  if (!lista.length) {
    host.innerHTML = stateBox(
      'Sin descartadas todavía',
      'Al buscar, todo lo que la API traiga y no pase el filtro se guarda aquí (en lotes de 40). Luego puedes <b>Salvar</b> las que sí te sirvan.'
    );
    return;
  }

  host.innerHTML = lista
    .map((d) => {
      return `
      <article class="lic-card discard">
        <div class="lic-card-main">
          <div class="lic-card-top">
            <span class="lic-code">${esc(d.codigoExterno)}</span>
            <span class="chip warn">${esc(labelMotivo(d.motivo))}</span>
            ${d.vecesVisto > 1 ? `<span class="chip">Vista ${d.vecesVisto}×</span>` : ''}
          </div>
          <div class="lic-title">${esc(d.nombre || '(sin nombre)')}</div>
          <div class="lic-meta">
            <span>${esc(d.nombreOrganismo || '—')}</span>
            <span>Score ${d.score || 0} · técnico ${d.scoreTecnico || 0}</span>
            <span>${formatearFechaCorta(d.ultimaVez)}</span>
          </div>
        </div>
        <div class="lic-side">
          <div class="card-actions">
            <button type="button" class="btn btn-primary btn-sm" data-salvar="${esc(d.codigoExterno)}" title="Mover a oportunidades">Salvar</button>
            <button type="button" class="btn btn-secondary btn-sm" data-reeval="${esc(d.codigoExterno)}">Re-evaluar</button>
            <a class="btn btn-ghost btn-sm" href="${esc(d.urlFicha || '#')}" target="_blank" rel="noopener">Ficha</a>
          </div>
        </div>
      </article>`;
    })
    .join('');

  host.querySelectorAll('[data-reeval]').forEach((btn) => {
    btn.addEventListener('click', () => reevaluar(btn.dataset.reeval, btn));
  });
  host.querySelectorAll('[data-salvar]').forEach((btn) => {
    btn.addEventListener('click', () => salvarDescartada(btn.dataset.salvar, btn));
  });
}

function labelMotivo(m) {
  return (
    {
      sin_coincidencia: 'Sin coincidencia',
      solo_formacion: 'Solo formación',
      bajo_umbral: 'Bajo umbral',
      no_aplica: 'No aplica',
    }[m] ||
    m ||
    'Descartada'
  );
}

async function salvarDescartada(codigo, btn) {
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const r = await api('/api/descartadas/' + encodeURIComponent(codigo) + '/salvar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorito: true }),
    });
    toast('Guardada en oportunidades (favorita)');
    flash(
      'ok',
      `<b>Salvada.</b> ${esc(r.lic?.nombre || codigo)} ahora está en Favoritas / Sin revisar.`
    );
    await cargarStats();
    await cargarVista();
  } catch (e) {
    toast(e.error || e.message || 'Error', true);
    btn.disabled = false;
    btn.textContent = prev;
  }
}

async function reevaluar(codigo, btn) {
  const prev = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>';
  try {
    const r = await api('/api/reevaluar/' + encodeURIComponent(codigo), { method: 'POST' });
    if (r.guardada) {
      toast('Ahora sí aplica — movida a oportunidades');
      await cargarStats();
      await cargarVista();
    } else {
      toast(`Sigue sin aplicar · ${labelMotivo(r.motivo)}`);
      await cargarVista();
    }
  } catch (e) {
    toast(e.error || e.message || 'Error', true);
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

/* ── Historial ── */
async function cargarHistorial() {
  const host = document.getElementById('historial-host');
  host.innerHTML = skeletonCards(2);
  setText('results-count', 'Cargando…');
  try {
    const logs = await api('/api/logs?limite=30');
    if (!logs.length) {
      host.innerHTML = stateBox('Sin búsquedas', 'Ejecuta Buscar ahora.');
      setText('results-count', '0');
      return;
    }
    setText('results-count', `${logs.length} ejecución(es)`);
    host.innerHTML =
      '<div class="hist-list">' +
      logs
        .map((l) => {
          const porFecha = l.porFecha || [];
          const dias = porFecha.length
            ? porFecha
                .map(
                  (d) =>
                    `<div><code>${esc(d.fecha)}</code> · API ${d.api} · guardadas ${d.guardadas} · descartadas ${d.descartadas}${d.error ? ' · ⚠ ' + esc(String(d.error).slice(0, 50)) : ''}</div>`
                )
                .join('')
            : l.detalle
              ? `<div>${esc(l.detalle)}</div>`
              : '<div>Sin desglose</div>';
          return `
          <div class="hist-card">
            <div class="hist-card-head">
              <strong>${formatearFecha(l.fecha)} · ${esc(l.origen || '—')}</strong>
              <div class="hist-stats">
                <span class="hist-stat">API ${l.licitaciones_api ?? 0}</span>
                <span class="hist-stat hi">Nuevas ${l.licitaciones_nuevas ?? 0}</span>
                <span class="hist-stat">Guardadas ${l.licitaciones_guardadas ?? 0}</span>
                <span class="hist-stat">Desc. ${l.licitaciones_descartadas ?? '—'}</span>
              </div>
            </div>
            <div class="hist-days">${dias}</div>
          </div>`;
        })
        .join('') +
      '</div>';
  } catch (e) {
    host.innerHTML = stateBox('Error', esc(e.error || e.message));
  }
}

/* ── Detalle ── */
async function abrirDetalle(codigo) {
  const body = document.getElementById('drawer-body');
  document.getElementById('drawer-foot').hidden = false;
  body.innerHTML =
    '<div style="padding:2rem;text-align:center;color:var(--text-muted)">Cargando…</div>';
  openDrawer();
  try {
    const lic = await api('/api/licitaciones/' + encodeURIComponent(codigo));
    detalleActual = lic;
    const local = listaActual.find((x) => x.codigoExterno === codigo);
    if (local) local.visto = true;
    body.innerHTML = `
      <div class="lic-code" style="margin-bottom:0.45rem">${esc(lic.codigoExterno)}</div>
      <div class="detail-title">${esc(lic.nombre || '(sin nombre)')}</div>
      <div class="chips" style="justify-content:flex-start;margin-bottom:0.4rem">
        ${(lic.cursos || [])
          .map(
            (c) =>
              `<span class="chip ${c.id !== 'formacion' && c.id !== 'manual' ? 'tech' : ''}">${esc(c.nombre)}</span>`
          )
          .join('')}
      </div>
      <dl class="detail-grid">
        <div class="detail-row"><dt>Organismo</dt><dd>${esc(lic.nombreOrganismo || '—')}</dd></div>
        <div class="detail-row"><dt>Estado</dt><dd>${esc(lic.estado || '—')}</dd></div>
        <div class="detail-row"><dt>Tipo</dt><dd>${esc(lic.tipo || '—')}</dd></div>
        <div class="detail-row"><dt>Publicación</dt><dd>${formatearFecha(lic.fechaPublicacion)}</dd></div>
        <div class="detail-row"><dt>Cierre</dt><dd>${formatearFecha(lic.fechaCierre)}</dd></div>
        <div class="detail-row"><dt>Monto</dt><dd>${formatoMonto(lic.montoEstimado)}</dd></div>
        <div class="detail-row"><dt>Afinidad</dt><dd>${lic.afinidad ?? 0}% · score ${lic.score ?? 0}</dd></div>
      </dl>
      ${
        lic.descripcion
          ? `<div class="detail-matches"><h3>Descripción</h3><div class="detail-desc">${esc(lic.descripcion)}</div></div>`
          : ''
      }
      <div class="detail-matches">
        <h3>Coincidencias</h3>
        ${
          (lic.cursos || [])
            .map(
              (c) => `
          <div class="match-block"><strong>${esc(c.nombre)}</strong>
          <div class="match-kws">${(c.coincidencias || []).map((k) => `<span>${esc(k)}</span>`).join('')}</div></div>`
            )
            .join('') || '<p style="color:var(--text-muted);font-size:0.84rem">—</p>'
        }
      </div>`;
    document.getElementById('drawer-link').href = lic.urlFicha || '#';
    updateDrawerFavBtn();
    cargarStats();
  } catch (e) {
    body.innerHTML = `<p style="color:var(--danger)">${esc(e.error || e.message)}</p>`;
  }
}

function updateDrawerFavBtn() {
  const btn = document.getElementById('drawer-fav');
  if (!detalleActual) return;
  btn.textContent = detalleActual.esFavorito ? 'Quitar favorito' : 'Favorito';
}
async function toggleFavDetalle() {
  if (!detalleActual) return;
  await toggleFav(detalleActual.codigoExterno, null);
}
function openDrawer() {
  document.getElementById('overlay').classList.add('open');
  document.getElementById('drawer').classList.add('open');
}
function cerrarDrawer() {
  document.getElementById('overlay').classList.remove('open');
  document.getElementById('drawer').classList.remove('open');
  detalleActual = null;
}

async function toggleFav(cod, btnEl) {
  const actual = listaActual.find((x) => x.codigoExterno === cod);
  const valor = !(actual?.esFavorito || btnEl?.classList.contains('on'));
  try {
    await api('/api/licitaciones/' + encodeURIComponent(cod) + '/favorito', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valor }),
    });
    if (actual) actual.esFavorito = valor;
    if (btnEl) {
      btnEl.classList.toggle('on', valor);
      btnEl.innerHTML = valor ? starFilled() : starEmpty();
    }
    if (detalleActual?.codigoExterno === cod) {
      detalleActual.esFavorito = valor;
      updateDrawerFavBtn();
    }
    cargarStats();
  } catch (e) {
    toast(e.error || e.message || 'Error', true);
  }
}

async function marcarTodasProcesadas() {
  if (!confirm('¿Marcar todas como procesadas?')) return;
  try {
    await api('/api/licitaciones/marcar-vistas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valor: true }),
    });
    toast('Marcadas como procesadas');
    await cargarStats();
    await cargarVista();
  } catch (e) {
    toast(e.error || e.message, true);
  }
}

/* ── Buscar como JOB en background (Detener siempre funciona) ── */
let searchTickTimer = null;
let searchPollTimer = null;
let searchStartedAt = 0;
let searching = false; // solo true si el USUARIO pulsó Buscar

function setSearchUI(loading) {
  const btn = document.getElementById('btn-buscar');
  const stop = document.getElementById('btn-detener');
  const txt = document.getElementById('btn-buscar-txt');
  if (!btn || !stop) return;

  // La visibilidad de idle/loading la controla SOLO la clase .is-loading en CSS
  // (antes el CSS pisaba el atributo hidden y "Buscando…" se veía siempre)
  if (loading) {
    searching = true;
    btn.classList.add('is-loading');
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    stop.classList.add('is-visible');
    stop.hidden = false;
    stop.disabled = false;
    const seg = Math.max(0, Math.round((Date.now() - (searchStartedAt || Date.now())) / 1000));
    if (txt) txt.textContent = seg > 0 ? `Buscando… ${seg}s` : 'Buscando…';
  } else {
    searching = false;
    btn.classList.remove('is-loading');
    btn.disabled = false;
    btn.setAttribute('aria-busy', 'false');
    stop.classList.remove('is-visible');
    stop.hidden = true;
    stop.disabled = false;
    if (txt) txt.textContent = 'Buscando…';
    clearSearchTimers();
  }
}

function clearSearchTimers() {
  if (searchTickTimer) {
    clearInterval(searchTickTimer);
    searchTickTimer = null;
  }
  if (searchPollTimer) {
    clearInterval(searchPollTimer);
    searchPollTimer = null;
  }
}

/** Al cargar la página: mata jobs colgados, NO inicia búsqueda */
async function liberarServidorAlCargar() {
  setSearchUI(false);
  try {
    const st = await api('/api/buscar/estado');
    if (st.enCurso || st.status === 'running') {
      await api('/api/buscar/forzar-parada', { method: 'POST' });
      console.info('[ProgramBI] Job anterior detenido al cargar.');
    }
  } catch {
    /* servidor aún no listo */
  }
  setSearchUI(false);
}

/**
 * Detener: UI libre YA + cancela job en servidor.
 * Nunca muestra "Deteniendo…".
 */
function detenerBusqueda() {
  // 1) UI al instante
  clearSearchTimers();
  setSearchUI(false);
  toast('Búsqueda detenida');

  // 2) Servidor en paralelo (no bloquea el botón)
  fetch('/api/buscar/cancelar', { method: 'POST' }).catch(() => {
    fetch('/api/buscar/forzar-parada', { method: 'POST' }).catch(() => {});
  });

  // 3) Refrescar listas
  setTimeout(() => {
    cargarStats();
    cargarVista();
  }, 500);
}

/**
 * Buscar: lanza job (respuesta inmediata) y hace polling del estado.
 */
async function buscarAhora() {
  if (searching) return;

  searchStartedAt = Date.now();
  setSearchUI(true);

  // Contador visual
  searchTickTimer = setInterval(() => {
    if (!searching) return;
    const seg = Math.round((Date.now() - searchStartedAt) / 1000);
    setText('btn-buscar-txt', `Buscando… ${seg}s`);
  }, 1000);

  try {
    // En serverless (Vercel) el POST espera síncrono y devuelve el resultado
    // final en la misma respuesta. En local responde al instante y se hace
    // polling a /api/buscar/estado.
    const start = await api('/api/buscar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!start.ok && !start.started) {
      throw { error: start.error || 'No se pudo iniciar la búsqueda' };
    }

    // Modo síncrono: la búsqueda ya terminó, usar el resultado del POST
    const terminoSync =
      start.result ||
      start.status === 'done' ||
      start.status === 'cancelled' ||
      start.status === 'error';
    if (terminoSync) {
      clearSearchTimers();
      setSearchUI(false);
      mostrarResultadoBusqueda(start);
      return;
    }
  } catch (e) {
    if (String(e.error || e.message || '').includes('en curso')) {
      // Liberar y avisar
      try {
        await api('/api/buscar/forzar-parada', { method: 'POST' });
      } catch {
        /* ok */
      }
      setSearchUI(false);
      flash(
        'warn',
        'Había una búsqueda trabada. Se liberó: pulsa <b>Buscar ahora</b> de nuevo.'
      );
      return;
    }
    setSearchUI(false);
    flash('error', esc(e.error || e.message || 'Error al iniciar búsqueda'));
    toast(e.error || e.message || 'Error', true);
    return;
  }

  // Polling cada 1.2s hasta que termine o el usuario detenga (solo modo local)
  searchPollTimer = setInterval(async () => {
    if (!searching) {
      clearSearchTimers();
      return;
    }
    try {
      const st = await api('/api/buscar/estado');
      if (st.enCurso || st.status === 'running') {
        if (st.segundos != null) {
          setText('btn-buscar-txt', `Buscando… ${st.segundos}s`);
        }
        return;
      }

      // Terminó
      clearSearchTimers();
      setSearchUI(false);
      mostrarResultadoBusqueda(st);
    } catch {
      /* reintento en el próximo tick */
    }
  }, 1200);
}

/** Muestra el resultado final de una búsqueda (modos síncrono y polling). */
function mostrarResultadoBusqueda(st) {
  const r = st.result;
  if (st.status === 'cancelled' || r?.cancelada) {
    flash(
      'warn',
      r
        ? `Detenida. API <b>${r.api}</b> · guardadas <b>${r.guardadas}</b> · descartadas <b>${r.descartadas}</b>`
        : 'Búsqueda detenida.'
    );
    toast('Búsqueda detenida');
  } else if (st.status === 'error') {
    flash('error', esc(st.error || 'Error en la búsqueda'));
    toast(st.error || 'Error', true);
  } else if (r) {
    flash(
      r.nuevas > 0 ? 'ok' : 'info',
      `API <b>${r.api}</b> · guardadas <b>${r.guardadas}</b> (${r.nuevas} nuevas) · descartadas <b>${r.descartadas}</b>`
    );
    toast(`${r.nuevas} nuevas · ${r.descartadas} descartadas · ${r.api} en API`);
    if (r.nuevas > 0) {
      notificarNavegador('ProgramBI', `${r.nuevas} licitación(es) nueva(s)`);
    }
    if (r.errores?.length) {
      flash('warn', 'Errores parciales: ' + esc(r.errores.slice(0, 2).join(' · ')));
    }
  }

  cargarStats();
  cargarNotificaciones();
  cargarVista();
}

/** Importar CSV de Mercado Público (respaldo cuando la API trae pocas filas) */
async function onCsvFileSelected(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;

  if (file.size > 35 * 1024 * 1024) {
    toast('El archivo es muy grande (máx. ~35 MB)', true);
    return;
  }

  toast(`Leyendo ${file.name}…`);
  const btn = document.getElementById('btn-import-csv');
  const prev = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> Importando…';

  try {
    const texto = await file.text();
    if (!texto || texto.trim().length < 20) {
      throw { error: 'El archivo parece vacío' };
    }

    const r = await api('/api/importar-csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: texto }),
    });

    flash(
      r.nuevas > 0 ? 'ok' : 'info',
      `<b>CSV importado.</b> Filas: <b>${r.total}</b> · Encontradas: <b>${r.guardadas}</b> (${r.nuevas} nuevas) · Descartadas: <b>${r.descartadas}</b>` +
        (r.columnasDetectadas?.length
          ? `<br><span style="opacity:.85">Columnas detectadas: ${esc(r.columnasDetectadas.join(', '))}</span>`
          : '')
    );
    toast(
      `${r.nuevas} nuevas · ${r.guardadas} encontradas · ${r.descartadas} descartadas`
    );

    if (r.nuevas > 0) {
      notificarNavegador(
        'ProgramBI · CSV',
        `${r.nuevas} oportunidad(es) desde el archivo`
      );
    }

    await cargarStats();
    await cargarNotificaciones();
    // Ir a Encontradas o Descartadas según resultado
    if (r.guardadas > 0) setView('todas');
    else setView('descartadas');
    await cargarVista();
  } catch (err) {
    flash('error', esc(err.error || err.message || 'Error al importar CSV'));
    toast(err.error || err.message || 'Error al importar', true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = prev;
  }
}

function exportarCsv() {
  if (view === 'historial' || !listaActual.length) {
    toast('No hay datos en esta página para exportar');
    return;
  }
  let cab, filas;
  if (view === 'descartadas') {
    cab = ['Código', 'Nombre', 'Organismo', 'Motivo', 'Score', 'URL'];
    filas = listaActual.map((l) => [
      l.codigoExterno,
      l.nombre,
      l.nombreOrganismo,
      l.motivo,
      l.score,
      l.urlFicha,
    ]);
  } else {
    cab = ['Código', 'Nombre', 'Organismo', 'Estado', 'Cursos', 'Afinidad', 'URL'];
    filas = listaActual.map((l) => [
      l.codigoExterno,
      l.nombre,
      l.nombreOrganismo,
      l.estado,
      (l.cursos || []).map((c) => c.nombre).join('; '),
      l.afinidad,
      l.urlFicha,
    ]);
  }
  const csv = [cab, ...filas]
    .map((f) => f.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = `programbi-${view}-p${page}.csv`;
  a.click();
  toast('CSV de esta página descargado');
}

/* ── Config modal ── */
async function openConfig() {
  document.getElementById('config-overlay').hidden = false;
  document.body.style.overflow = 'hidden';
  closeSidebarMobile();
  try {
    const s = await api('/api/status');
    setPill('cfg-st-ticket', s.ticketConfigurado, s.ticketConfigurado ? 'OK' : 'Falta ticket');
    setPill('cfg-st-storage', true, s.storage === 'supabase' ? 'Supabase' : 'Local');
    setPill('cfg-st-webhook', s.notifyWebhook, s.notifyWebhook ? 'Activo' : 'No');
  } catch {
    /* ok */
  }
  try {
    const cfg = await api('/api/config');
    cursosEdicion = JSON.parse(JSON.stringify(cfg.cursos || []));
    document.getElementById('cfg-umbral').value = cfg.umbral ?? 1;
    requireTecnico = cfg.requireTecnico !== false;
    renderEditor();
  } catch (e) {
    document.getElementById('save-msg').textContent = e.error || e.message;
  }
}

function closeConfig() {
  document.getElementById('config-overlay').hidden = true;
  document.body.style.overflow = '';
}

function setPill(id, ok, label) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'pill ' + (ok ? 'ok' : 'bad');
  el.innerHTML = `<span class="dot"></span>${esc(label)}`;
}

function renderEditor() {
  const cont = document.getElementById('cursos-editor');
  if (!cursosEdicion.length) {
    cont.innerHTML = '<p class="hint">Sin cursos. Restaura por defecto o añade uno.</p>';
    return;
  }
  cont.innerHTML = cursosEdicion
    .map(
      (c, i) => `
    <div class="curso-row">
      <input type="text" value="${esc(c.nombre)}" data-i="${i}" data-f="nombre" placeholder="Curso">
      <input type="text" value="${esc((c.keywords || []).join(', '))}" data-i="${i}" data-f="keywords" placeholder="kw1, kw2">
      <button type="button" class="btn btn-ghost btn-sm" data-del="${i}" aria-label="Eliminar">×</button>
    </div>`
    )
    .join('');
  cont.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('input', (e) => {
      const i = +e.target.dataset.i;
      const f = e.target.dataset.f;
      if (f === 'keywords') {
        cursosEdicion[i].keywords = e.target.value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        cursosEdicion[i][f] = e.target.value;
      }
    });
  });
  cont.querySelectorAll('[data-del]').forEach((b) => {
    b.addEventListener('click', () => {
      cursosEdicion.splice(+b.dataset.del, 1);
      renderEditor();
    });
  });
}

async function guardarConfig() {
  const umbral = parseInt(document.getElementById('cfg-umbral').value, 10);
  const msg = document.getElementById('save-msg');
  cursosEdicion.forEach((c) => {
    if (!c.id) c.id = (c.nombre || 'curso').toLowerCase().replace(/\s+/g, '-');
  });
  try {
    await api('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ umbral, cursos: cursosEdicion, requireTecnico }),
    });
    msg.style.color = 'var(--ok)';
    msg.textContent = 'Guardado.';
    toast('Configuración guardada');
  } catch (e) {
    msg.style.color = 'var(--danger)';
    msg.textContent = e.error || e.message;
  }
}

async function resetConfig() {
  if (!confirm('¿Restaurar keywords por defecto?')) return;
  try {
    const r = await api('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _reset: true }),
    });
    cursosEdicion = JSON.parse(JSON.stringify(r.data.cursos));
    document.getElementById('cfg-umbral').value = r.data.umbral;
    renderEditor();
    toast('Restaurado');
  } catch (e) {
    toast(e.error || e.message, true);
  }
}

/* ── Notificaciones ── */
async function cargarNotificaciones() {
  try {
    const list = await api('/api/notificaciones');
    const unread = list.filter((n) => !n.leida).length;
    const badge = document.getElementById('notif-badge');
    if (unread > 0) {
      badge.hidden = false;
      badge.textContent = unread > 9 ? '9+' : String(unread);
    } else badge.hidden = true;
    const host = document.getElementById('notif-list');
    if (!list.length) {
      host.innerHTML = '<div class="notif-empty">Sin notificaciones</div>';
      return;
    }
    host.innerHTML = list
      .map(
        (n) => `
      <div class="notif-item ${n.leida ? '' : 'unread'}">
        <time>${formatearFecha(n.fecha)}</time>
        <p><b>${n.total}</b> nueva(s)</p>
      </div>`
      )
      .join('');
  } catch {
    /* ok */
  }
}
function toggleNotifPanel(e) {
  e?.stopPropagation();
  document.getElementById('notif-panel').classList.toggle('open');
}
function closeNotifPanel() {
  document.getElementById('notif-panel').classList.remove('open');
}
async function marcarNotifLeidas() {
  try {
    await api('/api/notificaciones/leer', { method: 'POST' });
    await cargarNotificaciones();
  } catch {
    /* ok */
  }
}
function notificarNavegador(titulo, body, opts = {}) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const n = new Notification(titulo, {
      body,
      tag: opts.tag || 'programbi',
      // Reusa la misma notificación para no spamear el centro de notificaciones
      renotify: !!opts.renotify,
      icon:
        'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 100 100%27%3E%3Crect width=%27100%27 height=%27100%27 rx=%2722%27 fill=%27%230a0a0a%27/%3E%3Ctext x=%2750%27 y=%2766%27 font-size=%2742%27 font-family=%27system-ui%27 font-weight=%27700%27 fill=%27white%27 text-anchor=%27middle%27%3EBI%3C/text%3E%3C/svg%3E',
    });
    // Click en la notificación → enfoca la pestaña y abre la app
    n.onclick = () => {
      window.focus();
      n.close();
      if (opts.onClickView && VIEWS[opts.onClickView]) setView(opts.onClickView);
    };
  } catch {
    /* ignore */
  }
}

/* ── Vigilancia de nuevas licitaciones (web abierta) ── */

let POLL_NUEVAS_TIMER = null;
let ULTIMAS_NUEVAS_COUNT = null; // null = aún no sabemos el baseline
let POLL_INTERVAL_MS = 5 * 60 * 1000; // cada 5 min

function iniciarVigilanciaNotificaciones() {
  // Solo arranca si el usuario ya concedió permiso, si no, se habilita tras pulsar el botón
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  arrancarPollingNuevas();
  // Re-verifica cuando vuelves a la pestaña (mientras estuviste en otra)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) revisarNuevasAhora();
  });
}

function arrancarPollingNuevas() {
  if (POLL_NUEVAS_TIMER) clearInterval(POLL_NUEVAS_TIMER);
  // Primera lectura inmediata: establece el baseline sin notificar
  revisarNuevasAhora(true);
  POLL_NUEVAS_TIMER = setInterval(() => revisarNuevasAhora(), POLL_INTERVAL_MS);
}

async function revisarNuevasAhora(esInicial = false) {
  try {
    const s = await api('/api/stats');
    // noVistos cuenta las licitaciones guardadas aún no revisadas en la UI
    const count = s.noVistos ?? 0;
    if (ULTIMAS_NUEVAS_COUNT === null) {
      // baseline: la primera vez NO notificamos (podría haber backlog)
      ULTIMAS_NUEVAS_COUNT = count;
      return;
    }
    if (count > ULTIMAS_NUEVAS_COUNT) {
      const delta = count - ULTIMAS_NUEVAS_COUNT;
      ULTIMAS_NUEVAS_COUNT = count;
      if (!esInicial) {
        notificarNavegador(
          '🎓 ProgramBI — Nuevas licitaciones',
          `${delta} licitación(es) nueva(s) que coinciden con tu perfil. Abre la app para verlas.`,
          { tag: 'nuevas', renotify: true, onClickView: 'pendientes' }
        );
        // Refresca la vista silenciosamente
        cargarStats();
        cargarNotificaciones();
        if (view === 'todas' || view === 'pendientes') cargarVista();
      }
    } else if (count < ULTIMAS_NUEVAS_COUNT) {
      // Las vieron/marcaron visto → actualizar baseline
      ULTIMAS_NUEVAS_COUNT = count;
    }
  } catch {
    /* reintento en el próximo tick */
  }
}

/* ── Botón para activar/desactivar notificaciones ── */

function registrarBotonNotificaciones() {
  const btn = document.getElementById('btn-notif-toggle');
  if (!btn) return;
  actualizarUIBotonNotif();
  btn.addEventListener('click', async () => {
    if (!('Notification' in window)) {
      toast('Tu navegador no soporta notificaciones', true);
      return;
    }
    if (Notification.permission === 'granted') {
      // Ya activado: probamos con una notificación de prueba
      notificarNavegador(
        '🎓 ProgramBI',
        'Notificaciones activadas. Te avisaré cuando el cron detecte licitaciones nuevas (mientras tengas la web abierta).',
        { tag: 'prueba' }
      );
      arrancarPollingNuevas();
      actualizarUIBotonNotif();
    } else if (Notification.permission !== 'denied') {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        arrancarPollingNuevas();
        actualizarUIBotonNotif();
        notificarNavegador('🎓 ProgramBI', '¡Listo! Te avisaré de las nuevas licitaciones.', {
          tag: 'prueba',
        });
      } else {
        actualizarUIBotonNotif();
        toast('Permiso de notificaciones denegado', true);
      }
    } else {
      toast(
        'Bloqueaste las notificaciones. Actívalas en el icono del candado en la barra del navegador.',
        true
      );
    }
  });
}

function actualizarUIBotonNotif() {
  const btn = document.getElementById('btn-notif-toggle');
  if (!btn) return;
  if (!('Notification' in window)) {
    btn.hidden = true;
    return;
  }
  const perm = Notification.permission;
  const dot = btn.querySelector('.notif-dot') || document.createElement('span');
  dot.className = 'notif-dot';
  dot.style.cssText =
    'display:inline-block;width:8px;height:8px;border-radius:50%;margin-left:8px;background:' +
    (perm === 'granted' ? '#22c55e' : perm === 'denied' ? '#ef4444' : '#94a3b8') +
    ';';
  if (!dot.parentNode) btn.appendChild(dot);
  btn.title =
    perm === 'granted'
      ? 'Notificaciones activadas'
      : perm === 'denied'
      ? 'Notificaciones bloqueadas por el navegador'
      : 'Activar notificaciones del navegador';
}

/* ── helpers ── */
function skeletonCards(n) {
  return Array.from({ length: n })
    .map(
      () =>
        `<div class="lic-card" style="pointer-events:none"><div class="lic-card-main" style="width:100%"><div class="skeleton" style="width:40%;height:11px;margin-bottom:10px"></div><div class="skeleton" style="width:85%;height:15px;margin-bottom:8px"></div><div class="skeleton" style="width:50%;height:11px"></div></div></div>`
    )
    .join('');
}
function stateBox(title, msg, extra = '') {
  return `<div class="state-box"><div class="icon-wrap"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg></div><h3>${title}</h3><p>${msg}</p>${extra}</div>`;
}
function starEmpty() {
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
}
function starFilled() {
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.75"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
}
function claseEstado(estado) {
  const e = (estado || '').toLowerCase();
  if (e.includes('public') || e.includes('abierta')) return 'pub';
  if (e.includes('cerrad') || e.includes('desiert')) return 'cerr';
  return '';
}
function formatoMonto(m) {
  if (m == null || m === '' || Number.isNaN(Number(m))) return '—';
  try {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0,
    }).format(Number(m));
  } catch {
    return String(m);
  }
}
function setText(id, t) {
  const el = document.getElementById(id);
  if (el) el.textContent = t;
}
function formatearFecha(f) {
  if (!f) return '—';
  const d = new Date(typeof f === 'string' && !f.includes('T') ? f.replace(' ', 'T') : f);
  if (isNaN(d)) return esc(String(f));
  return d.toLocaleString('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function formatearFechaCorta(f) {
  if (!f) return '—';
  const d = new Date(typeof f === 'string' && !f.includes('T') ? f.replace(' ', 'T') : f);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
}
function relativo(f) {
  if (!f) return '';
  const d = new Date(f);
  if (isNaN(d)) return '';
  const m = Math.floor((Date.now() - d.getTime()) / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}
function flash(tipo, html) {
  const host = document.getElementById('alerta-host');
  const div = document.createElement('div');
  div.className = 'alert ' + tipo;
  div.innerHTML = html;
  host.prepend(div);
  setTimeout(() => {
    div.style.opacity = '0';
    div.style.transition = 'opacity .35s';
    setTimeout(() => div.remove(), 350);
  }, 12000);
}
function toast(msg, isError) {
  const host = document.getElementById('toast-host');
  const div = document.createElement('div');
  div.className = 'toast' + (isError ? ' error' : '');
  div.textContent = msg;
  host.appendChild(div);
  setTimeout(() => {
    div.style.opacity = '0';
    div.style.transition = 'opacity .3s';
    setTimeout(() => div.remove(), 300);
  }, 4200);
}
function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
