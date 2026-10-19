import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import type { SigningStep, Transfer } from '@zoko/contracts';
import { copy as brandCopy } from '@zoko/tokens';
import { useTheme } from '@/theme';
import { Button, Card, ErrorState, LoadingState, Text, TextField } from '@/components/ui';
import { useQueryClient } from '@tanstack/react-query';
import { getCachedSigningStep, useBroadcastTransfer, useCancelTransfer, usePrepareTransfer, useSubmitSigned, useTransfer } from '@/features/wallet/hooks';
import { formatDoge, formatUnits } from '@/features/wallet/amount';
import { ConfirmationBar, CopyButton, InfoRow, MonoValue, Notice, PendingProgress, Stepper } from '@/features/wallet/components';
import { canCancel, confirmationProgress, currentStepKey, nextAction, statusHeadline, transferStepStates, type StepView } from '@/features/wallet/transferSteps';
import { isBuilderUnavailable, transferErrorMessage } from '@/features/wallet/problems';
import { ApiError } from '@/lib/api';

function useSecondsLeft(expiresAt: string | undefined): number | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return expiresAt ? Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000)) : null;
}

const HEX = /^[0-9a-fA-F]+$/;

export default function TransferScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const transfer = useTransfer(id);
  const [refreshing, setRefreshing] = useState(false);

  const header = <Stack.Screen options={{ title: 'Transfer' }} />;
  if (transfer.isPending) return <>{header}<LoadingState /></>;
  if (transfer.isError) {
    const notFound = transfer.error instanceof ApiError && transfer.error.status === 404;
    return <>{header}<ErrorState message={notFound ? "We couldn't find this transfer." : undefined} onRetry={notFound ? undefined : () => transfer.refetch()} /></>;
  }
  const tr = transfer.data;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
      {header}
      <ScrollView
        contentContainerStyle={{ padding: t.components.feedGutter, gap: t.spacing.lg, paddingBottom: t.spacing.xxxl }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={t.colors.primary}
            onRefresh={async () => {
              setRefreshing(true);
              await transfer.refetch();
              setRefreshing(false);
            }}
          />
        }
      >
        <Summary transfer={tr} />
        <Outcome transfer={tr} />
        <Card>
          <Stepper
            steps={transferStepStates(tr)}
            confirmedTransfer={tr.status === 'confirmed'}
            renderDetail={(s) => <StepDetail step={s} transfer={tr} />}
          />
        </Card>
        <TxIds transfer={tr} />
        <CancelAction transfer={tr} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Summary({ transfer: tr }: { transfer: Transfer }) {
  const t = useTheme();
  const ticker = tr.token.ticker.toUpperCase();
  return (
    <Card style={{ gap: 0 }}>
      <Text variant="caption" color="textSecondary" accessibilityLiveRegion="polite">
        {statusHeadline(tr.status)}
      </Text>
      <Text variant="h1" tabular style={{ marginVertical: t.spacing.xs }}>
        {formatUnits(tr.amount_base_units, tr.token.decimals, { group: true })} <Text variant="h3" color="goldText">{ticker}</Text>
      </Text>
      <InfoRow label="Recipient">
        <MonoValue value={tr.recipient_address} label="Recipient address" />
      </InfoRow>
      <InfoRow label="From">
        <MonoValue value={tr.from_address} label="Sending address" />
      </InfoRow>
      <View style={{ flexDirection: 'row', gap: t.spacing.xl }}>
        <InfoRow label="Network">Dogecoin mainnet</InfoRow>
        {tr.network_fee_koinu ? <InfoRow label="Network fee">{`${formatDoge(tr.network_fee_koinu)} DOGE`}</InfoRow> : null}
      </View>
      {tr.steps.length > 1 ? (
        <Text variant="caption" color="textSecondary">
          DRC-20 transfers need {tr.steps.length} Dogecoin transactions: an inscription, then the transfer itself. You sign each one.
        </Text>
      ) : null}
    </Card>
  );
}

function Outcome({ transfer: tr }: { transfer: Transfer }) {
  const newTransfer = () => router.replace({ pathname: '/wallet/send', params: { wallet_id: tr.wallet_id, token_id: tr.token.id } });
  switch (tr.status) {
    case 'confirmed':
      return <SuccessNotice transfer={tr} />;
    case 'failed':
      return (
        <Notice
          tone="danger"
          icon="alert-circle"
          title="This transfer didn't go through."
          body={`${tr.error_detail || 'The network or the transaction builder rejected it.'} Your tokens have not moved unless a step below shows a confirmed transaction.`}
        >
          <Button title="Start a new transfer" variant="secondary" onPress={newTransfer} />
        </Notice>
      );
    case 'reorged':
      return (
        <Notice
          icon="git-branch-outline"
          title="The network reorganized."
          body="The block that held this transaction was replaced. Zoko keeps checking; it may confirm again in a new block. If it doesn't, you can start a new transfer."
        >
          <Button title="Start a new transfer" variant="secondary" onPress={newTransfer} />
        </Notice>
      );
    case 'cancelled':
      return (
        <Notice icon="close-circle-outline" title="Transfer cancelled." body="Nothing was broadcast, so nothing moved.">
          <Button title="Start a new transfer" variant="secondary" onPress={newTransfer} />
        </Notice>
      );
    default:
      return null;
  }
}

