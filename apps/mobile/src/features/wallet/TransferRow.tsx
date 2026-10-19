import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { Transfer, TransferStatus } from '@zoko/contracts';
import { useTheme } from '@/theme';
import { Text } from '@/components/ui';
import { shortRelativeTime } from '@/features/inbox/relativeTime';
import { formatUnits } from './amount';
import { truncateMiddle } from './address';

export const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = {
  draft: 'Not started',
  prepared: 'Needs signature',
  awaiting_signature: 'Needs signature',
  signed: 'Ready to broadcast',
  broadcast: 'Pending',
  confirming: 'Pending',
  confirmed: 'Confirmed',
  failed: 'Failed',
  reorged: 'Reorganized',
  cancelled: 'Cancelled',
};

export function TransferRow({ transfer }: { transfer: Transfer }) {
  const t = useTheme();
  const s = transfer.status;
  const statusColor = s === 'confirmed' ? 'successText' : s === 'failed' || s === 'reorged' ? 'danger' : 'textSecondary';
  const amount = `${formatUnits(transfer.amount_base_units, transfer.token.decimals, { group: true })} ${transfer.token.ticker.toUpperCase()}`;
  return (
    <Pressable
      onPress={() => router.push(`/wallet/transfer/${transfer.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${amount} to ${transfer.recipient_address}. ${TRANSFER_STATUS_LABEL[s]}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.md,
        paddingVertical: t.spacing.md,
        minHeight: 56,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.colors.goldSurface, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="arrow-up" size={18} color={t.colors.goldText} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text tabular numberOfLines={1} style={{ fontFamily: 'Inter_600SemiBold' }}>
          {amount}
        </Text>
        <Text variant="small" color="textSecondary" numberOfLines={1}>
          To <Text variant="technical" color="textSecondary">{truncateMiddle(transfer.recipient_address, 6, 6)}</Text>
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text variant="caption" color={statusColor}>
          {TRANSFER_STATUS_LABEL[s]}
        </Text>
        <Text variant="caption" color="textSecondary">
          {shortRelativeTime(transfer.updated_at)}
        </Text>
      </View>
    </Pressable>
  );
}
