#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Configuration
const INPUT_DIR = path.join(__dirname, '../assets/country-images');
const OUTPUT_DIR = path.join(__dirname, '../assets/country-images/processed');
const TARGET_WIDTH = 1350;
const WEBP_QUALITY = 80;

// Country name to ISO code mapping (from countries.sql)
// Handles variations in naming (hyphens, spaces, spelling differences)
const NAME_TO_CODE = {
  // Africa
  Algeria: 'DZ',
  Angola: 'AO',
  Benin: 'BJ',
  Botswana: 'BW',
  'Burkina-Faso': 'BF',
  Burundi: 'BI',
  'Cape-Verde': 'CV',
  Cameroon: 'CM',
  'Central-African-Republic': 'CF',
  Chad: 'TD',
  Comoros: 'KM',
  'Republic-of-Congo': 'CG',
  'Democratic-Republic-of-Congo': 'CD',
  Djibouti: 'DJ',
  Egypt: 'EG',
  'Equatorial-Guinea': 'GQ',
  Eritrea: 'ER',
  Swaziland: 'SZ',
  Ethiopia: 'ET',
  Gabon: 'GA',
  Gambia: 'GM',
  Ghana: 'GH',
  Guinea: 'GN',
  'Guinea-Bissau': 'GW',
  'Ivory-Coast': 'CI',
  Kenya: 'KE',
  Lesotho: 'LS',
  Liberia: 'LR',
  Libya: 'LY',
  Madagascar: 'MG',
  Malawi: 'MW',
  Mali: 'ML',
  Mauritania: 'MR',
  Mauritius: 'MU',
  Morocco: 'MA',
  Mozambique: 'MZ',
  Namibia: 'NA',
  Niger: 'NE',
  Nigeria: 'NG',
  Rwanda: 'RW',
  'Sao-Tome-and-Principe': 'ST',
  Senegal: 'SN',
  Seychelles: 'SC',
  'Sierra-Leone': 'SL',
  Somalia: 'SO',
  'South-Africa': 'ZA',
  'South-Sudan': 'SS',
  Sudan: 'SD',
  Tanzania: 'TZ',
  Togo: 'TG',
  Tunisia: 'TN',
  Uganda: 'UG',
  Zambia: 'ZM',
  Zimbabwe: 'ZW',
  Zanzibar: 'ZZ',

  // Americas
  'Antigua-and-Barbuda': 'AG',
  Argentina: 'AR',
  Bahamas: 'BS',
  Barbados: 'BB',
  Belize: 'BZ',
  Bolivia: 'BO',
  Brazil: 'BR',
  Canada: 'CA',
  Chile: 'CL',
  Colombia: 'CO',
  'Costa-Rica': 'CR',
  Cuba: 'CU',
  Dominica: 'DM',
  'Dominican-Republic': 'DO',
  Ecuador: 'EC',
  'El-Salvador': 'SV',
  Grenada: 'GD',
  Guatemala: 'GT',
  Guyana: 'GY',
  Haiti: 'HT',
  Honduras: 'HN',
  Jamaica: 'JM',
  Mexico: 'MX',
  Nicaragua: 'NI',
  Panama: 'PA',
  Paraguay: 'PY',
  Peru: 'PE',
  'Saint-Kitts-and-Nevis': 'KN',
  'Saint-Lucia': 'LC',
  'Saint-Vincent-and-the-Grenadines': 'VC',
  // Note: 'Saint-Vincent' also exists but maps to same code - skip to avoid duplicate
  Suriname: 'SR',
  'Trinidad-and-Tobago': 'TT',
  'United-States': 'US',
  USA: 'US',
  Uruguay: 'UY',
  Venezuela: 'VE',
  // Americas - Dependent territories
  Anguila: 'AI',
  Aruba: 'AW',
  Bermuda: 'BM',
  BVI: 'VG',
  'British-Virgin-Islands': 'VG',
  'Cayman-Islands': 'KY',
  'Falkland-Islands': 'FK',
  'French-Guiana': 'GF',
  Guadeloupe: 'GP',
  Martinique: 'MQ',
  'Puerto-Rico': 'PR',
  'St-Barts': 'BL',
  'Saint-Martin': 'MF',
  'Turks-and-Caicos': 'TC',
  USVI: 'VI',
  'US-Virgin-Islands': 'VI',

  // Asia
  Afghanistan: 'AF',
  Armenia: 'AM',
  Azerbaijan: 'AZ',
  Bahrain: 'BH',
  Bangladesh: 'BD',
  Bhutan: 'BT',
  Brunei: 'BN',
  Cambodia: 'KH',
  China: 'CN',
  Cyprus: 'CY',
  Georgia: 'GE',
  India: 'IN',
  Indonesia: 'ID',
  Iran: 'IR',
  Iraq: 'IQ',
  Israel: 'IL',
  Japan: 'JP',
  Jordan: 'JO',
  Kazakhstan: 'KZ',
  Kuwait: 'KW',
  Kyrgyzstan: 'KG',
  Laos: 'LA',
  Lebanon: 'LB',
  Malaysia: 'MY',
  Maldives: 'MV',
  Mongolia: 'MN',
  Myanmar: 'MM',
  Mynamar: 'MM', // Spelling variation in source files
  Nepal: 'NP',
  'North-Korea': 'KP',
  Oman: 'OM',
  Pakistan: 'PK',
  Philippines: 'PH',
  Phillipines: 'PH', // Spelling variation in source files
  Qatar: 'QA',
  'Saudi-Arabia': 'SA',
  Singapore: 'SG',
  'South-Korea': 'KR',
  'Sri-Lanka': 'LK',
  Syria: 'SY',
  Tajikistan: 'TJ',
  Thailand: 'TH',
  'East-Timor': 'TL',
  'Timor-Leste': 'TL',
  Turkey: 'TR',
  Turkmenistan: 'TM',
  'United-Arab-Emirates': 'AE',
  UAE: 'AE',
  Uzbekistan: 'UZ',
  Vietnam: 'VN',
  Yemen: 'YE',
  // Asia - Disputed/Observer/Special
  Taiwan: 'TW',
  'Northern-Cyprus': 'XN',
  Palestine: 'PS',
  'Hong-Kong': 'HK',
  Macau: 'MO',

  // Europe
  Albania: 'AL',
  Andorra: 'AD',
  Austria: 'AT',
  Belarus: 'BY',
  Belgium: 'BE',
  'Bosnia-and-Herzegovina': 'BA',
  Bosnia: 'BA',
  Bulgaria: 'BG',
  Croatia: 'HR',
  'Czech-Republic': 'CZ',
  Czechia: 'CZ',
  Denmark: 'DK',
  Estonia: 'EE',
  Finland: 'FI',
  France: 'FR',
  Germany: 'DE',
  Greece: 'GR',
  Hungary: 'HU',
  Iceland: 'IS',
  Ireland: 'IE',
  Italy: 'IT',
  Latvia: 'LV',
  Liechtenstein: 'LI',
  Lithuania: 'LT',
  Luxembourg: 'LU',
  Malta: 'MT',
  Moldova: 'MD',
  Monaco: 'MC',
  Montenegro: 'ME',
  Netherlands: 'NL',
  'North-Macedonia': 'MK',
  Macedonia: 'MK',
  Norway: 'NO',
  Poland: 'PL',
  Portugal: 'PT',
  Romania: 'RO',
  Russia: 'RU',
  'San-Marino': 'SM',
  Serbia: 'RS',
  Slovakia: 'SK',
  Slovenia: 'SI',
  Spain: 'ES',
  Sweden: 'SE',
  Switzerland: 'CH',
  Ukraine: 'UA',
  'United-Kingdom': 'GB',
  UK: 'GB',
  // Europe - Observer/Disputed/Dependent/Constituent
  'Vatican-City': 'VA',
  Vatican: 'VA',
  Kosovo: 'XK',
  'Faroe-Islands': 'FO',
  Gibraltar: 'GI',
  Greenland: 'GL',
  'Isle-of-Man': 'IM',
  'Northern-Ireland': 'XI',
  Scotland: 'XS',
  Wales: 'XW',

  // Oceania
  Australia: 'AU',
  Fiji: 'FJ',
  Kiribati: 'KI',
  Kirbati: 'KI', // Spelling variation in source files
  'Marshall-Islands': 'MH',
  Micronesia: 'FM',
  Nauru: 'NR',
  'New-Zealand': 'NZ',
  Palau: 'PW',
  'Papua-New-Guinea': 'PG',
  'Papa-New-Guinea': 'PG', // Spelling variation in source files
  Samoa: 'WS',
  'Solomon-Islands': 'SB',
  Tonga: 'TO',
  Tuvalu: 'TV',
  Vanuatu: 'VU',
  // Oceania - Dependent territories
  'American-Samoa': 'AS',
  'Cook-Islands': 'CK',
  'French-Polynesia': 'PF',
  Guam: 'GU',

  // Antarctica
  Antarctica: 'AQ',

  // Spelling variations in source files
  Anguilla: 'AI',
  Azerbajin: 'AZ',
  'Central-Africa-Republic': 'CF',
  Dijibouti: 'DJ',
  'French-Guinea': 'GF',
  Gibaltrar: 'GI',
  Kazakstan: 'KZ',
  Kyrgestan: 'KG',
  Lichenstein: 'LI',
  Luxembuorg: 'LU',
  Maldvies: 'MV',
  Maurituina: 'MR',
  'Saint-Kitts-And-Nevis': 'KN',
  'Soloman-Islands': 'SB',
  Vanatu: 'VU',
};

