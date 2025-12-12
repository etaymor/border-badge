-- Seed file for country table
-- 227 countries/territories including:
-- - UN member states
-- - UN observers (Vatican, Palestine)
-- - Disputed territories (Kosovo, Taiwan, Northern Cyprus)
-- - Dependent territories (various)
-- - Special regions (Antarctica, Hong Kong, Macau, etc.)
-- Recognition types: un_member, observer, disputed, territory, dependent_territory, special_region, constituent_country
-- Subregions: Northern/Western/Eastern/Central/Southern Africa, North/Central America, Caribbean, South America,
--             Middle East, Central/South/Southeast/East Asia, Northern/Western/Eastern/Southern Europe,
--             Australia/New Zealand, Melanesia, Micronesia, Polynesia

-- Clear existing countries and insert fresh data
TRUNCATE TABLE country CASCADE;

INSERT INTO country (code, name, region, subregion, recognition) VALUES
-- Africa - Northern Africa
('DZ', 'Algeria', 'Africa', 'Northern Africa', 'un_member'),
('EG', 'Egypt', 'Africa', 'Northern Africa', 'un_member'),
('LY', 'Libya', 'Africa', 'Northern Africa', 'un_member'),
('MA', 'Morocco', 'Africa', 'Northern Africa', 'un_member'),
('SD', 'Sudan', 'Africa', 'Northern Africa', 'un_member'),
('TN', 'Tunisia', 'Africa', 'Northern Africa', 'un_member'),

-- Africa - Western Africa
('BJ', 'Benin', 'Africa', 'Western Africa', 'un_member'),
('BF', 'Burkina Faso', 'Africa', 'Western Africa', 'un_member'),
('CV', 'Cape Verde', 'Africa', 'Western Africa', 'un_member'),
('CI', 'Ivory Coast', 'Africa', 'Western Africa', 'un_member'),
('GM', 'Gambia', 'Africa', 'Western Africa', 'un_member'),
('GH', 'Ghana', 'Africa', 'Western Africa', 'un_member'),
('GN', 'Guinea', 'Africa', 'Western Africa', 'un_member'),
('GW', 'Guinea-Bissau', 'Africa', 'Western Africa', 'un_member'),
('LR', 'Liberia', 'Africa', 'Western Africa', 'un_member'),
('ML', 'Mali', 'Africa', 'Western Africa', 'un_member'),
('MR', 'Mauritania', 'Africa', 'Western Africa', 'un_member'),
('NE', 'Niger', 'Africa', 'Western Africa', 'un_member'),
('NG', 'Nigeria', 'Africa', 'Western Africa', 'un_member'),
('SN', 'Senegal', 'Africa', 'Western Africa', 'un_member'),
('SL', 'Sierra Leone', 'Africa', 'Western Africa', 'un_member'),
('TG', 'Togo', 'Africa', 'Western Africa', 'un_member'),

-- Africa - Eastern Africa
('BI', 'Burundi', 'Africa', 'Eastern Africa', 'un_member'),
('KM', 'Comoros', 'Africa', 'Eastern Africa', 'un_member'),
('DJ', 'Djibouti', 'Africa', 'Eastern Africa', 'un_member'),
('ER', 'Eritrea', 'Africa', 'Eastern Africa', 'un_member'),
('ET', 'Ethiopia', 'Africa', 'Eastern Africa', 'un_member'),
('KE', 'Kenya', 'Africa', 'Eastern Africa', 'un_member'),
('MG', 'Madagascar', 'Africa', 'Eastern Africa', 'un_member'),
('MW', 'Malawi', 'Africa', 'Eastern Africa', 'un_member'),
('MU', 'Mauritius', 'Africa', 'Eastern Africa', 'un_member'),
('MZ', 'Mozambique', 'Africa', 'Eastern Africa', 'un_member'),
('RW', 'Rwanda', 'Africa', 'Eastern Africa', 'un_member'),
('SC', 'Seychelles', 'Africa', 'Eastern Africa', 'un_member'),
('SO', 'Somalia', 'Africa', 'Eastern Africa', 'un_member'),
('SS', 'South Sudan', 'Africa', 'Eastern Africa', 'un_member'),
('TZ', 'Tanzania', 'Africa', 'Eastern Africa', 'un_member'),
('UG', 'Uganda', 'Africa', 'Eastern Africa', 'un_member'),
('ZM', 'Zambia', 'Africa', 'Eastern Africa', 'un_member'),
('ZW', 'Zimbabwe', 'Africa', 'Eastern Africa', 'un_member'),
('EH', 'Zanzibar', 'Africa', 'Eastern Africa', 'special_region'),

