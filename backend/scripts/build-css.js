#!/usr/bin/env node

/**
 * CSS Build Script
 *
 * Concatenates modular CSS files into a single styles.css
 * and creates a minified styles.min.css for production.
 *
 * Usage:
 *   node scripts/build-css.js         # Build both dev and prod
 *   node scripts/build-css.js --watch # Watch mode for development
 */

const fs = require('fs');
const path = require('path');

// Configuration
const CSS_DIR = path.join(__dirname, '../app/static/css');
const SRC_DIR = path.join(CSS_DIR, 'src');
const OUTPUT_FILE = path.join(CSS_DIR, 'styles.css');
const OUTPUT_MIN_FILE = path.join(CSS_DIR, 'styles.min.css');

// Order matters! Files are concatenated in this order.
const CSS_FILES = [
  'variables.css',
  'base.css',
  'components.css',
  'pages/list.css',
  'pages/landing.css',
  'responsive.css',
];

/**
 * Read and concatenate all CSS source files
 */
function concatenateCSS() {
  const header = `/* ==============================================
   Atlasi Public Pages - Compiled CSS
   Generated: ${new Date().toISOString()}
   DO NOT EDIT - This file is auto-generated from src/
   ============================================== */

`;

  let output = header;

  for (const file of CSS_FILES) {
    const filePath = path.join(SRC_DIR, file);

    if (!fs.existsSync(filePath)) {
      console.error(`Warning: ${file} not found, skipping...`);
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    output += `\n/* Source: ${file} */\n`;
    output += content;
    output += '\n';
  }

  return output;
}

/**
 * Simple CSS minification
 * - Removes comments
 * - Removes unnecessary whitespace
 * - Preserves content in strings and data URIs
 */
function minifyCSS(css) {
  // Remove multi-line comments (but preserve data URIs)
  let minified = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // Remove newlines and extra spaces
  minified = minified
    .replace(/\s+/g, ' ') // Collapse whitespace
    .replace(/\s*{\s*/g, '{') // Remove space around {
    .replace(/\s*}\s*/g, '}') // Remove space around }
    .replace(/\s*;\s*/g, ';') // Remove space around ;
    .replace(/\s*:\s*/g, ':') // Remove space around :
    .replace(/\s*,\s*/g, ',') // Remove space around ,
    .replace(/;}/g, '}') // Remove last semicolon before }
    .trim();

  return minified;
}

/**
 * Build CSS files
 */
function build() {
  console.log('Building CSS...');

  // Ensure directories exist
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`Error: Source directory not found: ${SRC_DIR}`);
    process.exit(1);
  }

  // Concatenate source files
  const css = concatenateCSS();

  // Write development version
  fs.writeFileSync(OUTPUT_FILE, css);
  console.log(`✓ Created ${path.relative(process.cwd(), OUTPUT_FILE)}`);

  // Create minified version
  const minified = minifyCSS(css);
  fs.writeFileSync(OUTPUT_MIN_FILE, minified);

  // Report sizes
  const devSize = (css.length / 1024).toFixed(1);
  const minSize = (minified.length / 1024).toFixed(1);
  const savings = (((css.length - minified.length) / css.length) * 100).toFixed(1);

  console.log(`✓ Created ${path.relative(process.cwd(), OUTPUT_MIN_FILE)}`);
  console.log(`  Development: ${devSize} KB`);
  console.log(`  Minified: ${minSize} KB (${savings}% smaller)`);
}

/**
 * Watch mode - rebuild on file changes
 */
function watch() {
  console.log('Watching for changes in src/...\n');

  // Initial build
  build();

  // Watch for changes
  const watchDirs = [SRC_DIR, path.join(SRC_DIR, 'pages')];

  for (const dir of watchDirs) {
    if (fs.existsSync(dir)) {
      fs.watch(dir, { persistent: true }, (eventType, filename) => {
        if (filename && filename.endsWith('.css')) {
          console.log(`\nChange detected: ${filename}`);
          build();
        }
      });
    }
  }
}

// Main execution
const args = process.argv.slice(2);

if (args.includes('--watch') || args.includes('-w')) {
  watch();
} else {
  build();
}
