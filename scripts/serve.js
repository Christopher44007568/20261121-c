import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

const root = resolve(process.cwd());
const port = Number(process.env.PORT || 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');
  const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const filename = resolve(root, `.${relative}`);
  if (filename !== root && !filename.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end('forbidden');
    return;
  }
  try {
    const stat = statSync(filename);
    if (!stat.isFile()) throw new Error('not a file');
    response.writeHead(200, {
      'content-type': types[extname(filename)] || 'application/octet-stream',
      'cache-control': 'no-store',
      'content-length': stat.size,
    });
    createReadStream(filename).pipe(response);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`terra-local viewer: http://127.0.0.1:${port}`);
});
