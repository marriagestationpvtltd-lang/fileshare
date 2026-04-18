# FileShare — Local Laptop File Delivery System

A self-hosted, token-based file delivery system built with Node.js + Express + SQLite. Share files via secure, expiring links with optional password protection, download limits, and resume support.

---

## Quick Start

```bash
cp .env.example .env
# Edit .env — set ADMIN_SECRET at minimum
npm install
npm start
```

The server starts on `http://localhost:3000` by default.

---

## Configuration (`.env`)

| Variable           | Default                  | Description                                                 |
|--------------------|--------------------------|-------------------------------------------------------------|
| `PORT`             | `3000`                   | HTTP port                                                   |
| `ADMIN_SECRET`     | `change-me-…`            | Header value required for all admin API calls               |
| `UPLOAD_DIR`       | `./uploads`              | Directory where uploaded files are stored                   |
| `DB_PATH`          | `./data/fileshare.db`    | SQLite database path                                        |
| `BASE_URL`         | `http://localhost:3000`  | Public base URL (used in generated link URLs)               |
| `ENABLE_TUNNEL`    | _(unset)_                | Set to `true` to open an ngrok tunnel on startup            |
| `NGROK_AUTHTOKEN`  | _(unset)_                | Your ngrok auth token (required when `ENABLE_TUNNEL=true`)  |
| `TUNNEL_SUBDOMAIN` | _(unset)_                | Custom ngrok domain (requires paid ngrok plan)              |

---

## Admin API

All admin endpoints require the header:

```
x-admin-secret: <your ADMIN_SECRET>
```

### Upload a File

```bash
curl -X POST http://localhost:3000/admin/upload \
  -H "x-admin-secret: change-me-to-a-strong-secret" \
  -F "file=@/path/to/your/file.pdf"
```

**Response:**
```json
{
  "file": {
    "id": 1,
    "original_name": "file.pdf",
    "stored_name": "uuid.pdf",
    "file_path": "/abs/path/uploads/uuid.pdf",
    "size": 204800,
    "mime_type": "application/pdf",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

---

### Create a Share Link

```bash
curl -X POST http://localhost:3000/admin/links \
  -H "x-admin-secret: change-me-to-a-strong-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "file_id": 1,
    "password": "secret123",
    "max_downloads": 5,
    "expires_in_hours": 24
  }'
```

All fields except `file_id` are optional.

**Response:**
```json
{
  "link": { "...": "..." },
  "download_url": "http://localhost:3000/d/<token>",
  "preview_url":  "http://localhost:3000/preview/<token>",
  "info_url":     "http://localhost:3000/info/<token>"
}
```

---

### List Files

```bash
curl http://localhost:3000/admin/files \
  -H "x-admin-secret: change-me-to-a-strong-secret"
```

### List Share Links (with stats)

```bash
curl http://localhost:3000/admin/links \
  -H "x-admin-secret: change-me-to-a-strong-secret"
```

### Delete a File (and all its links)

```bash
curl -X DELETE http://localhost:3000/admin/files/1 \
  -H "x-admin-secret: change-me-to-a-strong-secret"
```

### Revoke a Share Link

```bash
curl -X DELETE http://localhost:3000/admin/links/1 \
  -H "x-admin-secret: change-me-to-a-strong-secret"
```

---

## Public Endpoints

No authentication needed — unless a link is password-protected.

### Download a File

```
GET /d/:token
```

- Supports `Range` header for **resumable downloads** (`206 Partial Content`).
- For password-protected links supply the password via header (not query string):

```
x-download-password: secret123
```

### Preview a File (inline)

```
GET /preview/:token
```

Serves the file inline for supported MIME types: `image/*`, `application/pdf`, `text/*`, `application/json`.

### Download as ZIP

```
GET /zip/:token
```

Wraps the file in a ZIP archive on-the-fly before streaming.

### Link Info (JSON)

```
GET /info/:token
```

Returns metadata without incrementing the download counter:

```json
{
  "filename": "report.pdf",
  "size": 204800,
  "mime_type": "application/pdf",
  "password_protected": true,
  "expires_at": "2024-01-02T00:00:00.000Z",
  "downloads_used": 2,
  "downloads_remaining": 3,
  "created_at": "2024-01-01T00:00:00.000Z"
}
```

---

## Tunnel (Public Access via ngrok)

Add to `.env`:

```env
ENABLE_TUNNEL=true
NGROK_AUTHTOKEN=your_ngrok_authtoken_here
BASE_URL=https://<auto-assigned>.ngrok-free.app

# Optional: custom domain (requires paid ngrok plan)
TUNNEL_SUBDOMAIN=my-fileshare.ngrok.io
```

Start normally — the public URL is printed to the console on startup.

---

## Project Structure

```
fileshare/
├── src/
│   ├── db.js              # SQLite setup & prepared statements
│   ├── server.js          # Express entry point
│   ├── tunnel.js          # @ngrok/ngrok integration (opt-in)
│   └── routes/
│       ├── admin.js       # Admin API (upload, create link, list, delete)
│       └── download.js    # Public routes (download, preview, zip, info)
├── uploads/               # Uploaded files (git-ignored)
├── data/                  # SQLite database (git-ignored)
├── .env.example
├── package.json
└── README.md
```

---

## Database Schema

```sql
-- Uploaded files
files (id, original_name, stored_name, file_path, size, mime_type, created_at)

-- Share links
share_links (id, file_id, token, password_hash, max_downloads, download_count, expires_at, created_at)

-- Download audit log
download_logs (id, link_id, ip_address, user_agent, downloaded_at, bytes_served)
```
