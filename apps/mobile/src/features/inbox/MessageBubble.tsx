import { Pressable, View } from 'react-native';
import { useTheme } from '@/theme';
import { Text } from '@/components/ui';
import type { ChatMessage } from './cache';
import { clockTime } from './relativeTime';

export function MessageBubble({ message, mine, showTime, onRetry }: { message: ChatMessage; mine: boolean; showTime: boolean; onRetry?: () => void }) {
  const t = useTheme();
  const failed = message.local_state === 'failed';
  const sending = message.local_state === 'sending';
  const status = failed ? 'Not sent. Tap to retry.' : sending ? 'Sending…' : showTime ? clockTime(message.created_at) : null;
  const bubble = (
    <View
      style={{
        maxWidth: '80%',
        alignSelf: mine ? 'flex-end' : 'flex-start',
        backgroundColor: mine ? t.colors.primary : t.colors.surface,
        borderWidth: mine ? 0 : 1,
        borderColor: t.colors.border,
        borderRadius: 20,
        borderBottomRightRadius: mine ? 6 : 20,
        borderBottomLeftRadius: mine ? 20 : 6,
        paddingHorizontal: t.spacing.md + 2,
        paddingVertical: t.spacing.sm + 1,
        opacity: sending ? 0.7 : 1,
      }}
    >
      <Text color={mine ? 'onPrimary' : 'textPrimary'} selectable>
        {message.body}
      </Text>
    </View>
  );
  return (
    <View style={{ paddingHorizontal: t.components.feedGutter, paddingVertical: 2, gap: 2 }}>
      {failed && onRetry ? (
        <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel={`Message not sent: ${message.body}. Tap to retry.`} style={{ alignSelf: 'flex-end', maxWidth: '100%' }}>
          {bubble}
        </Pressable>
      ) : (
        bubble
      )}
      {status ? (
        <Text variant="caption" color={failed ? 'danger' : 'textSecondary'} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', marginBottom: t.spacing.xs }}>
          {status}
        </Text>
      ) : null}
    </View>
  );
}
