'use strict';

// Punto de entrada único para TODAS las rutas /api/* en Vercel.
// vercel.json reescribe /api/* hacia aquí. Vercel preserva req.url
// original al hacer rewrite a una función, de modo que Express ve
// rutas como /api/buscar/estado correctamente.
//
// Vercel invoca module.exports como (req, res) => {}. Las apps Express
// son middlewares compatibles con esa firma.
const app = require('../src/apiApp');

module.exports = (req, res) => app(req, res);
