const { FlatCompat } = require("@eslint/eslintrc");
const globals = require("globals");

const compat = new FlatCompat({ baseDirectory: __dirname });
const expoConfig = compat.extends("expo").map((config) => ({
  ...config,
  files: config.files ?? ["**/*.{js,jsx,ts,tsx}"],
}));

const testFiles = [
  "**/__tests__/**/*.{js,jsx,ts,tsx}",
  "**/*.{spec,test}.{js,jsx,ts,tsx}",
  "**/__mocks__/**/*.{js,jsx,ts,tsx}",
  "src/test-utils/**/*.{js,jsx,ts,tsx}",
  "jest/setup.{js,ts}",
];

module.exports = [
  {
    ignores: [
      "node_modules",
      "dist",
      "build",
      "coverage",
      ".expo",
      "android",
      "ios",
      "eslint.config.js",
    ],
  },
  ...expoConfig,
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    rules: {
      // Prevent blocking haptic calls - all haptics should use fire-and-forget pattern
      // Bad: haptics.win() or await haptics.win()
      // Good: haptics.win().catch(() => {})
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='haptics']:not(:has(> MemberExpression[property.name='catch']))",
          message:
            "Haptic calls must use fire-and-forget pattern: haptics.xxx().catch(() => {}). " +
            "Blocking haptics can freeze UI on devices without haptic hardware.",
        },
        {
          selector: "AwaitExpression > CallExpression[callee.object.name='haptics']",
          message:
            "Do not await haptic calls - use fire-and-forget pattern: haptics.xxx().catch(() => {})",
        },
      ],
    },
  },
  {
    files: testFiles,
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
    rules: {
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];
