import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '@/theme';
import { EmptyState, ErrorState, LoadingState, Screen, Text } from '@/components/ui';
import { IconButton } from '@/components/IconButton';
import { useSession } from '@/lib/session';
import { useConversations } from '@/features/inbox/hooks';
import { flattenPages } from '@/features/inbox/cache';
import { ConversationRow } from '@/features/inbox/ConversationRow';
import { NewMessageSheet } from '@/features/inbox/NewMessageSheet';
import { selectUnreadCount, useNotifications } from '@/features/notifications/hooks';

type Segment = 'messages' | 'requests';

export default function InboxScreen() {
  const t = useTheme();
  const meId = useSession((s) => s.user?.id ?? null);
  const q = useConversations();
  const notifications = useNotifications();
  const [segment, setSegment] = useState<Segment>('messages');
  const [composeOpen, setComposeOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const all = useMemo(() => flattenPages(q.data), [q.data]);
  const requests = useMemo(() => all.filter((c) => c.is_request), [all]);
  const messages = useMemo(() => all.filter((c) => !c.is_request), [all]);
  const list = segment === 'messages' ? messages : requests;
  const unreadNotifications = selectUnreadCount(notifications.data);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([q.refetch(), notifications.refetch()]);
    setRefreshing(false);
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: t.components.feedGutter, paddingRight: t.spacing.xs, paddingTop: t.spacing.sm }}>
        <Text variant="h1" accessibilityRole="header" style={{ flex: 1 }}>
          Inbox
        </Text>
        <IconButton
          icon="notifications-outline"
          accessibilityLabel={unreadNotifications ? `Notifications, ${unreadNotifications} unread` : 'Notifications'}
          badge={unreadNotifications > 0}
          onPress={() => router.push('/notifications')}
        />
        <IconButton icon="create-outline" accessibilityLabel="New message" color="link" onPress={() => setComposeOpen(true)} />
      </View>

      <View
        accessibilityRole="tablist"
        style={{ flexDirection: 'row', marginHorizontal: t.components.feedGutter, marginVertical: t.spacing.md, backgroundColor: t.colors.surface, borderRadius: t.radii.md, padding: 4, borderWidth: 1, borderColor: t.colors.border }}
      >
        {(['messages', 'requests'] as const).map((s) => {
          const selected = segment === s;
          const label = s === 'messages' ? 'Messages' : `Requests${requests.length ? ` (${requests.length})` : ''}`;
          return (
            <Pressable
              key={s}
              onPress={() => setSegment(s)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={label}
              style={{ flex: 1, minHeight: 40, borderRadius: t.radii.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? t.colors.primary : 'transparent' }}
            >
              <Text variant="small" color={selected ? 'onPrimary' : 'textSecondary'} style={{ fontFamily: 'Inter_600SemiBold' }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => <ConversationRow conversation={item} meId={meId} onPress={() => router.push(`/chat/${item.id}`)} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.primary} />}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
          }}
          ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.lg }} /> : undefined}
          contentContainerStyle={list.length === 0 ? { flexGrow: 1, justifyContent: 'center' } : undefined}
          ListEmptyComponent={
            segment === 'messages' ? (
              <EmptyState icon="chatbubbles-outline" title="No messages yet" body="Start a conversation with someone you follow." action={{ title: 'New message', onPress: () => setComposeOpen(true) }} />
            ) : (
              <EmptyState icon="mail-unread-outline" title="No message requests" body="Messages from people you don't follow land here first. You choose whether to reply." />
            )
          }
        />
      )}

      <NewMessageSheet visible={composeOpen} onClose={() => setComposeOpen(false)} />
    </Screen>
  );
}