-- Africa - Central Africa
('CM', 'Cameroon', 'Africa', 'Central Africa', 'un_member'),
('CF', 'Central African Republic', 'Africa', 'Central Africa', 'un_member'),
('TD', 'Chad', 'Africa', 'Central Africa', 'un_member'),
('CG', 'Republic of Congo', 'Africa', 'Central Africa', 'un_member'),
('CD', 'Democratic Republic of Congo', 'Africa', 'Central Africa', 'un_member'),
('GQ', 'Equatorial Guinea', 'Africa', 'Central Africa', 'un_member'),
('GA', 'Gabon', 'Africa', 'Central Africa', 'un_member'),
('ST', 'Sao Tome and Principe', 'Africa', 'Central Africa', 'un_member'),

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
('AI', 'Anguila', 'Americas', 'Caribbean', 'dependent_territory'),
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
('NC', 'Northern Cyprus', 'Asia', 'Middle East', 'disputed'),

-- Asia - Central Asia
('AF', 'Afghanistan', 'Asia', 'Central Asia', 'un_member'),
('KZ', 'Kazakhstan', 'Asia', 'Central Asia', 'un_member'),
('KG', 'Kyrgyzstan', 'Asia', 'Central Asia', 'un_member'),
('MN', 'Mongolia', 'Asia', 'Central Asia', 'un_member'),
('TJ', 'Tajikistan', 'Asia', 'Central Asia', 'un_member'),
('TM', 'Turkmenistan', 'Asia', 'Central Asia', 'un_member'),
('UZ', 'Uzbekistan', 'Asia', 'Central Asia', 'un_member'),

-- Asia - South Asia
('BD', 'Bangladesh', 'Asia', 'South Asia', 'un_member'),
('BT', 'Bhutan', 'Asia', 'South Asia', 'un_member'),
('IN', 'India', 'Asia', 'South Asia', 'un_member'),
('MV', 'Maldives', 'Asia', 'South Asia', 'un_member'),
('NP', 'Nepal', 'Asia', 'South Asia', 'un_member'),
('PK', 'Pakistan', 'Asia', 'South Asia', 'un_member'),
('LK', 'Sri Lanka', 'Asia', 'South Asia', 'un_member'),

-- Asia - Southeast Asia
('BN', 'Brunei', 'Asia', 'Southeast Asia', 'un_member'),
('KH', 'Cambodia', 'Asia', 'Southeast Asia', 'un_member'),
('ID', 'Indonesia', 'Asia', 'Southeast Asia', 'un_member'),
('LA', 'Laos', 'Asia', 'Southeast Asia', 'un_member'),
('MY', 'Malaysia', 'Asia', 'Southeast Asia', 'un_member'),
('MM', 'Myanmar', 'Asia', 'Southeast Asia', 'un_member'),
('PH', 'Philippines', 'Asia', 'Southeast Asia', 'un_member'),
('SG', 'Singapore', 'Asia', 'Southeast Asia', 'un_member'),
('TH', 'Thailand', 'Asia', 'Southeast Asia', 'un_member'),
('TL', 'East Timor', 'Asia', 'Southeast Asia', 'un_member'),
('VN', 'Vietnam', 'Asia', 'Southeast Asia', 'un_member'),

-- Asia - East Asia
('CN', 'China', 'Asia', 'East Asia', 'un_member'),
('JP', 'Japan', 'Asia', 'East Asia', 'un_member'),
('KP', 'North Korea', 'Asia', 'East Asia', 'un_member'),
('KR', 'South Korea', 'Asia', 'East Asia', 'un_member'),
('TW', 'Taiwan', 'Asia', 'East Asia', 'disputed'),
('HK', 'Hong Kong', 'Asia', 'East Asia', 'special_region'),
('MO', 'Macau', 'Asia', 'East Asia', 'special_region'),

-- Asia - Caucasus (grouped with Central Asia for simplicity)
('AM', 'Armenia', 'Asia', 'Central Asia', 'un_member'),
('AZ', 'Azerbaijan', 'Asia', 'Central Asia', 'un_member'),
('GE', 'Georgia', 'Asia', 'Central Asia', 'un_member'),

-- Europe - Northern Europe
('DK', 'Denmark', 'Europe', 'Northern Europe', 'un_member'),
('EE', 'Estonia', 'Europe', 'Northern Europe', 'un_member'),
('FI', 'Finland', 'Europe', 'Northern Europe', 'un_member'),
('IS', 'Iceland', 'Europe', 'Northern Europe', 'un_member'),
('IE', 'Ireland', 'Europe', 'Northern Europe', 'un_member'),
('LV', 'Latvia', 'Europe', 'Northern Europe', 'un_member'),
('LT', 'Lithuania', 'Europe', 'Northern Europe', 'un_member'),
('NO', 'Norway', 'Europe', 'Northern Europe', 'un_member'),
('SE', 'Sweden', 'Europe', 'Northern Europe', 'un_member'),
('GB', 'United Kingdom', 'Europe', 'Northern Europe', 'un_member'),
('FO', 'Faroe Islands', 'Europe', 'Northern Europe', 'dependent_territory'),
('IM', 'Isle of Man', 'Europe', 'Northern Europe', 'dependent_territory'),
('NIR', 'Northern Ireland', 'Europe', 'Northern Europe', 'constituent_country'),
('SCT', 'Scotland', 'Europe', 'Northern Europe', 'constituent_country'),
('WLS', 'Wales', 'Europe', 'Northern Europe', 'constituent_country'),

