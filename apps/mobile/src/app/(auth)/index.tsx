import { View } from 'react-native';
import { router } from 'expo-router';
import { copy } from '@zoko/tokens';
import { useTheme } from '@/theme';
import { Button, LogoMark, Screen, Text, Wordmark } from '@/components/ui';

export default function Welcome() {
  const t = useTheme();
  return (
    <Screen edges={['top', 'bottom']} style={{ paddingHorizontal: t.spacing.xl }}>
      <View style={{ paddingTop: t.spacing.lg }}>
        <Wordmark size={24} />
      </View>
      <View style={{ flex: 1, justifyContent: 'center', gap: t.spacing.lg }}>
        <LogoMark size={96} />
        <Text variant="display" accessibilityRole="header">
          {copy.onboarding}
        </Text>
        <Text variant="h3" color="textSecondary">
          {copy.tagline}
        </Text>
        <Text color="textSecondary">{copy.secondary}</Text>
      </View>
      <View style={{ gap: t.spacing.md, paddingBottom: t.spacing.xl }}>
        <Button title="Create account" fullWidth onPress={() => router.push('/sign-up')} />
        <Button title="Sign in" variant="secondary" fullWidth onPress={() => router.push('/sign-in')} />
        <Text variant="caption" color="textSecondary" style={{ textAlign: 'center' }}>
          {copy.privacy} You can add a wallet later, or never.
        </Text>
      </View>
    </Screen>
  );
}
