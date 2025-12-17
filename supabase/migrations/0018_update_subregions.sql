-- Migration to update subregion values to new simplified groupings
-- Europe: 6 subregions (Core Europe, Nordics, Southern Europe, Balkans, Eastern Europe, British Isles)
-- Asia: 4 subregions (East & Southeast Asia, South Asia, Middle East, Central Asia)
-- Africa: 4 subregions (North Africa, East Africa, Southern Africa, West & Central Africa)
-- Americas: 4 subregions (North America, Central America, Caribbean, South America) - unchanged
-- Oceania: 2 subregions (Australia & New Zealand, Pacific Islands)

-- ============================================
-- EUROPE - 6 subregions
-- ============================================

-- Core Europe (was Western Europe, minus microstates that go elsewhere)
UPDATE country SET subregion = 'Core Europe' WHERE code IN (
  'AT',  -- Austria
  'BE',  -- Belgium
  'FR',  -- France
  'DE',  -- Germany
  'LI',  -- Liechtenstein
  'LU',  -- Luxembourg
  'MC',  -- Monaco
  'NL',  -- Netherlands
  'CH'   -- Switzerland
);

-- Nordics (from Northern Europe)
UPDATE country SET subregion = 'Nordics' WHERE code IN (
  'DK',  -- Denmark
  'FI',  -- Finland
  'IS',  -- Iceland
  'NO',  -- Norway
  'SE',  -- Sweden
  'FO'   -- Faroe Islands
);

-- British Isles (from Northern Europe)
UPDATE country SET subregion = 'British Isles' WHERE code IN (
  'GB',  -- United Kingdom
  'IE',  -- Ireland
  'IM',  -- Isle of Man
  'XI',  -- Northern Ireland
  'XS',  -- Scotland
  'XW'   -- Wales
);

-- Balkans (from Southern Europe)
UPDATE country SET subregion = 'Balkans' WHERE code IN (
  'AL',  -- Albania
  'BA',  -- Bosnia and Herzegovina
  'HR',  -- Croatia
  'XK',  -- Kosovo
  'ME',  -- Montenegro
  'MK',  -- North Macedonia
  'RS',  -- Serbia
  'SI'   -- Slovenia
);

-- Southern Europe (subset of old Southern Europe, without Balkans)
UPDATE country SET subregion = 'Southern Europe' WHERE code IN (
  'AD',  -- Andorra
  'GR',  -- Greece
  'IT',  -- Italy
  'MT',  -- Malta
  'PT',  -- Portugal
  'SM',  -- San Marino
  'ES',  -- Spain
  'VA',  -- Vatican City
  'GI'   -- Gibraltar
);

-- Eastern Europe (was Eastern Europe + Baltic states from Northern Europe)
UPDATE country SET subregion = 'Eastern Europe' WHERE code IN (
  'BY',  -- Belarus
  'BG',  -- Bulgaria
  'CZ',  -- Czech Republic
  'HU',  -- Hungary
  'MD',  -- Moldova
  'PL',  -- Poland
  'RO',  -- Romania
  'RU',  -- Russia
  'SK',  -- Slovakia
  'UA',  -- Ukraine
  'EE',  -- Estonia (was Northern Europe)
  'LV',  -- Latvia (was Northern Europe)
  'LT'   -- Lithuania (was Northern Europe)
);

-- ============================================
-- ASIA - 4 subregions
-- ============================================

-- East & Southeast Asia (combining East Asia and Southeast Asia)
UPDATE country SET subregion = 'East & Southeast Asia' WHERE code IN (
  -- East Asia
  'CN',  -- China
  'JP',  -- Japan
  'KP',  -- North Korea
  'KR',  -- South Korea
  'TW',  -- Taiwan
  'HK',  -- Hong Kong
  'MO',  -- Macau
  -- Southeast Asia
  'BN',  -- Brunei
  'KH',  -- Cambodia
  'ID',  -- Indonesia
  'LA',  -- Laos
  'MY',  -- Malaysia
  'MM',  -- Myanmar
  'PH',  -- Philippines
  'SG',  -- Singapore
  'TH',  -- Thailand
  'TL',  -- East Timor
  'VN'   -- Vietnam
);

-- South Asia - unchanged
-- (Bangladesh, Bhutan, India, Maldives, Nepal, Pakistan, Sri Lanka already have 'South Asia')

