import { Stack } from 'expo-router';
import { useTheme } from '@/theme';
import { useMe } from '@/lib/useMe';

export default function AppLayout() {
  const t = useTheme();
  useMe();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.colors.background },
        headerTintColor: t.colors.textPrimary,
        headerTitleStyle: { fontFamily: 'SpaceGrotesk_600SemiBold' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: t.colors.background },
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}
