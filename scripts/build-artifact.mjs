// dist/ を Claude の Artifact として公開できる形（artifact/）に変換する。
// Artifact はページを自前の <html><head><body> で包むため、骨格タグを外し、必要な要素だけ残す。
// Artifact 上では Service Worker（オフライン起動）とファイルのダウンロードは使えない。
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const keep = head
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => /^<title>|^<meta name="description"|^<meta name="theme-color"|^<script type="module"|^<link rel="stylesheet"|^<link rel="icon" href=".\/icons\/icon.svg"/.test(l));
const out = [...keep, body.trim().replace(/<noscript>[\s\S]*?<\/noscript>/, '')].join('\n') + '\n';

rmSync('artifact', { recursive: true, force: true });
mkdirSync('artifact', { recursive: true });
writeFileSync('artifact/index.html', out);
cpSync('dist/assets', 'artifact/assets', { recursive: true });
mkdirSync('artifact/icons', { recursive: true });
cpSync('dist/icons/icon.svg', 'artifact/icons/icon.svg');
console.log(out);
