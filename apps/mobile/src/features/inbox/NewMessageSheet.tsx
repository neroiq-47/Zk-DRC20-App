import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '@/theme';
import { Avatar, Text, TextField } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { ApiError } from '@/lib/api';
import { useStartConversation, useUserSearch } from './hooks';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function NewMessageSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q, 250);
  const search = useUserSearch(debounced);
  const start = useStartConversation();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setQ('');
      setError(null);
    }
  }, [visible]);

  const open = (handle: string) => {
    setError(null);
    start.mutate(handle, {
      onSuccess: (c) => {
        onClose();
        router.push(`/chat/${c.id}`);
      },
      onError: (e) => {
        const status = e instanceof ApiError ? e.status : 0;
        setError(
          status === 403
            ? `@${handle} isn't accepting messages from you.`
            : status === 404
              ? "We couldn't find that person."
              : (e instanceof ApiError && e.problem?.detail) || "We couldn't start this conversation. Try again.",
        );
      },
    });
  };

  const users = search.data?.users ?? [];
  const term = debounced.trim();

  return (
    <BottomSheet visible={visible} onClose={onClose} title="New message">
      <View style={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.sm, paddingBottom: t.spacing.md }}>
        <TextField
          value={q}
          onChangeText={setQ}
          placeholder="Search people"
          accessibilityLabel="Search people"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          returnKeyType="search"
        />
        {error ? (
          <Text variant="small" color="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </View>
      {search.isFetching && users.length === 0 ? (
        <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.lg }} />
      ) : term && search.isSuccess && users.length === 0 ? (
        <Text color="textSecondary" style={{ padding: t.spacing.lg, textAlign: 'center' }}>
          No people match “{term}”.
        </Text>
      ) : search.isError ? (
        <Text color="textSecondary" style={{ padding: t.spacing.lg, textAlign: 'center' }}>
          We couldn't search right now. Try again.
        </Text>
      ) : null}
      {users.map((u) => (
        <Pressable
          key={u.id}
          onPress={() => open(u.handle)}
          disabled={start.isPending}
          accessibilityRole="button"
          accessibilityLabel={`Message ${u.display_name}, @${u.handle}`}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.spacing.md,
            paddingHorizontal: t.spacing.lg,
            minHeight: 60,
            backgroundColor: pressed ? t.colors.border : 'transparent',
          })}
        >
          <Avatar uri={u.avatar_url} name={u.display_name || u.handle} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontFamily: 'Inter_600SemiBold' }}>
              {u.display_name || u.handle}
            </Text>
            <Text variant="small" color="textSecondary" numberOfLines={1}>
              @{u.handle}
            </Text>
          </View>
          {start.isPending && start.variables === u.handle ? <ActivityIndicator color={t.colors.primary} /> : null}
        </Pressable>
      ))}
    </BottomSheet>
  );
}