-- Europe - Western Europe
('AT', 'Austria', 'Europe', 'Western Europe', 'un_member'),
('BE', 'Belgium', 'Europe', 'Western Europe', 'un_member'),
('FR', 'France', 'Europe', 'Western Europe', 'un_member'),
('DE', 'Germany', 'Europe', 'Western Europe', 'un_member'),
('LI', 'Liechtenstein', 'Europe', 'Western Europe', 'un_member'),
('LU', 'Luxembourg', 'Europe', 'Western Europe', 'un_member'),
('MC', 'Monaco', 'Europe', 'Western Europe', 'un_member'),
('NL', 'Netherlands', 'Europe', 'Western Europe', 'un_member'),
('CH', 'Switzerland', 'Europe', 'Western Europe', 'un_member'),

-- Europe - Eastern Europe
('BY', 'Belarus', 'Europe', 'Eastern Europe', 'un_member'),
('BG', 'Bulgaria', 'Europe', 'Eastern Europe', 'un_member'),
('CZ', 'Czech Republic', 'Europe', 'Eastern Europe', 'un_member'),
('HU', 'Hungary', 'Europe', 'Eastern Europe', 'un_member'),
('MD', 'Moldova', 'Europe', 'Eastern Europe', 'un_member'),
('PL', 'Poland', 'Europe', 'Eastern Europe', 'un_member'),
('RO', 'Romania', 'Europe', 'Eastern Europe', 'un_member'),
('RU', 'Russia', 'Europe', 'Eastern Europe', 'un_member'),
('SK', 'Slovakia', 'Europe', 'Eastern Europe', 'un_member'),
('UA', 'Ukraine', 'Europe', 'Eastern Europe', 'un_member'),

-- Europe - Southern Europe
('AL', 'Albania', 'Europe', 'Southern Europe', 'un_member'),
('AD', 'Andorra', 'Europe', 'Southern Europe', 'un_member'),
('BA', 'Bosnia and Herzegovina', 'Europe', 'Southern Europe', 'un_member'),
('HR', 'Croatia', 'Europe', 'Southern Europe', 'un_member'),
('GR', 'Greece', 'Europe', 'Southern Europe', 'un_member'),
('IT', 'Italy', 'Europe', 'Southern Europe', 'un_member'),
('MT', 'Malta', 'Europe', 'Southern Europe', 'un_member'),
('ME', 'Montenegro', 'Europe', 'Southern Europe', 'un_member'),
('MK', 'North Macedonia', 'Europe', 'Southern Europe', 'un_member'),
('PT', 'Portugal', 'Europe', 'Southern Europe', 'un_member'),
('SM', 'San Marino', 'Europe', 'Southern Europe', 'un_member'),
('RS', 'Serbia', 'Europe', 'Southern Europe', 'un_member'),
('SI', 'Slovenia', 'Europe', 'Southern Europe', 'un_member'),
('ES', 'Spain', 'Europe', 'Southern Europe', 'un_member'),
('VA', 'Vatican City', 'Europe', 'Southern Europe', 'observer'),
('XK', 'Kosovo', 'Europe', 'Southern Europe', 'disputed'),
('GI', 'Gibraltar', 'Europe', 'Southern Europe', 'dependent_territory'),

-- Oceania - Australia/New Zealand
('AU', 'Australia', 'Oceania', 'Australia/New Zealand', 'un_member'),
('NZ', 'New Zealand', 'Oceania', 'Australia/New Zealand', 'un_member'),

-- Oceania - Melanesia
('FJ', 'Fiji', 'Oceania', 'Melanesia', 'un_member'),
('PG', 'Papua New Guinea', 'Oceania', 'Melanesia', 'un_member'),
('SB', 'Solomon Islands', 'Oceania', 'Melanesia', 'un_member'),
('VU', 'Vanuatu', 'Oceania', 'Melanesia', 'un_member'),

-- Oceania - Micronesia
('KI', 'Kiribati', 'Oceania', 'Micronesia', 'un_member'),
('MH', 'Marshall Islands', 'Oceania', 'Micronesia', 'un_member'),
('FM', 'Micronesia', 'Oceania', 'Micronesia', 'un_member'),
('NR', 'Nuaru', 'Oceania', 'Micronesia', 'un_member'),
('PW', 'Palau', 'Oceania', 'Micronesia', 'un_member'),
('GU', 'Guam', 'Oceania', 'Micronesia', 'dependent_territory'),

-- Oceania - Polynesia
('WS', 'Samoa', 'Oceania', 'Polynesia', 'un_member'),
('TO', 'Tonga', 'Oceania', 'Polynesia', 'un_member'),
('TV', 'Tuvalu', 'Oceania', 'Polynesia', 'un_member'),
('AS', 'American Samao', 'Oceania', 'Polynesia', 'dependent_territory'),
('CK', 'Cook Islands', 'Oceania', 'Polynesia', 'dependent_territory'),
('PF', 'French Polynesia', 'Oceania', 'Polynesia', 'dependent_territory'),

-- Antarctica
('AQ', 'Antarctica', 'Antarctica', 'Antarctica', 'territory');
