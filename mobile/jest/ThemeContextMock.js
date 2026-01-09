const React = require('react');

const mockTheme = {
  colorSchemePreference: 'light',
  colorScheme: 'light',
  isDark: false,
  setColorSchemePreference: jest.fn(),
  toggleColorScheme: jest.fn(),
};

const ThemeProvider = ({ children }) => React.createElement(React.Fragment, null, children);

const useTheme = () => mockTheme;

const useIsDark = () => mockTheme.isDark;

module.exports = {
  ThemeProvider,
  useTheme,
  useIsDark,
};
