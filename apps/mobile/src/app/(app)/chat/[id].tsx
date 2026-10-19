import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import type { Conversation } from '@zoko/contracts';
import { useTheme } from '@/theme';
import { Avatar, Button, ErrorState, LoadingState, Text } from '@/components/ui';
import { IconButton } from '@/components/IconButton';
import { BottomSheet, SheetOption } from '@/components/BottomSheet';
import { useSession } from '@/lib/session';
import { activeConversation, flattenPages, type ChatMessage } from '@/features/inbox/cache';
import { useAcceptRequest, useBlockUser, useConversation, useMarkRead, useMessages, useSendMessage } from '@/features/inbox/hooks';
import { MessageBubble } from '@/features/inbox/MessageBubble';
import { ReportSheet } from '@/features/moderation/ReportSheet';

const MAX_LEN = 4000;

export default function ChatScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const meId = useSession((s) => s.user?.id ?? null);
  const headerHeight = useHeaderHeight();
  const [focused, setFocused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const conv = useConversation(id);
  const msgs = useMessages(id, focused);
  const markRead = useMarkRead(id);
  const { send } = useSendMessage(id);
  const block = useBlockUser();

  const lastReadRef = useRef<string | null>(null);
  const items = useMemo(() => flattenPages(msgs.data), [msgs.data]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      activeConversation.set(id);
      lastReadRef.current = null;
      return () => {
        setFocused(false);
        if (activeConversation.get() === id) activeConversation.set(null);
      };
    }, [id]),
  );

  // Mark read on focus and whenever a new incoming message arrives while focused.
  const newestIncoming = items.find((m) => m.sender_id !== meId && !m.local_state);
  useEffect(() => {
    if (!focused || !msgs.isSuccess) return;
    const key = newestIncoming?.id ?? 'none';
    if (lastReadRef.current === key) return;
    lastReadRef.current = key;
    markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, msgs.isSuccess, newestIncoming?.id]);

  const other = conv.data?.other;

  const confirmBlock = (c: Conversation) =>
    Alert.alert(`Block @${c.other.handle}?`, "They won't be able to message you or see your posts. They won't be told.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: () =>
          block.mutate(c.other.handle, {
            onSuccess: () => router.back(),
            onError: () => Alert.alert("We couldn't block this account", 'Try again.'),
          }),
      },
    ]);

  const headerTitle = () =>
    other ? (
      <Pressable
        onPress={() => router.push(`/user/${other.handle}`)}
        accessibilityRole="button"
        accessibilityLabel={`${other.display_name}, @${other.handle}. View profile`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, minHeight: 44 }}
      >
        <Avatar uri={other.avatar_url} name={other.display_name || other.handle} size="sm" />
        <View>
          <Text numberOfLines={1} style={{ fontFamily: 'Inter_600SemiBold', maxWidth: 200 }}>
            {other.display_name || other.handle}
          </Text>
          <Text variant="caption" color="textSecondary" numberOfLines={1}>
            @{other.handle}
          </Text>
        </View>
      </Pressable>
    ) : null;

  const screen = (
    <Stack.Screen
      options={{
        title: other ? other.display_name : 'Chat',
        headerTitle,
        headerRight: () =>
          conv.data ? <IconButton icon="ellipsis-horizontal" accessibilityLabel="Conversation options" onPress={() => setMenuOpen(true)} /> : null,
      }}
    />
  );

  if (conv.isPending && !conv.data) return <>{screen}<LoadingState /></>;
  if (conv.isError && !conv.data) return <>{screen}<ErrorState onRetry={() => conv.refetch()} /></>;
  const c = conv.data!;

  const renderItem = ({ item, index }: { item: ChatMessage; index: number }) => {
    const mine = item.sender_id === meId;
    // Show a time under the newest message of each run from the same sender.
    const newer = items[index - 1];
    const showTime = !newer || newer.sender_id !== item.sender_id || Date.parse(newer.created_at) - Date.parse(item.created_at) > 5 * 60_000;
    return <MessageBubble message={item} mine={mine} showTime={showTime} onRetry={mine ? () => send(item.body, item.client_id ?? undefined) : undefined} />;
  };

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: t.colors.background }}>
      {screen}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerHeight}>
        {msgs.isPending ? (
          <LoadingState />
        ) : msgs.isError && items.length === 0 ? (
          <ErrorState message="We couldn't load these messages." onRetry={() => msgs.refetch()} />
        ) : (
          <FlatList
            inverted
            data={items}
            keyExtractor={(m) => m.client_id ?? m.id}
            renderItem={renderItem}
            contentContainerStyle={{ paddingVertical: t.spacing.md }}
            onEndReachedThreshold={0.4}
            onEndReached={() => {
              if (msgs.hasNextPage && !msgs.isFetchingNextPage) msgs.fetchNextPage();
            }}
            ListFooterComponent={msgs.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.md }} /> : undefined}
            ListEmptyComponent={
              <View style={{ transform: [{ scaleY: -1 }], alignItems: 'center', padding: t.spacing.xxl, gap: t.spacing.sm }}>
                <Avatar uri={c.other.avatar_url} name={c.other.display_name || c.other.handle} size="xl" />
                <Text variant="h3">{c.other.display_name || c.other.handle}</Text>
                <Text color="textSecondary">Say hello to @{c.other.handle}.</Text>
              </View>
            }
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
          />
        )}
        {c.is_request ? <RequestBanner conversation={c} onBlock={() => confirmBlock(c)} onReport={() => setReportOpen(true)} /> : <Composer onSend={(body) => send(body)} />}
      </KeyboardAvoidingView>

      <BottomSheet visible={menuOpen} onClose={() => setMenuOpen(false)}>
        <SheetOption
          label={`View @${c.other.handle}'s profile`}
          onPress={() => {
            setMenuOpen(false);
            router.push(`/user/${c.other.handle}`);
          }}
        />
        <SheetOption
          label="Report"
          onPress={() => {
            setMenuOpen(false);
            setReportOpen(true);
          }}
        />
        <SheetOption
          label={`Block @${c.other.handle}`}
          destructive
          onPress={() => {
            setMenuOpen(false);
            confirmBlock(c);
          }}
        />
      </BottomSheet>
      <ReportSheet visible={reportOpen} onClose={() => setReportOpen(false)} target={{ kind: 'user', id: c.other.id, label: `@${c.other.handle}` }} />
    </SafeAreaView>
  );
}

