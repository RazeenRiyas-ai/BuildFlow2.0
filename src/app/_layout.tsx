import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { OrderDraftProvider } from '@/context/order-draft-context';
import { OrdersProvider } from '@/context/orders-context';
import { SitesProvider } from '@/context/sites-context';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <ThemeProvider value={DefaultTheme}>
      <SitesProvider>
        <OrdersProvider>
          <OrderDraftProvider>
            <Stack screenOptions={{ headerShadowVisible: false }}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="sites/new" options={{ presentation: 'modal', title: 'Add Site' }} />
            </Stack>
          </OrderDraftProvider>
        </OrdersProvider>
      </SitesProvider>
    </ThemeProvider>
  );
}
