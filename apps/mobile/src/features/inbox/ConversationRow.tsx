import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Conversation } from '@zoko/contracts';
import { useTheme } from '@/theme';
import { Avatar, Text } from '@/components/ui';
import { shortRelativeTime } from './relativeTime';

export function ConversationRow({ conversation: c, meId, onPress }: { conversation: Conversation; meId: string | null; onPress: () => void }) {
  const t = useTheme();
  const unread = c.unread_count > 0;
  const last = c.last_message;
  const preview = last ? `${last.sender_id === meId ? 'You: ' : ''}${last.body}` : c.is_request ? 'Wants to message you' : 'Say hello';
  const time = shortRelativeTime(last?.created_at ?? c.updated_at);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${c.other.display_name}, @${c.other.handle}. ${unread ? `${c.unread_count} unread. ` : ''}${preview}. ${time}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.md,
        paddingHorizontal: t.components.feedGutter,
        paddingVertical: t.spacing.md,
        minHeight: 72,
        backgroundColor: pressed ? t.colors.surface : 'transparent',
      })}
    >
      <Avatar uri={c.other.avatar_url} name={c.other.display_name || c.other.handle} size="lg" />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.xs }}>
          <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: unread ? 'Inter_600SemiBold' : 'Inter_500Medium' }}>
            {c.other.display_name || c.other.handle}
          </Text>
          {c.other.has_verified_wallet ? <Ionicons name="wallet" size={13} color={t.colors.goldText} accessibilityLabel="Verified wallet" /> : null}
          <Text variant="small" color="textSecondary" numberOfLines={1} style={{ flexShrink: 2 }}>
            @{c.other.handle}
          </Text>
        </View>
        <Text variant="small" color={unread ? 'textPrimary' : 'textSecondary'} numberOfLines={1} style={unread ? { fontFamily: 'Inter_500Medium' } : undefined}>
          {preview}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: t.spacing.xs }}>
        <Text variant="caption" color="textSecondary">
          {time}
        </Text>
        {unread ? (
          <View style={{ minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: t.colors.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="caption" color="onPrimary" tabular>
              {c.unread_count > 99 ? '99+' : c.unread_count}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
