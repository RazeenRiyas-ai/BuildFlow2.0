import { DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { AuthProvider, useAuth } from '@/context/auth-context';
import { OrderDraftProvider } from '@/context/order-draft-context';
import { OrdersProvider } from '@/context/orders-context';
import { SitesProvider } from '@/context/sites-context';

SplashScreen.preventAutoHideAsync();

function SplashScreenController() {
  const { isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync();
    }
  }, [isLoading]);

  return null;
}

/** Deep-links a tapped push notification straight to the relevant HQ order, whether the app was
 * foregrounded, backgrounded, or cold-started. Harmless (never fires) for contractors, who never
 * register a push token. */
function NotificationTapController() {
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const orderId = response.notification.request.content.data?.orderId;
      if (typeof orderId === 'string') {
        router.push({ pathname: '/(hq)/orders/[orderId]', params: { orderId } });
      }
    });
    return () => subscription.remove();
  }, []);

  return null;
}

function RootNavigator() {
  const { user } = useAuth();
  const isContractor = user?.role === 'contractor';
  const isHqStaff = user?.role === 'hq_staff' || user?.role === 'hq_admin';

  return (
    <Stack screenOptions={{ headerShadowVisible: false }}>
      <Stack.Protected guard={isContractor}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="sites/new" options={{ presentation: 'modal', title: 'Add Site' }} />
      </Stack.Protected>

      <Stack.Protected guard={isHqStaff}>
        <Stack.Screen name="(hq)" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={!user}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider value={DefaultTheme}>
      <AuthProvider>
        <SplashScreenController />
        <NotificationTapController />
        <SitesProvider>
          <OrdersProvider>
            <OrderDraftProvider>
              <RootNavigator />
            </OrderDraftProvider>
          </OrdersProvider>
        </SitesProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
