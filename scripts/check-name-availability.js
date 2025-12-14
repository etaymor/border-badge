#!/usr/bin/env node

/**
 * App Name Availability Checker
 * Checks domain availability and App Store for name conflicts
 */

const dns = require('dns');
const https = require('https');

// Name candidates to check
const NAMES = [
  'trekd',
  'roamed',
  'landed',
  'voyaged',
  'globed',
  'tripsy',
  'passportr',
  'stampt',
  'borderly',
  'entryd',
  'atlasi',
  'nomadly',
  'wayfarer',
  'boundless',
  'drift',
  'tripster',
  'worldie',
  'jetsett',
  'roamie',
  'traverse',
  'meridian',
  'latitude',
  'sojourn',
  'waypoint',
];

/**
 * Check if a domain is available via DNS lookup
 * If DNS fails with ENOTFOUND, domain is likely available
 */
function checkDomain(domain) {
  return new Promise((resolve) => {
    dns.resolve(domain, 'A', (err) => {
      if (err && (err.code === 'ENOTFOUND' || err.code === 'ENODATA')) {
        resolve({ domain, available: true });
      } else {
        resolve({ domain, available: false });
      }
    });
  });
}

/**
 * Check App Store for existing apps with similar name
 */
function checkAppStore(name) {
  return new Promise((resolve) => {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=software&limit=10`;

    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const results = json.results || [];

            // Check for exact or very close matches
            const exactMatch = results.find((app) => {
              const appName = app.trackName.toLowerCase().replace(/[^a-z0-9]/g, '');
              const searchName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
              return appName === searchName || appName.startsWith(searchName + ' ');
            });

            const closeMatch = results.find((app) => {
              const appName = app.trackName.toLowerCase();
              return appName.includes(name.toLowerCase());
            });

            resolve({
              name,
              exactMatch: exactMatch ? exactMatch.trackName : null,
              closeMatch: closeMatch && !exactMatch ? closeMatch.trackName : null,
              available: !exactMatch,
            });
          } catch (e) {
            resolve({ name, available: true, error: e.message });
          }
        });
      })
      .on('error', (err) => {
        resolve({ name, available: true, error: err.message });
      });
  });
}

/**
 * Calculate availability score
 */
function calculateScore(domainCom, domainAppCom, domainApp, appStore) {
  let score = 0;
  if (domainCom) score += 3; // Best option
  if (domainAppCom) score += 2; // Good alternative
  if (domainApp) score += 1; // Acceptable
  if (appStore) score += 4; // Critical
  return score;
}

function getStars(score) {
  const maxScore = 10;
  const stars = Math.round((score / maxScore) * 5);
  return '★'.repeat(stars) + '☆'.repeat(5 - stars);
}

async function checkAllNames() {
  console.log('🔍 Checking availability for 24 app name candidates...\n');
  console.log('Please wait, this may take a moment...\n');

  const results = [];

  for (const name of NAMES) {
    process.stdout.write(`Checking ${name}...`);

    // Check all domain variants
    const [domainCom, domainAppCom, domainApp, appStoreResult] = await Promise.all([
      checkDomain(`${name}.com`),
      checkDomain(`${name}app.com`),
      checkDomain(`${name}.app`),
      checkAppStore(name),
    ]);

    const score = calculateScore(
      domainCom.available,
      domainAppCom.available,
      domainApp.available,
      appStoreResult.available
    );

    results.push({
      name,
      domainCom: domainCom.available,
      domainAppCom: domainAppCom.available,
      domainApp: domainApp.available,
      appStore: appStoreResult.available,
      appStoreMatch: appStoreResult.exactMatch || appStoreResult.closeMatch,
      score,
      stars: getStars(score),
    });

    console.log(' done');

    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 200));
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  // Print results table
  console.log('\n' + '='.repeat(100));
  console.log('📊 AVAILABILITY RESULTS');
  console.log('='.repeat(100) + '\n');

  const header = `| ${'Name'.padEnd(12)} | ${'name.com'.padEnd(10)} | ${'nameapp.com'.padEnd(12)} | ${'name.app'.padEnd(10)} | ${'App Store'.padEnd(10)} | ${'Score'.padEnd(7)} |`;
  const separator = `|${'-'.repeat(14)}|${'-'.repeat(12)}|${'-'.repeat(14)}|${'-'.repeat(12)}|${'-'.repeat(12)}|${'-'.repeat(9)}|`;

  console.log(header);
  console.log(separator);

  for (const r of results) {
    const comStatus = r.domainCom ? '✅ AVAIL' : '❌ TAKEN';
    const appComStatus = r.domainAppCom ? '✅ AVAIL' : '❌ TAKEN';
    const appStatus = r.domainApp ? '✅ AVAIL' : '❌ TAKEN';
    const storeStatus = r.appStore ? '✅ AVAIL' : '❌ TAKEN';

    console.log(
      `| ${r.name.padEnd(12)} | ${comStatus.padEnd(10)} | ${appComStatus.padEnd(12)} | ${appStatus.padEnd(10)} | ${storeStatus.padEnd(10)} | ${r.stars.padEnd(7)} |`
    );
  }

  console.log('\n');

  // Print top recommendations
  console.log('🏆 TOP RECOMMENDATIONS (App Store Available + At Least One Domain):\n');

  const topPicks = results.filter((r) => r.appStore && (r.domainCom || r.domainAppCom || r.domainApp));

  if (topPicks.length === 0) {
    console.log('No names have both App Store and domain availability. Consider variations.\n');
  } else {
    for (let i = 0; i < Math.min(topPicks.length, 20); i++) {
      const r = topPicks[i];
      const domains = [];
      if (r.domainCom) domains.push(`${r.name}.com`);
      if (r.domainAppCom) domains.push(`${r.name}app.com`);
      if (r.domainApp) domains.push(`${r.name}.app`);

      console.log(`${i + 1}. ${r.name.toUpperCase()} ${r.stars}`);
      console.log(`   Available domains: ${domains.join(', ')}`);
      console.log('');
    }
  }

  // Print names with App Store conflicts
  const conflicts = results.filter((r) => !r.appStore);
  if (conflicts.length > 0) {
    console.log('\n⚠️  NAMES WITH APP STORE CONFLICTS:\n');
    for (const r of conflicts) {
      console.log(`- ${r.name}: Found "${r.appStoreMatch}"`);
    }
  }

  console.log('\n✅ Check complete!');
}

// Run the checker
checkAllNames().catch(console.error);
