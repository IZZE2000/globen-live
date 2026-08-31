/**
 * Globen Live — lokal server.
 *
 * Anledningen till att det här behöver vara en server och inte en HTML-fil man
 * dubbelklickar på: arenornas sajter skickar inga CORS-headers, så en sida som körs
 * från file:// aldrig får läsa deras svar. Hämtningen måste ske serverside.
 *
 * Servern gör tre saker: hämtar och cachar evenemang, serverar det statiska
 * gränssnittet, och delar ut modulerna i src/ till webbläsaren så att statuslogiken
 * finns i exakt en implementation.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectEvents } from './src/aggregate.js';
import { createCache } from './src/cache.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const CACHE_TTL_MS = 10 * 60_000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const cache = createCache(() => collectEvents(), { ttlMs: CACHE_TTL_MS });

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  response.end(payload);
}

/**
 * Löser en URL till en fil under ROOT och vägrar allt som pekar utanför.
 * Servern är avsedd för localhost, men en sökvägsgenomgång är billig att stänga.
 */
function resolveStaticPath(urlPath) {
  const relative = urlPath === '/' ? 'public/index.html' : urlPath.replace(/^\/+/, '');
  const candidate = normalize(join(ROOT, relative));

  if (!candidate.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) return null;

  // Bara gränssnittet och delade moduler är åtkomliga utifrån.
  const allowed = ['public' + sep, 'src' + sep];
  const suffix = candidate.slice(ROOT.length);
  if (!allowed.some((prefix) => suffix.startsWith(prefix))) return null;

  return candidate;
}

async function serveStatic(urlPath, response) {
  const filePath = resolveStaticPath(urlPath);

  if (!filePath) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Hittades inte');
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Hittades inte');
  }
}

const server = createServer(async (request, response) => {
  const { pathname } = new URL(request.url, `http://${request.headers.host}`);

  if (pathname === '/api/events') {
    try {
      sendJson(response, 200, { ...(await cache.get()), now: Date.now() });
    } catch (error) {
      // Alla källor nere och inget i cachen. Säg det rakt ut i stället för
      // att svara med en tom lista som ser ut som en lugn kväll.
      sendJson(response, 503, {
        error: 'Kunde inte hämta evenemang från någon källa',
        detail: error.message,
      });
    }
    return;
  }

  await serveStatic(pathname, response);
});

server.listen(PORT, () => {
  console.log(`Globen Live körs på http://localhost:${PORT}`);
  console.log('Hämtar Avicii Arena, 3Arena och Slakthusområdet. Avsluta med Ctrl+C.');
});
