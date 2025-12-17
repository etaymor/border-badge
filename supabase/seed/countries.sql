-- Seed file for country table
-- 227 countries/territories including:
-- - UN member states
-- - UN observers (Vatican, Palestine)
-- - Disputed territories (Kosovo, Taiwan, Northern Cyprus)
-- - Dependent territories (various)
-- - Special regions (Antarctica, Hong Kong, Macau, etc.)
-- Recognition types: un_member, observer, disputed, territory, dependent_territory, special_region, constituent_country
-- Subregions:
--   Europe: Core Europe, Nordics, Southern Europe, Balkans, Eastern Europe, British Isles
--   Asia: East & Southeast Asia, South Asia, Middle East, Central Asia
--   Africa: North Africa, East Africa, Southern Africa, West & Central Africa
--   Americas: North America, Central America, Caribbean, South America
--   Oceania: Australia & New Zealand, Pacific Islands

-- Clear existing countries and insert fresh data
TRUNCATE TABLE country CASCADE;

INSERT INTO country (code, name, region, subregion, recognition) VALUES
-- Africa - North Africa
('DZ', 'Algeria', 'Africa', 'North Africa', 'un_member'),
('EG', 'Egypt', 'Africa', 'North Africa', 'un_member'),
('LY', 'Libya', 'Africa', 'North Africa', 'un_member'),
('MA', 'Morocco', 'Africa', 'North Africa', 'un_member'),
('SD', 'Sudan', 'Africa', 'North Africa', 'un_member'),
('TN', 'Tunisia', 'Africa', 'North Africa', 'un_member'),

-- Africa - West & Central Africa
('BJ', 'Benin', 'Africa', 'West & Central Africa', 'un_member'),
('BF', 'Burkina Faso', 'Africa', 'West & Central Africa', 'un_member'),
('CV', 'Cape Verde', 'Africa', 'West & Central Africa', 'un_member'),
('CI', 'Ivory Coast', 'Africa', 'West & Central Africa', 'un_member'),
('GM', 'Gambia', 'Africa', 'West & Central Africa', 'un_member'),
('GH', 'Ghana', 'Africa', 'West & Central Africa', 'un_member'),
('GN', 'Guinea', 'Africa', 'West & Central Africa', 'un_member'),
('GW', 'Guinea-Bissau', 'Africa', 'West & Central Africa', 'un_member'),
('LR', 'Liberia', 'Africa', 'West & Central Africa', 'un_member'),
('ML', 'Mali', 'Africa', 'West & Central Africa', 'un_member'),
('MR', 'Mauritania', 'Africa', 'West & Central Africa', 'un_member'),
('NE', 'Niger', 'Africa', 'West & Central Africa', 'un_member'),
('NG', 'Nigeria', 'Africa', 'West & Central Africa', 'un_member'),
('SN', 'Senegal', 'Africa', 'West & Central Africa', 'un_member'),
('SL', 'Sierra Leone', 'Africa', 'West & Central Africa', 'un_member'),
('TG', 'Togo', 'Africa', 'West & Central Africa', 'un_member'),
('CM', 'Cameroon', 'Africa', 'West & Central Africa', 'un_member'),
('CF', 'Central African Republic', 'Africa', 'West & Central Africa', 'un_member'),
('TD', 'Chad', 'Africa', 'West & Central Africa', 'un_member'),
('CG', 'Republic of Congo', 'Africa', 'West & Central Africa', 'un_member'),
('CD', 'Democratic Republic of Congo', 'Africa', 'West & Central Africa', 'un_member'),
('GQ', 'Equatorial Guinea', 'Africa', 'West & Central Africa', 'un_member'),
('GA', 'Gabon', 'Africa', 'West & Central Africa', 'un_member'),
('ST', 'Sao Tome and Principe', 'Africa', 'West & Central Africa', 'un_member'),

