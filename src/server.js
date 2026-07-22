'use strict';

// Servidor de desarrollo local. En Vercel se usa api/[...slug].js
const path = require('path');
const express = require('express');
const apiApp = require('./apiApp');
const scheduler = require('./scheduler');
const { config } = require('./config');
const store = require('./store/db');
const control = require('./busquedaControl');
const job = require('./busquedaJob');

// Al arrancar: estado limpio (no busca sola, no deja jobs fantasmas)
try {
  control.hardReset();
} catch {
  /* ignore */
}

const app = express();

app.use(apiApp);

// Solo si AUTO_BUSCAR=1 (por defecto OFF)
try {
  scheduler.arrancar();
} catch (e) {
  console.error('[scheduler]', e.message);
}

app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA-friendly fallbacks
app.get(
  [
    '/',
    '/inicio',
    '/pendientes',
    '/todas',
    '/procesadas',
    '/favoritas',
    '/descartadas',
    '/historial',
    '/calendario',
    '/dashboard',
    '/configuracion',
  ],
  (_req, res) => {
    const file = _req.path.includes('config') ? 'config.html' : 'index.html';
    res.sendFile(path.join(__dirname, '..', 'public', file));
  }
);

const PORT = config.port;
app.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║   ProgramBI · Licitaciones                ║');
  console.log(`  ║   http://localhost:${PORT}                   ║`);
  console.log(`  ║   Storage: ${store.modoStorage().padEnd(28)}║`);
  console.log(`  ║   Auto-buscar: ${(config.autoBuscar ? 'ON ' : 'OFF').padEnd(25)}║`);
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
});
