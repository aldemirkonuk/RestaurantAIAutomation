module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Reanimated 4 worklets. Must stay the last plugin.
    plugins: ["react-native-worklets/plugin"],
  };
};
