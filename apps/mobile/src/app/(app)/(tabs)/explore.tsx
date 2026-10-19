import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { Post, UserSummary } from '@zoko/contracts';
import { useTheme } from '@/theme';
import { EmptyState, ErrorState, Screen, Text } from '@/components/ui';
import { SegmentedControl } from '@/components/SegmentedControl';
import { ToastHost } from '@/components/Toast';
import { compactCount, plural } from '@/lib/format';
import { useMe } from '@/lib/useMe';
import { PostCard } from '@/features/posts/PostCard';
import { UserRow } from '@/features/profile/UserRow';
import { SearchField } from '@/features/explore/SearchField';
import { useDebounced, useSearch, useSuggested, useTrends } from '@/features/explore/hooks';

type ResultTab = 'people' | 'posts';

function SectionTitle({ children }: { children: string }) {
  const t = useTheme();
  return (
    <Text variant="h3" accessibilityRole="header" style={{ paddingHorizontal: t.components.feedGutter, paddingTop: t.spacing.lg, paddingBottom: t.spacing.sm }}>
      {children}
    </Text>
  );
}

function Discover({ onTag }: { onTag: (tag: string) => void }) {
  const t = useTheme();
  const trends = useTrends();
  const suggested = useSuggested();
  const me = useMe().data;
  const refreshing = (trends.isRefetching || suggested.isRefetching) && !trends.isPending;
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: t.spacing.xxl }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            void trends.refetch();
            void suggested.refetch();
          }}
          tintColor={t.colors.primary}
          colors={[t.colors.primary]}
        />
      }
    >
      <SectionTitle>Trending</SectionTitle>
      {trends.isPending ? (
        <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.lg }} />
      ) : trends.isError ? (
        <ErrorState onRetry={() => trends.refetch()} />
      ) : trends.data.length === 0 ? (
        <Text color="textSecondary" style={{ paddingHorizontal: t.components.feedGutter }}>
          No trends right now. Check back soon.
        </Text>
      ) : (
        trends.data.map((tr, i) => (
          <Pressable
            key={tr.tag}
            onPress={() => onTag(tr.tag)}
            accessibilityRole="button"
            accessibilityLabel={`Trending hashtag ${tr.tag}, ${tr.post_count} posts`}
            style={({ pressed }) => ({
              paddingHorizontal: t.components.feedGutter,
              paddingVertical: t.spacing.sm,
              minHeight: 56,
              justifyContent: 'center',
              backgroundColor: pressed ? t.colors.surface : 'transparent',
            })}
          >
            <Text variant="caption" color="textSecondary">
              {i + 1} · Trending
            </Text>
            <Text style={{ fontFamily: 'Inter_600SemiBold' }}>#{tr.tag}</Text>
            <Text variant="small" color="textSecondary" tabular>
              {compactCount(tr.post_count)} {plural(tr.post_count, 'post')}
            </Text>
          </Pressable>
        ))
      )}

      <SectionTitle>Suggested creators</SectionTitle>
      {suggested.isPending ? (
        <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.lg }} />
      ) : suggested.isError ? (
        <ErrorState onRetry={() => suggested.refetch()} />
      ) : suggested.data.length === 0 ? (
        <Text color="textSecondary" style={{ paddingHorizontal: t.components.feedGutter }}>
          No suggestions yet.
        </Text>
      ) : (
        suggested.data.map((u) => <UserRow key={u.id} user={u} showFollow isMe={u.id === me?.id} />)
      )}
    </ScrollView>
  );
}

function Results({ q }: { q: string }) {
  const t = useTheme();
  const me = useMe().data;
  const [tab, setTab] = useState<ResultTab>(q.startsWith('#') ? 'posts' : 'people');
  const search = useSearch(q);
  useEffect(() => {
    if (q.startsWith('#')) setTab('posts');
  }, [q]);

  const header = (
    <View>
      <SegmentedControl<ResultTab>
        variant="underline"
        value={tab}
        onChange={setTab}
        segments={[
          { value: 'people', label: 'People' },
          { value: 'posts', label: 'Posts' },
        ]}
      />
      {search.isFetching && search.data ? <ActivityIndicator color={t.colors.primary} style={{ paddingTop: t.spacing.sm }} /> : null}
    </View>
  );

  const empty = search.isPending ? (
    <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.xl }} />
  ) : search.isError ? (
    <ErrorState onRetry={() => search.refetch()} />
  ) : (
    <EmptyState icon="search-outline" title={`No ${tab === 'people' ? 'people' : 'posts'} found`} body={`Try a different search than “${q}”.`} />
  );

  if (tab === 'people') {
    return (
      <FlatList<UserSummary>
        data={search.data?.users ?? []}
        keyExtractor={(u) => u.id}
        renderItem={({ item }) => <UserRow user={item} showFollow isMe={item.id === me?.id} />}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: t.spacing.xxl }}
      />
    );
  }
  return (
    <FlatList<Post>
      data={search.data?.posts ?? []}
      keyExtractor={(p) => p.id}
      renderItem={({ item }) => <PostCard post={item} />}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={{ paddingBottom: t.spacing.xxl }}
    />
  );
}

export default function Explore() {
  const t = useTheme();
  const params = useLocalSearchParams<{ q?: string }>();
  const [text, setText] = useState(params.q ?? '');
  const q = useDebounced(text, 300).trim();

  useEffect(() => {
    if (typeof params.q === 'string') setText(params.q);
  }, [params.q]);

  return (
    <Screen>
      <View style={{ paddingHorizontal: t.components.feedGutter, paddingTop: t.spacing.sm, paddingBottom: t.spacing.sm, gap: t.spacing.sm }}>
        <Text variant="h2" accessibilityRole="header">
          Explore
        </Text>
        <SearchField value={text} onChangeText={setText} />
      </View>
      {q ? <Results key={q.startsWith('#') ? 'tag' : 'text'} q={q} /> : <Discover onTag={(tag) => setText(`#${tag}`)} />}
      <ToastHost />
    </Screen>
  );
}
