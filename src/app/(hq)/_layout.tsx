import { Stack } from 'expo-router';

export default function HqLayout() {
  return (
    <Stack screenOptions={{ headerShadowVisible: false }}>
      <Stack.Screen name="index" options={{ title: 'HQ Queue' }} />
      <Stack.Screen name="orders/[orderId]" options={{ title: 'Order Detail' }} />
    </Stack>
  );
}
