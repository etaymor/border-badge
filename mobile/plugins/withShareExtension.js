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
const APP_GROUP_ID = 'group.com.borderbadge.app';
const EXTENSION_DISPLAY_NAME = 'Save Place';

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
 * Add the Share Extension target to the Xcode project
 */
function withShareExtensionTarget(config) {
  return withXcodeProject(config, async (mod) => {
    const xcodeProject = mod.modResults;
    const appBundleId = mod.ios?.bundleIdentifier ?? 'com.borderbadge.app';
    const extensionBundleId = `${appBundleId}${EXTENSION_BUNDLE_ID_SUFFIX}`;
    const projectRoot = mod.modRequest.projectRoot;
    const iosPath = path.join(projectRoot, 'ios');

    // Check if extension already exists
    const extensionTargetName = EXTENSION_NAME;
    const existingTarget = xcodeProject.pbxTargetByName(extensionTargetName);
    if (existingTarget) {
      console.log(`Share Extension target "${extensionTargetName}" already exists, skipping...`);
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
      extensionTargetName,
      'app_extension',
      EXTENSION_NAME,
      extensionBundleId
    );

    if (!target) {
      console.warn('Failed to add Share Extension target');
      return mod;
    }

    // Add source files to target
    const groupName = EXTENSION_NAME;
    const extensionGroup = xcodeProject.addPbxGroup(
      ['ShareViewController.swift', 'Info.plist', 'ShareExtension.entitlements'],
      groupName,
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
      CURRENT_PROJECT_VERSION: 1,
      GENERATE_INFOPLIST_FILE: 'NO',
      INFOPLIST_FILE: `${EXTENSION_NAME}/Info.plist`,
      INFOPLIST_KEY_CFBundleDisplayName: EXTENSION_DISPLAY_NAME,
      INFOPLIST_KEY_NSHumanReadableCopyright: '',
      IPHONEOS_DEPLOYMENT_TARGET: '15.0',
      LD_RUNPATH_SEARCH_PATHS:
        '$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks',
      MARKETING_VERSION: '1.0',
      PRODUCT_BUNDLE_IDENTIFIER: extensionBundleId,
      PRODUCT_NAME: '$(TARGET_NAME)',
      SKIP_INSTALL: 'YES',
      SWIFT_EMIT_LOC_STRINGS: 'YES',
      SWIFT_VERSION: '5.0',
      TARGETED_DEVICE_FAMILY: '"1,2"',
    };

    // Apply build settings to debug and release configurations
    const configurations = xcodeProject.pbxXCBuildConfigurationSection();
    for (const key in configurations) {
      if (typeof configurations[key] === 'object' && configurations[key].buildSettings) {
        const config = configurations[key];
        if (config.name === 'Debug' || config.name === 'Release') {
          // Check if this config belongs to our extension target
          const configList = xcodeProject.pbxXCConfigurationList();
          for (const listKey in configList) {
            if (
              configList[listKey].buildConfigurations &&
              configList[listKey].buildConfigurations.some((c) => c.value === key)
            ) {
              // Check if this list belongs to extension target
              const targets = xcodeProject.pbxNativeTargetSection();
              for (const targetKey in targets) {
                if (
                  targets[targetKey].name === extensionTargetName &&
                  targets[targetKey].buildConfigurationList === listKey
                ) {
                  Object.assign(config.buildSettings, buildSettings);
                }
              }
            }
          }
        }
      }
    }

    // Add extension to main app's "Embed App Extensions" build phase
    // This ensures the extension is embedded in the app bundle
    const mainAppTarget = xcodeProject.getFirstTarget();
    if (mainAppTarget) {
      // Add copy files build phase for embedding extension
      xcodeProject.addBuildPhase(
        [`${EXTENSION_NAME}.appex`],
        'PBXCopyFilesBuildPhase',
        'Embed App Extensions',
        mainAppTarget.uuid,
        'app_extension'
      );
    }

    console.log(
      `Added Share Extension target "${extensionTargetName}" with bundle ID "${extensionBundleId}"`
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
