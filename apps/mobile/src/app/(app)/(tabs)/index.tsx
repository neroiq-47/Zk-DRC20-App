import { useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { router, useScrollToTop } from 'expo-router';
import type { Post } from '@zoko/contracts';
import { useTheme } from '@/theme';
import { Screen, Wordmark } from '@/components/ui';
import { IconButton } from '@/components/IconButton';
import { SegmentedControl } from '@/components/SegmentedControl';
import { ToastHost } from '@/components/Toast';
import { PostList } from '@/features/posts/PostList';
import { useFeed } from '@/features/posts/hooks';
import type { FeedKind } from '@/features/posts/keys';
import { useUnreadNotifications } from '@/features/posts/useUnreadNotifications';

function Feed({ kind }: { kind: FeedKind }) {
  const feed = useFeed(kind);
  const ref = useRef<FlatList<Post>>(null);
  useScrollToTop(ref);
  return (
    <PostList
      ref={ref}
      query={feed}
      empty={
        kind === 'following'
          ? {
              icon: 'people-outline',
              title: 'Your feed is quiet',
              body: 'Follow people to see their posts here. Find creators and topics in Explore.',
              action: { title: 'Go to Explore', onPress: () => router.navigate('/explore') },
            }
          : { icon: 'sparkles-outline', title: 'Nothing here yet', body: 'Check back soon for new posts.', action: { title: 'Search Explore', onPress: () => router.navigate('/explore') } }
      }
    />
  );
}

export default function Home() {
  const t = useTheme();
  const [kind, setKind] = useState<FeedKind>('following');
  const unread = useUnreadNotifications();
  const count = unread.data ?? 0;
  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: t.components.feedGutter, paddingRight: 4, height: 56 }}>
        <Wordmark size={24} />
        <IconButton
          icon={count > 0 ? 'notifications' : 'notifications-outline'}
          accessibilityLabel={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
          badge={count > 0}
          onPress={() => router.push('/notifications')}
        />
      </View>
      <View style={{ paddingHorizontal: t.components.feedGutter, paddingBottom: t.spacing.sm }}>
        <SegmentedControl<FeedKind>
          value={kind}
          onChange={setKind}
          segments={[
            { value: 'following', label: 'Following' },
            { value: 'discover', label: 'For you' },
          ]}
        />
      </View>
      <View style={{ flex: 1, borderTopWidth: 1, borderTopColor: t.colors.border }}>
        {/* Keep both feeds mounted so switching keeps scroll position. */}
        <View style={{ flex: 1, display: kind === 'following' ? 'flex' : 'none' }}>
          <Feed kind="following" />
        </View>
        <View style={{ flex: 1, display: kind === 'discover' ? 'flex' : 'none' }}>
          <Feed kind="discover" />
        </View>
      </View>
      <ToastHost />
    </Screen>
  );
}
