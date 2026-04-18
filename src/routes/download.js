'use strict';

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const archiver = require('archiver');
const bcrypt   = require('bcryptjs');
const { stmts } = require('../db');

const router = express.Router();

/**
 * Resolve a share link by token, checking expiry and download limit.
 * Returns { link, file } on success, or sends an error response and returns null.
 */
function resolveLink(token, res) {
  const link = stmts.getLinkByToken.get(token);
  if (!link) {
    res.status(404).json({ error: 'Link not found or has been revoked' });
    return null;
  }

  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    res.status(410).json({ error: 'Link has expired' });
    return null;
  }

  if (link.max_downloads !== null && link.download_count >= link.max_downloads) {
    res.status(410).json({ error: 'Download limit reached' });
    return null;
  }

  const file = stmts.getFileById.get(link.file_id);
  if (!file || !fs.existsSync(file.file_path)) {
    res.status(404).json({ error: 'File no longer available on disk' });
    return null;
  }

  return { link, file };
}

/**
 * Check password if the link is password-protected.
 * Password must be supplied via the x-download-password header.
 */
function checkPassword(link, req, res) {
  if (!link.password_hash) return true;

  const supplied = req.headers['x-download-password'];
  if (!supplied || !bcrypt.compareSync(supplied, link.password_hash)) {
    res
      .status(401)
      .json({ error: 'Invalid or missing password. Supply it via the x-download-password header.' });
    return false;
  }
  return true;
}

/** Extract real client IP, honouring common proxy headers. */
function clientIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

// ─── GET /info/:token ────────────────────────────────────────────────────────
router.get('/info/:token', (req, res) => {
  const link = stmts.getLinkByToken.get(req.params.token);
  if (!link) {
    return res.status(404).json({ error: 'Link not found' });
  }

  const file = stmts.getFileById.get(link.file_id);

  res.json({
    filename:            file ? file.original_name : null,
    size:                file ? file.size          : null,
    mime_type:           file ? file.mime_type      : null,
    password_protected:  !!link.password_hash,
    expires_at:          link.expires_at,
    downloads_used:      link.download_count,
    downloads_remaining: link.max_downloads !== null
      ? link.max_downloads - link.download_count
      : null,
    created_at: link.created_at,
  });
});

// ─── GET /d/:token — download with Range / resume support ────────────────────
router.get('/d/:token', (req, res) => {
  const result = resolveLink(req.params.token, res);
  if (!result) return;

  const { link, file } = result;
  if (!checkPassword(link, req, res)) return;

  const filePath = file.file_path;
  const fileSize = file.size;
  const mimeType = file.mime_type || 'application/octet-stream';
  const filename = file.original_name;

  const rangeHeader = req.headers.range;

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (!match) {
      return res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
    }

    const start = match[1] ? parseInt(match[1], 10) : 0;
    const end   = match[2] ? parseInt(match[2], 10) : fileSize - 1;

    if (start > end || end >= fileSize) {
      return res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
    }

    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range':       `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges':       'bytes',
      'Content-Length':      chunkSize,
      'Content-Type':        mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    });

    const stream = fs.createReadStream(filePath, { start, end });
    stream.pipe(res);

    res.on('finish', () => {
      stmts.incrementDownload.run(link.id);
      stmts.insertLog.run({
        link_id:    link.id,
        ip_address: clientIp(req),
        user_agent: req.headers['user-agent'] || '',
        bytes_served: chunkSize,
      });
    });
  } else {
    res.writeHead(200, {
      'Content-Length':      fileSize,
      'Content-Type':        mimeType,
      'Accept-Ranges':       'bytes',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);

    res.on('finish', () => {
      stmts.incrementDownload.run(link.id);
      stmts.insertLog.run({
        link_id:    link.id,
        ip_address: clientIp(req),
        user_agent: req.headers['user-agent'] || '',
        bytes_served: fileSize,
      });
    });
  }
});

// ─── GET /preview/:token — inline preview (images, PDF, text, JSON) ──────────
router.get('/preview/:token', (req, res) => {
  const result = resolveLink(req.params.token, res);
  if (!result) return;

  const { link, file } = result;
  if (!checkPassword(link, req, res)) return;

  const mimeType = file.mime_type || 'application/octet-stream';
  const isPreviewable =
    mimeType.startsWith('image/') ||
    mimeType === 'application/pdf' ||
    mimeType.startsWith('text/') ||
    mimeType === 'application/json';

  if (!isPreviewable) {
    return res.status(415).json({
      error:     'File type not supported for preview',
      mime_type: mimeType,
    });
  }

  res.setHeader('Content-Type',        mimeType);
  res.setHeader('Content-Length',      file.size);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.original_name)}"`);
  res.setHeader('Accept-Ranges',       'bytes');

  const stream = fs.createReadStream(file.file_path);
  stream.pipe(res);

  res.on('finish', () => {
    stmts.insertLog.run({
      link_id:    link.id,
      ip_address: clientIp(req),
      user_agent: req.headers['user-agent'] || '',
      bytes_served: file.size,
    });
  });
});

// ─── GET /zip/:token — on-the-fly ZIP download ───────────────────────────────
router.get('/zip/:token', (req, res) => {
  const result = resolveLink(req.params.token, res);
  if (!result) return;

  const { link, file } = result;
  if (!checkPassword(link, req, res)) return;

  const zipName = `${path.basename(file.original_name, path.extname(file.original_name))}.zip`;

  res.setHeader('Content-Type',        'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipName)}"`);

  const archive = archiver('zip', { zlib: { level: 6 } });

  archive.on('error', (err) => {
    console.error('[zip] Archive error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to create ZIP' });
    }
  });

  archive.pipe(res);
  archive.file(file.file_path, { name: file.original_name });
  archive.finalize();

  res.on('finish', () => {
    stmts.incrementDownload.run(link.id);
    stmts.insertLog.run({
      link_id:    link.id,
      ip_address: clientIp(req),
      user_agent: req.headers['user-agent'] || '',
      bytes_served: file.size,
    });
  });
});

module.exports = router;
