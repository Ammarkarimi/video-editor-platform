import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { FIXTURES } from './global-setup';

export const fixture = (name: string) => path.join(FIXTURES, name);

export async function createProject(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByTestId('new-project').click();
  await page.getByTestId('project-name-input').fill(name);
  await page.getByTestId('create-project').click();
  await expect(page.getByTestId('project-title')).toHaveText(name);
}

/** Sum of RGB at a point of the preview canvas (fractions of its size). */
export async function previewPixelSum(page: Page, fx = 0.5, fy = 0.5): Promise<number> {
  return page.evaluate(
    ([x, y]) => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-testid="preview-stage"] canvas',
      );
      if (!canvas) return 0;
      const ctx = canvas.getContext('2d');
      if (!ctx) return 0;
      const d = ctx.getImageData(
        Math.floor(canvas.width * x!),
        Math.floor(canvas.height * y!),
        1,
        1,
      ).data;
      return d[0]! + d[1]! + d[2]!;
    },
    [fx, fy],
  );
}

/** Moves keyboard focus out of form fields so editor shortcuts apply. */
export async function blur(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

export async function seekSeconds(page: Page, seconds: number): Promise<void> {
  await blur(page);
  await page.keyboard.press('Home');
  for (let i = 0; i < seconds; i++) await page.keyboard.press('Shift+ArrowRight');
}

export async function uploadAndWait(page: Page, file: string): Promise<void> {
  await page.getByTestId('media-upload-input').setInputFiles(file);
  const card = page.getByTestId('asset-card').filter({ hasText: path.basename(file) });
  await expect(card).toBeVisible();
  await expect(card.getByText('Processing')).toHaveCount(0, { timeout: 90_000 });
}

export function clips(page: Page) {
  return page.getByTestId('timeline-clip');
}
