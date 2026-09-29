import { cp, mkdir, readFile, rm } from 'node:fs/promises';

await Promise.all([
  readFile('index.html', 'utf8'),
  readFile('src/style.css', 'utf8'),
  readFile('src/main.js', 'utf8'),
]);
await rm('dist', { recursive: true, force: true });
await mkdir('dist/src', { recursive: true });
await cp('index.html', 'dist/index.html');
await cp('src', 'dist/src', { recursive: true });
console.log('Built static app in dist/');
