'use strict';

const { config } = require('../config');

/**
 * Envía notificación cuando hay licitaciones nuevas.
 * - Webhook HTTP (Discord / Slack / Make / n8n / Zapier)
 * - El frontend también usa la Notification API del navegador
 */
async function notificarNuevas(licitaciones, meta = {}) {
  if (!licitaciones || !licitaciones.length) {
    return { enviada: false, razon: 'sin_nuevas' };
  }

  const resumen = licitaciones.slice(0, 10).map((l) => ({
    codigo: l.codigoExterno,
    nombre: l.nombre,
    organismo: l.nombreOrganismo,
    cursos: (l.cursos || []).map((c) => c.nombre),
    afinidad: l.afinidad,
    url: l.urlFicha,
    cierre: l.fechaCierre,
  }));

  const payload = {
    source: 'ProgramBI Licitaciones',
    titulo: `ProgramBI: ${licitaciones.length} licitación(es) nueva(s)`,
    mensaje: `Se detectaron ${licitaciones.length} oportunidades que coinciden con tus cursos.`,
    email: config.notifyEmail || null,
    total: licitaciones.length,
    origen: meta.origen || 'manual',
    fecha: new Date().toISOString(),
    licitaciones: resumen,
  };

  if (!config.notifyWebhook) {
    return { enviada: false, razon: 'sin_webhook', payload };
  }

  try {
    const resp = await fetch(config.notifyWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      console.warn('[notificaciones] webhook HTTP', resp.status, t.slice(0, 200));
      return { enviada: false, razon: `http_${resp.status}` };
    }
    return { enviada: true, razon: 'webhook' };
  } catch (e) {
    console.warn('[notificaciones] error webhook:', e.message);
    return { enviada: false, razon: e.message };
  }
}

/** Formato amigable para Discord (content + embeds simples). */
function payloadDiscord(licitaciones) {
  const lines = licitaciones.slice(0, 5).map((l) => {
    const cursos = (l.cursos || []).map((c) => c.nombre).join(', ');
    return `• **${l.nombre?.slice(0, 80) || l.codigoExterno}**\n  ${l.nombreOrganismo || '—'} · ${cursos || '—'}\n  ${l.urlFicha || ''}`;
  });
  return {
    content: `🎓 **ProgramBI** — ${licitaciones.length} licitación(es) nueva(s) en Mercado Público`,
    embeds: [
      {
        title: 'Oportunidades detectadas',
        description: lines.join('\n\n') || 'Sin detalle',
        color: 0x0a0a0a,
      },
    ],
  };
}

async function notificarDiscordCompatible(licitaciones, meta = {}) {
  if (!config.notifyWebhook || !licitaciones?.length) {
    return notificarNuevas(licitaciones, meta);
  }

  // Si el webhook parece de Discord, usa formato nativo
  const isDiscord = /discord(?:app)?\.com\/api\/webhooks/i.test(config.notifyWebhook);
  if (!isDiscord) return notificarNuevas(licitaciones, meta);

  try {
    const body = payloadDiscord(licitaciones);
    const resp = await fetch(config.notifyWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { enviada: resp.ok, razon: resp.ok ? 'discord' : `http_${resp.status}` };
  } catch (e) {
    return { enviada: false, razon: e.message };
  }
}

module.exports = { notificarNuevas, notificarDiscordCompatible };
