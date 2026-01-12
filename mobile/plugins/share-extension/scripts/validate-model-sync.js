#!/usr/bin/env node
/**
 * validate-model-sync.js
 *
 * Validates that model definitions in QueuedShareApp.swift stay in sync
 * with their source definitions in the Share Extension.
 *
 * This script parses Swift struct/enum definitions and compares:
 * - Property names and types
 * - Enum cases
 * - CodingKeys mappings
 *
 * Run manually: node plugins/share-extension/scripts/validate-model-sync.js
 * Called automatically by withShareExtension.js during prebuild
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

const MODELS_DIR = path.join(__dirname, '..', 'Models');

// Models to validate and their source files
const MODEL_SOURCES = {
  DetectedCountry: 'IngestResponse.swift',
  DetectedPlace: 'IngestResponse.swift',
  SocialProvider: 'IngestResponse.swift',
  SocialIngestResponse: 'IngestResponse.swift',
  EntryType: 'EntryType.swift',
  QueuedShare: 'QueuedShare.swift',
};

const APP_COPY_FILE = 'QueuedShareApp.swift';

/**
 * Extract struct/enum definition from Swift source
 * Returns normalized representation for comparison
 */
function extractDefinition(source, name) {
  // Match struct or enum definition
  const structRegex = new RegExp(
    `(struct|enum)\\s+${name}\\s*:\\s*([^{]+)\\{([^}]+(?:\\{[^}]*\\}[^}]*)*)\\}`,
    's'
  );

  const match = source.match(structRegex);
  if (!match) {
    return null;
  }

  const [, kind, protocols, body] = match;

  // Extract properties (for structs)
  const properties = [];
  const propertyRegex = /let\s+(\w+)\s*:\s*([^\n]+)/g;
  let propMatch;
  while ((propMatch = propertyRegex.exec(body)) !== null) {
    const [, propName, propType] = propMatch;
    // Normalize type (remove whitespace variations)
    properties.push({
      name: propName,
      type: propType.trim().replace(/\s+/g, ' '),
    });
  }

  // Extract enum cases
  const cases = [];
  const caseRegex = /case\s+(\w+)(?:\s*=\s*"([^"]+)")?/g;
  let caseMatch;
  while ((caseMatch = caseRegex.exec(body)) !== null) {
    const [, caseName, rawValue] = caseMatch;
    // Skip CodingKeys cases
    if (!body.includes('enum CodingKeys') || !isInsideCodingKeys(body, caseMatch.index)) {
      cases.push({ name: caseName, rawValue: rawValue || caseName });
    }
  }

  // Extract CodingKeys
  const codingKeys = extractCodingKeys(body);

  return {
    kind,
    protocols: protocols
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .sort(),
    properties,
    cases,
    codingKeys,
  };
}

/**
 * Check if an index is inside a CodingKeys enum block
 */
function isInsideCodingKeys(body, index) {
  const codingKeysStart = body.indexOf('enum CodingKeys');
  if (codingKeysStart === -1 || index < codingKeysStart) {
    return false;
  }

  // Find the closing brace of CodingKeys
  let braceCount = 0;
  let inCodingKeys = false;
  for (let i = codingKeysStart; i < body.length; i++) {
    if (body[i] === '{') {
      braceCount++;
      inCodingKeys = true;
    } else if (body[i] === '}') {
      braceCount--;
      if (inCodingKeys && braceCount === 0) {
        return index < i;
      }
    }
  }
  return false;
}

/**
 * Extract CodingKeys enum from body
 */
function extractCodingKeys(body) {
  const codingKeysRegex = /enum\s+CodingKeys\s*:\s*String\s*,\s*CodingKey\s*\{([^}]+)\}/s;
  const match = body.match(codingKeysRegex);
  if (!match) {
    return null;
  }

  const keys = {};
  const keyRegex = /case\s+(\w+)\s*=\s*"([^"]+)"/g;
  let keyMatch;
  while ((keyMatch = keyRegex.exec(match[1])) !== null) {
    keys[keyMatch[1]] = keyMatch[2];
  }

  // Also capture cases without explicit raw value
  const simpleKeyRegex = /case\s+(\w+)(?!\s*=)/g;
  while ((keyMatch = simpleKeyRegex.exec(match[1])) !== null) {
    if (!keys[keyMatch[1]]) {
      keys[keyMatch[1]] = keyMatch[1];
    }
  }

  return keys;
}

/**
 * Compare two definitions and return differences
 */
