import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Share, View } from 'react-native';
import Constants from 'expo-constants';
import { router, Stack, useFocusEffect } from 'expo-router';
import type { AccountExport } from '@zoko/contracts';
import { copy as brandCopy } from '@zoko/tokens';
import { useTheme, type ThemePreference } from '@/theme';
import { Text } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useMe } from '@/lib/useMe';
import { queryClient } from '@/lib/queryClient';
import { SettingsChoice, SettingsRow, SettingsSection } from '@/features/settings/SettingsRow';
import { useUpdateSettings } from '@/features/settings/hooks';
import { enablePushNotifications, getPushPermission } from '@/features/settings/push';

async function signOutEverywhere() {
  const tokens = useSession.getState().tokens;
  if (tokens) {
    await api<void>('/auth/logout', { method: 'POST', body: { refresh_token: tokens.refresh_token }, auth: false }).catch(() => undefined);
  }
  await useSession.getState().signOut();
  queryClient.clear();
}

export default function SettingsScreen() {
  const t = useTheme();
  const me = useMe();
  const updateSettings = useUpdateSettings();
  const [push, setPush] = useState<'granted' | 'denied' | 'undetermined' | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getPushPermission().then(setPush);
    }, []),
  );

  const setTheme = (p: ThemePreference) => {
    t.setPreference(p);
    updateSettings.mutate({ theme: p });
  };

  const turnOnPush = async () => {
    setPushBusy(true);
    const r = await enablePushNotifications();
    setPushBusy(false);
    setPush(await getPushPermission());
    if (r.ok) Alert.alert('Notifications are on', "We'll let you know about replies, messages and transfer updates.");
    else Alert.alert('Notifications', r.message);
  };

  const exportData = async () => {
    setExporting(true);
    try {
      const data = await api<AccountExport>('/users/me/export');
      await Share.share({ title: 'Zoko data export', message: JSON.stringify(data, null, 2) });
    } catch {
      Alert.alert("We couldn't export your data", 'Try again in a moment.');
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = () =>
    Alert.alert(
      'Delete your account?',
      'Your profile, posts and messages will be deleted and you will be signed out on every device. Connected wallets are only unlinked; your assets stay in your wallet. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            try {
              await api<void>('/users/me', { method: 'DELETE' });
              await useSession.getState().signOut();
              queryClient.clear();
            } catch {
              Alert.alert("We couldn't delete your account", 'Try again in a moment.');
            }
          },
        },
      ],
    );

  const signOut = () =>
    Alert.alert('Sign out?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          setSigningOut(true);
          await signOutEverywhere();
          setSigningOut(false);
        },
      },
    ]);

  const user = me.data;
  const isModerator = user?.role === 'moderator' || user?.role === 'admin';
  const version = Constants.expoConfig?.version ?? '0.0.0';

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: t.spacing.xxxl }}>
      <Stack.Screen options={{ title: 'Settings' }} />

      <SettingsSection title="Account">
        <SettingsRow first icon="person-circle-outline" label={user ? `@${user.handle}` : 'Account'} value={user?.email} />
        <SettingsRow icon="create-outline" label="Edit profile" onPress={() => router.push('/edit-profile')} />
      </SettingsSection>

      <SettingsSection title="Privacy" description={brandCopy.privacy}>
        <SettingsRow first icon="lock-closed-outline" label="Privacy and messages" hint="Default audience, message requests, wallet badge" onPress={() => router.push('/settings/privacy')} />
      </SettingsSection>

      <SettingsSection title="Appearance">
        <SettingsChoice<ThemePreference>
          first
          label="Theme"
          value={t.preference}
          onChange={setTheme}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </SettingsSection>

      <SettingsSection title="Notifications">
        <SettingsRow
          first
          icon="notifications-outline"
          label="Push notifications"
          value={push === 'granted' ? 'On' : push === 'denied' ? 'Off in device settings' : push ? 'Off' : undefined}
          hint={push === 'granted' ? 'Tap to register this device again' : 'Replies, messages and transfer updates'}
          onPress={pushBusy ? undefined : turnOnPush}
          right={pushBusy ? <ActivityIndicator color={t.colors.primary} /> : undefined}
        />
        <SettingsRow icon="list-outline" label="Activity" onPress={() => router.push('/notifications')} />
      </SettingsSection>

      <SettingsSection title="Your stuff">
        <SettingsRow first icon="wallet-outline" label="Wallet" hint="Optional. Connect a Dogecoin wallet to show DRC-20 assets." onPress={() => router.push('/wallet')} />
        <SettingsRow icon="bookmark-outline" label="Bookmarks" onPress={() => router.push('/bookmarks')} />
        {isModerator ? <SettingsRow icon="shield-checkmark-outline" label="Moderation queue" onPress={() => router.push('/moderation')} /> : null}
      </SettingsSection>

      <SettingsSection title="Your data">
        <SettingsRow
          first
          icon="download-outline"
          label="Export my data"
          hint="Profile, posts, follows and wallets as JSON"
          onPress={exporting ? undefined : exportData}
          right={exporting ? <ActivityIndicator color={t.colors.primary} /> : undefined}
        />
        <SettingsRow icon="trash-outline" label="Delete account" destructive onPress={deleteAccount} />
      </SettingsSection>

      <SettingsSection title="Session">
        <SettingsRow
          first
          icon="log-out-outline"
          label="Sign out"
          destructive
          onPress={signingOut ? undefined : signOut}
          right={signingOut ? <ActivityIndicator color={t.colors.danger} /> : undefined}
        />
      </SettingsSection>

      <View style={{ alignItems: 'center', marginTop: t.spacing.xl }}>
        <Text variant="caption" color="textSecondary">
          Zoko {version}
        </Text>
      </View>
    </ScrollView>
  );
}
