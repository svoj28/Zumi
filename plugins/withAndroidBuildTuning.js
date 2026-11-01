const { withGradleProperties } = require('expo/config-plugins');

/**
 * Keeps Android builds within the build machine's memory. Skia, Reanimated and Worklets compile
 * a lot of C++ per CPU type; building all four types in parallel killed the Gradle daemon on EAS.
 *
 * - Only real-phone CPUs (arm64-v8a, armeabi-v7a): x86 / x86_64 are emulator-only.
 * - Fewer parallel workers and a fixed heap for the Gradle daemon.
 */
const PROPERTIES = {
  reactNativeArchitectures: 'arm64-v8a,armeabi-v7a',
  'org.gradle.jvmargs': '-Xmx4g -XX:MaxMetaspaceSize=1g -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8',
  'org.gradle.workers.max': '2',
  'org.gradle.parallel': 'false',
};

module.exports = function withAndroidBuildTuning(config) {
  return withGradleProperties(config, (cfg) => {
    for (const [key, value] of Object.entries(PROPERTIES)) {
      const existing = cfg.modResults.find((item) => item.type === 'property' && item.key === key);
      if (existing) existing.value = value;
      else cfg.modResults.push({ type: 'property', key, value });
    }
    return cfg;
  });
};
