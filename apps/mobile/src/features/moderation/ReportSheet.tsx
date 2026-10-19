import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { ReportReason, ReportTarget } from '@zoko/contracts';
import { useTheme } from '@/theme';
import { Button, Text, TextField } from '@/components/ui';
import { BottomSheet, SheetOption } from '@/components/BottomSheet';
import { useCreateReport } from './hooks';

const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'hate', label: 'Hate speech' },
  { value: 'violence', label: 'Violence or threats' },
  { value: 'sexual', label: 'Sexual content' },
  { value: 'scam', label: 'Scam or fraud' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'other', label: 'Something else' },
];

export function ReportSheet({
  visible,
  onClose,
  target,
  onReported,
}: {
  visible: boolean;
  onClose: () => void;
  target: { kind: ReportTarget; id: string; label: string };
  onReported?: () => void;
}) {
  const t = useTheme();
  const report = useCreateReport();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!visible) {
      setReason(null);
      setDetails('');
      setDone(false);
      report.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const submit = () => {
    if (!reason) return;
    report.mutate(
      { target_kind: target.kind, target_id: target.id, reason, details: details.trim() || undefined },
      {
        onSuccess: () => {
          setDone(true);
          onReported?.();
        },
      },
    );
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={done ? 'Thanks for telling us' : `Report ${target.label}`}>
      {done ? (
        <View style={{ padding: t.spacing.lg, gap: t.spacing.md }}>
          <Text color="textSecondary">Our team will review this report. You can also block this person so they can't message you.</Text>
          <Button title="Done" onPress={onClose} />
        </View>
      ) : (
        <>
          {REASONS.map((r) => (
            <SheetOption key={r.value} label={r.label} selected={reason === r.value} onPress={() => setReason(r.value)} />
          ))}
          <View style={{ padding: t.spacing.lg, gap: t.spacing.md }}>
            <TextField label="Details (optional)" value={details} onChangeText={setDetails} multiline multilineHeight={80} maxLength={1000} />
            {report.isError ? (
              <Text variant="small" color="danger">
                We couldn't send your report. Try again.
              </Text>
            ) : null}
            <Button title="Send report" onPress={submit} disabled={!reason} loading={report.isPending} />
          </View>
        </>
      )}
    </BottomSheet>
  );
}
