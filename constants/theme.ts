import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#0F172A',
    background: '#F8FAFC',
    tint: '#0891B2',
    icon: '#475569',
    tabIconDefault: '#94A3B8',
    tabIconSelected: '#0891B2',
  },
  dark: {
    text: '#F1F5F9',
    background: '#0B1120',
    tint: '#06B6D4',
    icon: '#94A3B8',
    tabIconDefault: '#475569',
    tabIconSelected: '#06B6D4',
  },
};

/** Shared semantic design tokens (dark-first, matches utexo.com aesthetic) */
export const AppColors = {
  // Backgrounds
  bgBase: '#0B1120',
  bgCard: '#0F1929',
  bgCardElevated: '#162033',
  bgInput: '#111827',

  // Borders
  border: '#1E2D40',
  borderAccent: '#0891B2',
  borderSubtle: '#162033',

  // Brand / Primary
  primary: '#06B6D4',
  primaryDark: '#0891B2',
  primaryBg: '#082F3E',

  // Text
  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  textTertiary: '#64748B',
  textAccent: '#38BDF8',

  // Status
  success: '#10B981',
  successBg: '#022C22',
  successBorder: '#064E3B',

  error: '#EF4444',
  errorBg: '#1F0606',
  errorBorder: '#7F1D1D',

  warning: '#F59E0B',
  warningBg: '#1C1003',

  running: '#8B5CF6',
  runningBg: '#1A1040',
  runningBorder: '#4C1D95',

  // Utility
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', web: 'monospace' }) as string,
  white: '#FFFFFF',
  black: '#000000',
};

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
