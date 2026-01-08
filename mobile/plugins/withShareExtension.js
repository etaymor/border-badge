/**
 * Expo Config Plugin for iOS Share Extension
 *
 * This plugin adds a Share Extension target to the iOS project that allows
 * users to share TikTok/Instagram URLs directly to the Atlasi app.
 *
 * The extension:
 * 1. Receives shared URLs from other apps
 * 2. Writes the URL to App Group shared storage
 * 3. Opens the main app via deep link (atlasi://share)
 *
 * @see https://docs.expo.dev/config-plugins/plugins-and-mods/
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const { withXcodeProject, withEntitlementsPlist } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Configuration constants
const EXTENSION_NAME = 'ShareExtension';
const EXTENSION_BUNDLE_ID_SUFFIX = '.ShareExtension';
const APP_GROUP_ID = 'group.com.atlasi.app';
const EXTENSION_DISPLAY_NAME = 'Save Place';
// Get Apple Team ID - only required during actual iOS builds (prebuild), not Metro
function getAppleTeamId() {
  const teamId = process.env.APPLE_TEAM_ID || process.env.DEVELOPMENT_TEAM || process.env.TEAM_ID;
  if (!teamId) {
    throw new Error(
      'APPLE_TEAM_ID environment variable must be set for iOS builds. ' +
        'Set APPLE_TEAM_ID, DEVELOPMENT_TEAM, or TEAM_ID in your environment.'
    );
  }
  return teamId;
}

/**
 * Add App Group entitlement to the main app
 */
function withAppGroupEntitlement(config) {
  return withEntitlementsPlist(config, (mod) => {
    mod.modResults['com.apple.security.application-groups'] = [APP_GROUP_ID];
    return mod;
  });
}

/**
 * Find extension target by name, handling the xcode library's quoted name format.
 * The xcode npm package stores target names with quotes (e.g., "ShareExtension"),
 * but pbxTargetByName expects unquoted names. This function handles both cases.
 * @param {Object} xcodeProject - The xcode project object
 * @param {string} name - The unquoted target name to find
 * @returns {Object|null} - The target object or null if not found
 */
function findExtensionTarget(xcodeProject, name) {
  const nativeTargets = xcodeProject.pbxNativeTargetSection();
  const quotedName = `"${name}"`;

  for (const key in nativeTargets) {
    // Skip comment keys
    if (key.endsWith('_comment')) continue;

    const target = nativeTargets[key];
    if (target && (target.name === name || target.name === quotedName)) {
      return { uuid: key, target };
    }
  }

  return null;
}

/**
 * Add the Share Extension target to the Xcode project
 */
