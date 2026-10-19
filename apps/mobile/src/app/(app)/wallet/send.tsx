import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@/theme';
import { Button, Card, EmptyState, ErrorState, LoadingState, Text, TextField } from '@/components/ui';
import { useCreateTransfer, useWalletAssets } from '@/features/wallet/hooks';
import { compareUnits, formatUnits, parseUnits } from '@/features/wallet/amount';
import { addressProblemMessage, dogecoinAddressProblem } from '@/features/wallet/address';
import { InfoRow, MonoValue, Notice, StatusChip } from '@/features/wallet/components';
import { isBuilderUnavailable, transferErrorMessage } from '@/features/wallet/problems';

export default function SendScreen() {
  const t = useTheme();
  const { wallet_id, token_id } = useLocalSearchParams<{ wallet_id: string; token_id: string }>();
  const assets = useWalletAssets();
  const create = useCreateTransfer();

  const balance = useMemo(
    () => assets.data?.drc20.find((b) => b.wallet_id === wallet_id && b.token.id === token_id),
    [assets.data, wallet_id, token_id],
  );

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [touched, setTouched] = useState({ recipient: false, amount: false });
  const [review, setReview] = useState(false);

  const title = balance ? `Send ${balance.token.ticker.toUpperCase()}` : 'Send';
  const header = <Stack.Screen options={{ title }} />;

  if (assets.isPending) return <>{header}<LoadingState /></>;
  if (assets.isError) return <>{header}<ErrorState onRetry={() => assets.refetch()} /></>;
  if (!balance) {
    return (
      <>
        {header}
        <EmptyState icon="wallet-outline" title="We couldn't find this balance" body="It may have moved or the wallet was disconnected." action={{ title: 'Back to wallet', onPress: () => router.back() }} />
      </>
    );
  }

  const { token } = balance;
  const ticker = token.ticker.toUpperCase();
  const maxDisplay = formatUnits(balance.amount_base_units, token.decimals);
  const base = parseUnits(amount, token.decimals);

  const recipientProblem = dogecoinAddressProblem(recipient);
  const recipientError =
    recipientProblem && (touched.recipient || recipient.length > 0) && recipientProblem !== 'empty'
      ? addressProblemMessage(recipientProblem)
      : touched.recipient && recipientProblem === 'empty'
        ? addressProblemMessage('empty')
        : recipient.trim() === balance.address
          ? 'This is the sending address. Enter a different recipient.'
          : null;

  let amountError: string | null = null;
  if (amount.trim() !== '' || touched.amount) {
    if (base === null) amountError = token.decimals === 0 ? `${ticker} only supports whole amounts.` : `Enter an amount with up to ${token.decimals} decimal places.`;
    else if (base === '0') amountError = 'Enter an amount greater than 0.';
    else if (compareUnits(base, balance.amount_base_units) > 0) amountError = `You have ${formatUnits(balance.amount_base_units, token.decimals, { group: true })} ${ticker}.`;
  }

  const valid = !recipientError && !recipientProblem && !amountError && base !== null && base !== '0';
  const disputed = balance.status === 'disputed';

  const submit = () => {
    if (!valid || !base) return;
    create.mutate(
      { wallet_id: balance.wallet_id, token_id: token.id, recipient_address: recipient.trim(), amount_base_units: base },
      { onSuccess: (tr) => router.replace(`/wallet/transfer/${tr.id}`) },
    );
  };

  if (review && base) {
    return (
      <ScrollView contentContainerStyle={{ padding: t.components.feedGutter, gap: t.spacing.lg, paddingBottom: t.spacing.xxxl }}>
        <Stack.Screen options={{ title: 'Review transfer' }} />
        <Text variant="h2" accessibilityRole="header">Review transfer</Text>
        <Card style={{ gap: 0 }}>
          <InfoRow label="Amount">
            <Text variant="h2" tabular>
              {formatUnits(base, token.decimals, { group: true })} <Text color="goldText">{ticker}</Text>
            </Text>
          </InfoRow>
          <InfoRow label="Token">{`${ticker} (DRC-20)`}</InfoRow>
          <InfoRow label="Recipient">
            <MonoValue value={recipient.trim()} label="Recipient address" full />
          </InfoRow>
          <InfoRow label="From">
            <MonoValue value={balance.address} label="Sending address" />
          </InfoRow>
          <InfoRow label="Network">Dogecoin mainnet</InfoRow>
          <InfoRow label="Network fee">Shown when you prepare the transaction, before you sign.</InfoRow>
        </Card>
        <Text variant="small" color="textSecondary">
          Check the recipient carefully. Transfers on Dogecoin cannot be reversed once confirmed. Next you will sign the transaction in your own wallet; Zoko never sees your keys.
        </Text>
        {create.isError ? (
          isBuilderUnavailable(create.error) ? (
            <Notice icon="construct-outline" title="Transfers aren't available on this server yet." body="Your balance is safe in your wallet. Try again later." />
          ) : (
            <Notice tone="danger" icon="alert-circle" title={transferErrorMessage(create.error)} />
          )
        ) : null}
        <Button title="Continue to signing" onPress={submit} loading={create.isPending} />
        <Button title="Edit" variant="ghost" onPress={() => setReview(false)} disabled={create.isPending} />
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
      {header}
      <ScrollView contentContainerStyle={{ padding: t.components.feedGutter, gap: t.spacing.lg, paddingBottom: t.spacing.xxxl }} keyboardShouldPersistTaps="handled">
        <Card tone="gold" style={{ gap: t.spacing.xs }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="caption" color="goldText">Available {ticker}</Text>
            <StatusChip status={balance.status} />
          </View>
          <Text variant="h2" tabular color="textPrimary">
            {formatUnits(balance.amount_base_units, token.decimals, { group: true })}
          </Text>
          <Text variant="technical" color="textSecondary" numberOfLines={1}>
            From {balance.address}
          </Text>
        </Card>
        {disputed ? <Notice tone="danger" icon="alert-circle" title="Independent indexers disagree on this balance." body="Sending is paused until they agree." /> : null}

        <TextField
          label="Recipient address"
          value={recipient}
          onChangeText={setRecipient}
          onBlur={() => setTouched((s) => ({ ...s, recipient: true }))}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          placeholder="D…"
          error={recipientError}
          style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 14 }}
        />
        <View style={{ gap: t.spacing.xs }}>
          <TextField
            label={`Amount (${ticker})`}
            value={amount}
            onChangeText={setAmount}
            onBlur={() => setTouched((s) => ({ ...s, amount: true }))}
            keyboardType={token.decimals === 0 ? 'number-pad' : 'decimal-pad'}
            placeholder="0"
            error={amountError}
            style={{ fontVariant: ['tabular-nums'] }}
          />
          <Button title={`Use max (${formatUnits(balance.amount_base_units, token.decimals, { group: true })})`} size="sm" variant="ghost" style={{ alignSelf: 'flex-start' }} onPress={() => setAmount(maxDisplay)} />
        </View>
        <InfoRow label="Network">Dogecoin mainnet</InfoRow>
        <Button
          title="Review"
          disabled={!valid || disputed}
          onPress={() => {
            setTouched({ recipient: true, amount: true });
            if (valid) setReview(true);
          }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
