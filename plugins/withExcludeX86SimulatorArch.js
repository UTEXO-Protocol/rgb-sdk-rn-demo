const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// bdk-rn and other native dependencies only ship arm64 simulator slices.
// Excluding x86_64 prevents linker errors on Apple Silicon Macs.
const EXCLUDED_ARCHS_SNIPPET = `
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['EXCLUDED_ARCHS[sdk=iphonesimulator*]'] = 'x86_64'
      end
    end
    installer.aggregate_targets.each do |aggregate_target|
      aggregate_target.user_project.targets.each do |target|
        target.build_configurations.each do |config|
          config.build_settings['EXCLUDED_ARCHS[sdk=iphonesimulator*]'] = 'x86_64'
        end
      end
      aggregate_target.user_project.save
    end`;

const withExcludeX86SimulatorArch = (config) => {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let podfile = fs.readFileSync(podfilePath, 'utf8');

      if (podfile.includes("EXCLUDED_ARCHS[sdk=iphonesimulator*]")) {
        return config;
      }

      // Insert after the closing paren of react_native_post_install(...)
      podfile = podfile.replace(
        /(react_native_post_install\([\s\S]*?\n\s*\))/,
        `$1\n${EXCLUDED_ARCHS_SNIPPET}`
      );

      fs.writeFileSync(podfilePath, podfile);
      return config;
    },
  ]);
};

module.exports = withExcludeX86SimulatorArch;
