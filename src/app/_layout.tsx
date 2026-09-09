import { DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';

import { AuthProvider, useAuth } from '@/context/auth-context';
import { OrderDraftProvider } from '@/context/order-draft-context';
import { OrdersProvider } from '@/context/orders-context';
import { SitesProvider } from '@/context/sites-context';
import { extractOrderIdFromNotificationData, resolveOrderNotificationRoute } from '@/utils/notification-routing';

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

/**
 * Deep-links a tapped push notification straight to the relevant order — the contractor's own
 * order detail (`/order/[orderId]`) for a contractor, HQ's order detail (`/(hq)/orders/[orderId]`)
 * for HQ staff/admin — whether the app was foregrounded, backgrounded, or fully closed.
 *
 * Handles cold launch explicitly: `addNotificationResponseReceivedListener` below only fires for a
 * response received *while it's already registered* — the tap that actually launched the app from
 * fully closed happened before this component (and its listener) ever mounted, so that one specific
 * case has to be read once via `getLastNotificationResponseAsync()` on mount instead. Immediately
 * cleared afterward so a later, unrelated cold start doesn't re-navigate to the same stale order.
 *
 * Deliberately routes on `data.orderId`/role alone, never on any other notification content — the
 * destination screen (order/[orderId].tsx or (hq)/orders/[orderId].tsx) always refetches from the
 * normal authenticated REST endpoint, which is the only source of truth and the only place
 * authorization is actually enforced (a contractor can never be routed into another contractor's
 * order data merely because a notification claimed that id — the order-detail endpoint itself
 * re-checks ownership).
 */
function NotificationTapController() {
  const { user } = useAuth();
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    function handleResponse(response: Notifications.NotificationResponse) {
      const orderId = extractOrderIdFromNotificationData(response.notification.request.content.data);
      if (!orderId) return;
      router.push(resolveOrderNotificationRoute(userRef.current?.role, orderId));
    }

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      handleResponse(response);
      Notifications.clearLastNotificationResponseAsync();
    });

    const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
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
