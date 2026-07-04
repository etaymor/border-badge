module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['.'],
          alias: {
            '@screens': './src/screens',
            '@components': './src/components',
            '@contexts': './src/contexts',
            '@hooks': './src/hooks',
            '@services': './src/services',
            '@stores': './src/stores',
            '@utils': './src/utils',
            '@config': './src/config',
            '@navigation': './src/navigation',
            '@constants': './src/constants',
          },
        },
      ],
      // react-native-reanimated/plugin must be last
      'react-native-reanimated/plugin',
    ],
    // PERF (U10): strip console.* from production bundles (keep error/warn).
    // Build-time only via babel-plugin-transform-remove-console (devDependency);
    // dev builds are unaffected. `error`/`warn` are preserved intentionally.
    env: {
      production: {
        plugins: [['transform-remove-console', { exclude: ['error', 'warn'] }]],
      },
    },
  };
};
