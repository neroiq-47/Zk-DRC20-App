import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useFocusEffect, type Href } from 'expo-router';
import type { NotificationKind } from '@zoko/contracts';
import { useTheme } from '@/theme';
import { Avatar, EmptyState, ErrorState, LoadingState, Text } from '@/components/ui';
import { flattenPages } from '@/features/inbox/cache';
import { shortRelativeTime } from '@/features/inbox/relativeTime';
import { groupNotifications, notificationHref, notificationText, type NotificationGroup } from '@/features/notifications/group';
import { useMarkNotificationsRead, useNotifications } from '@/features/notifications/hooks';

const KIND_ICON: Record<NotificationKind, keyof typeof Ionicons.glyphMap> = {
  like: 'heart',
  reply: 'chatbubble',
  repost: 'repeat',
  follow: 'person-add',
  mention: 'at',
  message: 'mail',
  transfer: 'swap-horizontal',
};

export default function NotificationsScreen() {
  const t = useTheme();
  const q = useNotifications();
  const markRead = useMarkNotificationsRead();
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      markRead.mutate();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const groups = useMemo(() => groupNotifications(flattenPages(q.data)), [q.data]);

  const onRefresh = async () => {
    setRefreshing(true);
    await q.refetch();
    markRead.mutate();
    setRefreshing(false);
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Notifications' }} />
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.key}
          renderItem={({ item }) => <NotificationRow group={item} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.primary} />}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
          }}
          ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.lg }} /> : undefined}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: t.colors.border, marginLeft: 72 }} />}
          contentContainerStyle={groups.length === 0 ? { flexGrow: 1, justifyContent: 'center' } : { paddingBottom: t.spacing.xxl }}
          ListEmptyComponent={<EmptyState icon="notifications-outline" title="Nothing new yet" body="Likes, replies, follows and messages show up here." />}
        />
      )}
    </>
  );
}

function NotificationRow({ group: g }: { group: NotificationGroup }) {
  const t = useTheme();
  const href = notificationHref(g.latest);
  const text = notificationText(g);
  const iconColor = g.kind === 'transfer' ? t.colors.goldText : t.colors.primary;
  const preview = g.latest.post?.body?.trim();
  return (
    <Pressable
      onPress={href ? () => router.push(href as Href) : undefined}
      disabled={!href}
      accessibilityRole="button"
      accessibilityLabel={`${g.unread ? 'New. ' : ''}${text}. ${shortRelativeTime(g.latest.created_at)}${preview ? `. ${preview}` : ''}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: t.spacing.md,
        paddingHorizontal: t.components.feedGutter,
        paddingVertical: t.spacing.md,
        backgroundColor: pressed ? t.colors.surface : g.unread ? t.colors.surface : 'transparent',
      })}
    >
      <View style={{ width: 40, alignItems: 'center', paddingTop: 2 }}>
        <Ionicons name={KIND_ICON[g.kind]} size={22} color={iconColor} />
      </View>
      <View style={{ flex: 1, gap: t.spacing.xs }}>
        {g.actors.length ? (
          <View style={{ flexDirection: 'row' }}>
            {g.actors.slice(0, 5).map((a, i) => (
              <View key={a.id} style={{ marginLeft: i === 0 ? 0 : -8, borderRadius: 18, borderWidth: 2, borderColor: t.colors.background }}>
                <Avatar uri={a.avatar_url} name={a.display_name || a.handle} size="sm" />
              </View>
            ))}
          </View>
        ) : null}
        <Text>
          {text}
          <Text variant="small" color="textSecondary">
            {'  '}
            {shortRelativeTime(g.latest.created_at)}
          </Text>
        </Text>
        {preview ? (
          <Text variant="small" color="textSecondary" numberOfLines={2}>
            {preview}
          </Text>
        ) : null}
      </View>
      {g.unread ? <View accessibilityElementsHidden style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.colors.primary, marginTop: 8 }} /> : null}
    </Pressable>
  );
}
