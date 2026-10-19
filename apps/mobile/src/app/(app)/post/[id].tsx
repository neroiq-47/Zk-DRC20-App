import { Pressable, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@/theme';
import { Avatar, ErrorState, LoadingState, Text } from '@/components/ui';
import { ToastHost } from '@/components/Toast';
import { ApiError } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { PostCard, openCompose, openPost } from '@/features/posts/PostCard';
import { PostList } from '@/features/posts/PostList';
import { usePost, useReplies } from '@/features/posts/hooks';

function ReplyEntry({ postId, handle }: { postId: string; handle: string }) {
  const t = useTheme();
  const me = useMe().data;
  return (
    <Pressable
      onPress={() => openCompose({ reply_to: postId })}
      accessibilityRole="button"
      accessibilityLabel={`Reply to @${handle}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.md,
        paddingHorizontal: t.components.feedGutter,
        paddingVertical: t.spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: t.colors.border,
      }}
    >
      {me ? <Avatar uri={me.avatar_url} name={me.display_name} size="sm" /> : null}
      <View style={{ flex: 1, height: 44, borderRadius: t.radii.pill, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.border, justifyContent: 'center', paddingHorizontal: t.spacing.lg }}>
        <Text color="textSecondary">Post your reply</Text>
      </View>
    </Pressable>
  );
}

export default function PostDetail() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const post = usePost(id);
  const replies = useReplies(id ?? '');

  if (post.isPending) {
    return (
      <>
        <Stack.Screen options={{ title: 'Post' }} />
        <LoadingState />
      </>
    );
  }
  if (post.isError || !post.data) {
    const gone = post.error instanceof ApiError && (post.error.status === 404 || post.error.status === 403);
    return (
      <>
        <Stack.Screen options={{ title: 'Post' }} />
        <ErrorState message={gone ? 'This post is unavailable.' : undefined} onRetry={gone ? undefined : () => post.refetch()} />
      </>
    );
  }
  const p = post.data;
  const header = (
    <View>
      {p.parent_id ? (
        <Pressable
          onPress={() => openPost(p.parent_id!)}
          accessibilityRole="link"
          style={{ paddingHorizontal: t.components.feedGutter, paddingTop: t.spacing.md, minHeight: 44, justifyContent: 'center' }}
        >
          <Text variant="small" color="link">
            Show the post this replies to
          </Text>
        </Pressable>
      ) : null}
      <PostCard post={p} variant="detail" onDeleted={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      <ReplyEntry postId={p.id} handle={p.author.handle} />
    </View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <Stack.Screen options={{ title: 'Post' }} />
      <PostList
        query={{
          ...replies,
          isPending: replies.isPending,
          refetch: () => {
            void post.refetch();
            return replies.refetch();
          },
        }}
        header={header}
        hideReplyContext
        empty={{ icon: 'chatbubbles-outline', title: 'No replies yet', body: 'Start the conversation.' }}
      />
      <ToastHost />
    </View>
  );
}