-- Africa - East Africa
('BI', 'Burundi', 'Africa', 'East Africa', 'un_member'),
('KM', 'Comoros', 'Africa', 'East Africa', 'un_member'),
('DJ', 'Djibouti', 'Africa', 'East Africa', 'un_member'),
('ER', 'Eritrea', 'Africa', 'East Africa', 'un_member'),
('ET', 'Ethiopia', 'Africa', 'East Africa', 'un_member'),
('KE', 'Kenya', 'Africa', 'East Africa', 'un_member'),
('MG', 'Madagascar', 'Africa', 'East Africa', 'un_member'),
('MW', 'Malawi', 'Africa', 'East Africa', 'un_member'),
('MU', 'Mauritius', 'Africa', 'East Africa', 'un_member'),
('MZ', 'Mozambique', 'Africa', 'East Africa', 'un_member'),
('RW', 'Rwanda', 'Africa', 'East Africa', 'un_member'),
('SC', 'Seychelles', 'Africa', 'East Africa', 'un_member'),
('SO', 'Somalia', 'Africa', 'East Africa', 'un_member'),
('SS', 'South Sudan', 'Africa', 'East Africa', 'un_member'),
('TZ', 'Tanzania', 'Africa', 'East Africa', 'un_member'),
('UG', 'Uganda', 'Africa', 'East Africa', 'un_member'),
('ZM', 'Zambia', 'Africa', 'East Africa', 'un_member'),
('ZW', 'Zimbabwe', 'Africa', 'East Africa', 'un_member'),
('ZZ', 'Zanzibar', 'Africa', 'East Africa', 'special_region'),

-- Africa - Southern Africa
('AO', 'Angola', 'Africa', 'Southern Africa', 'un_member'),
('BW', 'Botswana', 'Africa', 'Southern Africa', 'un_member'),
('LS', 'Lesotho', 'Africa', 'Southern Africa', 'un_member'),
('NA', 'Namibia', 'Africa', 'Southern Africa', 'un_member'),
('ZA', 'South Africa', 'Africa', 'Southern Africa', 'un_member'),
('SZ', 'Swaziland', 'Africa', 'Southern Africa', 'un_member'),

-- Americas - North America
('CA', 'Canada', 'Americas', 'North America', 'un_member'),
('MX', 'Mexico', 'Americas', 'North America', 'un_member'),
('US', 'United States', 'Americas', 'North America', 'un_member'),
('BM', 'Bermuda', 'Americas', 'North America', 'dependent_territory'),
('GL', 'Greenland', 'Americas', 'North America', 'dependent_territory'),

-- Americas - Central America
('BZ', 'Belize', 'Americas', 'Central America', 'un_member'),
('CR', 'Costa Rica', 'Americas', 'Central America', 'un_member'),
('SV', 'El Salvador', 'Americas', 'Central America', 'un_member'),
('GT', 'Guatemala', 'Americas', 'Central America', 'un_member'),
('HN', 'Honduras', 'Americas', 'Central America', 'un_member'),
('NI', 'Nicaragua', 'Americas', 'Central America', 'un_member'),
('PA', 'Panama', 'Americas', 'Central America', 'un_member'),

-- Americas - Caribbean
('AG', 'Antigua and Barbuda', 'Americas', 'Caribbean', 'un_member'),
('BS', 'Bahamas', 'Americas', 'Caribbean', 'un_member'),
('BB', 'Barbados', 'Americas', 'Caribbean', 'un_member'),
('CU', 'Cuba', 'Americas', 'Caribbean', 'un_member'),
('DM', 'Dominica', 'Americas', 'Caribbean', 'un_member'),
('DO', 'Dominican Republic', 'Americas', 'Caribbean', 'un_member'),
('GD', 'Grenada', 'Americas', 'Caribbean', 'un_member'),
('HT', 'Haiti', 'Americas', 'Caribbean', 'un_member'),
('JM', 'Jamaica', 'Americas', 'Caribbean', 'un_member'),
('KN', 'Saint Kitts and Nevis', 'Americas', 'Caribbean', 'un_member'),
('LC', 'Saint Lucia', 'Americas', 'Caribbean', 'un_member'),
('VC', 'Saint Vincent and the Grenadines', 'Americas', 'Caribbean', 'un_member'),
('TT', 'Trinidad and Tobago', 'Americas', 'Caribbean', 'un_member'),
('AI', 'Anguilla', 'Americas', 'Caribbean', 'dependent_territory'),
('AW', 'Aruba', 'Americas', 'Caribbean', 'dependent_territory'),
('VG', 'BVI', 'Americas', 'Caribbean', 'dependent_territory'),
('KY', 'Cayman Islands', 'Americas', 'Caribbean', 'dependent_territory'),
('GP', 'Guadeloupe', 'Americas', 'Caribbean', 'dependent_territory'),
('MQ', 'Martinique', 'Americas', 'Caribbean', 'dependent_territory'),
('PR', 'Puerto Rico', 'Americas', 'Caribbean', 'dependent_territory'),
('BL', 'St. Barts', 'Americas', 'Caribbean', 'dependent_territory'),
('MF', 'Saint Martin', 'Americas', 'Caribbean', 'dependent_territory'),
('TC', 'Turks and Caicos', 'Americas', 'Caribbean', 'dependent_territory'),
('VI', 'USVI', 'Americas', 'Caribbean', 'dependent_territory'),

