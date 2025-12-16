/**
 * Country rarity scores for share cards.
 * Higher scores = rarer/more unique destinations.
 * Used to highlight the "most unique" country visited per continent.
 *
 * Score ranges:
 * 10 - Extremely rare (remote islands, conflict zones)
 * 9  - Very rare (visa-difficult, remote)
 * 8  - Rare (off the beaten path)
 * 7  - Uncommon
 * 6  - Moderate
 * 5  - Common (default)
 * 4  - Very common
 * 3  - Microstates (easy day trips)
 */

export const COUNTRY_RARITY: Record<string, number> = {
  // Score 10: Extremely rare
  AQ: 10, // Antarctica
  NU: 10, // Niue
  TK: 10, // Tokelau
  PN: 10, // Pitcairn Islands
  NR: 10, // Nauru
  TV: 10, // Tuvalu
  KI: 10, // Kiribati
  MH: 10, // Marshall Islands
  FM: 10, // Micronesia
  PW: 10, // Palau
  ER: 10, // Eritrea
  TM: 10, // Turkmenistan
  KP: 10, // North Korea
  SO: 10, // Somalia
  SS: 10, // South Sudan
  CF: 10, // Central African Republic
  TD: 10, // Chad
  SH: 10, // Saint Helena
  FK: 10, // Falkland Islands
  GS: 10, // South Georgia

  // Score 9: Very rare
  BT: 9, // Bhutan
  MN: 9, // Mongolia
  LA: 9, // Laos
  TJ: 9, // Tajikistan
  KG: 9, // Kyrgyzstan
  UZ: 9, // Uzbekistan
  AF: 9, // Afghanistan
  YE: 9, // Yemen
  SY: 9, // Syria
  LY: 9, // Libya
  BI: 9, // Burundi
  DJ: 9, // Djibouti
  KM: 9, // Comoros
  GW: 9, // Guinea-Bissau
  ST: 9, // Sao Tome
  GQ: 9, // Equatorial Guinea
  ZZ: 9, // Zanzibar
  SC: 9, // Seychelles
  MV: 9, // Maldives
  WF: 9, // Wallis and Futuna
  AS: 9, // American Samoa
  GU: 9, // Guam
  MP: 9, // Northern Mariana Islands
  CK: 9, // Cook Islands
  WS: 9, // Samoa
  TO: 9, // Tonga
  VU: 9, // Vanuatu
  SB: 9, // Solomon Islands
  PG: 9, // Papua New Guinea
  TL: 9, // Timor-Leste
  BN: 9, // Brunei
  XK: 9, // Kosovo
  XN: 9, // Northern Cyprus
  // Note: XI, XS, XW are UK regions (Northern Ireland, Scotland, Wales) - not rare destinations

  // Score 8: Rare
  MG: 8, // Madagascar
  MW: 8, // Malawi
  ZM: 8, // Zambia
  MZ: 8, // Mozambique
  AO: 8, // Angola
  CG: 8, // Republic of Congo
  CD: 8, // DRC
  GA: 8, // Gabon
  CM: 8, // Cameroon
  NE: 8, // Niger
  ML: 8, // Mali
  MR: 8, // Mauritania
  SL: 8, // Sierra Leone
  LR: 8, // Liberia
  GN: 8, // Guinea
  SN: 8, // Senegal
  BF: 8, // Burkina Faso
  TG: 8, // Togo
  BJ: 8, // Benin
  RW: 8, // Rwanda
  UG: 8, // Uganda
  NP: 8, // Nepal
  BD: 8, // Bangladesh
  MM: 8, // Myanmar
  PK: 8, // Pakistan
  IR: 8, // Iran
  IQ: 8, // Iraq
  OM: 8, // Oman
  BH: 8, // Bahrain
  KW: 8, // Kuwait
  AM: 8, // Armenia
  AZ: 8, // Azerbaijan
  GE: 8, // Georgia
  BY: 8, // Belarus
  MD: 8, // Moldova
  UA: 8, // Ukraine
  AL: 8, // Albania
  MK: 8, // North Macedonia
  ME: 8, // Montenegro
  BA: 8, // Bosnia
  GL: 8, // Greenland
  IS: 8, // Iceland
  FO: 8, // Faroe Islands
  SJ: 8, // Svalbard
  SR: 8, // Suriname
  GY: 8, // Guyana
  GF: 8, // French Guiana
  PY: 8, // Paraguay
  BO: 8, // Bolivia
  HN: 8, // Honduras
  NI: 8, // Nicaragua
  HT: 8, // Haiti
  CU: 8, // Cuba
  NC: 8, // New Caledonia
  FJ: 8, // Fiji
  PF: 8, // French Polynesia

  // Score 7: Uncommon
  ET: 7, // Ethiopia
  KE: 7, // Kenya
  TZ: 7, // Tanzania
  ZW: 7, // Zimbabwe
  BW: 7, // Botswana
  NA: 7, // Namibia
  LS: 7, // Lesotho
  SZ: 7, // Eswatini
  CV: 7, // Cape Verde
  GM: 7, // Gambia
  GH: 7, // Ghana
  CI: 7, // Ivory Coast
  NG: 7, // Nigeria
  EG: 7, // Egypt
  SD: 7, // Sudan
  LK: 7, // Sri Lanka
  IN: 7, // India
  VN: 7, // Vietnam
  KH: 7, // Cambodia
  PH: 7, // Philippines
  ID: 7, // Indonesia
  MY: 7, // Malaysia
  SA: 7, // Saudi Arabia
  QA: 7, // Qatar
  AE: 7, // UAE
  JO: 7, // Jordan
  LB: 7, // Lebanon
  PS: 7, // Palestine
  RU: 7, // Russia
  KZ: 7, // Kazakhstan
  SK: 7, // Slovakia
  SI: 7, // Slovenia
  LV: 7, // Latvia
  LT: 7, // Lithuania
  EE: 7, // Estonia
  RO: 7, // Romania
  BG: 7, // Bulgaria
  RS: 7, // Serbia
  EC: 7, // Ecuador
  CO: 7, // Colombia
  VE: 7, // Venezuela
  UY: 7, // Uruguay
  GT: 7, // Guatemala
  SV: 7, // El Salvador
  BZ: 7, // Belize
  JM: 7, // Jamaica
  TT: 7, // Trinidad
  BB: 7, // Barbados
  LC: 7, // Saint Lucia
  GD: 7, // Grenada
  DM: 7, // Dominica
  VC: 7, // St Vincent
  AG: 7, // Antigua
  KN: 7, // St Kitts
  NZ: 7, // New Zealand
  AU: 7, // Australia
  XI: 7, // Northern Ireland (UK constituent - less visited than England)
  XS: 7, // Scotland (UK constituent - less visited than England)
  XW: 7, // Wales (UK constituent - less visited than England)

  // Score 6: Moderate
  MA: 6, // Morocco
  TN: 6, // Tunisia
  ZA: 6, // South Africa
  MU: 6, // Mauritius
  TW: 6, // Taiwan
  KR: 6, // South Korea
  TH: 6, // Thailand
  SG: 6, // Singapore
  HK: 6, // Hong Kong
  MO: 6, // Macau
  IL: 6, // Israel
  TR: 6, // Turkey
  CY: 6, // Cyprus
  FI: 6, // Finland
  NO: 6, // Norway
  SE: 6, // Sweden
  DK: 6, // Denmark
  PL: 6, // Poland
  CZ: 6, // Czech Republic
  HU: 6, // Hungary
  HR: 6, // Croatia
  GR: 6, // Greece
  MT: 6, // Malta
  PE: 6, // Peru
  AR: 6, // Argentina
  CL: 6, // Chile
  BR: 6, // Brazil
  CR: 6, // Costa Rica
  PA: 6, // Panama
  DO: 6, // Dominican Republic
  BS: 6, // Bahamas
  PR: 6, // Puerto Rico
  VI: 6, // US Virgin Islands
  VG: 6, // British Virgin Islands
  AI: 6, // Anguilla
  TC: 6, // Turks and Caicos
  KY: 6, // Cayman Islands
  AW: 6, // Aruba
  CW: 6, // Curacao
  SX: 6, // Sint Maarten
  MF: 6, // Saint Martin
  BQ: 6, // Caribbean Netherlands
  BM: 6, // Bermuda

  // Score 5: Common (default)
  JP: 5, // Japan
  CN: 5, // China
  IE: 5, // Ireland
  GB: 5, // United Kingdom (England)
  PT: 5, // Portugal
  AT: 5, // Austria
  CH: 5, // Switzerland
  BE: 5, // Belgium
  NL: 5, // Netherlands
  LU: 5, // Luxembourg
  MC: 5, // Monaco
  AD: 5, // Andorra
  SM: 5, // San Marino
  MX: 5, // Mexico
  CA: 5, // Canada

  // Score 4: Very common
  US: 4, // United States
  FR: 4, // France
  ES: 4, // Spain
  IT: 4, // Italy
  DE: 4, // Germany

  // Score 3: Microstates
  VA: 3, // Vatican
  LI: 3, // Liechtenstein
};

export const DEFAULT_RARITY = 5;

/**
 * Get rarity score for a country code.
 */
export function getCountryRarity(code: string): number {
  return COUNTRY_RARITY[code.toUpperCase()] ?? DEFAULT_RARITY;
}

/**
 * Traveler percentile estimation based on country count.
 * Returns estimated percentile (e.g., 20 means "Top 20%").
 */
export function estimateTravelerPercentile(countryCount: number): number {
  if (countryCount >= 121) return 1;
  if (countryCount >= 81) return 2;
  if (countryCount >= 51) return 5;
  if (countryCount >= 31) return 10;
  if (countryCount >= 16) return 20;
  if (countryCount >= 8) return 40;
  if (countryCount >= 4) return 60;
  return 80;
}

/**
 * Hardcoded country totals per continent.
 * Based on countries.sql seed data.
 */
export const CONTINENT_TOTALS: Record<string, number> = {
  Africa: 55,
  Americas: 50,
  Asia: 52,
  Europe: 51,
  Oceania: 18,
  Antarctica: 1,
};
