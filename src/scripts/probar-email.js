'use strict';

require('dotenv').config();
const { enviarEmailLicitaciones } = require('../services/email');

async function main() {
  console.log('----------------------------------------------------');
  console.log('📧 Probando envío de correo vía Amazon SES / SMTP...');
  console.log('----------------------------------------------------');

  const licitacionPrueba = {
    codigoExterno: 'TEST-12345-LP26',
    nombre: 'Licitación de Prueba: Capacitación en Power BI y Excel Avanzado',
    nombreOrganismo: 'Ministerio de Ejemplo - Gobierno de Chile',
    cursos: [
      { id: 'excel', nombre: 'Excel' },
      { id: 'powerbi', nombre: 'Power BI' },
    ],
    afinidad: 95,
    urlFicha: 'https://www.mercadopublico.cl/FichaLicitacion/detalle.aspx?idLicitacion=TEST-12345-LP26',
  };

  const res = await enviarEmailLicitaciones([licitacionPrueba], { origen: 'manual' });

  if (res.enviada) {
    console.log('✅ ¡ÉXITO! Correo de prueba enviado con éxito.');
    console.log(`   Message ID: ${res.messageId}`);
    console.log(`   Destino: ${res.destino}`);
  } else {
    console.error('❌ ERROR al enviar el correo.');
    console.error(`   Causa: ${res.razon}`);
    console.log('\n💡 Revisa tus variables en el archivo .env (SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_FROM, EMAIL_TO).');
  }
}

main().catch((e) => console.error('Error fatal:', e.message));