// Mint/success styling is reserved for status === 'confirmed' only.
function SuccessNotice({ transfer: tr }: { transfer: Transfer }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.colors.successSurface, borderRadius: t.radii.lg, padding: t.spacing.lg, gap: t.spacing.xs }} accessibilityRole="summary">
      <Text color="successText" style={{ fontFamily: 'Inter_600SemiBold' }}>
        Transfer confirmed
      </Text>
      <Text variant="small" color="successText">
        Confirmed on Dogecoin mainnet after {tr.required_confirmations} confirmations.
      </Text>
    </View>
  );
}

function StepDetail({ step, transfer: tr }: { step: StepView; transfer: Transfer }) {
  const active = step.key === currentStepKey(tr) && (step.state === 'current' || step.state === 'failed');
  if (!active) return null;
  const action = nextAction(tr.status);
  if (step.key === 'prepare' && action === 'prepare') return <PrepareAction transfer={tr} />;
  if (step.key === 'sign' && action === 'sign') return <SignAction transfer={tr} />;
  if (step.key === 'broadcast' && action === 'broadcast') return <BroadcastAction transfer={tr} />;
  if (step.key === 'confirm') return <ConfirmDetail transfer={tr} />;
  return null;
}

function ActionError({ error }: { error: unknown }) {
  if (!error) return null;
  if (isBuilderUnavailable(error)) {
    return <Notice icon="construct-outline" title="Transfers aren't available on this server yet." body="Nothing was signed or sent. Your tokens stay in your wallet." />;
  }
  return <Notice tone="danger" icon="alert-circle" title={transferErrorMessage(error)} />;
}

function PrepareAction({ transfer: tr }: { transfer: Transfer }) {
  const prepare = usePrepareTransfer(tr.id);
  return (
    <View style={{ gap: 8 }}>
      <Text variant="small" color="textSecondary">Zoko builds an unsigned transaction and estimates the network fee. Nothing is sent yet.</Text>
      <ActionError error={prepare.error} />
      <Button title="Prepare transaction" onPress={() => prepare.mutate()} loading={prepare.isPending} />
    </View>
  );
}

function SignAction({ transfer: tr }: { transfer: Transfer }) {
  const t = useTheme();
  const prepare = usePrepareTransfer(tr.id);
  const submit = useSubmitSigned(tr.id);
  const qc = useQueryClient();
  const [signing, setSigning] = useState<SigningStep | null>(() => getCachedSigningStep(qc, tr.id));
  const [signed, setSigned] = useState('');
  const secondsLeft = useSecondsLeft(signing?.expires_at);
  const expired = secondsLeft === 0;

  const load = () => prepare.mutate(undefined, { onSuccess: (s) => setSigning(s) });

  // Load the signing payload automatically when arriving at this step.
  useEffect(() => {
    if (!signing && !prepare.isPending && !prepare.isError) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!signing) {
    return (
      <View style={{ gap: t.spacing.sm }}>
        <ActionError error={prepare.error} />
        <Button title="Show transaction to sign" variant="secondary" onPress={load} loading={prepare.isPending} />
      </View>
    );
  }

  const clean = signed.replace(/\s+/g, '');
  const hexError = clean && (!HEX.test(clean) || clean.length % 2 !== 0) ? 'Paste the signed transaction as hex (0–9, a–f).' : null;
  const formatLabel = signing.wallet_payload.provider_format === 'psbt_hex' ? 'PSBT (hex)' : 'Unsigned transaction (hex)';

  return (
    <View style={{ gap: t.spacing.md }}>
      <Text variant="small">
        Copy this transaction into your Dogecoin wallet, check the recipient and amount there, sign it, then paste the signed transaction below.
      </Text>
      {tr.steps.length > 1 ? (
        <Text variant="caption" color="textSecondary">
          Transaction {signing.step_index + 1} of {tr.steps.length} ({signing.kind})
        </Text>
      ) : null}
      <View style={{ backgroundColor: t.colors.background, borderRadius: t.radii.md, padding: t.spacing.md, gap: t.spacing.sm, borderWidth: 1, borderColor: t.colors.border }}>
        <Text variant="caption" color="textSecondary">{formatLabel}</Text>
        <Text variant="technical" selectable numberOfLines={6} ellipsizeMode="middle">
          {signing.wallet_payload.data}
        </Text>
        <CopyButton value={signing.wallet_payload.data} label="Copy transaction" />
      </View>
      <View style={{ flexDirection: 'row', gap: t.spacing.xl }}>
        <InfoRow label="Network fee">{`${formatDoge(signing.network_fee_koinu)} DOGE`}</InfoRow>
        <InfoRow label="Expires">
          <Text tabular color={expired ? 'danger' : 'textPrimary'}>
            {expired ? 'Expired' : `${Math.floor((secondsLeft ?? 0) / 60)}:${String((secondsLeft ?? 0) % 60).padStart(2, '0')}`}
          </Text>
        </InfoRow>
      </View>
      {expired ? (
        <Notice icon="time-outline" title="This signing request expired." body="Prepare it again to get a fresh transaction and fee.">
          <Button title="Prepare again" variant="secondary" onPress={load} loading={prepare.isPending} />
        </Notice>
      ) : (
        <>
          <TextField
            label="Signed transaction"
            value={signed}
            onChangeText={setSigned}
            multiline
            multilineHeight={96}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            placeholder="Paste the signed transaction hex"
            error={hexError}
            style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 13 }}
          />
          <ActionError error={submit.error} />
          <Button
            title="Submit signature"
            disabled={!clean || !!hexError}
            loading={submit.isPending}
            onPress={() => submit.mutate({ step_id: signing.step_id, signed_payload: clean }, { onSuccess: () => setSigned('') })}
          />
        </>
      )}
    </View>
  );
}

