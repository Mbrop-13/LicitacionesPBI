'use strict';

require('dotenv').config();

const config = {
  // Mercado Público (ChileCompra)
  ticket: process.env.MERCADOPUBLICO_TICKET || '',
  apiBase: 'https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json',
  fichaUrl: 'https://www.mercadopublico.cl/FichaLicitacion/detalle.aspx?idLicitacion=',

  // Servidor local
  port: parseInt(process.env.PORT || '3000', 10),

  // Cron local — OFF por defecto (solo busca cuando tú pulsas el botón)
  // Activa con AUTO_BUSCAR=1 si quieres búsqueda automática en local
  autoBuscar: process.env.AUTO_BUSCAR === '1' || process.env.CRON_ENABLED === '1',
  cronExpresion: process.env.CRON_EXPRESION || '0 9 * * 1-5',
  cronTimezone: process.env.CRON_TIMEZONE || 'America/Santiago',

  // Búsqueda
  diasHaciaAtras: parseInt(process.env.DIAS_HACIA_ATRAS || '5', 10),
  umbralCoincidencias: parseInt(process.env.UMBRAL_COINCIDENCIAS || '1', 10),
  // Si true, pide detalle a la API cuando el listado no tiene descripción
  enriquecerDetalle: process.env.ENRIQUECER_DETALLE !== '0',

  // Supabase (opcional). Si no está, se usa almacenamiento local en /data
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_SERVICE_KEY || '',

  // Seguridad del cron (Vercel)
  cronSecret: process.env.CRON_SECRET || '',

  // Notificaciones Webhook (Discord / Slack / Make / n8n)
  notifyWebhook: process.env.NOTIFY_WEBHOOK_URL || '',
  notifyEmail: process.env.NOTIFY_EMAIL || '',

  // Notificaciones Email Directo (Amazon SES / SMTP)
  emailEnable: process.env.EMAIL_ENABLE === '1' || process.env.NOTIFY_EMAIL_ENABLE === '1',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpSecure: process.env.SMTP_SECURE === '1' || process.env.SMTP_SECURE === 'true',
  emailFrom: process.env.EMAIL_FROM || '',
  emailTo: process.env.EMAIL_TO || process.env.NOTIFY_EMAIL || '',
};

function ticketOk() {
  return !!(config.ticket && config.ticket !== 'tu-ticket-aqui');
}

function supabaseOk() {
  return !!(
    config.supabaseUrl &&
    config.supabaseKey &&
    !config.supabaseUrl.includes('TU-PROYECTO') &&
    config.supabaseKey !== 'tu-service-role-key'
  );
}

function emailOk() {
  return !!(config.smtpHost && config.smtpUser && config.smtpPass && (config.emailTo || config.notifyEmail));
}

module.exports = { config, ticketOk, supabaseOk, emailOk };
