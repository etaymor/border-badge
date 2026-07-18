#!/usr/bin/env node

/**
 * One-off: extract the app screenshots from the Atlasi landing design bundle
 * and emit web-optimized WebP + PNG at 3x display size.
 *
 * The design file is a Claude design-doc bundle: the images live base64-encoded
 * in a <script type="__bundler/manifest"> block, keyed by uuid.
 *
 * Usage:
 *   node scripts/extract-design-assets.js "~/Downloads/Atlasi Landing.html"
 *
 * Requires sharp, which lives in mobile/node_modules (not a backend dependency).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const sharp = require(path.join(__dirname, '../../mobile/node_modules/sharp'));

const OUT_DIR = path.join(__dirname, '../app/static/images/screens');

// Display widths come from the design comp; we render at 3x for retina.
// Hero phone is 300px wide with 11px padding -> 278px image area.
// "In action" phones are 250px wide with 9px padding -> 232px image area.
const SCREENS = [
  { uuid: 'bf331e2b', name: 'passport-home', displayWidth: 278 },
  { uuid: '3defb688', name: 'country-mexico', displayWidth: 232 },
  { uuid: 'c604a6e9', name: 'trip-tokyo', displayWidth: 232 },
  { uuid: 'b68aad34', name: 'share-collage', displayWidth: 232 },
];

const DPR = 3;

function readManifest(bundlePath) {
  const src = fs.readFileSync(bundlePath, 'utf8');
  const match = src.match(
    /<script type="__bundler\/manifest">([\s\S]*?)<\/script>/
  );
  if (!match) throw new Error('No __bundler/manifest block found in bundle');
  return JSON.parse(match[1].trim());
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/extract-design-assets.js <bundle.html>');
    process.exit(1);
  }
  const bundlePath = arg.replace(/^~/, os.homedir());

  const manifest = readManifest(bundlePath);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const screen of SCREENS) {
    const uuid = Object.keys(manifest).find((u) => u.startsWith(screen.uuid));
    if (!uuid) throw new Error(`Asset ${screen.uuid} not found in manifest`);

    const png = Buffer.from(manifest[uuid].data, 'base64');
    const width = screen.displayWidth * DPR;

    const base = sharp(png).resize({ width, withoutEnlargement: true });

    const webpPath = path.join(OUT_DIR, `${screen.name}.webp`);
    const pngPath = path.join(OUT_DIR, `${screen.name}.png`);

    await base.clone().webp({ quality: 82 }).toFile(webpPath);
    await base.clone().png({ compressionLevel: 9, palette: true }).toFile(pngPath);

    const meta = await sharp(webpPath).metadata();
    const kb = (f) => (fs.statSync(f).size / 1024).toFixed(0);
    console.log(
      `${screen.name}: ${meta.width}x${meta.height} — ` +
        `webp ${kb(webpPath)}KB, png ${kb(pngPath)}KB`
    );
  }

  // Open Graph image: a 1200x630 branded card — wordmark and tagline on the
  // left, the passport-home screen bleeding off the right edge. Social cards get
  // rendered small, so the phone is cropped rather than letterboxed whole.
  const heroUuid = Object.keys(manifest).find((u) => u.startsWith('bf331e2b'));
  const phone = await sharp(Buffer.from(manifest[heroUuid].data, 'base64'))
    .resize({ width: 420 })
    .extract({ left: 0, top: 0, width: 420, height: 560 })
    .toBuffer();

  const text = Buffer.from(`<svg width="1200" height="630">
    <style>
      .brand { font: 800 64px 'Playfair Display', Georgia, serif; fill: #172A3A; }
      .tag { font: 400 30px 'Open Sans', sans-serif; fill: #5a6470; }
      .eyebrow { font: 700 20px 'Open Sans', sans-serif; fill: #C1543E;
                 letter-spacing: 3px; }
    </style>
    <text class="eyebrow" x="80" y="210">227 COUNTRIES &amp; TERRITORIES</text>
    <text class="brand" x="80" y="300">Stamp your passport</text>
    <text class="brand" x="80" y="374">for everywhere</text>
    <text class="brand" x="80" y="448">you've been.</text>
    <text class="tag" x="80" y="510">Track countries, import photos, log every trip.</text>
  </svg>`);

  const ogPath = path.join(OUT_DIR, 'og-image.png');
  await sharp({
    create: {
      width: 1200,
      height: 630,
      channels: 3,
      background: '#FDF6ED', // Warm Cream
    },
  })
    .composite([
      { input: phone, top: 40, left: 760 },
      { input: text, top: 0, left: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toFile(ogPath);

  console.log(
    `og-image: 1200x630 — ${(fs.statSync(ogPath).size / 1024).toFixed(0)}KB`
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
