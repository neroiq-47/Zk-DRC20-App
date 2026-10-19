import { ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import type { PostVisibility, UserSettings } from '@zoko/contracts';
import { copy as brandCopy } from '@zoko/tokens';
import { useTheme } from '@/theme';
import { ErrorState, LoadingState, Text } from '@/components/ui';
import { useMe } from '@/lib/useMe';
import { SettingsChoice, SettingsSection, SettingsSwitch } from '@/features/settings/SettingsRow';
import { useUpdateSettings } from '@/features/settings/hooks';

export default function PrivacyScreen() {
  const t = useTheme();
  const me = useMe();
  const update = useUpdateSettings();

  const header = <Stack.Screen options={{ title: 'Privacy' }} />;
  if (me.isPending) return <>{header}<LoadingState /></>;
  if (me.isError) return <>{header}<ErrorState onRetry={() => me.refetch()} /></>;
  const s = me.data.settings;

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: t.spacing.xxxl }}>
      {header}
      <Text variant="h2" style={{ paddingHorizontal: t.components.feedGutter, marginTop: t.spacing.lg }}>
        {brandCopy.privacy}
      </Text>

      <SettingsSection title="Posts" description="Who sees new posts by default. You can change it on each post.">
        <SettingsChoice<PostVisibility>
          first
          label="Default audience"
          value={s.default_visibility}
          onChange={(v) => update.mutate({ default_visibility: v })}
          options={[
            { value: 'public', label: 'Everyone' },
            { value: 'followers', label: 'Followers' },
          ]}
        />
      </SettingsSection>

      <SettingsSection title="Messages" description="Messages from people you don't follow arrive as requests you can accept, block or report.">
        <SettingsChoice<UserSettings['allow_message_requests']>
          first
          label="Who can message me"
          value={s.allow_message_requests}
          onChange={(v) => update.mutate({ allow_message_requests: v })}
          options={[
            { value: 'everyone', label: 'Everyone' },
            { value: 'following', label: 'People I follow' },
            { value: 'nobody', label: 'Nobody new' },
          ]}
        />
      </SettingsSection>

      <SettingsSection title="Wallet" description="Controls whether your profile shows that you have a verified Dogecoin wallet.">
        <SettingsSwitch first label="Show my wallet on my profile" value={s.show_wallet_on_profile} onValueChange={(v) => update.mutate({ show_wallet_on_profile: v })} />
      </SettingsSection>

      {update.isError ? (
        <Text variant="small" color="danger" style={{ paddingHorizontal: t.components.feedGutter, marginTop: t.spacing.md }} accessibilityLiveRegion="polite">
          We couldn't save that change. Try again.
        </Text>
      ) : null}
    </ScrollView>
  );
}
