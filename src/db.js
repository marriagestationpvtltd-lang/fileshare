'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './data/fileshare.db';
const dbDir = path.dirname(path.resolve(DB_PATH));

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(path.resolve(DB_PATH));

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    original_name TEXT    NOT NULL,
    stored_name   TEXT    NOT NULL,
    file_path     TEXT    NOT NULL,
    size          INTEGER NOT NULL,
    mime_type     TEXT    NOT NULL DEFAULT 'application/octet-stream',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS share_links (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id        INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    token          TEXT    NOT NULL UNIQUE,
    password_hash  TEXT,
    max_downloads  INTEGER,
    download_count INTEGER NOT NULL DEFAULT 0,
    expires_at     TEXT,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_share_links_token ON share_links(token);

  CREATE TABLE IF NOT EXISTS download_logs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id       INTEGER NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
    ip_address    TEXT    NOT NULL,
    user_agent    TEXT,
    downloaded_at TEXT    NOT NULL DEFAULT (datetime('now')),
    bytes_served  INTEGER NOT NULL DEFAULT 0
  );
`);

// Prepared statements
const stmts = {
  // files
  insertFile: db.prepare(
    `INSERT INTO files (original_name, stored_name, file_path, size, mime_type)
     VALUES (@original_name, @stored_name, @file_path, @size, @mime_type)`
  ),
  getFileById: db.prepare(`SELECT * FROM files WHERE id = ?`),
  listFiles:   db.prepare(`SELECT * FROM files ORDER BY created_at DESC`),
  deleteFile:  db.prepare(`DELETE FROM files WHERE id = ?`),

  // share_links
  insertLink: db.prepare(
    `INSERT INTO share_links (file_id, token, password_hash, max_downloads, expires_at)
     VALUES (@file_id, @token, @password_hash, @max_downloads, @expires_at)`
  ),
  getLinkByToken:    db.prepare(`SELECT * FROM share_links WHERE token = ?`),
  getLinkById:       db.prepare(`SELECT * FROM share_links WHERE id = ?`),
  incrementDownload: db.prepare(
    `UPDATE share_links SET download_count = download_count + 1 WHERE id = ?`
  ),
  listLinks: db.prepare(
    `SELECT sl.*, f.original_name, f.size, f.mime_type
     FROM share_links sl JOIN files f ON f.id = sl.file_id
     ORDER BY sl.created_at DESC`
  ),
  deleteLink: db.prepare(`DELETE FROM share_links WHERE id = ?`),

  // download_logs
  insertLog: db.prepare(
    `INSERT INTO download_logs (link_id, ip_address, user_agent, bytes_served)
     VALUES (@link_id, @ip_address, @user_agent, @bytes_served)`
  ),
};

module.exports = { db, stmts };
