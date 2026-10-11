import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { handleApi, hostAllowed } from './handler';

// Standalone local backend: the API plus the built frontend from dist/.
// Binds to loopback only; it has no authentication of its own.

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const DIST = path.resolve('dist');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

createServer((req, res) => {
  // The app itself is not secret, but answering only to this machine's names
  // keeps a hostile domain pointed here from getting a foothold at all.
  if (!hostAllowed(req.headers.host)) {
    res.statusCode = 403;
    res.end('Host not allowed');
    return;
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    void handleApi(req, res);
    return;
  }
  const requested = path.join(DIST, path.normalize(decodeURIComponent(url.pathname)));
  const inside = requested === DIST || requested.startsWith(DIST + path.sep);
  const file =
    inside && existsSync(requested) && statSync(requested).isFile()
      ? requested
      : path.join(DIST, 'index.html');
  if (!existsSync(file)) {
    res.statusCode = 404;
    res.end('Frontend is not built. Run `npm run build`, or use `npm run dev`.');
    return;
  }
  res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream');
  createReadStream(file).pipe(res);
}).listen(PORT, HOST, () => {
  console.log(`exfolio local backend: http://${HOST}:${PORT}`);
});
