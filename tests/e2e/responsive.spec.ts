import { expect, test } from '@playwright/test';
import { noHorizontalOverflow, open } from './helpers';

const WIDTHS = [320, 375, 390, 430, 768, 1024, 1440];
const LONG = '問題集の第11章「決算整理仕訳」の練習問題を最後まで解いて、間違えたところを解説で確認する';

test.describe('レスポンシブ（7幅）', () => {

  for (const w of WIDTHS) {
    test(`${w}px：主要画面に横スクロール・欠けがない`, async ({ page }, info) => {
      await page.setViewportSize({ width: w, height: w >= 1024 ? 900 : 760 });
      await open(page);
      // 長い学習タイトルでも折り返す
      await page.locator('.next-body').click();
      await page.locator('#edit-text').fill(LONG.slice(0, 80));
      await page.getByRole('button', { name: '保存する' }).click();
      await noHorizontalOverflow(page);
      await expect(page.getByRole('button', { name: '学習を始める' })).toBeInViewport();
      await page.screenshot({ path: info.outputPath(`home-${w}.png`), fullPage: true });

      // ナビゲーション：1024px 以上は左ナビ、未満は下部ナビ
      if (w >= 1024) {
        await expect(page.locator('.sidenav')).toBeVisible();
        await expect(page.locator('.bottomnav')).toBeHidden();
      } else {
        await expect(page.locator('.bottomnav')).toBeVisible();
        await expect(page.locator('.sidenav')).toBeHidden();
      }
      // 右の補助情報は 1024px 以上のみ
      if (w >= 1280) await expect(page.locator('.info')).toBeVisible();

      await page.goto('/#records');
      await expect(page.locator('.records')).toBeVisible();
      await noHorizontalOverflow(page);
      await page.screenshot({ path: info.outputPath(`records-${w}.png`), fullPage: true });

      await page.goto('/#options');
      await noHorizontalOverflow(page);

      await page.goto('/#');
      await page.getByRole('button', { name: '学習を始める' }).click();
      await expect(page.locator('.session')).toBeVisible();
      await noHorizontalOverflow(page);
      await expect(page.getByRole('button', { name: '学習を終える' })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`timer-${w}.png`), fullPage: true });

      await page.clock.runFor(20 * 60_000);
      await page.getByRole('button', { name: '学習を終える' }).click();
      await noHorizontalOverflow(page);
      await page.screenshot({ path: info.outputPath(`finish-${w}.png`), fullPage: true });
    });
  }

  test('タップ領域：主要な操作は 44px 以上', async ({ page }) => {
    await open(page);
    const targets = ['学習を始める', '2分だけ始める', '設定を開く'];
    for (const name of targets) {
      const b = await page.getByRole('button', { name }).boundingBox();
      expect(b!.height, name).toBeGreaterThanOrEqual(44);
      expect(b!.width, name).toBeGreaterThanOrEqual(44);
    }
    const tab = await page.locator('.tab').first().boundingBox();
    expect(tab!.height).toBeGreaterThanOrEqual(44);
    await page.getByRole('button', { name: '学習を始める' }).click();
    for (const name of ['一時停止', '中断', '学習を終える', 'ホームに戻る（計測は続きます）']) {
      const b = await page.getByRole('button', { name }).boundingBox();
      expect(b!.height, name).toBeGreaterThanOrEqual(44);
    }
  });

  test('文字サイズ200%でも横にはみ出さない', async ({ page }, info) => {
    await open(page);
    await page.addStyleTag({ content: 'html{font-size:200%!important}' });
    await noHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath('home-text200.png'), fullPage: true });
    await page.getByRole('button', { name: '学習を始める' }).click();
    await page.addStyleTag({ content: 'html{font-size:200%!important}' });
    await noHorizontalOverflow(page);
    await expect(page.getByRole('button', { name: '学習を終える' })).toBeVisible();
    // タイマーの数字が2行に折り返さない
    const lines = await page.locator('.timer-clock').evaluate((el) => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).fontSize));
    expect(lines).toBeLessThan(1.5);
    // 非表示のスキップリンクが画面に出ていない
    await expect(page.locator('.skip-link')).not.toBeInViewport();
    await page.screenshot({ path: info.outputPath('timer-text200.png'), fullPage: true });
  });

  test('reduced motion を尊重する', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    const d = await page.locator('.btn-primary').first().evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(d.split(',').every((x) => parseFloat(x) < 0.01)).toBe(true);
  });
});
