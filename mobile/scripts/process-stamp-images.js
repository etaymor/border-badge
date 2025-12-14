#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Configuration
const INPUT_DIR = path.join(__dirname, '../assets/stamps');
const OUTPUT_DIR = path.join(__dirname, '../assets/stamps/processed');
const WEBP_QUALITY = 80;

// Country name to ISO code mapping
// Handles variations in naming (lowercase, hyphens, spelling differences)
// Stamp files are named like: afghanistan-stamp.png, antigua-barbuda-stamp.png
const NAME_TO_CODE = {
  // Africa
  algeria: 'DZ',
  angola: 'AO',
  benin: 'BJ',
  botswana: 'BW',
  'burkina-faso': 'BF',
  burundi: 'BI',
  'cape-verde': 'CV',
  cameroon: 'CM',
  'central-african-republic': 'CF',
  'central-africa-republic': 'CF', // spelling variation
  chad: 'TD',
  comoros: 'KM',
  'republic-of-congo': 'CG',
  congo: 'CG',
  'democratic-republic-of-congo': 'CD',
  drc: 'CD',
  djibouti: 'DJ',
  egypt: 'EG',
  'equatorial-guinea': 'GQ',
  eritrea: 'ER',
  swaziland: 'SZ',
  swazil: 'SZ', // typo in source
  eswatini: 'SZ',
  ethiopia: 'ET',
  gabon: 'GA',
  gambia: 'GM',
  ghana: 'GH',
  guinea: 'GN',
  'guinea-bissau': 'GW',
  'ivory-coast': 'CI',
  'cote-divoire': 'CI',
  kenya: 'KE',
  lesotho: 'LS',
  liberia: 'LR',
  libya: 'LY',
  madagascar: 'MG',
  malawi: 'MW',
  mali: 'ML',
  mauritania: 'MR',
  mauritius: 'MU',
  morocco: 'MA',
  mozambique: 'MZ',
  namibia: 'NA',
  niger: 'NE',
  nigeria: 'NG',
  rwanda: 'RW',
  'sao-tome-and-principe': 'ST',
  senegal: 'SN',
  seychelles: 'SC',
  'sierra-leone': 'SL',
  somalia: 'SO',
  'south-africa': 'ZA',
  'south-sudan': 'SS',
  sudan: 'SD',
  tanzania: 'TZ',
  togo: 'TG',
  tunisia: 'TN',
  uganda: 'UG',
  'ug-a': 'UG', // typo in source
  zambia: 'ZM',
  zimbabwe: 'ZW',
  zanzibar: 'ZZ', // Special region of Tanzania

  // Americas
  'antigua-barbuda': 'AG', // no "and" in stamp name
  'antigua-and-barbuda': 'AG',
  argentina: 'AR',
  bahamas: 'BS',
  barbados: 'BB',
  belize: 'BZ',
  bolivia: 'BO',
  brazil: 'BR',
  canada: 'CA',
  chile: 'CL',
  colombia: 'CO',
  'costa-rica': 'CR',
  cuba: 'CU',
  dominica: 'DM',
  'dominican-republic': 'DO',
  ecuador: 'EC',
  'el-salvador': 'SV',
  grenada: 'GD',
  guatemala: 'GT',
  guyana: 'GY',
  haiti: 'HT',
  honduras: 'HN',
  jamaica: 'JM',
  mexico: 'MX',
  nicaragua: 'NI',
  panama: 'PA',
  paraguay: 'PY',
  peru: 'PE',
  'saint-kitts-and-nevis': 'KN',
  'st-kitts-nevis': 'KN',
  'saint-lucia': 'LC',
  'st-lucia': 'LC',
  'saint-vincent-and-the-grenadines': 'VC',
  'st-vincent': 'VC',
  suriname: 'SR',
  'trinidad-tobago': 'TT', // no "and" in stamp name
  'trinidad-and-tobago': 'TT',
  'united-states': 'US',
  usa: 'US',
  uruguay: 'UY',
  venezuela: 'VE',
  // Americas - Dependent territories
  anguilla: 'AI',
  aruba: 'AW',
  bermuda: 'BM',
  bvi: 'VG',
  'british-virgin-islands': 'VG',
  'cayman-islands': 'KY',
  'falkland-islands': 'FK',
  'french-guiana': 'GF',
  guadeloupe: 'GP',
  martinique: 'MQ',
  'puerto-rico': 'PR',
  'st-barts': 'BL',
  'saint-barthelemy': 'BL',
  'saint-martin': 'MF',
  'turks-caicos': 'TC', // no "and" in stamp name
  'turks-and-caicos': 'TC',
  usvi: 'VI',
  'us-virgin-islands': 'VI',

  // Asia
  afghanistan: 'AF',
  armenia: 'AM',
  azerbaijan: 'AZ',
  azerbajin: 'AZ', // spelling variation
  bahrain: 'BH',
  bangladesh: 'BD',
  bhutan: 'BT',
  brunei: 'BN',
  cambodia: 'KH',
  china: 'CN',
  cyprus: 'CY',
  georgia: 'GE',
  india: 'IN',
  indonesia: 'ID',
  iran: 'IR',
  iraq: 'IQ',
  israel: 'IL',
  japan: 'JP',
  jordan: 'JO',
  kazakhstan: 'KZ',
  kuwait: 'KW',
  kyrgyzstan: 'KG',
  laos: 'LA',
  lebanon: 'LB',
  malaysia: 'MY',
  maldives: 'MV',
  mongolia: 'MN',
  myanmar: 'MM',
  nepal: 'NP',
  'north-korea': 'KP',
  oman: 'OM',
  pakistan: 'PK',
  philippines: 'PH',
  qatar: 'QA',
  'saudi-arabia': 'SA',
  singapore: 'SG',
  'south-korea': 'KR',
  'sri-lanka': 'LK',
  syria: 'SY',
  tajikistan: 'TJ',
  thailand: 'TH',
  'east-timor': 'TL',
  'timor-leste': 'TL',
  turkey: 'TR',
  turkmenistan: 'TM',
  'united-arab-emirates': 'AE',
  uae: 'AE',
  uzbekistan: 'UZ',
  vietnam: 'VN',
  yemen: 'YE',
  // Asia - Disputed/Observer/Special
  taiwan: 'TW',
  'northern-cyprus': 'XN',
  palestine: 'PS',
  'hong-kong': 'HK',
  macau: 'MO',

  // Europe
  albania: 'AL',
  andorra: 'AD',
  austria: 'AT',
  belarus: 'BY',
  belgium: 'BE',
  'bosnia-herzegovina': 'BA', // no "and" in stamp name
  'bosnia-and-herzegovina': 'BA',
  bosnia: 'BA',
  bulgaria: 'BG',
  croatia: 'HR',
  'czech-republic': 'CZ',
  czechia: 'CZ',
  denmark: 'DK',
  estonia: 'EE',
  finland: 'FI',
  france: 'FR',
  germany: 'DE',
  greece: 'GR',
  hungary: 'HU',
  iceland: 'IS',
  ireland: 'IE',
  italy: 'IT',
  latvia: 'LV',
  liechtenstein: 'LI',
  lichenstein: 'LI', // spelling variation in source file
  lithuania: 'LT',
  luxembourg: 'LU',
  luxembuorg: 'LU', // spelling variation in source file
  malta: 'MT',
  moldova: 'MD',
  monaco: 'MC',
  montenegro: 'ME',
  netherlands: 'NL',
  'north-macedonia': 'MK',
  macedonia: 'MK',
  norway: 'NO',
  poland: 'PL',
  portugal: 'PT',
  romania: 'RO',
  russia: 'RU',
  'san-marino': 'SM',
  serbia: 'RS',
  slovakia: 'SK',
  slovenia: 'SI',
  spain: 'ES',
  sweden: 'SE',
  switzerland: 'CH',
  ukraine: 'UA',
  'united-kingdom': 'GB',
  uk: 'GB',
  // Europe - Observer/Disputed/Dependent/Constituent
  'vatican-city': 'VA',
  vatican: 'VA',
  kosovo: 'XK',
  'faroe-islands': 'FO',
  gibraltar: 'GI',
  greenland: 'GL',
  'isle-of-man': 'IM',
  'northern-ireland': 'XI',
  scotland: 'XS',
  wales: 'XW',

  // Oceania
  australia: 'AU',
  fiji: 'FJ',
  kiribati: 'KI',
  'marshall-islands': 'MH',
  micronesia: 'FM',
  nauru: 'NR',
  'new-zealand': 'NZ',
  palau: 'PW',
  'papua-new-guinea': 'PG',
  samoa: 'WS',
  'solomon-islands': 'SB',
  'soloman-islands': 'SB', // spelling variation
  tonga: 'TO',
  tuvalu: 'TV',
  vanuatu: 'VU',
  vanatu: 'VU', // spelling variation
  // Oceania - Dependent territories
  'american-samoa': 'AS',
  'cook-islands': 'CK',
  'french-polynesia': 'PF',
  guam: 'GU',

  // Antarctica
  antarctica: 'AQ',

  // Spelling variations in source files
  dijibouti: 'DJ',
  'falkl-islands': 'FK',
  finl: 'FI',
  'french-guinea': 'GF',
  gibaltrar: 'GI',
  irel: 'IE',
  kazakstan: 'KZ',
  kirbati: 'KI',
  kyrgestan: 'KG',
  maldvies: 'MV',
  maurituina: 'MR',
  mynamar: 'MM',
  'papa-new-guinea': 'PG',
  phillipines: 'PH',
  'saint-kitts-nevis': 'KN',
  'saint-vincent-the-grenadines': 'VC',
  'sao-tome-principe': 'ST',
  scotl: 'XS',

  // Special/Non-standard (skip these)
  'bora-bora': null, // Part of French Polynesia, not a country
};