function compareDefinitions(source, copy, modelName) {
  const errors = [];

  if (!source) {
    errors.push(`Source definition for ${modelName} not found`);
    return errors;
  }

  if (!copy) {
    errors.push(`Copy definition for ${modelName} not found in QueuedShareApp.swift`);
    return errors;
  }

  // Compare kind (struct vs enum)
  if (source.kind !== copy.kind) {
    errors.push(`${modelName}: Kind mismatch - source is ${source.kind}, copy is ${copy.kind}`);
  }

  // Compare properties
  if (source.properties.length !== copy.properties.length) {
    errors.push(
      `${modelName}: Property count mismatch - source has ${source.properties.length}, copy has ${copy.properties.length}`
    );
  }

  for (const srcProp of source.properties) {
    const copyProp = copy.properties.find((p) => p.name === srcProp.name);
    if (!copyProp) {
      errors.push(`${modelName}: Missing property '${srcProp.name}' in copy`);
    } else if (srcProp.type !== copyProp.type) {
      errors.push(
        `${modelName}.${srcProp.name}: Type mismatch - source is '${srcProp.type}', copy is '${copyProp.type}'`
      );
    }
  }

  // Check for extra properties in copy
  for (const copyProp of copy.properties) {
    const srcProp = source.properties.find((p) => p.name === copyProp.name);
    if (!srcProp) {
      errors.push(`${modelName}: Extra property '${copyProp.name}' in copy not in source`);
    }
  }

  // Compare enum cases (for non-CodingKeys enums)
  if (source.kind === 'enum' && source.cases.length > 0) {
    for (const srcCase of source.cases) {
      const copyCase = copy.cases.find((c) => c.name === srcCase.name);
      if (!copyCase) {
        errors.push(`${modelName}: Missing case '${srcCase.name}' in copy`);
      } else if (srcCase.rawValue !== copyCase.rawValue) {
        errors.push(
          `${modelName}.${srcCase.name}: Raw value mismatch - source is '${srcCase.rawValue}', copy is '${copyCase.rawValue}'`
        );
      }
    }
  }

  // Compare CodingKeys
  if (source.codingKeys && !copy.codingKeys) {
    errors.push(`${modelName}: Missing CodingKeys in copy (source has CodingKeys)`);
  } else if (source.codingKeys && copy.codingKeys) {
    for (const [key, value] of Object.entries(source.codingKeys)) {
      if (!copy.codingKeys[key]) {
        errors.push(`${modelName}.CodingKeys: Missing key '${key}' in copy`);
      } else if (copy.codingKeys[key] !== value) {
        errors.push(
          `${modelName}.CodingKeys.${key}: Value mismatch - source is '${value}', copy is '${copy.codingKeys[key]}'`
        );
      }
    }
  }

  return errors;
}

/**
 * Main validation function
 */
function validate() {
  console.log('Validating Share Extension model sync...\n');

  const appCopyPath = path.join(MODELS_DIR, APP_COPY_FILE);
  if (!fs.existsSync(appCopyPath)) {
    console.error(`ERROR: ${APP_COPY_FILE} not found at ${appCopyPath}`);
    process.exit(1);
  }

  const appCopySource = fs.readFileSync(appCopyPath, 'utf-8');
  const allErrors = [];

  for (const [modelName, sourceFile] of Object.entries(MODEL_SOURCES)) {
    const sourcePath = path.join(MODELS_DIR, sourceFile);
    if (!fs.existsSync(sourcePath)) {
      allErrors.push(`Source file ${sourceFile} not found`);
      continue;
    }

    const sourceContent = fs.readFileSync(sourcePath, 'utf-8');
    const sourceDefinition = extractDefinition(sourceContent, modelName);
    const copyDefinition = extractDefinition(appCopySource, modelName);

    const errors = compareDefinitions(sourceDefinition, copyDefinition, modelName);
    if (errors.length > 0) {
      allErrors.push(...errors);
    } else {
      console.log(`✓ ${modelName} is in sync`);
    }
  }

  if (allErrors.length > 0) {
    console.error('\n❌ Model sync validation FAILED:\n');
    for (const error of allErrors) {
      console.error(`  • ${error}`);
    }
    console.error('\nPlease update QueuedShareApp.swift to match the source model definitions.');
    console.error('See the source files in plugins/share-extension/Models/ for reference.\n');
    process.exit(1);
  }

  console.log('\n✅ All models are in sync!\n');
  return true;
}

// Run if called directly
if (require.main === module) {
  validate();
}

module.exports = { validate };