function RequestBanner({ conversation: c, onBlock, onReport }: { conversation: Conversation; onBlock: () => void; onReport: () => void }) {
  const t = useTheme();
  const accept = useAcceptRequest(c.id);
  return (
    <View style={{ borderTopWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.surface, padding: t.components.feedGutter, gap: t.spacing.md }}>
      <Text style={{ fontFamily: 'Inter_600SemiBold' }}>@{c.other.handle} wants to message you</Text>
      <Text variant="small" color="textSecondary">
        You don't follow each other. They won't know you've seen this until you accept.
      </Text>
      {accept.isError ? (
        <Text variant="small" color="danger">
          We couldn't accept this request. Try again.
        </Text>
      ) : null}
      <Button title="Accept" onPress={() => accept.mutate()} loading={accept.isPending} />
      <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
        <Button title="Block" variant="danger" onPress={onBlock} style={{ flex: 1 }} />
        <Button title="Report" variant="secondary" onPress={onReport} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

function Composer({ onSend }: { onSend: (body: string) => void }) {
  const t = useTheme();
  const [text, setText] = useState('');
  const trimmed = text.trim();
  const submit = () => {
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  };
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: t.spacing.sm,
        paddingLeft: t.components.feedGutter,
        paddingRight: t.spacing.sm,
        paddingVertical: t.spacing.sm,
        borderTopWidth: 1,
        borderColor: t.colors.border,
        backgroundColor: t.colors.background,
      }}
    >
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Message"
        placeholderTextColor={t.colors.textSecondary}
        accessibilityLabel="Message"
        multiline
        maxLength={MAX_LEN}
        style={[
          t.typography.body,
          {
            fontWeight: undefined,
            flex: 1,
            minHeight: 44,
            maxHeight: 140,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: t.colors.border,
            backgroundColor: t.colors.surface,
            color: t.colors.textPrimary,
            paddingHorizontal: t.spacing.lg,
            paddingTop: 10,
            paddingBottom: 10,
          },
        ]}
      />
      <IconButton icon="arrow-up-circle" size={34} color={trimmed ? 'primary' : 'textSecondary'} accessibilityLabel="Send message" disabled={!trimmed} onPress={submit} />
    </View>
  );
}
