import { expect, test } from '@playwright/test';
import { clips, previewPixelSum, seekSeconds } from './helpers';

test('the demo project opens, renders and plays', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Try a demo project/ }).click();
  await page.waitForURL(/\/projects\//, { timeout: 120_000 });
  await expect(clips(page)).toHaveCount(10);
  await expect(page.getByTestId('transition-chip')).toHaveCount(2);

  await seekSeconds(page, 2);
  await expect.poll(() => previewPixelSum(page, 0.3, 0.3), { timeout: 60_000 }).toBeGreaterThan(60);

  await page.getByTestId('play-toggle').click();
  await page.waitForTimeout(1500);
  await page.getByTestId('play-toggle').click();
  const readout = await page.getByTestId('time-readout').textContent();
  const seconds = Number(readout!.slice(6, 8));
  expect(seconds).toBeGreaterThanOrEqual(3);

  // The project shows up on the dashboard with a rendered thumbnail.
  await page.getByTitle('Back to projects').click();
  const card = page.getByTestId('project-card').filter({ hasText: 'Demo project' }).first();
  await expect(card).toBeVisible();
  const thumbnail = card.locator('img');
  await expect
    .poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
});
