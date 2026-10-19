import { useState } from 'react';
import { Alert, Pressable, Share, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Profile } from '@zoko/contracts';
import { useTheme } from '@/theme';
import { Avatar, Button, EmptyState, Text } from '@/components/ui';
import { BottomSheet, SheetOption } from '@/components/BottomSheet';
import { IconButton } from '@/components/IconButton';
import { SegmentedControl } from '@/components/SegmentedControl';
import { ToastHost, showToast } from '@/components/Toast';
import { compactCount, monthYear, plural } from '@/lib/format';
import { PostList } from '@/features/posts/PostList';
import { ReportSheet } from '@/features/posts/ReportSheet';
import { RichText } from '@/features/posts/RichText';
import { useUserPosts } from '@/features/posts/hooks';
import type { UserPostsFilter } from '@/features/posts/keys';
import { FollowButton } from './FollowButton';
import { useBlock, useStartConversation } from './hooks';

const COVER_HEIGHT = 140;

export function WalletBadge() {
  const t = useTheme();
  return (
    <View
      accessibilityLabel="Verified Dogecoin wallet"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: t.colors.goldSurface,
        borderRadius: t.radii.pill,
        paddingHorizontal: t.spacing.sm,
        paddingVertical: 2,
        alignSelf: 'flex-start',
      }}
    >
      <Ionicons name="shield-checkmark" size={12} color={t.colors.goldText} />
      <Text variant="caption" color="goldText">
        Verified wallet
      </Text>
    </View>
  );
}

function Count({ n, label, onPress }: { n: number; label: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : 'text'} accessibilityLabel={`${n} ${label}`} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text variant="small" color="textSecondary">
        <Text variant="small" tabular style={{ fontFamily: 'Inter_600SemiBold' }}>
          {compactCount(n)}
        </Text>{' '}
        {label}
      </Text>
    </Pressable>
  );
}

function ProfileHeader({ profile, onMenu, filter, setFilter, isTab }: {
  profile: Profile;
  onMenu: () => void;
  filter: UserPostsFilter;
  setFilter: (f: UserPostsFilter) => void;
  isTab?: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const message = useStartConversation();
  const openList = (list: 'followers' | 'following') => router.push({ pathname: '/user/[handle]/[list]', params: { handle: profile.handle, list } });

  return (
    <View>
      <View style={{ height: COVER_HEIGHT + insets.top, backgroundColor: t.colors.surfaceElevated }}>
        {profile.cover_url ? (
          <Image source={{ uri: profile.cover_url }} style={{ flex: 1 }} contentFit="cover" accessibilityLabel={`${profile.display_name}'s cover image`} />
        ) : (
          <View style={{ flex: 1, backgroundColor: t.scheme === 'light' ? t.colors.border : t.colors.surface }} />
        )}
        <View style={{ position: 'absolute', top: insets.top + 4, left: 8, right: 8, flexDirection: 'row', justifyContent: 'space-between' }}>
          {!isTab && router.canGoBack() ? (
            <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} color="onPrimary" style={{ backgroundColor: t.colors.overlay }} />
          ) : (
            <View />
          )}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {profile.is_me ? (
              <>
                <IconButton icon="bookmark-outline" accessibilityLabel="Bookmarks" onPress={() => router.push('/bookmarks')} color="onPrimary" style={{ backgroundColor: t.colors.overlay }} />
                <IconButton icon="settings-outline" accessibilityLabel="Settings" onPress={() => router.push('/settings')} color="onPrimary" style={{ backgroundColor: t.colors.overlay }} />
              </>
            ) : (
              <IconButton icon="ellipsis-horizontal" accessibilityLabel="More options" onPress={onMenu} color="onPrimary" style={{ backgroundColor: t.colors.overlay }} />
            )}
          </View>
        </View>
      </View>

      <View style={{ paddingHorizontal: t.components.feedGutter, gap: t.spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: -40 }}>
          <View style={{ borderRadius: 44, borderWidth: 4, borderColor: t.colors.background }}>
            <Avatar uri={profile.avatar_url} name={profile.display_name} size="xl" />
          </View>
          <View style={{ flexDirection: 'row', gap: t.spacing.sm, paddingBottom: 4 }}>
            {profile.is_me ? (
              <>
                <Button title="Wallet" icon="wallet-outline" variant="secondary" size="sm" style={{ height: 36 }} onPress={() => router.push('/wallet')} />
                <Button title="Edit profile" variant="secondary" size="sm" style={{ height: 36 }} onPress={() => router.push('/edit-profile')} />
              </>
            ) : profile.is_blocked ? null : (
              <>
                <Button
                  title="Message"
                  icon="chatbubble-outline"
                  variant="secondary"
                  size="sm"
                  style={{ height: 36 }}
                  loading={message.isPending}
                  onPress={() => message.mutate(profile.handle, { onError: () => showToast("We couldn't open this conversation. Try again.", 'error') })}
                />
                <FollowButton handle={profile.handle} following={profile.is_following} />
              </>
            )}
          </View>
        </View>

        <View style={{ gap: 2 }}>
          <Text variant="h2" accessibilityRole="header">
            {profile.display_name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, flexWrap: 'wrap' }}>
            <Text color="textSecondary">@{profile.handle}</Text>
            {profile.follows_me && !profile.is_me ? (
              <View style={{ backgroundColor: t.colors.surfaceElevated, borderRadius: t.radii.sm, paddingHorizontal: 6, paddingVertical: 1 }}>
                <Text variant="caption" color="textSecondary">
                  Follows you
                </Text>
              </View>
            ) : null}
            {profile.has_verified_wallet ? <WalletBadge /> : null}
          </View>
        </View>

        {profile.bio ? <RichText body={profile.bio} /> : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="calendar-outline" size={14} color={t.colors.textSecondary} />
          <Text variant="small" color="textSecondary">
            Joined {monthYear(profile.created_at)}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: t.spacing.lg }}>
          <Count n={profile.following_count} label="Following" onPress={() => openList('following')} />
          <Count n={profile.followers_count} label={plural(profile.followers_count, 'Follower')} onPress={() => openList('followers')} />
          <Count n={profile.posts_count} label={plural(profile.posts_count, 'Post')} />
        </View>
      </View>

      {profile.is_blocked ? null : (
        <View style={{ marginTop: t.spacing.sm }}>
          <SegmentedControl<UserPostsFilter>
            variant="underline"
            value={filter}
            onChange={setFilter}
            segments={[
              { value: 'posts', label: 'Posts' },
              { value: 'replies', label: 'Replies' },
              { value: 'media', label: 'Media' },
            ]}
          />
        </View>
      )}
    </View>
  );
}

