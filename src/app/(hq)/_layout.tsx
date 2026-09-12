import { Stack } from 'expo-router';

export default function HqLayout() {
  return (
    <Stack screenOptions={{ headerShadowVisible: false }}>
      <Stack.Screen name="index" options={{ title: 'HQ Queue' }} />
      <Stack.Screen name="orders/[orderId]" options={{ title: 'Order Detail' }} />
      <Stack.Screen name="materials/index" options={{ title: 'Materials' }} />
      <Stack.Screen name="materials/new" options={{ title: 'New Material' }} />
      <Stack.Screen name="materials/[materialId]/index" options={{ title: 'Material' }} />
      <Stack.Screen name="drivers/index" options={{ title: 'Drivers' }} />
      <Stack.Screen name="suppliers/index" options={{ title: 'Suppliers' }} />
    </Stack>
  );
}
