import { expect, test } from '@playwright/test';
import { blur, clips, createProject, seekSeconds } from './helpers';

test.beforeEach(async ({ page }) => {
  await createProject(page, `Timeline ${Date.now()}`);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
});

test('drag, trim, transition and delete clips', async ({ page }) => {
  // Two text clips back to back on the same track.
  await page.getByRole('button', { name: /Add plain text/ }).click();
  await expect(clips(page)).toHaveCount(1);
  await seekSeconds(page, 5);
  await page.getByRole('button', { name: /Add plain text/ }).click();
  await expect(clips(page)).toHaveCount(2);
  const [first, second] = [clips(page).nth(0), clips(page).nth(1)];
  const firstBox = (await first.boundingBox())!;
  const secondBox = (await second.boundingBox())!;
  expect(Math.abs(secondBox.y - firstBox.y)).toBeLessThan(2); // same track
  expect(Math.abs(secondBox.x - (firstBox.x + firstBox.width))).toBeLessThan(3); // touching

  // Add a transition on the cut between them.
  await page.mouse.move(secondBox.x + 10, secondBox.y + secondBox.height / 2);
  await page.getByRole('button', { name: 'Add transition' }).first().click();
  await expect(page.getByTestId('transition-chip')).toHaveCount(1);
  await expect(page.getByTestId('inspector')).toContainText('Cross dissolve');

  // Trim the second clip's end by dragging its right edge to the left.
  await second.click();
  const before = (await second.boundingBox())!;
  await page.mouse.move(before.x + before.width - 3, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width - 120, before.y + before.height / 2, { steps: 6 });
  await page.mouse.up();
  const trimmed = (await second.boundingBox())!;
  expect(trimmed.width).toBeLessThan(before.width - 60);

  // Drag the second clip away (grabbing its middle, clear of the transition overlay on the cut);
  // the transition disappears because the clips no longer touch.
  const grabX = trimmed.x + trimmed.width * 0.75;
  await page.mouse.move(grabX, trimmed.y + trimmed.height / 2);
  await page.mouse.down();
  await page.mouse.move(grabX + 200, trimmed.y + trimmed.height / 2, { steps: 8 });
  await page.mouse.up();
  const moved = (await second.boundingBox())!;
  expect(moved.x).toBeGreaterThan(trimmed.x + 150);
  await expect(page.getByTestId('transition-chip')).toHaveCount(0);

  // Delete with the keyboard.
  await blur(page);
  await page.keyboard.press('Delete');
  await expect(clips(page)).toHaveCount(1);
});

test('edit text on the canvas and animate with keyframes', async ({ page }) => {
  await page.getByTestId('text-preset-title').click();
  await expect(clips(page)).toHaveCount(1);
  const stage = page.getByTestId('preview-stage');
  await expect(page.getByTestId('transform-box')).toBeVisible();

  // Drag the title on the preview: its X position changes.
  const xField = page.getByTestId('prop-x');
  const box = (await stage.boundingBox())!;
  await seekSeconds(page, 1);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(xField).not.toHaveValue('0');

  // Animate opacity with two keyframes.
  await page.getByTestId('keyframe-opacity').click();
  await seekSeconds(page, 3);
  await page.getByTestId('keyframe-opacity').click();
  await expect(page.getByText(/Keyframes \(2\)/)).toBeVisible();
});
