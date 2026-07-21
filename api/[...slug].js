'use strict';

// Catch-all dinámico de Vercel: cualquier /api/* llega aquí con req.url intacto.
// Vercel invoca module.exports como (req, res) => {}. Express apps son middlewares
// compatibles con (req, res), así que basta con delegar.
const app = require('../src/apiApp');

module.exports = (req, res) => app(req, res);
