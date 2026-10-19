import { useState } from 'react';
import { Button } from '@/components/ui';
import { showToast } from '@/components/Toast';
import { useFollow } from './hooks';

/**
 * Follow toggle. Pass `following` when the state is known from a Profile (the mutation updates
 * the cached profile optimistically); without it the button keeps its own optimistic state.
 */
export function FollowButton({ handle, following, size = 'sm' }: { handle: string; following?: boolean; size?: 'sm' | 'md' }) {
  const follow = useFollow();
  const [local, setLocal] = useState(false);
  const isFollowing = following ?? local;
  return (
    <Button
      title={isFollowing ? 'Following' : 'Follow'}
      variant={isFollowing ? 'secondary' : 'primary'}
      size={size}
      accessibilityLabel={isFollowing ? `Unfollow @${handle}` : `Follow @${handle}`}
      style={size === 'sm' ? { minWidth: 96, height: 36 } : { minWidth: 120 }}
      onPress={() => {
        const next = !isFollowing;
        if (following === undefined) setLocal(next);
        follow.mutate(
          { handle, next },
          {
            onError: () => {
              if (following === undefined) setLocal(!next);
              showToast("We couldn't update that. Try again.", 'error');
            },
          },
        );
      }}
    />
  );
}
