'use strict';

const nodemailer = require('nodemailer');
const { config } = require('../config');

/**
 * Crea el transporter de nodemailer para Amazon SES u otro servidor SMTP.
 */
function crearTransporter() {
  if (!config.smtpHost || !config.smtpUser || !config.smtpPass) {
    return null;
  }

  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure || config.smtpPort === 465,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
}

/**
 * Genera el cuerpo HTML responsive y optimizado para móviles (Gmail App, iOS, Outlook).
 */
function generarHtmlLicitaciones(licitaciones, meta = {}) {
  const fechaTexto = new Date().toLocaleDateString('es-CL', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const total = licitaciones.length;
  const origen = meta.origen === 'cron' ? 'Búsqueda automática (11:00 AM)' : 'Búsqueda manual';

  const tarjetas = licitaciones
    .map((lic) => {
      const cursosTags = (lic.cursos || [])
        .map(
          (c) =>
            `<span style="display:inline-block; background-color:#e0f2fe; color:#0369a1; border-radius:12px; padding:3px 10px; font-size:12px; font-weight:600; margin-right:4px; margin-bottom:4px;">${escapeHtml(c.nombre)}</span>`
        )
        .join('');

      const urlDirecta =
        lic.urlFicha ||
        `https://www.mercadopublico.cl/FichaLicitacion/detalle.aspx?idLicitacion=${encodeURIComponent(
          lic.codigoExterno
        )}`;

      return `
      <!-- Tarjeta Licitación -->
      <div style="background-color:#ffffff; border:1px solid #e2e8f0; border-radius:10px; padding:16px; margin-bottom:14px; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
        
        <!-- Cabecera Tarjeta (Afinidad + Código) -->
        <table style="width:100%; border-collapse:collapse; margin-bottom:8px;">
          <tr>
            <td style="font-size:12px; font-weight:700; color:#64748b; text-transform:uppercase;">
              COD: ${escapeHtml(lic.codigoExterno)}
            </td>
            <td style="text-align:right;">
              <span style="background-color:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; border-radius:6px; padding:3px 8px; font-weight:700; font-size:12px;">
                Afinidad ${lic.afinidad || 100}%
              </span>
            </td>
          </tr>
        </table>

        <!-- Título Licitación -->
        <div style="font-size:15px; font-weight:700; color:#0f172a; line-height:1.4; margin-bottom:8px;">
          ${escapeHtml(lic.nombre)}
        </div>

        <!-- Meta info -->
        <div style="font-size:13px; color:#475569; margin-bottom:10px; line-height:1.4;">
          🏢 <strong>Organismo:</strong> ${escapeHtml(lic.nombreOrganismo || 'No especificado')}
        </div>

        <!-- Chips de Cursos -->
        <div style="margin-bottom:14px;">
          ${cursosTags || '<span style="color:#94a3b8; font-size:12px;">Capacitación</span>'}
        </div>

        <!-- Botón Full-Width Celular / Desktop -->
        <div style="text-align:center;">
          <a href="${urlDirecta}" target="_blank" style="display:block; width:100%; box-sizing:border-box; background-color:#0f172a; color:#ffffff; font-size:14px; font-weight:700; text-decoration:none; padding:11px 0; border-radius:8px; text-align:center;">
            Ver Ficha en Mercado Público &rarr;
          </a>
        </div>

      </div>`;
    })
    .join('');

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Licitaciones ProgramBI</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color:#f1f5f9; margin:0; padding:10px 4px; color:#1e293b;">
  
  <div style="max-width:580px; width:100%; margin:0 auto; box-sizing:border-box;">
    
    <!-- Encabezado -->
    <div style="background-color:#0f172a; padding:20px; border-top-left-radius:12px; border-top-right-radius:12px; color:#ffffff; text-align:left;">
      <h1 style="margin:0; font-size:19px; font-weight:800; tracking-wide:0.5px;">
        🎓 ProgramBI · Licitaciones Detectadas
      </h1>
      <p style="margin:6px 0 0 0; color:#94a3b8; font-size:12px;">
        ${fechaTexto} · ${origen}
      </p>
    </div>

    <!-- Banner Contador -->
    <div style="background-color:#eff6ff; border-bottom:1px solid #dbeafe; padding:14px 20px; border-bottom-left-radius:0; border-bottom-right-radius:0;">
      <div style="font-size:15px; font-weight:700; color:#1e40af;">
        🎯 ${total} oportuni${total === 1 ? 'dad' : 'dades'} aplicable${total === 1 ? '' : 's'} detectada${total === 1 ? '' : 's'}
      </div>
      <div style="font-size:12px; color:#3b82f6; margin-top:2px;">
        Nuevas licitaciones publicadas en Mercado Público que coinciden con tus cursos.
      </div>
    </div>

    <!-- Cuerpo / Listado de Tarjetas -->
    <div style="padding:16px 8px 10px 8px; background-color:#f8fafc; border-bottom-left-radius:12px; border-bottom-right-radius:12px;">
      ${tarjetas}
    </div>

    <!-- Pie de Página -->
    <div style="padding:16px; text-align:center; color:#64748b; font-size:11px;">
      Enviado automáticamente por <strong>ProgramBI Licitaciones</strong> vía Amazon SES.
    </div>

  </div>

</body>
</html>`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Envía el reporte de licitaciones por email vía Amazon SES / SMTP.
 * Soporta múltiples emails destino separados por coma.
 */
async function enviarEmailLicitaciones(licitaciones, meta = {}) {
  if (!config.emailEnable) {
    return { enviada: false, razon: 'email_desactivado' };
  }

  const emailDestino = config.emailTo || config.notifyEmail;
  if (!emailDestino) {
    return { enviada: false, razon: 'sin_email_destino' };
  }

  const transporter = crearTransporter();
  if (!transporter) {
    return { enviada: false, razon: 'smtp_no_configurado' };
  }

  if (!licitaciones || !licitaciones.length) {
    return { enviada: false, razon: 'sin_licitaciones' };
  }

  const remitente = config.emailFrom || `"ProgramBI Licitaciones" <${config.smtpUser}>`;
  const asunto = `🎓 ProgramBI: ${licitaciones.length} nueva(s) licitación(es) detectada(s)`;
  const html = generarHtmlLicitaciones(licitaciones, meta);

  try {
    const info = await transporter.sendMail({
      from: remitente,
      to: emailDestino,
      subject: asunto,
      html,
    });
    console.log('[email] Correo enviado con éxito vía Amazon SES:', info.messageId);
    return { enviada: true, messageId: info.messageId, destino: emailDestino };
  } catch (e) {
    console.error('[email] Error enviando correo vía Amazon SES:', e.message);
    return { enviada: false, razon: e.message };
  }
}

module.exports = { enviarEmailLicitaciones, generarHtmlLicitaciones };
