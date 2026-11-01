import { expect, test } from '@playwright/test';
import { card, closeToasts, gotoStack, noHorizontalOverflow, open, setup } from './helpers';

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

test.describe('通知が操作ボタンに重ならない（v7.2）', () => {
  for (const w of [320, 390, 768, 1024, 1440]) {
    test(`${w}px：通知の位置に、押せるボタン・リンクがない`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: w >= 1024 ? 900 : 760 });
      await open(page);
      await setup(page, ['morning', 'boki', 'reading', 'room', 'note']);
      /** 通知が「バー」の中に収まっている（スマホ）か、本文の操作と重ならない（PC）こと */
      const check = async (label: string) => {
        const toast = page.locator('.toast').last();
        await expect(toast).toBeVisible();
        const t = (await toast.boundingBox())!;
        const bar = page.locator('.bottomnav:visible, .topbar:visible').first();
        if (w < 1024 && (await bar.count())) {
          const b = (await bar.boundingBox())!;
          expect(t.y, `${label}: 通知がバーより上にはみ出す`).toBeGreaterThanOrEqual(b.y - 1);
          expect(t.y + t.height, `${label}: 通知がバーより下にはみ出す`).toBeLessThanOrEqual(b.y + b.height + 1);
          return;
        }
        const hits = await page.evaluate((t) => {
          const out: string[] = [];
          for (const el of document.querySelectorAll<HTMLElement>('button, a[href], [role="radio"], input, select, textarea')) {
            if (el.closest('.toasts') || el.closest('dialog:not([open])')) continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0 || r.bottom <= 0 || r.top >= innerHeight) continue;
            const overlap = !(r.right <= t.x || r.left >= t.x + t.width || r.bottom <= t.y || r.top >= t.y + t.height);
            if (overlap) out.push((el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30));
          }
          return out;
        }, t);
        expect(hits, `${label}: 通知と重なる操作`).toEqual([]);
      };
      // 今日：やった → 通知（取り消すつき）
      await card(page, '読書').getByRole('button', { name: 'やった', exact: true }).click();
      await check('今日（先頭）');
      await closeToasts(page);
      // 下までスクロールした状態でも
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await card(page, 'note更新').getByRole('button', { name: 'やった', exact: true }).click();
      await check('今日（下までスクロール）');
      await closeToasts(page);
      // 記録画面で手入力
      await page.goto('/#records');
      await page.locator('.habit-pick').getByRole('radio', { name: '簿記3級' }).click();
      await page.getByRole('button', { name: '計測しなかった時間を記録する' }).click();
      await page.locator('#rec-date').fill('2026-10-30');
      await page.locator('#rec-min').fill('20');
      await page.locator('#rec-title').fill('講義');
      await page.getByRole('button', { name: '記録する', exact: true }).click();
      await check('記録');
    });
  }
});
