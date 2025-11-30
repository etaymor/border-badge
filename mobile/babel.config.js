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
            '@hooks': './src/hooks',
            '@services': './src/services',
            '@stores': './src/stores',
            '@utils': './src/utils',
            '@config': './src/config',
            '@navigation': './src/navigation',
          },
        },
      ],
    ],
  };
};
