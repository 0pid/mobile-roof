import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const root = process.argv[2] ?? '.';
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const server = createServer((request, response) => {
  const safePath = normalize(decodeURIComponent(request.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, safePath === '/' ? 'index.html' : safePath);
  if (!existsSync(file)) file = join(root, 'index.html');
  response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
  createReadStream(file).pipe(response);
});
server.listen(4173, '0.0.0.0', () => console.log('Roofline running at http://localhost:4173'));
