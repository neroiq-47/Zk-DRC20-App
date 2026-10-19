import { memo, useRef, useState } from 'react';
import { Alert, Animated, Pressable, Share, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import type { Post } from '@zoko/contracts';
import { motion } from '@zoko/tokens';
import { useTheme } from '@/theme';
import { Avatar, Text } from '@/components/ui';
import { BottomSheet, SheetOption } from '@/components/BottomSheet';
import { IconButton } from '@/components/IconButton';
import { showToast } from '@/components/Toast';
import { useMe } from '@/lib/useMe';
import { compactCount, relativeTime } from '@/lib/format';
import { displayedPost } from './cache';
import { useBookmark, useDeletePost, useLike, useRepost } from './hooks';
import { PostMedia } from './PostMedia';
import { ReportSheet } from './ReportSheet';
import { RichText, openProfile } from './RichText';

export function openPost(id: string) {
  router.push({ pathname: '/post/[id]', params: { id } });
}
export function openCompose(params: { reply_to?: string; quote?: string }) {
  router.push({ pathname: '/compose', params });
}

function WalletBadge() {
  const t = useTheme();
  return (
    <View accessibilityLabel="Verified Dogecoin wallet" style={{ marginLeft: 2 }}>
      <Ionicons name="shield-checkmark" size={14} color={t.colors.goldText} />
    </View>
  );
}

export function AuthorLine({ post, compact }: { post: Post; compact?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}>
      <Text numberOfLines={1} style={{ fontFamily: 'Inter_600SemiBold', flexShrink: 1 }} variant={compact ? 'small' : 'body'}>
        {post.author.display_name}
      </Text>
      {post.author.has_verified_wallet ? <WalletBadge /> : null}
      <Text numberOfLines={1} variant="small" color="textSecondary" style={{ flexShrink: 2 }}>
        @{post.author.handle} · {relativeTime(post.created_at)}
      </Text>
      {post.visibility === 'followers' ? <Ionicons name="people" size={12} color={t.colors.textSecondary} accessibilityLabel="Followers only" /> : null}
    </View>
  );
}

/** Compact embedded rendering for quoted posts. */
export function QuotedPost({ post }: { post: Post }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => openPost(post.id)}
      accessibilityRole="button"
      accessibilityLabel={`Quoted post by ${post.author.display_name}`}
      style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: t.radii.md, padding: t.spacing.md, gap: t.spacing.sm }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
        <Avatar uri={post.author.avatar_url} name={post.author.display_name} size="sm" />
        <AuthorLine post={post} compact />
      </View>
      {post.body ? <RichText body={post.body} variant="small" numberOfLines={6} /> : null}
      {post.media.length ? <PostMedia media={post.media} /> : null}
    </Pressable>
  );
}