function BroadcastAction({ transfer: tr }: { transfer: Transfer }) {
  const broadcast = useBroadcastTransfer(tr.id);
  return (
    <View style={{ gap: 8 }}>
      <Text variant="small" color="textSecondary">Your signed transaction is ready. Broadcasting sends it to the Dogecoin network. After this it can't be cancelled.</Text>
      <ActionError error={broadcast.error} />
      <Button title="Broadcast" onPress={() => broadcast.mutate()} loading={broadcast.isPending} />
    </View>
  );
}

function ConfirmDetail({ transfer: tr }: { transfer: Transfer }) {
  const t = useTheme();
  const { confirmations, required } = confirmationProgress(tr);
  if (tr.status === 'reorged') {
    return <Text variant="small" color="textSecondary">Waiting for the transaction to be included in a new block.</Text>;
  }
  if (tr.status === 'failed') return null;
  return (
    <View style={{ gap: t.spacing.sm }}>
      <Text variant="small" color="textSecondary">{brandCopy.pendingTx} Dogecoin blocks arrive about once a minute.</Text>
      <PendingProgress />
      <ConfirmationBar confirmations={confirmations} required={required} />
      <Text variant="caption" color="textSecondary" tabular>
        {confirmations} / {required} confirmations
      </Text>
    </View>
  );
}

function TxIds({ transfer: tr }: { transfer: Transfer }) {
  const t = useTheme();
  const withTx = tr.steps.filter((s) => !!s.txid).sort((a, b) => a.step_index - b.step_index);
  if (!withTx.length) return null;
  return (
    <Card style={{ gap: t.spacing.sm }}>
      <Text variant="h3" accessibilityRole="header">
        {withTx.length > 1 ? 'Transaction IDs' : 'Transaction ID'}
      </Text>
      {withTx.map((s) => (
        <View key={s.id} style={{ gap: 2 }}>
          {withTx.length > 1 ? (
            <Text variant="caption" color="textSecondary" tabular>
              {s.kind === 'inscription' ? 'Inscription' : s.kind === 'transfer' ? 'Transfer' : `Step ${s.step_index + 1}`} · {s.confirmations} confirmations
            </Text>
          ) : null}
          <MonoValue value={s.txid!} label="Transaction ID" />
        </View>
      ))}
    </Card>
  );
}

function CancelAction({ transfer: tr }: { transfer: Transfer }) {
  const cancel = useCancelTransfer(tr.id);
  if (!canCancel(tr.status)) return null;
  return (
    <View style={{ gap: 8 }}>
      <ActionError error={cancel.error} />
      <Button
        title="Cancel transfer"
        variant="ghost"
        loading={cancel.isPending}
        onPress={() =>
          Alert.alert('Cancel this transfer?', 'Nothing has been broadcast yet, so nothing will move.', [
            { text: 'Keep it', style: 'cancel' },
            { text: 'Cancel transfer', style: 'destructive', onPress: () => cancel.mutate() },
          ])
        }
      />
    </View>
  );
}
