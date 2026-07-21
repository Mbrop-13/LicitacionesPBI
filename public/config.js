'use strict';

const api = (url, opts) =>
  fetch(url, opts).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw data.error ? { error: data.error } : data;
    return data;
  });

let cursosEdicion = [];
let requireTecnico = true;

document.addEventListener('DOMContentLoaded', () => {
  comprobarStatus();
  cargarConfig();
  cargarLogs();
  wire();
});

function wire() {
  document.getElementById('btn-save-config').addEventListener('click', guardar);
  document.getElementById('btn-reset-config').addEventListener('click', resetear);
  document.getElementById('btn-add-curso').addEventListener('click', () => {
    cursosEdicion.push({
      id: 'curso_' + Date.now(),
      nombre: 'Nuevo curso',
      keywords: [],
    });
    renderEditor();
  });
  document.getElementById('btn-ping-cfg')?.addEventListener('click', pingCfg);
}

async function pingCfg() {
  const msg = document.getElementById('ping-msg');
  msg.textContent = 'Consultando…';
  try {
    const p = await api('/api/ping');
    msg.style.color = p.ok ? 'var(--ok)' : 'var(--danger)';
    msg.textContent = p.ok
      ? `OK · ${p.licitacionesHoy} licitaciones hoy · ${p.latenciaMs} ms`
      : p.mensaje || 'Error';
  } catch (e) {
    msg.style.color = 'var(--danger)';
    msg.textContent = e.error || e.message || 'Error';
  }
}

async function comprobarStatus() {
  try {
    const s = await api('/api/status');
    setPill('st-ticket', s.ticketConfigurado, s.ticketConfigurado ? 'Configurado' : 'Falta ticket');
    setPill(
      'st-storage',
      true,
      s.storage === 'supabase' ? 'Supabase' : 'Local (JSON)'
    );
    setPill(
      'st-webhook',
      s.notifyWebhook,
      s.notifyWebhook ? 'Webhook activo' : 'Sin webhook'
    );

    if (!s.ticketConfigurado) {
      flash(
        'warn',
        '<b>Falta el ticket de Mercado Público.</b> Edita <code>.env</code> y define <code>MERCADOPUBLICO_TICKET</code>.'
      );
    }
  } catch {
    setPill('st-ticket', false, 'Sin conexión');
    setPill('st-storage', false, 'Sin conexión');
    setPill('st-webhook', false, 'Sin conexión');
  }
}

function setPill(id, ok, label) {
  const el = document.getElementById(id);
  el.className = 'pill ' + (ok ? 'ok' : 'bad');
  el.innerHTML = `<span class="dot"></span>${esc(label)}`;
}

async function cargarConfig() {
  try {
    const cfg = await api('/api/config');
    cursosEdicion = JSON.parse(JSON.stringify(cfg.cursos || []));
    document.getElementById('cfg-umbral').value = cfg.umbral ?? 1;
    requireTecnico = cfg.requireTecnico !== false;
    renderEditor();
  } catch (e) {
    document.getElementById('save-msg').textContent =
      'Error al cargar: ' + (e.error || e.message);
  }
}

function renderEditor() {
  const cont = document.getElementById('cursos-editor');
  if (!cursosEdicion.length) {
    cont.innerHTML =
      '<p style="color:var(--text-muted);font-size:0.875rem;padding:0.5rem 0">No hay cursos. Añade uno o restaura los valores por defecto.</p>';
    return;
  }

  cont.innerHTML = cursosEdicion
    .map(
      (c, i) => `
    <div class="curso-row">
      <input type="text" value="${esc(c.nombre)}" placeholder="Nombre del curso" data-i="${i}" data-f="nombre">
      <input type="text" value="${esc((c.keywords || []).join(', '))}" placeholder="palabra1, palabra2, …" data-i="${i}" data-f="keywords">
      <button type="button" class="btn btn-ghost btn-sm" data-del="${i}" title="Eliminar" aria-label="Eliminar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
      </button>
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
        if (!cursosEdicion[i].id) {
          cursosEdicion[i].id = slug(e.target.value);
        }
      }
    });
  });

  cont.querySelectorAll('[data-del]').forEach((b) => {
    b.addEventListener('click', (e) => {
      const i = +e.currentTarget.dataset.del;
      if (confirm('¿Eliminar este curso del perfil?')) {
        cursosEdicion.splice(i, 1);
        renderEditor();
      }
    });
  });
}

async function guardar() {
  const umbral = parseInt(document.getElementById('cfg-umbral').value, 10);
  const msg = document.getElementById('save-msg');
  cursosEdicion.forEach((c) => {
    if (!c.id) c.id = slug(c.nombre);
  });
  try {
    await api('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ umbral, cursos: cursosEdicion, requireTecnico }),
    });
    msg.style.color = 'var(--ok)';
    msg.textContent = 'Guardado. Se aplicará en la próxima búsqueda.';
    toast('Configuración guardada');
  } catch (e) {
    msg.style.color = 'var(--danger)';
    msg.textContent = e.error || e.message || 'Error al guardar';
  }
}

async function resetear() {
  if (!confirm('¿Restaurar palabras clave por defecto de ProgramBI?')) return;
  try {
    const r = await api('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _reset: true }),
    });
    cursosEdicion = JSON.parse(JSON.stringify(r.data.cursos));
    document.getElementById('cfg-umbral').value = r.data.umbral;
    renderEditor();
    document.getElementById('save-msg').textContent = 'Valores por defecto restaurados.';
    toast('Perfil restaurado');
  } catch (e) {
    toast(e.error || e.message || 'Error', true);
  }
}

async function cargarLogs() {
  try {
    const logs = await api('/api/logs?limite=15');
    const body = document.getElementById('logs-body');
    if (!logs.length) {
      body.innerHTML =
        '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted)">Aún no hay ejecuciones. Usa “Buscar ahora” en el dashboard.</td></tr>';
      return;
    }
    body.innerHTML = logs
      .map(
        (l) => `
      <tr>
        <td class="mono">${esc(formatear(l.fecha))}</td>
        <td><span class="pill">${esc(l.origen)}</span></td>
        <td>${l.licitaciones_api}</td>
        <td style="font-weight:600;color:var(--text)">${l.licitaciones_nuevas}</td>
        <td>${l.licitaciones_guardadas}</td>
        <td>${l.licitaciones_descartadas ?? '—'}</td>
      </tr>`
      )
      .join('');
  } catch {
    /* ok */
  }
}

function formatear(f) {
  if (!f) return '—';
  const d = new Date(f);
  if (isNaN(d)) return String(f);
  return d.toLocaleString('es-CL', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function slug(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'curso';
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
}

function toast(msg, isError) {
  const host = document.getElementById('toast-host');
  if (!host) return;
  const div = document.createElement('div');
  div.className = 'toast' + (isError ? ' error' : '');
  div.textContent = msg;
  host.appendChild(div);
  setTimeout(() => {
    div.style.opacity = '0';
    div.style.transition = 'opacity .3s';
    setTimeout(() => div.remove(), 300);
  }, 4000);
}
