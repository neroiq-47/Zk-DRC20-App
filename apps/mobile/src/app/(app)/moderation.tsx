import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { router, Stack } from 'expo-router';
import type { ModerationActionRequest, ModerationReport } from '@zoko/contracts';
import { useTheme } from '@/theme';
import { Avatar, Button, Card, EmptyState, ErrorState, LoadingState, Text, TextField } from '@/components/ui';
import { BottomSheet, SheetOption } from '@/components/BottomSheet';
import { useMe } from '@/lib/useMe';
import { flattenPages } from '@/features/inbox/cache';
import { shortRelativeTime } from '@/features/inbox/relativeTime';
import { useModerationAction, useModerationQueue } from '@/features/moderation/hooks';

type Action = ModerationActionRequest['action'];

const ACTIONS: { value: Action; label: string; destructive?: boolean; for?: ModerationReport['target_kind'][] }[] = [
  { value: 'dismiss', label: 'Dismiss report' },
  { value: 'hide_post', label: 'Hide post', destructive: true, for: ['post'] },
  { value: 'suspend_user', label: 'Suspend user', destructive: true },
  { value: 'restore', label: 'Restore content' },
];

export default function ModerationScreen() {
  const t = useTheme();
  const me = useMe();
  const allowed = me.data?.role === 'moderator' || me.data?.role === 'admin';
  const q = useModerationQueue(allowed);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<ModerationReport | null>(null);
  const items = useMemo(() => flattenPages(q.data), [q.data]);

  const header = <Stack.Screen options={{ title: 'Moderation' }} />;
  if (me.isPending) return <>{header}<LoadingState /></>;
  if (!allowed) return <>{header}<EmptyState icon="shield-outline" title="Moderators only" body="You don't have access to the moderation queue." /></>;

  return (
    <>
      {header}
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.id}
          contentContainerStyle={items.length === 0 ? { flexGrow: 1, justifyContent: 'center' } : { padding: t.components.feedGutter, gap: t.spacing.md }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={t.colors.primary}
              onRefresh={async () => {
                setRefreshing(true);
                await q.refetch();
                setRefreshing(false);
              }}
            />
          }
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
          }}
          ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} /> : undefined}
          ListEmptyComponent={<EmptyState icon="shield-checkmark-outline" title="Queue is clear" body="No open reports right now." />}
          renderItem={({ item }) => <ReportCard report={item} onAct={() => setSelected(item)} />}
        />
      )}
      <ActionSheet report={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function ReportCard({ report: r, onAct }: { report: ModerationReport; onAct: () => void }) {
  const t = useTheme();
  return (
    <Card style={{ gap: t.spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontFamily: 'Inter_600SemiBold', textTransform: 'capitalize' }}>
          {r.reason} · {r.target_kind}
        </Text>
        <Text variant="caption" color="textSecondary">
          {shortRelativeTime(r.created_at)}
        </Text>
      </View>
      <Text variant="technical" color="textSecondary" selectable numberOfLines={1}>
        {r.target_id}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
        <Avatar uri={r.reporter.avatar_url} name={r.reporter.display_name || r.reporter.handle} size="sm" />
        <Text variant="small" color="textSecondary">
          Reported by @{r.reporter.handle}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
        {r.target_kind === 'post' ? (
          <Button title="View post" size="sm" variant="secondary" onPress={() => router.push(`/post/${r.target_id}`)} />
        ) : null}
        <Button title="Take action" size="sm" onPress={onAct} />
      </View>
    </Card>
  );
}

function ActionSheet({ report, onClose }: { report: ModerationReport | null; onClose: () => void }) {
  const t = useTheme();
  const act = useModerationAction();
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');

  const close = () => {
    setAction(null);
    setReason('');
    act.reset();
    onClose();
  };

  const submit = () => {
    if (!report || !action || reason.trim().length < 3) return;
    act.mutate({ id: report.id, action, reason: reason.trim() }, { onSuccess: close });
  };

  const options = ACTIONS.filter((a) => !a.for || (report && a.for.includes(report.target_kind)));

  return (
    <BottomSheet visible={!!report} onClose={close} title="Moderation action">
      {options.map((a) => (
        <SheetOption key={a.value} label={a.label} destructive={a.destructive} selected={action === a.value} onPress={() => setAction(a.value)} />
      ))}
      <View style={{ padding: t.spacing.lg, gap: t.spacing.md }}>
        <TextField
          label="Reason (required)"
          value={reason}
          onChangeText={setReason}
          multiline
          multilineHeight={80}
          maxLength={1000}
          hint="Recorded in the audit log."
        />
        {act.isError ? (
          <Text variant="small" color="danger">
            {act.error instanceof Error ? act.error.message : "We couldn't apply this action."}
          </Text>
        ) : null}
        <Button title="Apply" onPress={submit} disabled={!action || reason.trim().length < 3} loading={act.isPending} />
      </View>
    </BottomSheet>
  );
}
