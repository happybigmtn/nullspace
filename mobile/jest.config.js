const expoPreset = require("jest-expo/jest-preset");

module.exports = {
  ...expoPreset,
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/build/", "/e2e/"],
  transformIgnorePatterns: [
    "node_modules/(?!.*(react-native|@react-native|@react-navigation|@react-native-async-storage|expo(nent)?|@expo|expo-.*|react-native-gesture-handler|react-native-reanimated|react-native-worklets|react-native-safe-area-context|react-native-screens|react-native-mmkv|@shopify)/)",
  ],
  setupFilesAfterEnv: ["<rootDir>/jest/setup.js"],
  // Reduce worker count to curb memory spikes from heavy component suites
  maxWorkers: 1,
  moduleNameMapper: {
    ...(expoPreset.moduleNameMapper || {}),
    // Use prebuilt CJS-compatible outputs for workspace packages
    "^@nullspace/([^/]+)$": "<rootDir>/../packages/$1/dist/index.js",
    "^@nullspace/([^/]+)/(.+)$": "<rootDir>/../packages/$1/dist/$2.js",
    "^.+/context/ThemeContext$": "<rootDir>/jest/ThemeContextMock.js",
    "^react-native/Libraries/BatchedBridge/NativeModules$":
      "<rootDir>/jest/nativeModulesMock.js",
    "^react-native/Libraries/Animated/NativeAnimatedHelper$":
      "<rootDir>/jest/nativeAnimatedHelperMock.js",
    "^expo-modules-core/src/Refs$":
      "<rootDir>/node_modules/expo-modules-core/src/Refs.ts",
    "^expo-modules-core/src/uuid/uuid.web$":
      "<rootDir>/node_modules/expo-modules-core/src/uuid/index.web.ts",
    "^expo-modules-core/src/web/index.web$":
      "<rootDir>/jest/expoModulesCoreWebMock.js",
  },
};