function withShareExtensionTarget(config) {
  return withXcodeProject(config, async (mod) => {
    const xcodeProject = mod.modResults;
    const appBundleId = mod.ios?.bundleIdentifier ?? 'com.atlasi.app';
    const extensionBundleId = `${appBundleId}${EXTENSION_BUNDLE_ID_SUFFIX}`;
    const projectRoot = mod.modRequest.projectRoot;
    const iosPath = path.join(projectRoot, 'ios');

    // Check if extension target already exists using our custom finder
    // (pbxTargetByName doesn't handle quoted names properly)
    const existingTarget = findExtensionTarget(xcodeProject, EXTENSION_NAME);
    if (existingTarget) {
      console.log(`Share Extension target "${EXTENSION_NAME}" already exists, skipping...`);
      // The target already exists with all its build phases and dependencies
      // (addTarget automatically adds them for app_extension type)
      return mod;
    }

    // Create extension directory
    const extensionPath = path.join(iosPath, EXTENSION_NAME);
    if (!fs.existsSync(extensionPath)) {
      fs.mkdirSync(extensionPath, { recursive: true });
    }

    // Copy extension files from plugin directory
    const pluginExtensionPath = path.join(__dirname, 'share-extension');
    const filesToCopy = ['ShareViewController.swift', 'Info.plist', 'ShareExtension.entitlements'];

    for (const file of filesToCopy) {
      const srcPath = path.join(pluginExtensionPath, file);
      const destPath = path.join(extensionPath, file);
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
      }
    }

    // Create PBXNativeTarget for extension
    const target = xcodeProject.addTarget(
      EXTENSION_NAME,
      'app_extension',
      EXTENSION_NAME,
      extensionBundleId
    );

    if (!target) {
      console.warn('Failed to add Share Extension target');
      return mod;
    }

    // Add source files to target
    const extensionGroup = xcodeProject.addPbxGroup(
      ['ShareViewController.swift', 'Info.plist', 'ShareExtension.entitlements'],
      EXTENSION_NAME,
      EXTENSION_NAME
    );

    // Find main group and add extension group
    const mainGroupKey = xcodeProject.findPBXGroupKey({ name: undefined, path: undefined });
    if (mainGroupKey) {
      xcodeProject.addToPbxGroup(extensionGroup.uuid, mainGroupKey);
    }

    // Add Swift file to build sources
    const swiftFilePath = `${EXTENSION_NAME}/ShareViewController.swift`;
    xcodeProject.addSourceFile(swiftFilePath, { target: target.uuid }, extensionGroup.uuid);

    // Configure build settings for extension
    const buildSettings = {
      ASSETCATALOG_COMPILER_APPICON_NAME: 'AppIcon',
      CLANG_ENABLE_MODULES: 'YES',
      CODE_SIGN_ENTITLEMENTS: `${EXTENSION_NAME}/ShareExtension.entitlements`,
      CODE_SIGN_STYLE: 'Automatic',
      DEVELOPMENT_TEAM: getAppleTeamId(),
      CURRENT_PROJECT_VERSION: 1,
      GENERATE_INFOPLIST_FILE: 'NO',
      INFOPLIST_FILE: `${EXTENSION_NAME}/Info.plist`,
      INFOPLIST_KEY_CFBundleDisplayName: `"${EXTENSION_DISPLAY_NAME}"`,
      INFOPLIST_KEY_NSHumanReadableCopyright: '""',
      // iOS 15.1 matches React Native 0.81's minimum deployment target (set in RN 0.76+).
      // ShareViewController.swift uses UniformTypeIdentifiers (UTType), which requires iOS 14+.
      IPHONEOS_DEPLOYMENT_TARGET: '15.1',
      // Quote runpath entries so the generated pbxproj parses cleanly under CocoaPods/Nanaimo
      LD_RUNPATH_SEARCH_PATHS: [
        '"$(inherited)"',
        '"@executable_path/Frameworks"',
        '"@executable_path/../../Frameworks"',
      ],
      MARKETING_VERSION: '1.0',
      PRODUCT_BUNDLE_IDENTIFIER: extensionBundleId,
      PRODUCT_NAME: '"$(TARGET_NAME)"',
      SKIP_INSTALL: 'YES',
      SWIFT_EMIT_LOC_STRINGS: 'YES',
      SWIFT_VERSION: '5.0',
      TARGETED_DEVICE_FAMILY: '"1,2"',
    };

    // Apply build settings to debug and release configurations for the extension target
    const configurations = xcodeProject.pbxXCBuildConfigurationSection();
    const configLists = xcodeProject.pbxXCConfigurationList();
    const targets = xcodeProject.pbxNativeTargetSection();

    // Find the extension target's configuration list (handle quoted names)
    const quotedExtensionName = `"${EXTENSION_NAME}"`;
    let extensionConfigListKey = null;
    for (const targetKey in targets) {
      const targetName = targets[targetKey].name;
      if (targetName === EXTENSION_NAME || targetName === quotedExtensionName) {
        extensionConfigListKey = targets[targetKey].buildConfigurationList;
        break;
      }
    }

    if (extensionConfigListKey && configLists[extensionConfigListKey]) {
      const buildConfigs = configLists[extensionConfigListKey].buildConfigurations || [];
      for (const buildConfig of buildConfigs) {
        const configKey = buildConfig.value;
        if (configurations[configKey] && configurations[configKey].buildSettings) {
          Object.assign(configurations[configKey].buildSettings, buildSettings);
        }
      }
    }

    // Note: addTarget() for 'app_extension' type automatically:
    // 1. Creates a "Copy Files" build phase to embed the extension
    // 2. Adds the extension product to that build phase
    // 3. Adds a target dependency from the main app to the extension
    // So we don't need to add these manually.

    console.log(
      `Added Share Extension target "${EXTENSION_NAME}" with bundle ID "${extensionBundleId}"`
    );

    return mod;
  });
}

/**
 * Main plugin function
 */
function withShareExtension(config) {
  // Add App Group entitlement to main app
  config = withAppGroupEntitlement(config);

  // Add Share Extension target
  config = withShareExtensionTarget(config);

  return config;
}

module.exports = withShareExtension;