async function processImages() {
  console.log('🖼️  Country Image Processor');
  console.log('==========================\n');

  // Create output directory if it doesn't exist
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`📁 Created output directory: ${OUTPUT_DIR}\n`);
  }

  // Get all PNG files in input directory (excluding _alt variants)
  const files = fs.readdirSync(INPUT_DIR).filter((f) => f.endsWith('.png') && !f.includes('_alt'));

  console.log(`📂 Found ${files.length} source images (excluding _alt variants)\n`);

  const results = {
    processed: [],
    skipped: [],
    notMapped: [],
    errors: [],
  };

  let totalInputSize = 0;
  let totalOutputSize = 0;

  for (const file of files) {
    const baseName = path.basename(file, '.png');
    const code = NAME_TO_CODE[baseName];

    if (!code) {
      results.notMapped.push(baseName);
      continue;
    }

    const inputPath = path.join(INPUT_DIR, file);
    const outputPath = path.join(OUTPUT_DIR, `${code}.webp`);

    try {
      const inputStats = fs.statSync(inputPath);
      totalInputSize += inputStats.size;

      await sharp(inputPath)
        .resize(TARGET_WIDTH, null, { withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toFile(outputPath);

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
  console.log('\n==========================');
  console.log('📊 SUMMARY');
  console.log('==========================\n');

  console.log(`✅ Processed: ${results.processed.length} images`);
  console.log(`⏭️  Not mapped: ${results.notMapped.length} images`);
  console.log(`❌ Errors: ${results.errors.length} images\n`);

  const totalInputMB = (totalInputSize / (1024 * 1024)).toFixed(2);
  const totalOutputMB = (totalOutputSize / (1024 * 1024)).toFixed(2);
  const totalReduction = ((1 - totalOutputSize / totalInputSize) * 100).toFixed(1);

  console.log(`📦 Total size: ${totalInputMB}MB → ${totalOutputMB}MB (-${totalReduction}%)\n`);

  if (results.notMapped.length > 0) {
    console.log('⚠️  Images without mapping (add to NAME_TO_CODE if needed):');
    results.notMapped.forEach((name) => console.log(`   - ${name}`));
    console.log('');
  }

  if (results.errors.length > 0) {
    console.log('❌ Errors:');
    results.errors.forEach(({ file, error }) => console.log(`   - ${file}: ${error}`));
    console.log('');
  }

  // Find missing countries (codes in DB without images)
  const processedCodes = new Set(results.processed.map((r) => r.code));
  const allCodes = [...new Set(Object.values(NAME_TO_CODE))];
  const missingCodes = allCodes.filter((code) => !processedCodes.has(code));

  if (missingCodes.length > 0) {
    console.log(`📋 Countries without images (${missingCodes.length}):`);
    // Get reverse mapping for display
    const codeToName = {};
    for (const [name, code] of Object.entries(NAME_TO_CODE)) {
      if (!codeToName[code]) codeToName[code] = name;
    }
    missingCodes.forEach((code) => console.log(`   - ${code} (${codeToName[code]})`));
    console.log('');
  }

  // Generate TypeScript mapping file
  generateTypeScriptMapping(results.processed);

  return results;
}

function generateTypeScriptMapping() {
  const outputPath = path.join(__dirname, '../src/assets/countryImages.ts');

  // Scan all existing processed webp files to generate the mapping
  const processedFiles = fs
    .readdirSync(OUTPUT_DIR)
    .filter((f) => f.endsWith('.webp'))
    .map((f) => path.basename(f, '.webp'))
    .sort();

  const imports = processedFiles
    .map((code) => `  ${code}: require('../../assets/country-images/processed/${code}.webp'),`)
    .join('\n');

  const content = `// Auto-generated by scripts/process-country-images.js
// Do not edit manually - run the script to regenerate
/* eslint-disable @typescript-eslint/no-require-imports */

import { ImageSourcePropType } from 'react-native';

const countryImages: Record<string, ImageSourcePropType> = {
${imports}
};

/**
 * Get the local image asset for a country by its ISO 2-letter code
 * @param code - ISO 3166-1 alpha-2 country code (e.g., "US", "FR")
 * @returns The image require() result, or null if not found
 */
export function getCountryImage(code: string): ImageSourcePropType | null {
  return countryImages[code.toUpperCase()] ?? null;
}

/**
 * Check if a country has a local image available
 * @param code - ISO 3166-1 alpha-2 country code
 */
export function hasCountryImage(code: string): boolean {
  return code.toUpperCase() in countryImages;
}

/**
 * Get all available country codes that have images
 */
export function getAvailableCountryCodes(): string[] {
  return Object.keys(countryImages);
}

export default countryImages;
`;

  // Ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, content);
  console.log(`📝 Generated TypeScript mapping: ${outputPath}`);
  console.log(`   Contains ${processedFiles.length} country image imports\n`);
}

// Run the script
processImages().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
