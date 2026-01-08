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
 * Check if a build phase with the given name already exists for a target
 * @param {Object} xcodeProject - The xcode project object
 * @param {string} targetUuid - The UUID of the target to check
 * @param {string} phaseName - The name of the build phase (e.g., 'Embed App Extensions')
 * @returns {boolean} - True if the phase exists
 */
function buildPhaseExists(xcodeProject, targetUuid, phaseName) {
  const nativeTargets = xcodeProject.pbxNativeTargetSection();
  const target = nativeTargets[targetUuid];

  if (!target || !target.buildPhases) {
    return false;
  }

  for (const phase of target.buildPhases) {
    if (phase.comment === phaseName) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a target dependency already exists
 * @param {Object} xcodeProject - The xcode project object
 * @param {string} targetUuid - The UUID of the target that has the dependency
 * @param {string} dependencyTargetUuid - The UUID of the dependency target
 * @returns {boolean} - True if the dependency already exists
 */
function targetDependencyExists(xcodeProject, targetUuid, dependencyTargetUuid) {
  const nativeTargets = xcodeProject.pbxNativeTargetSection();
  const target = nativeTargets[targetUuid];

  if (!target || !target.dependencies) {
    return false;
  }

  const targetDependencySection = xcodeProject.hash.project.objects['PBXTargetDependency'] || {};

  for (const dep of target.dependencies) {
    const depUuid = dep.value;
    const depObj = targetDependencySection[depUuid];

    if (depObj && depObj.target === dependencyTargetUuid) {
      return true;
    }
  }

  return false;
}

/**
 * Add the Embed App Extensions build phase to the main target
 * @param {Object} xcodeProject - The xcode project object
 * @param {string} mainTargetUuid - UUID of the main app target
 * @param {string} extensionTargetUuid - UUID of the extension target
 */
function addEmbedAppExtensionsBuildPhase(xcodeProject, mainTargetUuid, extensionTargetUuid) {
  const nativeTargets = xcodeProject.pbxNativeTargetSection();
  const extensionTarget = nativeTargets[extensionTargetUuid];

  if (!extensionTarget) {
    console.warn('Extension target not found');
    return;
  }

  const copyFilesBuildPhase = xcodeProject.addBuildPhase(
    [],
    'PBXCopyFilesBuildPhase',
    'Embed App Extensions',
    mainTargetUuid,
    'app_extension'
  );

  if (copyFilesBuildPhase && copyFilesBuildPhase.buildPhase) {
    const extensionProduct = extensionTarget.productReference;
    if (extensionProduct) {
      const buildFileUuid = xcodeProject.generateUuid();
      xcodeProject.hash.project.objects['PBXBuildFile'][buildFileUuid] = {
        isa: 'PBXBuildFile',
        fileRef: extensionProduct,
        settings: { ATTRIBUTES: ['RemoveHeadersOnCopy'] },
      };
      xcodeProject.hash.project.objects['PBXBuildFile'][`${buildFileUuid}_comment`] =
        `${EXTENSION_NAME}.appex in Embed App Extensions`;

      copyFilesBuildPhase.buildPhase.files.push({
        value: buildFileUuid,
        comment: `${EXTENSION_NAME}.appex in Embed App Extensions`,
      });
    }
  }
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

    // Check if extension target already exists
    const existingTarget = xcodeProject.pbxTargetByName(EXTENSION_NAME);
    if (existingTarget) {
      console.log(
        `Share Extension target "${EXTENSION_NAME}" already exists, ensuring configuration...`
      );

      // Even if target exists, ensure build phase and dependency are configured
      const mainAppTarget = xcodeProject.getFirstTarget();
      if (mainAppTarget) {
        const mainTargetUuid = mainAppTarget.uuid;
        const extensionTargetUuid = xcodeProject.findTargetKey(EXTENSION_NAME);

        // Ensure target dependency exists
        if (
          extensionTargetUuid &&
          !targetDependencyExists(xcodeProject, mainTargetUuid, extensionTargetUuid)
        ) {
          xcodeProject.addTargetDependency(mainTargetUuid, [extensionTargetUuid]);
        }

        // Ensure Embed App Extensions build phase exists
        if (!buildPhaseExists(xcodeProject, mainTargetUuid, 'Embed App Extensions')) {
          addEmbedAppExtensionsBuildPhase(xcodeProject, mainTargetUuid, extensionTargetUuid);
        }
      }

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
      CURRENT_PROJECT_VERSION: 1,
      GENERATE_INFOPLIST_FILE: 'NO',
      INFOPLIST_FILE: `${EXTENSION_NAME}/Info.plist`,
      INFOPLIST_KEY_CFBundleDisplayName: EXTENSION_DISPLAY_NAME,
      INFOPLIST_KEY_NSHumanReadableCopyright: '',
      IPHONEOS_DEPLOYMENT_TARGET: '15.1',
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

    // Apply build settings to debug and release configurations for the extension target
    const configurations = xcodeProject.pbxXCBuildConfigurationSection();
    const configLists = xcodeProject.pbxXCConfigurationList();
    const targets = xcodeProject.pbxNativeTargetSection();

    // Find the extension target's configuration list
    let extensionConfigListKey = null;
    for (const targetKey in targets) {
      if (targets[targetKey].name === EXTENSION_NAME) {
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

    // Add extension to main app's build phases
    const mainAppTarget = xcodeProject.getFirstTarget();
    if (mainAppTarget) {
      const mainTargetUuid = mainAppTarget.uuid;

      // Add target dependency (only if not already added)
      if (!targetDependencyExists(xcodeProject, mainTargetUuid, target.uuid)) {
        xcodeProject.addTargetDependency(mainTargetUuid, [target.uuid]);
      }

      // Add Embed App Extensions build phase (only if not already added)
      if (!buildPhaseExists(xcodeProject, mainTargetUuid, 'Embed App Extensions')) {
        addEmbedAppExtensionsBuildPhase(xcodeProject, mainTargetUuid, target.uuid);
      }
    }

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