function ActionButton({
  icon,
  count,
  label,
  onPress,
  color,
  countColor,
  scale,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  count?: number;
  label: string;
  onPress: () => void;
  color: string;
  countColor?: 'textSecondary' | 'successText' | 'link';
  scale?: Animated.Value;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={{ minWidth: 44, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 }}
    >
      <Animated.View style={scale ? { transform: [{ scale }] } : undefined}>
        <Ionicons name={icon} size={20} color={color} />
      </Animated.View>
      {count !== undefined ? (
        <Text variant="small" color={countColor ?? 'textSecondary'} tabular style={{ minWidth: 18 }}>
          {count > 0 ? compactCount(count) : ''}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function PostActions({ post }: { post: Post }) {
  const t = useTheme();
  const like = useLike();
  const bookmark = useBookmark();
  const repost = useRepost();
  const pulse = useRef(new Animated.Value(1)).current;
  const [repostSheet, setRepostSheet] = useState(false);

  const onLike = () => {
    const next = !post.liked_by_me;
    if (next) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.3, duration: motion.likePulse / 2, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: motion.likePulse / 2, useNativeDriver: true }),
      ]).start();
    }
    like.mutate({ post, next });
  };

  const onShare = () => {
    const url = Linking.createURL(`/post/${post.id}`);
    Share.share({ message: post.body ? `${post.body}\n\n${url}` : url, url }).catch(() => undefined);
  };

  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginLeft: -8 }}>
      <ActionButton
        icon="chatbubble-outline"
        count={post.reply_count}
        label={`Reply. ${post.reply_count} replies`}
        onPress={() => openCompose({ reply_to: post.id })}
        color={t.colors.textSecondary}
      />
      <ActionButton
        icon="repeat"
        count={post.repost_count}
        label={post.reposted_by_me ? `Reposted. ${post.repost_count} reposts` : `Repost. ${post.repost_count} reposts`}
        onPress={() => setRepostSheet(true)}
        color={post.reposted_by_me ? t.colors.link : t.colors.textSecondary}
        countColor={post.reposted_by_me ? 'link' : 'textSecondary'}
      />
      <ActionButton
        icon={post.liked_by_me ? 'heart' : 'heart-outline'}
        count={post.like_count}
        label={post.liked_by_me ? `Liked. ${post.like_count} likes` : `Like. ${post.like_count} likes`}
        onPress={onLike}
        color={post.liked_by_me ? t.colors.mint : t.colors.textSecondary}
        countColor={post.liked_by_me ? 'successText' : 'textSecondary'}
        scale={pulse}
      />
      <ActionButton
        icon={post.bookmarked_by_me ? 'bookmark' : 'bookmark-outline'}
        label={post.bookmarked_by_me ? 'Remove bookmark' : 'Bookmark'}
        onPress={() => {
          const next = !post.bookmarked_by_me;
          bookmark.mutate({ post, next }, { onSuccess: () => showToast(next ? 'Saved to bookmarks.' : 'Removed from bookmarks.', 'info') });
        }}
        color={post.bookmarked_by_me ? t.colors.link : t.colors.textSecondary}
      />
      <ActionButton icon="share-outline" label="Share" onPress={onShare} color={t.colors.textSecondary} />

      <BottomSheet visible={repostSheet} onClose={() => setRepostSheet(false)}>
        <SheetOption
          label={post.reposted_by_me ? 'Undo repost' : 'Repost'}
          icon={<Ionicons name="repeat" size={22} color={t.colors.textPrimary} />}
          onPress={() => {
            setRepostSheet(false);
            repost.mutate({ post, next: !post.reposted_by_me }, { onError: () => showToast("We couldn't update your repost. Try again.", 'error') });
          }}
        />
        <SheetOption
          label="Quote"
          icon={<Ionicons name="create-outline" size={22} color={t.colors.textPrimary} />}
          onPress={() => {
            setRepostSheet(false);
            openCompose({ quote: post.id });
          }}
        />
      </BottomSheet>
    </View>
  );
}

function PostMenu({ post, visible, onClose, onDeleted }: { post: Post; visible: boolean; onClose: () => void; onDeleted?: () => void }) {
  const t = useTheme();
  const me = useMe().data;
  const del = useDeletePost();
  const [reporting, setReporting] = useState(false);
  const mine = me?.id === post.author.id;
  return (
    <>
      <BottomSheet visible={visible} onClose={onClose}>
        {mine ? (
          <SheetOption
            label="Delete post"
            destructive
            icon={<Ionicons name="trash-outline" size={22} color={t.colors.danger} />}
            onPress={() => {
              onClose();
              Alert.alert('Delete post?', 'This can’t be undone.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () =>
                    del.mutate(post, {
                      onSuccess: () => {
                        showToast('Post deleted.', 'info');
                        onDeleted?.();
                      },
                      onError: () => showToast("We couldn't delete your post. Try again.", 'error'),
                    }),
                },
              ]);
            }}
          />
        ) : (
          <>
            <SheetOption
              label={`View @${post.author.handle}`}
              icon={<Ionicons name="person-outline" size={22} color={t.colors.textPrimary} />}
              onPress={() => {
                onClose();
                openProfile(post.author.handle);
              }}
            />
            <SheetOption
              label="Report post"
              destructive
              icon={<Ionicons name="flag-outline" size={22} color={t.colors.danger} />}
              onPress={() => {
                onClose();
                setReporting(true);
              }}
            />
          </>
        )}
      </BottomSheet>
      <ReportSheet visible={reporting} onClose={() => setReporting(false)} target={{ kind: 'post', id: post.id }} />
    </>
  );
}

