import { Screen, ErrorState, LoadingState } from '@/components/ui';
import { useMe } from '@/lib/useMe';
import { ProfileView } from '@/features/profile/ProfileView';

export default function MyProfile() {
  const me = useMe();
  if (me.isPending) return <Screen><LoadingState /></Screen>;
  if (me.isError || !me.data) return <Screen><ErrorState onRetry={() => me.refetch()} /></Screen>;
  return <ProfileView profile={me.data} onRefreshProfile={() => void me.refetch()} isTab />;
}
