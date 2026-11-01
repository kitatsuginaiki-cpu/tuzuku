// つづきぼしの一覧画像（成長・表情・色とアクセサリー）を docs/screenshots/character-evolution.png に作る。
// 実行：npx tsx scripts/character-sheet.tsx
import React from 'react';
(globalThis as unknown as { React: typeof React }).React = React;
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright';
import { CharacterFace } from '../src/components/Character';
import { LEVELS, MOOD_LABEL } from '../src/lib/character';

const moods = ['happy', 'focus', 'normal', 'waiting', 'rest', 'worried', 'angry'] as const;
const Sheet = () => (
  <div style={{ fontFamily: 'Noto Sans JP, sans-serif', background: '#f7f5ee', padding: 24, color: '#142b45', width: 1100 }}>
    <h2 style={{ margin: '0 0 8px' }}>つづきぼし：成長（つづけた日で進化）</h2>
    <div style={{ display: 'flex', gap: 8 }}>
      {LEVELS.map((l) => (
        <div key={l.level} style={{ textAlign: 'center', width: 210 }}>
          <CharacterFace mood="happy" level={l.level} size={190} decorative />
          <div style={{ fontWeight: 800 }}>
            Lv.{l.level} {l.name}（{l.days}日〜）
          </div>
          <div style={{ fontSize: 13, color: '#4f5d6a' }}>{l.desc}</div>
        </div>
      ))}
    </div>
    <h2 style={{ margin: '24px 0 8px' }}>表情（Lv.3）</h2>
    <div style={{ display: 'flex', gap: 8 }}>
      {moods.map((m) => (
        <div key={m} style={{ textAlign: 'center', width: 150 }}>
          <CharacterFace mood={m} level={3} size={140} decorative />
          <div style={{ fontWeight: 700 }}>{MOOD_LABEL[m]}</div>
        </div>
      ))}
    </div>
    <h2 style={{ margin: '24px 0 8px' }}>色とアクセサリー</h2>
    <div style={{ display: 'flex', gap: 8 }}>
      <CharacterFace mood="happy" level={4} size={170} decorative />
      <CharacterFace mood="happy" level={4} size={170} color="blue" decorative />
      <CharacterFace mood="happy" level={4} size={170} color="orange" decorative />
      <CharacterFace mood="happy" level={4} size={170} accessory="scarf" decorative />
      <CharacterFace mood="happy" level={4} size={170} accessory="cap" decorative />
    </div>
  </div>
);

const html = '<html><body style="margin:0">' + renderToStaticMarkup(<Sheet />) + '</body></html>';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1148, height: 700 }, deviceScaleFactor: 2 });
await p.setContent(html);
await p.locator('body > div').screenshot({ path: 'docs/screenshots/character-evolution.png' });
await b.close();
console.log('saved docs/screenshots/character-evolution.png');
