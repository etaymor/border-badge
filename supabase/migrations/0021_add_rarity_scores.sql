-- Add rarity_score column to country table
-- Rarity scores: 1-10, higher = rarer destination
-- Used for share cards to highlight the "most unique" country visited per continent

ALTER TABLE country ADD COLUMN IF NOT EXISTS rarity_score INTEGER DEFAULT 5;

-- Score 10: Extremely rare (small territories, remote islands, conflict zones)
UPDATE country SET rarity_score = 10 WHERE code IN (
  'AQ',  -- Antarctica
  'NU',  -- Niue
  'TK',  -- Tokelau
  'PN',  -- Pitcairn Islands
  'NR',  -- Nauru
  'TV',  -- Tuvalu
  'KI',  -- Kiribati
  'MH',  -- Marshall Islands
  'FM',  -- Micronesia
  'PW',  -- Palau
  'ER',  -- Eritrea
  'TM',  -- Turkmenistan
  'KP',  -- North Korea
  'SO',  -- Somalia
  'SS',  -- South Sudan
  'CF',  -- Central African Republic
  'TD',  -- Chad
  'SH',  -- Saint Helena
  'FK',  -- Falkland Islands
  'GS'   -- South Georgia
);

-- Score 9: Very rare (remote destinations, visa-difficult)
UPDATE country SET rarity_score = 9 WHERE code IN (
  'BT',  -- Bhutan
  'MN',  -- Mongolia
  'LA',  -- Laos
  'TJ',  -- Tajikistan
  'KG',  -- Kyrgyzstan
  'UZ',  -- Uzbekistan
  'AF',  -- Afghanistan
  'YE',  -- Yemen
  'SY',  -- Syria
  'LY',  -- Libya
  'BI',  -- Burundi
  'DJ',  -- Djibouti
  'KM',  -- Comoros
  'GW',  -- Guinea-Bissau
  'ST',  -- Sao Tome
  'GQ',  -- Equatorial Guinea
  'ZZ',  -- Zanzibar
  'SC',  -- Seychelles
  'MV',  -- Maldives
  'WF',  -- Wallis and Futuna
  'AS',  -- American Samoa
  'GU',  -- Guam
  'MP',  -- Northern Mariana Islands
  'CK',  -- Cook Islands
  'WS',  -- Samoa
  'TO',  -- Tonga
  'VU',  -- Vanuatu
  'SB',  -- Solomon Islands
  'PG',  -- Papua New Guinea
  'TL',  -- Timor-Leste
  'BN',  -- Brunei
  'XK',  -- Kosovo
  'XN',  -- Northern Cyprus
  'XI',  -- Somaliland
  'XS',  -- South Ossetia
  'XW'   -- Western Sahara
);

-- Score 8: Rare (off the beaten path)
UPDATE country SET rarity_score = 8 WHERE code IN (
  'MG',  -- Madagascar
  'MW',  -- Malawi
  'ZM',  -- Zambia
  'MZ',  -- Mozambique
  'AO',  -- Angola
  'CG',  -- Republic of Congo
  'CD',  -- DRC
  'GA',  -- Gabon
  'CM',  -- Cameroon
  'NE',  -- Niger
  'ML',  -- Mali
  'MR',  -- Mauritania
  'SL',  -- Sierra Leone
  'LR',  -- Liberia
  'GN',  -- Guinea
  'SN',  -- Senegal
  'BF',  -- Burkina Faso
  'TG',  -- Togo
  'BJ',  -- Benin
  'RW',  -- Rwanda
  'UG',  -- Uganda
  'NP',  -- Nepal
  'BD',  -- Bangladesh
  'MM',  -- Myanmar
  'PK',  -- Pakistan
  'IR',  -- Iran
  'IQ',  -- Iraq
  'OM',  -- Oman
  'BH',  -- Bahrain
  'KW',  -- Kuwait
  'AM',  -- Armenia
  'AZ',  -- Azerbaijan
  'GE',  -- Georgia
  'BY',  -- Belarus
  'MD',  -- Moldova
  'UA',  -- Ukraine
  'AL',  -- Albania
  'MK',  -- North Macedonia
  'ME',  -- Montenegro
  'BA',  -- Bosnia
  'GL',  -- Greenland
  'IS',  -- Iceland
  'FO',  -- Faroe Islands
  'SJ',  -- Svalbard
  'SR',  -- Suriname
  'GY',  -- Guyana
  'GF',  -- French Guiana
  'PY',  -- Paraguay
  'BO',  -- Bolivia
  'HN',  -- Honduras
  'NI',  -- Nicaragua
  'HT',  -- Haiti
  'CU',  -- Cuba
  'NC',  -- New Caledonia
  'FJ',  -- Fiji
  'PF'   -- French Polynesia
);

