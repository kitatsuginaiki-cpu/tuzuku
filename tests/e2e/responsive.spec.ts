import { expect, test } from '@playwright/test';
import { card, gotoStack, noHorizontalOverflow, open, setup } from './helpers';

const WIDTHS = [320, 375, 390, 430, 768, 1024, 1440];
const LONG = '問題集の第11章「決算整理仕訳」の練習問題を最後まで解いて、間違えたところを解説で確認する';

test.describe('レスポンシブ（7幅）', () => {
  for (const w of WIDTHS) {
    test(`${w}px：主要画面に横スクロール・欠けがない`, async ({ page }, info) => {
      await page.setViewportSize({ width: w, height: w >= 1024 ? 900 : 760 });
      await open(page);
      await noHorizontalOverflow(page);
      await setup(page, ['morning', 'boki', 'reading', 'room', 'note']);
      // 長いしおりでも折り返す
      await card(page, '簿記3級').getByRole('button', { name: '簿記3級を編集' }).click();
      await page.locator('#habit-nextAction').fill(LONG.slice(0, 80));
      await noHorizontalOverflow(page);
      await page.screenshot({ path: info.outputPath(`habit-${w}.png`), fullPage: true });
      await page.getByRole('button', { name: '保存する' }).click();
      await card(page, '読書').getByRole('button', { name: 'やった', exact: true }).click();
      await noHorizontalOverflow(page);
      await expect(card(page, '簿記3級').getByRole('button', { name: 'しおりから始める' })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`home-${w}.png`), fullPage: true });

      if (w >= 1024) {
        await expect(page.locator('.sidenav')).toBeVisible();
        await expect(page.locator('.bottomnav')).toBeHidden();
      } else {
        await expect(page.locator('.bottomnav')).toBeVisible();
        await expect(page.locator('.sidenav')).toBeHidden();
        // 下部ナビの4つのタブが横に収まる
        const tabs = await page.locator('.bottomnav .tab').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
        expect(Math.max(...tabs)).toBeLessThanOrEqual(w);
      }
      if (w >= 1280) await expect(page.locator('.info')).toBeVisible();

      await gotoStack(page);
      await noHorizontalOverflow(page);
      await page.screenshot({ path: info.outputPath(`stack-${w}.png`), fullPage: true });
      for (const h of ['#friends', '#records', '#options', '#privacy']) {
        await page.goto(`/${h}`);
        await expect(page.locator('.screen')).toBeVisible();
        await noHorizontalOverflow(page);
      }

      await page.goto('/#');
      await card(page, '簿記3級').getByRole('button', { name: 'しおりから始める' }).click();
      await expect(page.locator('.session')).toBeVisible();
      await noHorizontalOverflow(page);
      await page.clock.runFor(20 * 60_000);
      await page.getByRole('button', { name: '終える', exact: true }).click();
      await noHorizontalOverflow(page);
      await page.screenshot({ path: info.outputPath(`finish-${w}.png`), fullPage: true });
    });
  }

  test('タップ領域：主要な操作は 44px 以上', async ({ page }) => {
    await open(page);
    await setup(page, ['boki', 'reading']);
    const els = [
      card(page, '簿記3級').getByRole('button', { name: 'しおりから始める' }),
      card(page, '簿記3級').getByRole('button', { name: 'できない日は' }),
      card(page, '簿記3級').getByRole('button', { name: '簿記3級を編集' }),
      card(page, '読書').getByRole('button', { name: 'やった', exact: true }),
      page.getByRole('button', { name: '設定を開く' }),
      page.locator('.tab').first(),
    ];
    for (const el of els) {
      const b = await el.boundingBox();
      expect(b!.height).toBeGreaterThanOrEqual(44);
      expect(b!.width).toBeGreaterThanOrEqual(44);
    }
    await card(page, '簿記3級').getByRole('button', { name: 'しおりから始める' }).click();
    for (const name of ['一時停止', '中断', '終える', 'ホームに戻る（計測は続きます）']) {
      const b = await page.getByRole('button', { name, exact: true }).boundingBox();
      expect(b!.height, name).toBeGreaterThanOrEqual(44);
    }
  });

  test('文字サイズ200%でも横にはみ出さない', async ({ page }, info) => {
    await open(page);
    await setup(page, ['boki', 'reading']);
    await page.addStyleTag({ content: 'html{font-size:200%!important}' });
    await noHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath('home-text200.png'), fullPage: true });
    await gotoStack(page);
    await page.addStyleTag({ content: 'html{font-size:200%!important}' });
    await noHorizontalOverflow(page);
    await page.goto('/#');
    await card(page, '簿記3級').getByRole('button', { name: 'しおりから始める' }).click();
    await page.addStyleTag({ content: 'html{font-size:200%!important}' });
    await noHorizontalOverflow(page);
    const lines = await page.locator('.timer-clock').evaluate((el) => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).fontSize));
    expect(lines).toBeLessThan(1.5);
    await expect(page.locator('.skip-link')).not.toBeInViewport();
  });

  test('reduced motion を尊重する（キャラクターも動かない）', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    await setup(page, ['boki', 'reading']);
    await card(page, '読書').getByRole('button', { name: 'やった', exact: true }).click();
    const d = await page.locator('.habit-card .btn-primary:visible').first().evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(d.split(',').every((x) => parseFloat(x) < 0.01)).toBe(true);
    const anim = await page.locator('.buddy .chara').evaluate((el) => getComputedStyle(el).animationName);
    expect(anim).toBe('none');
  });
});
