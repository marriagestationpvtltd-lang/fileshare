'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const adminRouter    = require('./routes/admin');
const downloadRouter = require('./routes/download');

const app  = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Ensure uploads directory exists
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Trust proxy headers (for accurate IP behind ngrok / reverse proxy)
app.set('trust proxy', 1);

// Rate limiting: admin endpoints
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests, please try again later.' },
});

// Rate limiting: public endpoints
const downloadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests, please try again later.' },
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Admin routes: /admin/*
app.use('/admin', adminLimiter, adminRouter);

// Public download / preview routes
app.use('/', downloadLimiter, downloadRouter);

// 404 fallback
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[error]', err.message);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

// Start server (and optionally open a tunnel)
async function start() {
  app.listen(PORT, () => {
    console.log(`[server] Listening on http://localhost:${PORT}`);
  });

  if (process.env.ENABLE_TUNNEL === 'true') {
    try {
      const { openTunnel } = require('./tunnel');
      await openTunnel(PORT);
    } catch (err) {
      console.error('[tunnel] Failed to open tunnel:', err.message);
    }
  }
}

start();

module.exports = app; // exported for testing
