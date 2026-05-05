const { AndroidConfig, withAndroidManifest } = require("@expo/config-plugins");

module.exports = function withAndroidLocalNetwork(config) {
  return withAndroidManifest(config, (modConfig) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(modConfig.modResults);
    application.$["android:usesCleartextTraffic"] = "true";
    return modConfig;
  });
};