-- Americas - South America
('AR', 'Argentina', 'Americas', 'South America', 'un_member'),
('BO', 'Bolivia', 'Americas', 'South America', 'un_member'),
('BR', 'Brazil', 'Americas', 'South America', 'un_member'),
('CL', 'Chile', 'Americas', 'South America', 'un_member'),
('CO', 'Colombia', 'Americas', 'South America', 'un_member'),
('EC', 'Ecuador', 'Americas', 'South America', 'un_member'),
('GY', 'Guyana', 'Americas', 'South America', 'un_member'),
('PY', 'Paraguay', 'Americas', 'South America', 'un_member'),
('PE', 'Peru', 'Americas', 'South America', 'un_member'),
('SR', 'Suriname', 'Americas', 'South America', 'un_member'),
('UY', 'Uruguay', 'Americas', 'South America', 'un_member'),
('VE', 'Venezuela', 'Americas', 'South America', 'un_member'),
('FK', 'Falkland Islands', 'Americas', 'South America', 'dependent_territory'),
('GF', 'French Guiana', 'Americas', 'South America', 'dependent_territory'),

-- Asia - Middle East
('BH', 'Bahrain', 'Asia', 'Middle East', 'un_member'),
('CY', 'Cyprus', 'Asia', 'Middle East', 'un_member'),
('IR', 'Iran', 'Asia', 'Middle East', 'un_member'),
('IQ', 'Iraq', 'Asia', 'Middle East', 'un_member'),
('IL', 'Israel', 'Asia', 'Middle East', 'un_member'),
('JO', 'Jordan', 'Asia', 'Middle East', 'un_member'),
('KW', 'Kuwait', 'Asia', 'Middle East', 'un_member'),
('LB', 'Lebanon', 'Asia', 'Middle East', 'un_member'),
('OM', 'Oman', 'Asia', 'Middle East', 'un_member'),
('QA', 'Qatar', 'Asia', 'Middle East', 'un_member'),
('SA', 'Saudi Arabia', 'Asia', 'Middle East', 'un_member'),
('SY', 'Syria', 'Asia', 'Middle East', 'un_member'),
('TR', 'Turkey', 'Asia', 'Middle East', 'un_member'),
('AE', 'United Arab Emirates', 'Asia', 'Middle East', 'un_member'),
('YE', 'Yemen', 'Asia', 'Middle East', 'un_member'),
('PS', 'Palestine', 'Asia', 'Middle East', 'observer'),
('XN', 'Northern Cyprus', 'Asia', 'Middle East', 'disputed'),

-- Asia - Central Asia (includes Caucasus)
('AF', 'Afghanistan', 'Asia', 'Central Asia', 'un_member'),
('KZ', 'Kazakhstan', 'Asia', 'Central Asia', 'un_member'),
('KG', 'Kyrgyzstan', 'Asia', 'Central Asia', 'un_member'),
('MN', 'Mongolia', 'Asia', 'Central Asia', 'un_member'),
('TJ', 'Tajikistan', 'Asia', 'Central Asia', 'un_member'),
('TM', 'Turkmenistan', 'Asia', 'Central Asia', 'un_member'),
('UZ', 'Uzbekistan', 'Asia', 'Central Asia', 'un_member'),
('AM', 'Armenia', 'Asia', 'Central Asia', 'un_member'),
('AZ', 'Azerbaijan', 'Asia', 'Central Asia', 'un_member'),
('GE', 'Georgia', 'Asia', 'Central Asia', 'un_member'),

