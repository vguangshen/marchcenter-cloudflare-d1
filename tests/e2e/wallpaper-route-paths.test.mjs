import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = await readFile(
  resolve(projectRoot, 'src/components/views/settings/WallpaperManager.jsx'),
  'utf8'
);

// WallpaperManager.request already prefixes /api/wallpapers. Keep callers
// relative to that router so production never receives /wallpapers/wallpapers.
assert.match(source, /request\('\'/);
assert.match(source, /request\('\/bing\/sync'/);
assert.match(source, /request\('\/upload'/);
assert.match(source, /request\(`\/\$\{wallpaper\.id\}`/);
assert.doesNotMatch(source, /request\(['`"]\/wallpapers(?:['`"]|\/)/);

console.log('Wallpaper route path tests passed');
