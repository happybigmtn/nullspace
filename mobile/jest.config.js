const expoPreset = require("jest-expo/jest-preset");

module.exports = {
  ...expoPreset,
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/build/"],
  transformIgnorePatterns: [
    "node_modules/(?!.*(react-native|@react-native|@react-navigation|@react-native-async-storage|expo(nent)?|@expo|expo-.*|react-native-gesture-handler|react-native-reanimated|react-native-safe-area-context|react-native-screens|react-native-mmkv|@shopify)/)",
  ],
  setupFilesAfterEnv: ["<rootDir>/jest/setup.js"],
  moduleNameMapper: {
    ...(expoPreset.moduleNameMapper || {}),
    "^react-native/Libraries/BatchedBridge/NativeModules$":
      "<rootDir>/jest/nativeModulesMock.js",
    "^expo-modules-core/src/Refs$":
      "<rootDir>/node_modules/expo-modules-core/src/Refs.ts",
    "^expo-modules-core/src/uuid/uuid.web$":
      "<rootDir>/node_modules/expo-modules-core/src/uuid/index.web.ts",
    "^expo-modules-core/src/web/index.web$":
      "<rootDir>/jest/expoModulesCoreWebMock.js",
  },
};