export interface ProfileViewProps {
  profile: Profile;
  /** Refetches the profile itself on pull to refresh. */
  onRefreshProfile?: () => void;
  /** True on the Profile tab (no back button). */
  isTab?: boolean;
}

export function ProfileView({ profile, onRefreshProfile, isTab }: ProfileViewProps) {
  const t = useTheme();
  const [filter, setFilter] = useState<UserPostsFilter>('posts');
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const posts = useUserPosts(profile.handle, filter);
  const block = useBlock();

  const confirmBlock = () => {
    setMenu(false);
    const next = !profile.is_blocked;
    const go = () =>
      block.mutate(
        { handle: profile.handle, next },
        {
          onSuccess: () => showToast(next ? `You blocked @${profile.handle}.` : `You unblocked @${profile.handle}.`, 'info'),
          onError: () => showToast("We couldn't update that. Try again.", 'error'),
        },
      );
    if (!next) return go();
    Alert.alert(`Block @${profile.handle}?`, 'They won’t be able to follow you or message you, and you won’t see their posts.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: go },
    ]);
  };

  const empty =
    filter === 'media'
      ? { title: 'No photos or videos yet', icon: 'images-outline' as const }
      : filter === 'replies'
        ? { title: 'No replies yet', icon: 'chatbubbles-outline' as const }
        : profile.is_me
          ? { title: 'Share your first post', body: 'Your posts will show up here.', action: { title: 'Create a post', onPress: () => router.push('/create') } }
          : { title: 'No posts yet', body: `When @${profile.handle} posts, it will show up here.` };

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      {profile.is_blocked ? (
        <View style={{ flex: 1 }}>
          <ProfileHeader profile={profile} onMenu={() => setMenu(true)} filter={filter} setFilter={setFilter} isTab={isTab} />
          <EmptyState
            icon="ban-outline"
            title={`You blocked @${profile.handle}`}
            body="Unblock to see their posts and let them follow or message you."
            action={{ title: 'Unblock', onPress: confirmBlock }}
          />
        </View>
      ) : (
        <PostList
          query={{
            ...posts,
            refetch: () => {
              onRefreshProfile?.();
              return posts.refetch();
            },
          }}
          header={<ProfileHeader profile={profile} onMenu={() => setMenu(true)} filter={filter} setFilter={setFilter} isTab={isTab} />}
          empty={empty}
        />
      )}

      <BottomSheet visible={menu} onClose={() => setMenu(false)}>
        <SheetOption
          label="Share profile"
          icon={<Ionicons name="share-outline" size={22} color={t.colors.textPrimary} />}
          onPress={() => {
            setMenu(false);
            const url = Linking.createURL(`/user/${profile.handle}`);
            Share.share({ message: url, url }).catch(() => undefined);
          }}
        />
        <SheetOption
          label={profile.is_blocked ? `Unblock @${profile.handle}` : `Block @${profile.handle}`}
          destructive={!profile.is_blocked}
          icon={<Ionicons name="ban-outline" size={22} color={profile.is_blocked ? t.colors.textPrimary : t.colors.danger} />}
          onPress={confirmBlock}
        />
        <SheetOption
          label={`Report @${profile.handle}`}
          destructive
          icon={<Ionicons name="flag-outline" size={22} color={t.colors.danger} />}
          onPress={() => {
            setMenu(false);
            setReporting(true);
          }}
        />
      </BottomSheet>
      <ReportSheet visible={reporting} onClose={() => setReporting(false)} target={{ kind: 'user', id: profile.id }} />
      <ToastHost />
    </View>
  );
}