async function processImages() {
  console.log('🎫 Stamp Image Processor');
  console.log('========================\n');

  // Create output directory if it doesn't exist
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`📁 Created output directory: ${OUTPUT_DIR}\n`);
  }

  // Get all PNG files in input directory (excluding _alt variants and numbered variants)
  const files = fs
    .readdirSync(INPUT_DIR)
    .filter((f) => f.endsWith('.png') && !f.includes('_alt') && !f.match(/-stamp\d+\.png$/));

  console.log(`📂 Found ${files.length} source stamps (excluding alternates)\n`);

  const results = {
    processed: [],
    skipped: [],
    notMapped: [],
    errors: [],
  };

  let totalInputSize = 0;
  let totalOutputSize = 0;

  for (const file of files) {
    // Extract country name: "afghanistan-stamp.png" -> "afghanistan"
    const baseName = path.basename(file, '.png').replace(/-stamp$/, '');
    const code = NAME_TO_CODE[baseName];

    if (code === null) {
      // Explicitly marked as skip (e.g., bora-bora)
      results.skipped.push(baseName);
      continue;
    }

    if (!code) {
      results.notMapped.push(baseName);
      continue;
    }

    const inputPath = path.join(INPUT_DIR, file);
    const outputPath = path.join(OUTPUT_DIR, `${code}.webp`);

    try {
      const inputStats = fs.statSync(inputPath);
      totalInputSize += inputStats.size;

      // Convert to WebP without resizing (keep 1024x1024)
      await sharp(inputPath).webp({ quality: WEBP_QUALITY }).toFile(outputPath);

      const outputStats = fs.statSync(outputPath);
      totalOutputSize += outputStats.size;

      const inputSizeKB = (inputStats.size / 1024).toFixed(0);
      const outputSizeKB = (outputStats.size / 1024).toFixed(0);
      const reduction = ((1 - outputStats.size / inputStats.size) * 100).toFixed(1);

      results.processed.push({
        source: baseName,
        code,
        inputSize: inputSizeKB,
        outputSize: outputSizeKB,
        reduction,
      });

      console.log(
        `✅ ${baseName} → ${code}.webp (${inputSizeKB}KB → ${outputSizeKB}KB, -${reduction}%)`
      );
    } catch (err) {
      results.errors.push({ file: baseName, error: err.message });
      console.log(`❌ ${baseName}: ${err.message}`);
    }
  }

  // Summary
  console.log('\n========================');
  console.log('📊 SUMMARY');
  console.log('========================\n');

  console.log(`✅ Processed: ${results.processed.length} stamps`);
  console.log(`⏭️  Skipped (intentional): ${results.skipped.length} stamps`);
  console.log(`⚠️  Not mapped: ${results.notMapped.length} stamps`);
  console.log(`❌ Errors: ${results.errors.length} stamps\n`);

  const totalInputMB = (totalInputSize / (1024 * 1024)).toFixed(2);
  const totalOutputMB = (totalOutputSize / (1024 * 1024)).toFixed(2);
  const totalReduction =
    totalInputSize > 0 ? ((1 - totalOutputSize / totalInputSize) * 100).toFixed(1) : 0;

  console.log(`📦 Total size: ${totalInputMB}MB → ${totalOutputMB}MB (-${totalReduction}%)\n`);

  if (results.skipped.length > 0) {
    console.log('⏭️  Intentionally skipped:');
    results.skipped.forEach((name) => console.log(`   - ${name}`));
    console.log('');
  }

  if (results.notMapped.length > 0) {
    console.log('⚠️  Stamps without mapping (add to NAME_TO_CODE if needed):');
    results.notMapped.forEach((name) => console.log(`   - ${name}`));
    console.log('');
  }

  if (results.errors.length > 0) {
    console.log('❌ Errors:');
    results.errors.forEach(({ file, error }) => console.log(`   - ${file}: ${error}`));
    console.log('');
  }

  // Generate TypeScript mapping file (scans all processed files)
  generateTypeScriptMapping();

  return results;
}