-- Asia - South Asia
('BD', 'Bangladesh', 'Asia', 'South Asia', 'un_member'),
('BT', 'Bhutan', 'Asia', 'South Asia', 'un_member'),
('IN', 'India', 'Asia', 'South Asia', 'un_member'),
('MV', 'Maldives', 'Asia', 'South Asia', 'un_member'),
('NP', 'Nepal', 'Asia', 'South Asia', 'un_member'),
('PK', 'Pakistan', 'Asia', 'South Asia', 'un_member'),
('LK', 'Sri Lanka', 'Asia', 'South Asia', 'un_member'),

-- Asia - East & Southeast Asia
('BN', 'Brunei', 'Asia', 'East & Southeast Asia', 'un_member'),
('KH', 'Cambodia', 'Asia', 'East & Southeast Asia', 'un_member'),
('ID', 'Indonesia', 'Asia', 'East & Southeast Asia', 'un_member'),
('LA', 'Laos', 'Asia', 'East & Southeast Asia', 'un_member'),
('MY', 'Malaysia', 'Asia', 'East & Southeast Asia', 'un_member'),
('MM', 'Myanmar', 'Asia', 'East & Southeast Asia', 'un_member'),
('PH', 'Philippines', 'Asia', 'East & Southeast Asia', 'un_member'),
('SG', 'Singapore', 'Asia', 'East & Southeast Asia', 'un_member'),
('TH', 'Thailand', 'Asia', 'East & Southeast Asia', 'un_member'),
('TL', 'East Timor', 'Asia', 'East & Southeast Asia', 'un_member'),
('VN', 'Vietnam', 'Asia', 'East & Southeast Asia', 'un_member'),
('CN', 'China', 'Asia', 'East & Southeast Asia', 'un_member'),
('JP', 'Japan', 'Asia', 'East & Southeast Asia', 'un_member'),
('KP', 'North Korea', 'Asia', 'East & Southeast Asia', 'un_member'),
('KR', 'South Korea', 'Asia', 'East & Southeast Asia', 'un_member'),
('TW', 'Taiwan', 'Asia', 'East & Southeast Asia', 'disputed'),
('HK', 'Hong Kong', 'Asia', 'East & Southeast Asia', 'special_region'),
('MO', 'Macau', 'Asia', 'East & Southeast Asia', 'special_region'),

-- Europe - Core Europe
('AT', 'Austria', 'Europe', 'Core Europe', 'un_member'),
('BE', 'Belgium', 'Europe', 'Core Europe', 'un_member'),
('FR', 'France', 'Europe', 'Core Europe', 'un_member'),
('DE', 'Germany', 'Europe', 'Core Europe', 'un_member'),
('LI', 'Liechtenstein', 'Europe', 'Core Europe', 'un_member'),
('LU', 'Luxembourg', 'Europe', 'Core Europe', 'un_member'),
('MC', 'Monaco', 'Europe', 'Core Europe', 'un_member'),
('NL', 'Netherlands', 'Europe', 'Core Europe', 'un_member'),
('CH', 'Switzerland', 'Europe', 'Core Europe', 'un_member'),

-- Europe - Nordics
('DK', 'Denmark', 'Europe', 'Nordics', 'un_member'),
('FI', 'Finland', 'Europe', 'Nordics', 'un_member'),
('IS', 'Iceland', 'Europe', 'Nordics', 'un_member'),
('NO', 'Norway', 'Europe', 'Nordics', 'un_member'),
('SE', 'Sweden', 'Europe', 'Nordics', 'un_member'),
('FO', 'Faroe Islands', 'Europe', 'Nordics', 'dependent_territory'),

-- Europe - British Isles
('GB', 'United Kingdom', 'Europe', 'British Isles', 'un_member'),
('IE', 'Ireland', 'Europe', 'British Isles', 'un_member'),
('IM', 'Isle of Man', 'Europe', 'British Isles', 'dependent_territory'),
('XI', 'Northern Ireland', 'Europe', 'British Isles', 'constituent_country'),
('XS', 'Scotland', 'Europe', 'British Isles', 'constituent_country'),
('XW', 'Wales', 'Europe', 'British Isles', 'constituent_country'),

