#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Perf pass (U13 / R8): downscale already-processed WebP assets in place to
 * display size so the app stops shipping and decoding 2-4x oversized images.
 *
 * The original high-res PNG sources for stamps/country-images are no longer in
 * the repo (only 4 legacy stamp PNGs remain and they are unreferenced), so this
 * script downscales the existing `processed/*.webp` files IN PLACE:
 *
 *   - stamps/processed:         1024x1024  ->  512x512   (square, exact)
 *   - country-images/processed: <=1350 wide -> <=800 long edge (aspect kept)
 *
 * Filenames are unchanged, so src/assets/stampImages.ts and
 * src/assets/countryImages.ts (which require() by filename) need no edits.
 *
 * WebP quality is kept at 80 to match the original processing scripts.
 *
 * Usage:
 *   node scripts/resize-assets.js           # resize both stamps + country images
 *   node scripts/resize-assets.js stamps    # stamps only
 *   node scripts/resize-assets.js country   # country images only
 *
 * Re-runnable: safe to run multiple times. `withoutEnlargement` prevents
 * upscaling, and re-running on already-512/800 files is a no-op resize
 * (it re-encodes, but dimensions do not change).
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const WEBP_QUALITY = 80;

const STAMPS_DIR = path.join(__dirname, '../assets/stamps/processed');
const COUNTRY_DIR = path.join(__dirname, '../assets/country-images/processed');

const STAMP_SIZE = 512; // down from 1024x1024
const COUNTRY_MAX_EDGE = 800; // down from 1350 wide

async function resizeDir(dir, resizeFn, label) {
  if (!fs.existsSync(dir)) {
    console.log(`⚠️  ${label}: directory not found: ${dir}`);
    return;
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.webp'));
  console.log(`\n🖼️  ${label}: ${files.length} .webp files in ${dir}`);

  let totalIn = 0;
  let totalOut = 0;
  let count = 0;
  const errors = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    const tmpPath = path.join(dir, `.tmp-${file}`);
    try {
      const inStats = fs.statSync(filePath);
      totalIn += inStats.size;

      await resizeFn(sharp(filePath)).webp({ quality: WEBP_QUALITY }).toFile(tmpPath);

      // Atomic-ish replace: write to temp, then rename over original.
      fs.renameSync(tmpPath, filePath);

      const outStats = fs.statSync(filePath);
      totalOut += outStats.size;
      count += 1;
    } catch (err) {
      errors.push({ file, error: err.message });
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  }

  const inMB = (totalIn / (1024 * 1024)).toFixed(2);
  const outMB = (totalOut / (1024 * 1024)).toFixed(2);
  const pct = totalIn > 0 ? ((1 - totalOut / totalIn) * 100).toFixed(1) : '0';
  console.log(`   ✅ resized ${count}/${files.length} (${inMB}MB → ${outMB}MB, -${pct}%)`);
  if (errors.length) {
    console.log(`   ❌ ${errors.length} errors:`);
    errors.forEach(({ file, error }) => console.log(`      - ${file}: ${error}`));
  }
}

async function main() {
  const arg = (process.argv[2] || 'all').toLowerCase();
  console.log('🔧 Asset resize (perf pass U13)');
  console.log('================================');

  if (arg === 'all' || arg === 'stamps') {
    await resizeDir(
      STAMPS_DIR,
      (img) => img.resize(STAMP_SIZE, STAMP_SIZE, { fit: 'cover', withoutEnlargement: true }),
      `stamps → ${STAMP_SIZE}x${STAMP_SIZE}`
    );
  }

  if (arg === 'all' || arg === 'country') {
    await resizeDir(
      COUNTRY_DIR,
      (img) =>
        img.resize(COUNTRY_MAX_EDGE, COUNTRY_MAX_EDGE, {
          fit: 'inside',
          withoutEnlargement: true,
        }),
      `country-images → ≤${COUNTRY_MAX_EDGE}px long edge`
    );
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
