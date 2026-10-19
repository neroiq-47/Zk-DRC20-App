import type { ReactElement, Ref } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View, type FlatListProps } from 'react-native';
import type { Post } from '@zoko/contracts';
import { useTheme } from '@/theme';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { PostCard } from './PostCard';
import type { useInfiniteList } from './hooks';

type ListQuery = Pick<
  ReturnType<typeof useInfiniteList<Post>>,
  'items' | 'isPending' | 'isError' | 'refetch' | 'isRefetching' | 'loadMore' | 'isFetchingNextPage' | 'error'
>;

export interface PostListProps extends Omit<FlatListProps<Post>, 'data' | 'renderItem'> {
  query: ListQuery;
  empty: { title: string; body?: string; icon?: Parameters<typeof EmptyState>[0]['icon']; action?: { title: string; onPress: () => void } };
  header?: ReactElement | null;
  hideReplyContext?: boolean;
  ref?: Ref<FlatList<Post>>;
}

/** Infinite, pull-to-refresh list of PostCards with loading, empty and error states. */
export function PostList({ query, empty, header, hideReplyContext, ...rest }: PostListProps) {
  const t = useTheme();
  const body = query.isPending ? (
    <LoadingState />
  ) : query.isError ? (
    <ErrorState onRetry={() => query.refetch()} />
  ) : (
    <EmptyState {...empty} />
  );
  return (
    <FlatList
      data={query.items}
      keyExtractor={(p) => p.id}
      renderItem={({ item }) => <PostCard post={item} hideReplyContext={hideReplyContext} />}
      ListHeaderComponent={header ?? undefined}
      ListEmptyComponent={<View style={{ paddingTop: t.spacing.xl }}>{body}</View>}
      ListFooterComponent={
        query.isFetchingNextPage ? (
          <View style={{ padding: t.spacing.lg }}>
            <ActivityIndicator color={t.colors.primary} />
          </View>
        ) : undefined
      }
      onEndReached={query.loadMore}
      onEndReachedThreshold={0.6}
      refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={() => void query.refetch()} tintColor={t.colors.primary} colors={[t.colors.primary]} />}
      contentContainerStyle={{ paddingBottom: t.spacing.xxl, flexGrow: 1 }}
      windowSize={9}
      initialNumToRender={6}
      removeClippedSubviews
      {...rest}
    />
  );
}
