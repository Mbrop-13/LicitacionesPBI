'use strict';

const { config } = require('../config');
const { enviarEmailLicitaciones } = require('./email');

/**
 * Envía notificación cuando hay licitaciones nuevas.
 * - Email directo vía Amazon SES / SMTP (si está activado en .env)
 * - Webhook HTTP (Discord / Slack / Make / n8n / Zapier)
 * - El frontend también usa la Notification API del navegador
 */
async function notificarNuevas(licitaciones, meta = {}) {
  if (!licitaciones || !licitaciones.length) {
    return { enviada: false, razon: 'sin_nuevas' };
  }

  // Intentar envío por email (Amazon SES)
  let emailRes = { enviada: false };
  try {
    emailRes = await enviarEmailLicitaciones(licitaciones, meta);
  } catch (e) {
    console.warn('[notificaciones] error email:', e.message);
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
    return { enviada: emailRes.enviada, razon: emailRes.enviada ? 'email' : 'sin_webhook', payload, email: emailRes };
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
      return { enviada: emailRes.enviada || false, razon: `http_${resp.status}`, email: emailRes };
    }
    return { enviada: true, razon: 'webhook_y_email', email: emailRes };
  } catch (e) {
    console.warn('[notificaciones] error webhook:', e.message);
    return { enviada: emailRes.enviada || false, razon: e.message, email: emailRes };
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
  // Siempre procesa el correo por Amazon SES si está habilitado
  let emailRes = { enviada: false };
  try {
    emailRes = await enviarEmailLicitaciones(licitaciones, meta);
  } catch (e) {
    console.warn('[notificaciones] error email:', e.message);
  }

  if (!config.notifyWebhook || !licitaciones?.length) {
    const r = await notificarNuevas(licitaciones, meta);
    return { ...r, email: emailRes };
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
    return { enviada: resp.ok || emailRes.enviada, razon: resp.ok ? 'discord' : `http_${resp.status}`, email: emailRes };
  } catch (e) {
    return { enviada: emailRes.enviada, razon: e.message, email: emailRes };
  }
}

module.exports = { notificarNuevas, notificarDiscordCompatible };