-- Europe - Eastern Europe (includes Baltic states)
('BY', 'Belarus', 'Europe', 'Eastern Europe', 'un_member'),
('BG', 'Bulgaria', 'Europe', 'Eastern Europe', 'un_member'),
('CZ', 'Czech Republic', 'Europe', 'Eastern Europe', 'un_member'),
('EE', 'Estonia', 'Europe', 'Eastern Europe', 'un_member'),
('HU', 'Hungary', 'Europe', 'Eastern Europe', 'un_member'),
('LV', 'Latvia', 'Europe', 'Eastern Europe', 'un_member'),
('LT', 'Lithuania', 'Europe', 'Eastern Europe', 'un_member'),
('MD', 'Moldova', 'Europe', 'Eastern Europe', 'un_member'),
('PL', 'Poland', 'Europe', 'Eastern Europe', 'un_member'),
('RO', 'Romania', 'Europe', 'Eastern Europe', 'un_member'),
('RU', 'Russia', 'Europe', 'Eastern Europe', 'un_member'),
('SK', 'Slovakia', 'Europe', 'Eastern Europe', 'un_member'),
('UA', 'Ukraine', 'Europe', 'Eastern Europe', 'un_member'),

-- Europe - Balkans
('AL', 'Albania', 'Europe', 'Balkans', 'un_member'),
('BA', 'Bosnia and Herzegovina', 'Europe', 'Balkans', 'un_member'),
('HR', 'Croatia', 'Europe', 'Balkans', 'un_member'),
('ME', 'Montenegro', 'Europe', 'Balkans', 'un_member'),
('MK', 'North Macedonia', 'Europe', 'Balkans', 'un_member'),
('RS', 'Serbia', 'Europe', 'Balkans', 'un_member'),
('SI', 'Slovenia', 'Europe', 'Balkans', 'un_member'),
('XK', 'Kosovo', 'Europe', 'Balkans', 'disputed'),

-- Europe - Southern Europe
('AD', 'Andorra', 'Europe', 'Southern Europe', 'un_member'),
('GR', 'Greece', 'Europe', 'Southern Europe', 'un_member'),
('IT', 'Italy', 'Europe', 'Southern Europe', 'un_member'),
('MT', 'Malta', 'Europe', 'Southern Europe', 'un_member'),
('PT', 'Portugal', 'Europe', 'Southern Europe', 'un_member'),
('SM', 'San Marino', 'Europe', 'Southern Europe', 'un_member'),
('ES', 'Spain', 'Europe', 'Southern Europe', 'un_member'),
('VA', 'Vatican City', 'Europe', 'Southern Europe', 'observer'),
('GI', 'Gibraltar', 'Europe', 'Southern Europe', 'dependent_territory'),

-- Oceania - Australia & New Zealand
('AU', 'Australia', 'Oceania', 'Australia & New Zealand', 'un_member'),
('NZ', 'New Zealand', 'Oceania', 'Australia & New Zealand', 'un_member'),

-- Oceania - Pacific Islands
('FJ', 'Fiji', 'Oceania', 'Pacific Islands', 'un_member'),
('PG', 'Papua New Guinea', 'Oceania', 'Pacific Islands', 'un_member'),
('SB', 'Solomon Islands', 'Oceania', 'Pacific Islands', 'un_member'),
('VU', 'Vanuatu', 'Oceania', 'Pacific Islands', 'un_member'),
('KI', 'Kiribati', 'Oceania', 'Pacific Islands', 'un_member'),
('MH', 'Marshall Islands', 'Oceania', 'Pacific Islands', 'un_member'),
('FM', 'Micronesia', 'Oceania', 'Pacific Islands', 'un_member'),
('NR', 'Nauru', 'Oceania', 'Pacific Islands', 'un_member'),
('PW', 'Palau', 'Oceania', 'Pacific Islands', 'un_member'),
('GU', 'Guam', 'Oceania', 'Pacific Islands', 'dependent_territory'),
('WS', 'Samoa', 'Oceania', 'Pacific Islands', 'un_member'),
('TO', 'Tonga', 'Oceania', 'Pacific Islands', 'un_member'),
('TV', 'Tuvalu', 'Oceania', 'Pacific Islands', 'un_member'),
('AS', 'American Samoa', 'Oceania', 'Pacific Islands', 'dependent_territory'),
('CK', 'Cook Islands', 'Oceania', 'Pacific Islands', 'dependent_territory'),
('PF', 'French Polynesia', 'Oceania', 'Pacific Islands', 'dependent_territory'),

-- Antarctica
('AQ', 'Antarctica', 'Antarctica', 'Antarctica', 'territory');
