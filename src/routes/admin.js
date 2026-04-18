'use strict';

const crypto  = require('crypto');
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const bcrypt  = require('bcryptjs');
const { stmts } = require('../db');
require('dotenv').config();

const router = express.Router();

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Multer storage: UUID-based filename, keep original extension
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb) => {
    const ext    = path.extname(file.originalname);
    const stored = `${crypto.randomUUID()}${ext}`;
    cb(null, stored);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10 GB cap
});

// Middleware: enforce ADMIN_SECRET header
function requireAdmin(req, res, next) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    console.error('[admin] ADMIN_SECRET is not set. Set it in your .env file.');
    return res.status(503).json({ error: 'Server misconfiguration: ADMIN_SECRET not set' });
  }
  if (req.headers['x-admin-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.use(requireAdmin);

// POST /admin/upload
router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const { originalname, filename, path: filePath, size, mimetype } = req.file;

  const info = stmts.insertFile.run({
    original_name: originalname,
    stored_name:   filename,
    file_path:     filePath,
    size,
    mime_type: mimetype || 'application/octet-stream',
  });

  const file = stmts.getFileById.get(info.lastInsertRowid);
  res.status(201).json({ file });
});

// POST /admin/links
router.post('/links', express.json(), (req, res) => {
  const { file_id, password, max_downloads, expires_in_hours } = req.body || {};

  if (!file_id) {
    return res.status(400).json({ error: 'file_id is required' });
  }

  const file = stmts.getFileById.get(file_id);
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  const token         = crypto.randomUUID();
  let   password_hash = null;
  if (password) {
    password_hash = bcrypt.hashSync(password, 10);
  }

  let expires_at = null;
  if (expires_in_hours) {
    const exp = new Date();
    exp.setHours(exp.getHours() + Number(expires_in_hours));
    expires_at = exp.toISOString();
  }

  const info = stmts.insertLink.run({
    file_id,
    token,
    password_hash,
    max_downloads: max_downloads ?? null,
    expires_at,
  });

  const link    = stmts.getLinkById.get(info.lastInsertRowid);
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

  res.status(201).json({
    link,
    download_url: `${baseUrl}/d/${token}`,
    preview_url:  `${baseUrl}/preview/${token}`,
    info_url:     `${baseUrl}/info/${token}`,
  });
});

// GET /admin/files
router.get('/files', (_req, res) => {
  const files = stmts.listFiles.all();
  res.json({ files });
});

// GET /admin/links
router.get('/links', (_req, res) => {
  const links   = stmts.listLinks.all();
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const enriched = links.map((l) => ({
    ...l,
    download_url: `${baseUrl}/d/${l.token}`,
    preview_url:  `${baseUrl}/preview/${l.token}`,
  }));
  res.json({ links: enriched });
});

// DELETE /admin/files/:id
router.delete('/files/:id', (req, res) => {
  const id   = Number(req.params.id);
  const file = stmts.getFileById.get(id);
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Remove from disk (ignore errors if already missing)
  try { fs.unlinkSync(file.file_path); } catch { /* already gone */ }

  stmts.deleteFile.run(id);
  res.json({ message: 'File and associated links deleted' });
});

// DELETE /admin/links/:id
router.delete('/links/:id', (req, res) => {
  const id   = Number(req.params.id);
  const link = stmts.getLinkById.get(id);
  if (!link) {
    return res.status(404).json({ error: 'Link not found' });
  }
  stmts.deleteLink.run(id);
  res.json({ message: 'Link revoked' });
});

module.exports = router;