-- Score 7: Uncommon
UPDATE country SET rarity_score = 7 WHERE code IN (
  'ET',  -- Ethiopia
  'KE',  -- Kenya
  'TZ',  -- Tanzania
  'ZW',  -- Zimbabwe
  'BW',  -- Botswana
  'NA',  -- Namibia
  'LS',  -- Lesotho
  'SZ',  -- Eswatini
  'CV',  -- Cape Verde
  'GM',  -- Gambia
  'GH',  -- Ghana
  'CI',  -- Ivory Coast
  'NG',  -- Nigeria
  'EG',  -- Egypt
  'SD',  -- Sudan
  'LK',  -- Sri Lanka
  'IN',  -- India
  'VN',  -- Vietnam
  'KH',  -- Cambodia
  'PH',  -- Philippines
  'ID',  -- Indonesia
  'MY',  -- Malaysia
  'SA',  -- Saudi Arabia
  'QA',  -- Qatar
  'AE',  -- UAE
  'JO',  -- Jordan
  'LB',  -- Lebanon
  'PS',  -- Palestine
  'RU',  -- Russia
  'KZ',  -- Kazakhstan
  'SK',  -- Slovakia
  'SI',  -- Slovenia
  'LV',  -- Latvia
  'LT',  -- Lithuania
  'EE',  -- Estonia
  'RO',  -- Romania
  'BG',  -- Bulgaria
  'RS',  -- Serbia
  'EC',  -- Ecuador
  'CO',  -- Colombia
  'VE',  -- Venezuela
  'UY',  -- Uruguay
  'GT',  -- Guatemala
  'SV',  -- El Salvador
  'BZ',  -- Belize
  'JM',  -- Jamaica
  'TT',  -- Trinidad
  'BB',  -- Barbados
  'LC',  -- Saint Lucia
  'GD',  -- Grenada
  'DM',  -- Dominica
  'VC',  -- St Vincent
  'AG',  -- Antigua
  'KN',  -- St Kitts
  'NZ',  -- New Zealand
  'AU'   -- Australia
);

-- Score 6: Moderate
UPDATE country SET rarity_score = 6 WHERE code IN (
  'MA',  -- Morocco
  'TN',  -- Tunisia
  'ZA',  -- South Africa
  'MU',  -- Mauritius
  'TW',  -- Taiwan
  'KR',  -- South Korea
  'TH',  -- Thailand
  'SG',  -- Singapore
  'HK',  -- Hong Kong
  'MO',  -- Macau
  'IL',  -- Israel
  'TR',  -- Turkey
  'CY',  -- Cyprus
  'FI',  -- Finland
  'NO',  -- Norway
  'SE',  -- Sweden
  'DK',  -- Denmark
  'PL',  -- Poland
  'CZ',  -- Czech Republic
  'HU',  -- Hungary
  'HR',  -- Croatia
  'GR',  -- Greece
  'MT',  -- Malta
  'PE',  -- Peru
  'AR',  -- Argentina
  'CL',  -- Chile
  'BR',  -- Brazil
  'CR',  -- Costa Rica
  'PA',  -- Panama
  'DO',  -- Dominican Republic
  'BS',  -- Bahamas
  'PR',  -- Puerto Rico
  'VI',  -- US Virgin Islands
  'VG',  -- British Virgin Islands
  'AI',  -- Anguilla
  'TC',  -- Turks and Caicos
  'KY',  -- Cayman Islands
  'AW',  -- Aruba
  'CW',  -- Curacao
  'SX',  -- Sint Maarten
  'MF',  -- Saint Martin
  'BQ',  -- Caribbean Netherlands
  'BM'   -- Bermuda
);

-- Score 5: Common (default - major destinations)
UPDATE country SET rarity_score = 5 WHERE code IN (
  'JP',  -- Japan
  'CN',  -- China
  'IE',  -- Ireland
  'GB',  -- United Kingdom
  'PT',  -- Portugal
  'AT',  -- Austria
  'CH',  -- Switzerland
  'BE',  -- Belgium
  'NL',  -- Netherlands
  'LU',  -- Luxembourg
  'MC',  -- Monaco
  'AD',  -- Andorra
  'SM',  -- San Marino
  'MX',  -- Mexico
  'CA'   -- Canada
);

-- Score 4: Very common
UPDATE country SET rarity_score = 4 WHERE code IN (
  'US',  -- United States
  'FR',  -- France
  'ES',  -- Spain
  'IT',  -- Italy
  'DE'   -- Germany
);

-- Score 3: Tiny European microstates (easy day trips but still counts)
UPDATE country SET rarity_score = 3 WHERE code IN (
  'VA',  -- Vatican
  'LI'   -- Liechtenstein
);
