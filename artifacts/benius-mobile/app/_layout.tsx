import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { ArchitectsDaughter_400Regular, useFonts } from '@expo-google-fonts/architects-daughter';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AuthProvider } from '@/contexts/AuthContext';
import { SessionProvider } from '@/contexts/SessionContext';
import { NetworkProvider } from '@/contexts/NetworkContext';
import { useColors } from '@/hooks/useColors';

void SplashScreen.preventAutoHideAsync();
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnReconnect: true } } });
function Navigation() {
  const c = useColors();
  return <Stack screenOptions={{ headerStyle: { backgroundColor: c.background }, headerTintColor: c.foreground, contentStyle: { backgroundColor: c.background } }}>
    <Stack.Screen name="index" options={{ headerShown: false }} />
    <Stack.Screen name="sessions" options={{ title: 'Academic session', headerShown: false }} />
    <Stack.Screen name="profile" options={{ title: 'Account', headerShown: false }} />
    <Stack.Screen name="settings" options={{ title: 'Settings', headerShown: false }} />
    <Stack.Screen name="network-error" options={{ title: 'Connection', headerShown: false }} />
    <Stack.Screen name="error" options={{ title: 'Error', headerShown: false }} />
  </Stack>;
}
export default function RootLayout() {
  const [loaded, error] = useFonts({ ArchitectsDaughter_400Regular });
  useEffect(() => { if (loaded || error) void SplashScreen.hideAsync(); }, [loaded, error]);
  if (!loaded && !error) return null;
  return <SafeAreaProvider><ErrorBoundary><QueryClientProvider client={queryClient}>
    <GestureHandlerRootView style={{ flex: 1 }}><KeyboardProvider><NetworkProvider>
      <AuthProvider><SessionProvider><Navigation /></SessionProvider></AuthProvider>
    </NetworkProvider></KeyboardProvider></GestureHandlerRootView>
  </QueryClientProvider></ErrorBoundary></SafeAreaProvider>;
}