export interface PostCardProps {
  post: Post;
  /** 'detail' renders a larger body, full timestamp and no tap-through. */
  variant?: 'feed' | 'detail';
  /** Hide the "Replying to" line (e.g. inside a reply thread). */
  hideReplyContext?: boolean;
  /** Called after the author deletes this post (detail screens use it to go back). */
  onDeleted?: () => void;
}

function PostCardImpl({ post: raw, variant = 'feed', hideReplyContext, onDeleted }: PostCardProps) {
  const t = useTheme();
  const { post, repostedBy } = displayedPost(raw);
  const [menu, setMenu] = useState(false);
  const detail = variant === 'detail';
  return (
    <Pressable
      onPress={detail ? undefined : () => openPost(post.id)}
      disabled={detail}
      accessibilityLabel={`Post by ${post.author.display_name}`}
      style={({ pressed }) => ({
        paddingHorizontal: t.components.feedGutter,
        paddingTop: t.spacing.md,
        paddingBottom: t.spacing.xs,
        backgroundColor: pressed ? t.colors.surface : t.colors.background,
        borderBottomWidth: 1,
        borderBottomColor: t.colors.border,
      })}
    >
      {repostedBy ? (
        <Pressable onPress={() => openProfile(repostedBy.handle)} accessibilityRole="link" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 28, marginBottom: 4 }}>
          <Ionicons name="repeat" size={14} color={t.colors.textSecondary} />
          <Text variant="caption" color="textSecondary">
            {repostedBy.display_name} reposted
          </Text>
        </Pressable>
      ) : null}
      <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
        <Pressable onPress={() => openProfile(post.author.handle)} accessibilityRole="link" accessibilityLabel={`Open ${post.author.display_name}'s profile`} hitSlop={4}>
          <Avatar uri={post.author.avatar_url} name={post.author.display_name} size="md" />
        </Pressable>
        <View style={{ flex: 1, gap: t.spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 24 }}>
            <Pressable style={{ flex: 1 }} onPress={() => openProfile(post.author.handle)} accessibilityRole="link">
              <AuthorLine post={post} />
            </Pressable>
            <IconButton icon="ellipsis-horizontal" size={18} color="textSecondary" accessibilityLabel="More options" onPress={() => setMenu(true)} style={{ marginVertical: -12, marginRight: -12 }} />
          </View>
          {post.reply_to_handle && !hideReplyContext ? (
            <Text variant="small" color="textSecondary" style={{ marginTop: -6 }}>
              Replying to{' '}
              <Text variant="small" color="link" onPress={() => openProfile(post.reply_to_handle!)}>
                @{post.reply_to_handle}
              </Text>
            </Text>
          ) : null}
          {post.body ? <RichText body={post.body} variant="body" style={detail ? { fontSize: 18, lineHeight: 26 } : undefined} selectable={detail} /> : null}
          {post.media.length ? <PostMedia media={post.media} /> : null}
          {post.quote ? <QuotedPost post={post.quote} /> : null}
          {detail ? (
            <Text variant="small" color="textSecondary">
              {new Date(post.created_at).toLocaleString()}
            </Text>
          ) : null}
          <PostActions post={post} />
        </View>
      </View>
      <PostMenu post={post} visible={menu} onClose={() => setMenu(false)} onDeleted={onDeleted} />
    </Pressable>
  );
}

export const PostCard = memo(PostCardImpl);
