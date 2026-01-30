import fs from 'fs';
import path from 'path';
import { withDangerousMod } from '@expo/config-plugins';

const STOREKIT_FILENAME = 'Products.storekit';

/**
 * Expo plugin to add StoreKit Configuration file to the Xcode project for testing.
 * This allows testing in-app purchases with a local StoreKit configuration
 * instead of requiring products to be approved in App Store Connect.
 *
 * The plugin:
 * 1. Copies Products.storekit from mobile/ root to ios/
 * 2. Modifies the Xcode scheme to use the StoreKit Configuration for Run/Debug
 */
export default function withStoreKitConfig(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;

      // Path to the StoreKit configuration file in project root
      const storeKitConfigPath = path.join(projectRoot, STOREKIT_FILENAME);

      // Only proceed if the file exists
      if (!fs.existsSync(storeKitConfigPath)) {
        console.log(`[withStoreKitConfig] ${STOREKIT_FILENAME} not found, skipping`);
        return config;
      }

      // Copy the file to the ios directory
      const iosDir = path.join(projectRoot, 'ios');
      const destPath = path.join(iosDir, STOREKIT_FILENAME);

      // Create ios directory if it doesn't exist
      if (!fs.existsSync(iosDir)) {
        fs.mkdirSync(iosDir, { recursive: true });
      }

      // Copy file
      fs.copyFileSync(storeKitConfigPath, destPath);
      console.log(`[withStoreKitConfig] Copied ${STOREKIT_FILENAME} to ios directory`);

      // Find and modify the scheme file to add StoreKit Configuration
      const appName = config.modRequest.projectName || 'Atlasi';
      const schemePath = path.join(
        iosDir,
        `${appName}.xcodeproj`,
        'xcshareddata',
        'xcschemes',
        `${appName}.xcscheme`
      );

      if (fs.existsSync(schemePath)) {
        let schemeContent = fs.readFileSync(schemePath, 'utf8');

        // Always update/add StoreKit config - it gets wiped on regeneration
        // First, check if it already exists and remove it to update
        if (schemeContent.includes('storeKitConfigurationFileReference')) {
          schemeContent = schemeContent.replace(
            /\s+storeKitConfigurationFileReference\s*=\s*"[^"]*"/,
            ''
          );
        }

        // Add storeKitConfigurationFileReference to LaunchAction
        // Match LaunchAction opening tag more flexibly
        if (schemeContent.includes('<LaunchAction')) {
          schemeContent = schemeContent.replace(
            /(<LaunchAction[^>]*?buildConfiguration\s*=\s*"Debug")([^>]*?>)/,
            `$1\n      storeKitConfigurationFileReference = "container:${STOREKIT_FILENAME}"$2`
          );
          fs.writeFileSync(schemePath, schemeContent, 'utf8');
          console.log('[withStoreKitConfig] Added StoreKit Configuration to scheme');
        } else {
          console.log('[withStoreKitConfig] Could not find LaunchAction in scheme');
        }
      } else {
        console.log(`[withStoreKitConfig] Scheme file not found at ${schemePath}`);
      }

      console.log('[withStoreKitConfig] Plugin completed successfully');
      return config;
    },
  ]);
}
