/**
 * `app://bundle/...` — serves the built scene (dist/) straight from disk: no localhost server, no network.
 *
 * The scheme is registered as standard + secure (so ES modules, fetch, WebAudio, workers, localStorage and
 * WebGL texture uploads behave as on https), with stream support and HTTP range requests (206) for large
 * files / audio / video, correct MIME types, path-traversal protection and a strict CSP for HTML documents.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

export const SCHEME = 'app';
export const HOST = 'bundle';
export const ORIGIN = `${SCHEME}://${HOST}`;

export const PRIVILEGES = { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true };

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.xml': 'application/xml',
  '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.bmp': 'image/bmp', '.hdr': 'image/vnd.radiance', '.exr': 'image/x-exr',
  '.ktx': 'image/ktx', '.ktx2': 'image/ktx2', '.basis': 'application/octet-stream', '.dds': 'image/vnd.ms-dds',
  '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.drc': 'application/octet-stream',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.weba': 'audio/webm',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

export function mimeType(file) { return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'; }

// Everything comes from the bundle itself; blob:/data: for generated textures, audio and workers.
// 'wasm-unsafe-eval' keeps WebAssembly decoders (Draco, Basis/KTX2) usable; no network origins at all.
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const SMALL_FILE = 4 * 1024 * 1024;   // read whole files below this size, stream larger ones

function textResponse(status, text, extra = {}) {
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...extra } });
}

/** Parses a single `bytes=` range against `size`; returns {start, end} (inclusive), null (no range) or 'invalid'. */
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';   // multi-range requests are not supported
  let start, end;
  if (m[1] === '') { const n = parseInt(m[2], 10); if (!n) return 'invalid'; start = Math.max(0, size - n); end = size - 1; }
  else { start = parseInt(m[1], 10); end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1); }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}

/** Creates the protocol.handle() handler that serves files below `root`. */
export function createHandler(root, { log = () => {} } = {}) {
  const base = path.resolve(root);
  return async (request) => {
    let url;
    try { url = new URL(request.url); } catch (_) { return textResponse(400, 'bad url'); }
    if (url.host !== HOST) return textResponse(404, 'unknown host');
    if (request.method !== 'GET' && request.method !== 'HEAD') return textResponse(405, 'method not allowed', { Allow: 'GET, HEAD' });
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch (_) { return textResponse(400, 'bad path'); }
    if (rel.includes('\0')) return textResponse(400, 'bad path');
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(base, '.' + path.posix.normalize('/' + rel));
    if (file !== base && !file.startsWith(base + path.sep)) return textResponse(403, 'forbidden');
    let st;
    try { st = await fs.promises.stat(file); } catch (_) { log(`404 ${url.pathname}`); return textResponse(404, 'not found'); }
    if (!st.isFile()) return textResponse(404, 'not found');

    const type = mimeType(file);
    const headers = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
      'Last-Modified': st.mtime.toUTCString(),
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
    };
    if (type.startsWith('text/html')) headers['Content-Security-Policy'] = CSP;

    const range = parseRange(request.headers.get('range'), st.size);
    if (range === 'invalid') return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${st.size}` } });
    const start = range ? range.start : 0;
    const end = range ? range.end : st.size - 1;
    const length = st.size === 0 ? 0 : end - start + 1;
    headers['Content-Length'] = String(length);
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    const status = range ? 206 : 200;
    if (request.method === 'HEAD' || length === 0) return new Response(null, { status, headers });

    if (length <= SMALL_FILE) {
      const fh = await fs.promises.open(file, 'r');
      try {
        const buf = Buffer.allocUnsafe(length);
        let off = 0;
        while (off < length) { const { bytesRead } = await fh.read(buf, off, length - off, start + off); if (!bytesRead) break; off += bytesRead; }
        return new Response(off === length ? buf : buf.subarray(0, off), { status, headers });
      } finally { await fh.close(); }
    }
    const stream = fs.createReadStream(file, { start, end, highWaterMark: 1024 * 1024 });
    return new Response(Readable.toWeb(stream), { status, headers });
  };
}
