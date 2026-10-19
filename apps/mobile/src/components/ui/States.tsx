import { ActivityIndicator, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { Text } from './Text';
import { Button } from './Button';

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.spacing.xxl }} accessibilityLabel={label}>
      <ActivityIndicator color={t.colors.primary} />
    </View>
  );
}

export function EmptyState({ icon = 'sparkles-outline', title, body, action }: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
  action?: { title: string; onPress: () => void };
}) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', padding: t.spacing.xxl, gap: t.spacing.md }}>
      <Ionicons name={icon} size={40} color={t.colors.primary} />
      <Text variant="h3" style={{ textAlign: 'center' }}>{title}</Text>
      {body ? <Text color="textSecondary" style={{ textAlign: 'center' }}>{body}</Text> : null}
      {action ? <Button title={action.title} onPress={action.onPress} /> : null}
    </View>
  );
}

export function ErrorState({ message = "Something went wrong. Try again.", onRetry }: { message?: string; onRetry?: () => void }) {
  return <EmptyState icon="cloud-offline-outline" title="We couldn't load this" body={message} action={onRetry ? { title: 'Try again', onPress: onRetry } : undefined} />;
}