function generateTypeScriptMapping() {
  const outputPath = path.join(__dirname, '../src/assets/stampImages.ts');

  // Scan all existing processed webp files to generate the mapping
  const processedFiles = fs
    .readdirSync(OUTPUT_DIR)
    .filter((f) => f.endsWith('.webp'))
    .map((f) => path.basename(f, '.webp'))
    .sort();

  const imports = processedFiles
    .map((code) => `  ${code}: require('../../assets/stamps/processed/${code}.webp'),`)
    .join('\n');

  const content = `// Auto-generated by scripts/process-stamp-images.js
// Do not edit manually - run the script to regenerate
/* eslint-disable @typescript-eslint/no-require-imports */

import { ImageSourcePropType } from 'react-native';

const stampImages: Record<string, ImageSourcePropType> = {
${imports}
};

/**
 * Get the local stamp image asset for a country by its ISO 2-letter code
 * @param code - ISO 3166-1 alpha-2 country code (e.g., "US", "FR")
 * @returns The image require() result, or null if not found
 */
export function getStampImage(code: string): ImageSourcePropType | null {
  return stampImages[code.toUpperCase()] ?? null;
}

/**
 * Check if a country has a local stamp image available
 * @param code - ISO 3166-1 alpha-2 country code
 */
export function hasStampImage(code: string): boolean {
  return code.toUpperCase() in stampImages;
}

/**
 * Get all available country codes that have stamp images
 */
export function getAvailableStampCodes(): string[] {
  return Object.keys(stampImages);
}

export default stampImages;
`;

  // Ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, content);
  console.log(`📝 Generated TypeScript mapping: ${outputPath}`);
  console.log(`   Contains ${processedFiles.length} stamp image imports\n`);
}

// Run the script
processImages().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
