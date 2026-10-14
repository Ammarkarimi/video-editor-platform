/**
 * Downloads the static TrueType files listed in the shared font catalog from Google Fonts.
 * Usage: npm run fonts:download   (files are committed, so this is only needed to refresh them)
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONT_CATALOG } from '../packages/core/src/fonts.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'assets', 'fonts');
// Google Fonts serves full-charset static .ttf files to clients that do not advertise WOFF support.
const USER_AGENT = 'Wget/1.21';

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const force = process.argv.includes('--force');
  for (const fam of FONT_CATALOG) {
    for (const face of fam.faces) {
      const target = path.join(outDir, face.file);
      if (!force && (await exists(target))) continue;
      const ital = face.style === 'italic' ? 1 : 0;
      const query = `${fam.family.replace(/ /g, '+')}:ital,wght@${ital},${face.weight}`;
      const cssUrl = `https://fonts.googleapis.com/css2?family=${query}`;
      const css = await (await fetch(cssUrl, { headers: { 'User-Agent': USER_AGENT } })).text();
      const match = /src:\s*url\(([^)]+)\)\s*format\('truetype'\)/.exec(css);
      if (!match?.[1])
        throw new Error(`No TTF source for ${fam.family} ${face.weight} ${face.style}`);
      const res = await fetch(match[1]);
      if (!res.ok) throw new Error(`Download failed (${res.status}) for ${match[1]}`);
      await writeFile(target, Buffer.from(await res.arrayBuffer()));
      console.log(`downloaded ${face.file}`);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
