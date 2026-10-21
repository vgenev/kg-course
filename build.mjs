import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'src');
const distDir = path.join(root, 'dist');

const template = fs.readFileSync(path.join(src, 'index.template.html'), 'utf8');
const styles = fs.readFileSync(path.join(src, 'styles.css'), 'utf8');
const grader = fs.readFileSync(path.join(src, 'grader.js'), 'utf8');
const app = fs.readFileSync(path.join(src, 'app.js'), 'utf8');
const data = fs.readFileSync(path.join(src, 'data.json'), 'utf8');

const html = template
  .replace('__STYLES__', styles)
  .replace('__GRADER__', grader)
  .replace('__DATA__', data)
  .replace('__APP__', app);

fs.mkdirSync(distDir, { recursive: true });
const outPath = path.join(distDir, 'knowledge-graphs-course.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log('Wrote', outPath, '(' + Buffer.byteLength(html) + ' bytes)');
