import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@/theme';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useMe } from '@/lib/useMe';
import { UserRow } from '@/features/profile/UserRow';
import { useUserList, type UserListKind } from '@/features/profile/hooks';

export default function UserList() {
  const t = useTheme();
  const params = useLocalSearchParams<{ handle: string; list: string }>();
  const kind: UserListKind = params.list === 'following' ? 'following' : 'followers';
  const handle = params.handle?.toLowerCase() ?? '';
  const list = useUserList(handle, kind);
  const me = useMe().data;
  const title = kind === 'followers' ? 'Followers' : 'Following';
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <Stack.Screen options={{ title, headerShown: true }} />
      <FlatList
        data={list.items}
        keyExtractor={(u) => u.id}
        renderItem={({ item }) => <UserRow user={item} isMe={item.id === me?.id} />}
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => void list.refetch()} tintColor={t.colors.primary} />}
        ListEmptyComponent={
          list.isPending ? (
            <LoadingState />
          ) : list.isError ? (
            <ErrorState onRetry={() => list.refetch()} />
          ) : (
            <EmptyState
              icon="people-outline"
              title={kind === 'followers' ? 'No followers yet' : 'Not following anyone yet'}
              body={kind === 'followers' ? `When people follow @${handle}, they'll show up here.` : `When @${handle} follows people, they'll show up here.`}
            />
          )
        }
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.lg }} /> : undefined}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: t.spacing.xxl }}
      />
    </View>
  );
}
