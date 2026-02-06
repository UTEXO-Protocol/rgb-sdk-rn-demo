// MUST be first import - polyfill for crypto.getRandomValues()
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Buffer } from 'buffer';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-get-random-values';
import 'react-native-reanimated';

// Polyfills for Node.js standard library modules (Metro resolver handles imports)
// These are imported here to ensure they're loaded before rgb-sdk-rn
import 'os-browserify';
import 'path-browserify';

// Make Buffer available globally
global.Buffer = Buffer;

import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
