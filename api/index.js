'use strict';

// Punto de entrada único para TODAS las rutas /api/* en Vercel.
// El rewrite en vercel.json envía cualquier /api/<algo> a este archivo
// PRESERVANDO req.url original (Vercel no reescribe el path cuando el
// destination es una Serverless Function), de modo que Express ve las
// rutas correctas (/api/status, /api/buscar/estado, etc.).
//
// Vercel invoca module.exports como (req, res) => {}. Express es
// compatible con esa firma, así que basta con delegar.
const app = require('../src/apiApp');

module.exports = (req, res) => app(req, res);
