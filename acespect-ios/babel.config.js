module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // WatermelonDB models use legacy decorators (@field, @date, @children…).
    plugins: [['@babel/plugin-proposal-decorators', { legacy: true }]],
  };
};
