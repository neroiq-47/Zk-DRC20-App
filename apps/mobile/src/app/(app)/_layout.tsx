import { Stack } from 'expo-router';
import { useTheme } from '@/theme';
import { useEffect } from 'react';
import { useMe } from '@/lib/useMe';
import { RealtimeBridge } from '@/features/realtime/RealtimeBridge';

export default function AppLayout() {
  const t = useTheme();
  const { data: me } = useMe();
  const serverTheme = me?.settings.theme;
  const setPreference = t.setPreference;
  // Apply the theme saved on the account when signing in on a device.
  useEffect(() => {
    if (serverTheme) setPreference(serverTheme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverTheme]);
  return (
    <>
      <RealtimeBridge />
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
    </>
  );
}