-- Middle East - unchanged
-- (Bahrain, Cyprus, Iran, Iraq, Israel, Jordan, Kuwait, Lebanon, Oman, Qatar, Saudi Arabia,
--  Syria, Turkey, UAE, Yemen, Palestine, Northern Cyprus already have 'Middle East')

-- Central Asia - unchanged (includes Caucasus)
-- (Afghanistan, Kazakhstan, Kyrgyzstan, Mongolia, Tajikistan, Turkmenistan, Uzbekistan,
--  Armenia, Azerbaijan, Georgia already have 'Central Asia')

-- ============================================
-- AFRICA - 4 subregions
-- ============================================

-- North Africa (was Northern Africa)
UPDATE country SET subregion = 'North Africa' WHERE code IN (
  'DZ',  -- Algeria
  'EG',  -- Egypt
  'LY',  -- Libya
  'MA',  -- Morocco
  'SD',  -- Sudan
  'TN'   -- Tunisia
);

-- East Africa - unchanged
-- (Burundi, Comoros, Djibouti, Eritrea, Ethiopia, Kenya, Madagascar, Malawi, Mauritius,
--  Mozambique, Rwanda, Seychelles, Somalia, South Sudan, Tanzania, Uganda, Zambia,
--  Zimbabwe, Zanzibar already have 'Eastern Africa')
UPDATE country SET subregion = 'East Africa' WHERE subregion = 'Eastern Africa';

-- Southern Africa - unchanged
-- (Angola, Botswana, Lesotho, Namibia, South Africa, Swaziland already have 'Southern Africa')

-- West & Central Africa (combining Western Africa and Central Africa)
UPDATE country SET subregion = 'West & Central Africa' WHERE code IN (
  -- Western Africa
  'BJ',  -- Benin
  'BF',  -- Burkina Faso
  'CV',  -- Cape Verde
  'CI',  -- Ivory Coast
  'GM',  -- Gambia
  'GH',  -- Ghana
  'GN',  -- Guinea
  'GW',  -- Guinea-Bissau
  'LR',  -- Liberia
  'ML',  -- Mali
  'MR',  -- Mauritania
  'NE',  -- Niger
  'NG',  -- Nigeria
  'SN',  -- Senegal
  'SL',  -- Sierra Leone
  'TG',  -- Togo
  -- Central Africa
  'CM',  -- Cameroon
  'CF',  -- Central African Republic
  'TD',  -- Chad
  'CG',  -- Republic of Congo
  'CD',  -- Democratic Republic of Congo
  'GQ',  -- Equatorial Guinea
  'GA',  -- Gabon
  'ST'   -- Sao Tome and Principe
);

-- ============================================
-- AMERICAS - 4 subregions (unchanged)
-- ============================================
-- North America, Central America, Caribbean, South America remain the same

-- ============================================
-- OCEANIA - 2 subregions
-- ============================================

-- Australia & New Zealand (was Australia/New Zealand)
UPDATE country SET subregion = 'Australia & New Zealand' WHERE code IN (
  'AU',  -- Australia
  'NZ'   -- New Zealand
);

-- Pacific Islands (combining Melanesia, Micronesia, Polynesia)
UPDATE country SET subregion = 'Pacific Islands' WHERE code IN (
  -- Melanesia
  'FJ',  -- Fiji
  'PG',  -- Papua New Guinea
  'SB',  -- Solomon Islands
  'VU',  -- Vanuatu
  -- Micronesia
  'KI',  -- Kiribati
  'MH',  -- Marshall Islands
  'FM',  -- Micronesia
  'NR',  -- Nauru
  'PW',  -- Palau
  'GU',  -- Guam
  -- Polynesia
  'WS',  -- Samoa
  'TO',  -- Tonga
  'TV',  -- Tuvalu
  'AS',  -- American Samoa
  'CK',  -- Cook Islands
  'PF'   -- French Polynesia
);

-- Add comment for documentation
COMMENT ON COLUMN country.subregion IS 'Granular regional grouping within continent. Europe: Core Europe, Nordics, Southern Europe, Balkans, Eastern Europe, British Isles. Asia: East & Southeast Asia, South Asia, Middle East, Central Asia. Africa: North Africa, East Africa, Southern Africa, West & Central Africa. Americas: North America, Central America, Caribbean, South America. Oceania: Australia & New Zealand, Pacific Islands.';
