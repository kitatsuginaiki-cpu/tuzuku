/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

/**
 * ビルド後に dist/ の全ファイルを列挙し、プリキャッシュ一覧とバージョンを埋め込んだ sw.js を生成する。
 * （workbox 等の依存を増やさないための最小実装）
 */
function serviceWorkerPlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'tsuzuku-sw',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const p = join(dir, name);
          if (statSync(p).isDirectory()) walk(p);
          else files.push(relative(outDir, p).split('\\').join('/'));
        }
      };
      walk(outDir);
      // キャラクター素材（35枚・約9MB）は、既定のつづきぼし7枚だけを先にキャッシュする。
      // ほかのキャラクターは、選んで表示したときにキャッシュされる（以後はオフラインでも表示できる）。
      const precache = files.filter(
        (f) =>
          f !== 'sw.js' &&
          !f.endsWith('.map') &&
          f !== '_headers' &&
          f !== 'assets/characters/manifest.json' &&
          (!f.startsWith('assets/characters/') || f.startsWith('assets/characters/tsuzukiboshi__')),
      );
      const hash = createHash('sha256');
      for (const f of precache.sort()) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 12);
      const template = readFileSync('src/sw-template.js', 'utf8');
      const urls = ['./', ...precache.map((f) => `./${f}`)];
      const sw = template.replaceAll('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(urls, null, 2));
      writeFileSync(join(outDir, 'sw.js'), sw);
    },
  };
}

/** 設定画面に出すバージョン：package.json の version ＋ commit（実機テストで、どの版か確かめるため） */
function appVersion() {
  const v = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
  let sha = (process.env.GITHUB_SHA ?? '').slice(0, 7);
  if (!sha) {
    try {
      sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      sha = '';
    }
  }
  return sha ? `${v} (${sha})` : v;
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  // 相対パスにして GitHub Pages 等のサブパス配信でも動くようにする
  base: './',
  plugins: [react(), serviceWorkerPlugin()],
  build: { target: 'es2020', sourcemap: false },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
