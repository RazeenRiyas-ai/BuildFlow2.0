import { Stack } from 'expo-router';

// Both screens are header-less with their own in-content heading (see login.tsx/register.tsx) so
// the two feel like one continuous flow instead of switching visual language mid-stack — register
// provides its own back affordance since removing the native header also removes its back chevron.
export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShadowVisible: false }}>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="register" options={{ headerShown: false }} />
    </Stack>
  );
}
