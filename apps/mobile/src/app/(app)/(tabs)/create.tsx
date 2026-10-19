import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/ui';
import { ToastHost } from '@/components/Toast';
import { Composer } from '@/features/compose/Composer';

export default function Create() {
  const params = useLocalSearchParams<{ reply_to?: string; quote?: string }>();
  const replyTo = typeof params.reply_to === 'string' && params.reply_to ? params.reply_to : undefined;
  const quote = typeof params.quote === 'string' && params.quote ? params.quote : undefined;
  return (
    <Screen>
      <Composer
        key={`${replyTo ?? ''}:${quote ?? ''}`}
        replyTo={replyTo}
        quote={quote}
        onCancel={
          replyTo || quote
            ? () => {
                router.setParams({ reply_to: undefined, quote: undefined });
              }
            : undefined
        }
        onPublished={() => {
          if (replyTo || quote) router.setParams({ reply_to: undefined, quote: undefined });
          router.navigate('/');
        }}
      />
      <ToastHost />
    </Screen>
  );
}
