import { View } from 'react-native';
import type { ReportTarget } from '@zoko/contracts';
import { BottomSheet, SheetOption } from '@/components/BottomSheet';
import { showToast } from '@/components/Toast';
import { Text } from '@/components/ui';
import { useTheme } from '@/theme';
import { REPORT_REASONS, useReport } from './hooks';

export function ReportSheet({
  visible,
  onClose,
  target,
}: {
  visible: boolean;
  onClose: () => void;
  target: { kind: ReportTarget; id: string } | null;
}) {
  const t = useTheme();
  const report = useReport();
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Report">
      <View style={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.sm }}>
        <Text variant="small" color="textSecondary">
          Why are you reporting this {target?.kind ?? 'content'}? Reports are private.
        </Text>
      </View>
      {REPORT_REASONS.map((r) => (
        <SheetOption
          key={r.value}
          label={r.label}
          onPress={() => {
            if (!target) return;
            onClose();
            report.mutate(
              { target_kind: target.kind, target_id: target.id, reason: r.value },
              {
                onSuccess: () => showToast('Thanks. Our team will review this report.', 'success'),
                onError: () => showToast("We couldn't send your report. Try again.", 'error'),
              },
            );
          }}
        />
      ))}
    </BottomSheet>
  );
}
