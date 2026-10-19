import { Stack, useLocalSearchParams } from 'expo-router';
import { ErrorState, LoadingState, Screen } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { ProfileView } from '@/features/profile/ProfileView';
import { useProfile } from '@/features/profile/hooks';

export default function UserProfile() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const profile = useProfile(handle?.toLowerCase());
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {profile.isPending ? (
        <Screen>
          <LoadingState />
        </Screen>
      ) : profile.isError ? (
        <Screen>
          <ErrorState
            message={profile.error instanceof ApiError && profile.error.status === 404 ? `We couldn't find @${handle}.` : undefined}
            onRetry={() => profile.refetch()}
          />
        </Screen>
      ) : (
        <ProfileView profile={profile.data} onRefreshProfile={() => void profile.refetch()} />
      )}
    </>
  );
}
