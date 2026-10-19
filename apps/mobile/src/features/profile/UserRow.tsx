import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { UserSummary } from '@zoko/contracts';
import { useTheme } from '@/theme';
import { Avatar, Text } from '@/components/ui';
import { FollowButton } from './FollowButton';

export function UserRow({ user, showFollow, isMe }: { user: UserSummary; showFollow?: boolean; isMe?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/user/[handle]', params: { handle: user.handle } })}
      accessibilityRole="button"
      accessibilityLabel={`${user.display_name}, @${user.handle}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.md,
        paddingHorizontal: t.components.feedGutter,
        paddingVertical: t.spacing.md,
        minHeight: 64,
        backgroundColor: pressed ? t.colors.surface : 'transparent',
      })}
    >
      <Avatar uri={user.avatar_url} name={user.display_name} size="md" />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text numberOfLines={1} style={{ fontFamily: 'Inter_600SemiBold', flexShrink: 1 }}>
            {user.display_name}
          </Text>
          {user.has_verified_wallet ? <Ionicons name="shield-checkmark" size={14} color={t.colors.goldText} accessibilityLabel="Verified Dogecoin wallet" /> : null}
        </View>
        <Text variant="small" color="textSecondary" numberOfLines={1}>
          @{user.handle}
        </Text>
      </View>
      {showFollow && !isMe ? <FollowButton handle={user.handle} /> : null}
    </Pressable>
  );
}
