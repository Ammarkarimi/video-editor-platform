import { expect, test } from '@playwright/test';
import {
  blur,
  clips,
  createProject,
  fixture,
  previewPixelSum,
  seekSeconds,
  uploadAndWait,
} from './helpers';

test('create a project, upload media, edit, autosave and export', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await createProject(page, 'E2E project');

  // Upload a video and put it on the timeline.
  await uploadAndWait(page, fixture('bars.mp4'));
  const card = page.getByTestId('asset-card').filter({ hasText: 'bars.mp4' });
  await card.hover();
  await card.getByRole('button', { name: /Add bars\.mp4 to timeline/ }).click();
  await expect(clips(page)).toHaveCount(1);

  // The preview draws real video frames once the browser-ready proxy exists.
  await expect.poll(() => previewPixelSum(page), { timeout: 90_000 }).toBeGreaterThan(60);

  // Add a styled title and change its text from the inspector.
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByTestId('text-preset-title').click();
  await expect(clips(page)).toHaveCount(2);
  await page.getByLabel('Text content').fill('Hello E2E');
  await expect(clips(page).filter({ hasText: 'Hello E2E' })).toHaveCount(1);

  // Split the video at 2s, then undo and redo the split.
  await clips(page).filter({ hasText: 'bars.mp4' }).click();
  await seekSeconds(page, 2);
  await expect(page.getByTestId('time-readout')).toContainText('00:00:02:00');
  await page.keyboard.press('s');
  await expect(clips(page)).toHaveCount(3);
  await page.keyboard.press('Control+z');
  await expect(clips(page)).toHaveCount(2);
  await page.keyboard.press('Control+Shift+z');
  await expect(clips(page)).toHaveCount(3);

  // Edits are saved automatically and survive a reload.
  await expect(page.getByTestId('save-state')).toHaveText(/Saved/, { timeout: 20_000 });
  await page.reload();
  await expect(clips(page)).toHaveCount(3);
  await expect(clips(page).filter({ hasText: 'Hello E2E' })).toHaveCount(1);

  // Export a small MP4 and download it.
  await blur(page);
  await page.getByTestId('open-export').click();
  await page.getByLabel('Resolution').selectOption('360');
  await page.getByRole('button', { name: 'Smaller' }).click();
  await page.getByTestId('start-export').click();
  const item = page.getByTestId('render-item').first();
  await expect(item).toHaveAttribute('data-status', 'completed', { timeout: 150_000 });
  const href = await item.getByTestId('download-render').getAttribute('href');
  expect(href).toBeTruthy();
  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('video/mp4');
  expect((await response.body()).length).toBeGreaterThan(10_000);

  expect(errors).toEqual([]);
});
