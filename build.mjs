import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'src');
const distDir = path.join(root, 'dist');

const template = fs.readFileSync(path.join(src, 'index.template.html'), 'utf8');

// papercss ships an @import of Google Fonts. The artifact must be fully offline,
// so the import is stripped here and the app supplies a local font stack.
const paperPath = path.join(root, 'node_modules', 'papercss', 'dist', 'paper.css');
const paper = fs
  .readFileSync(paperPath, 'utf8')
  .replace(/@import\s+url\(["']?https?:\/\/[^)]*\)\s*;?/g, '');
if (/@import\s+url\(\s*["']?https?:/i.test(paper)) {
  throw new Error('papercss still contains a remote @import after stripping');
}

// Handwriting faces are embedded, not linked: the artifact must render the same
// on a Linux box with no browser handwriting fonts installed. Both are OFL 1.1.
const fontFiles = [
  ['Neucha', 'neucha.woff2'],
  ['Patrick Hand SC', 'patrick-hand-sc.woff2'],
];
const fonts = fontFiles
  .map(([family, file]) => {
    const b64 = fs
      .readFileSync(path.join(root, 'assets', 'fonts', file))
      .toString('base64');
    return `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${b64}) format('woff2');font-weight:400;font-style:normal;font-display:block;}`;
  })
  .join('\n');

const styles = fs.readFileSync(path.join(src, 'styles.css'), 'utf8');
const grader = fs.readFileSync(path.join(src, 'grader.js'), 'utf8');
const scratchpad = fs.readFileSync(path.join(src, 'scratchpad.js'), 'utf8');
const app = fs.readFileSync(path.join(src, 'app.js'), 'utf8');
const data = fs.readFileSync(path.join(src, 'data.json'), 'utf8');

// Replacer functions, not strings: any "$&" inside CSS or content would otherwise
// be interpreted as a replacement pattern and silently corrupt the build.
const html = template
  .replace('__FONTS__', () => fonts)
  .replace('__PAPER__', () => paper)
  .replace('__STYLES__', () => styles)
  .replace('__GRADER__', () => grader)
  .replace('__DATA__', () => data)
  .replace('__SCRATCHPAD__', () => scratchpad)
  .replace('__APP__', () => app);

fs.mkdirSync(distDir, { recursive: true });
const outPath = path.join(distDir, 'knowledge-graphs-course.html');
fs.writeFileSync(outPath, html, 'utf8');
const rootIndex = path.join(root, 'index.html');
fs.writeFileSync(rootIndex, html, 'utf8');
console.log('Wrote', outPath, '(' + Buffer.byteLength(html) + ' bytes)');
console.log('Wrote', rootIndex, '(identical)');