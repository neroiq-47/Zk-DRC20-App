import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/ui';
import { ToastHost } from '@/components/Toast';
import { Composer } from '@/features/compose/Composer';

/** Modal composer for replies and quotes opened from post actions. */
export default function ComposeModal() {
  const params = useLocalSearchParams<{ reply_to?: string; quote?: string }>();
  const replyTo = typeof params.reply_to === 'string' && params.reply_to ? params.reply_to : undefined;
  const quote = typeof params.quote === 'string' && params.quote ? params.quote : undefined;
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <Screen edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false, presentation: 'modal', gestureEnabled: true }} />
      <Composer replyTo={replyTo} quote={quote} onCancel={close} onPublished={close} />
      <ToastHost />
    </Screen>
  );
}
