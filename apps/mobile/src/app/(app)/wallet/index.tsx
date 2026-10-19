import { useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import { router, Stack } from 'expo-router';
import type { DogeBalance, Drc20Balance, WalletConnection } from '@zoko/contracts';
import { copy as brandCopy } from '@zoko/tokens';
import { useTheme } from '@/theme';
import { Button, Card, EmptyState, ErrorState, LoadingState, Text } from '@/components/ui';
import { useDisconnectWallet, useTransfers, useWalletAssets, useWalletConnections } from '@/features/wallet/hooks';
import { formatDoge, formatUnits } from '@/features/wallet/amount';
import { MonoValue, SectionTitle, StatusChip } from '@/features/wallet/components';
import { TransferRow } from '@/features/wallet/TransferRow';
import { flattenPages } from '@/features/inbox/cache';

export default function WalletScreen() {
  const t = useTheme();
  const connections = useWalletConnections();
  const hasWallets = (connections.data?.length ?? 0) > 0;
  const assets = useWalletAssets(hasWallets);
  const transfers = useTransfers(hasWallets);
  const disconnect = useDisconnectWallet();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([connections.refetch(), hasWallets ? assets.refetch() : null, hasWallets ? transfers.refetch() : null]);
    setRefreshing(false);
  };

  const confirmDisconnect = (c: WalletConnection) =>
    Alert.alert('Disconnect this wallet?', `${c.address}\n\nYour assets stay in your wallet. Zoko will stop showing them, and your profile will no longer show a verified wallet from this address.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: () =>
          disconnect.mutate(c.id, { onError: () => Alert.alert("We couldn't disconnect this wallet", 'Try again.') }),
      },
    ]);

  const header = <Stack.Screen options={{ title: 'Wallet' }} />;

  if (connections.isPending) return <>{header}<LoadingState /></>;
  if (connections.isError) return <>{header}<ErrorState onRetry={() => connections.refetch()} /></>;

  if (!hasWallets) {
    return (
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: t.components.feedGutter }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.primary} />}>
        {header}
        <EmptyState icon="wallet-outline" title={brandCopy.walletEmpty} body="Wallets are optional. Zoko never asks for your seed phrase or private keys. You prove ownership by signing a message." action={{ title: 'Connect a wallet', onPress: () => router.push('/wallet/connect') }} />
      </ScrollView>
    );
  }

  const data = assets.data;
  const transferItems = flattenPages(transfers.data);

  return (
    <ScrollView
      contentContainerStyle={{ padding: t.components.feedGutter, paddingBottom: t.spacing.xxxl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.primary} />}
    >
      {header}

      <SectionTitle right={<Button title="Add" size="sm" variant="ghost" icon="add" onPress={() => router.push('/wallet/connect')} />}>Connected wallets</SectionTitle>
      <View style={{ gap: t.spacing.sm }}>
        {connections.data!.map((c) => (
          <Card key={c.id} style={{ gap: t.spacing.xs, paddingVertical: t.spacing.md }}>
            <MonoValue value={c.address} label="Wallet address" />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="caption" color="textSecondary">
                Dogecoin mainnet · verified {new Date(c.verified_at).toLocaleDateString()}
              </Text>
              <Button title="Disconnect" size="sm" variant="ghost" onPress={() => confirmDisconnect(c)} loading={disconnect.isPending && disconnect.variables === c.id} />
            </View>
          </Card>
        ))}
      </View>

      {assets.isPending ? (
        <LoadingState label="Loading balances" />
      ) : assets.isError ? (
        <ErrorState message="We couldn't load your balances. Try again." onRetry={() => assets.refetch()} />
      ) : data ? (
        <>
          <SectionTitle>DOGE</SectionTitle>
          {data.doge.length === 0 ? (
            <Text color="textSecondary">No DOGE balance found yet.</Text>
          ) : (
            <View style={{ gap: t.spacing.sm }}>
              {data.doge.map((b) => (
                <DogeCard key={b.wallet_id} balance={b} />
              ))}
            </View>
          )}

          <SectionTitle>DRC-20 tokens</SectionTitle>
          {data.drc20.length === 0 ? (
            <Text color="textSecondary">No DRC-20 tokens found for your connected wallets.</Text>
          ) : (
            <View style={{ gap: t.spacing.sm }}>
              {data.drc20.map((b) => (
                <Drc20Card key={`${b.wallet_id}:${b.token.id}`} balance={b} />
              ))}
            </View>
          )}
          {data.chain_height != null ? (
            <Text variant="caption" color="textSecondary" tabular style={{ marginTop: t.spacing.md }}>
              Network height {data.chain_height.toLocaleString()}. Balances come from independent indexers and can lag the network.
            </Text>
          ) : null}
        </>
      ) : null}

      <SectionTitle>Recent transfers</SectionTitle>
      {transfers.isPending ? (
        <LoadingState />
      ) : transfers.isError ? (
        <ErrorState message="We couldn't load your transfers." onRetry={() => transfers.refetch()} />
      ) : transferItems.length === 0 ? (
        <Text color="textSecondary">No transfers yet.</Text>
      ) : (
        <View>
          {transferItems.map((tr) => (
            <TransferRow key={tr.id} transfer={tr} />
          ))}
          {transfers.hasNextPage ? (
            <Button title="Show more" variant="secondary" onPress={() => transfers.fetchNextPage()} loading={transfers.isFetchingNextPage} />
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}

function IndexedLine({ height }: { height: number | null }) {
  return (
    <Text variant="caption" color="textSecondary" tabular>
      {height != null ? `Indexed at block ${height.toLocaleString()}` : 'Not indexed yet'}
    </Text>
  );
}

function DogeCard({ balance }: { balance: DogeBalance }) {
  const t = useTheme();
  return (
    <Card style={{ gap: t.spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: t.spacing.sm }}>
        <Text variant="h2" tabular style={{ flexShrink: 1 }} accessibilityLabel={`${formatDoge(balance.amount_koinu)} DOGE`}>
          {formatDoge(balance.amount_koinu)} <Text variant="body" color="goldText">DOGE</Text>
        </Text>
        <StatusChip status={balance.status} />
      </View>
      <MonoValue value={balance.address} label="Address" />
      {balance.status === 'disputed' ? <Text variant="small" color="danger">Independent indexers disagree on this balance.</Text> : null}
      <IndexedLine height={balance.indexed_height} />
    </Card>
  );
}

function Drc20Card({ balance }: { balance: Drc20Balance }) {
  const t = useTheme();
  const amount = formatUnits(balance.amount_base_units, balance.token.decimals, { group: true });
  const ticker = balance.token.ticker.toUpperCase();
  const disputed = balance.status === 'disputed';
  const empty = /^0*$/.test(balance.amount_base_units);
  return (
    <Card style={{ gap: t.spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
          <View style={{ paddingHorizontal: t.spacing.sm, paddingVertical: 2, borderRadius: t.radii.sm, backgroundColor: t.colors.goldSurface }}>
            <Text variant="caption" color="goldText">
              {ticker}
            </Text>
          </View>
          <Text variant="caption" color="textSecondary">DRC-20</Text>
        </View>
        <StatusChip status={balance.status} />
      </View>
      <Text variant="h2" tabular accessibilityLabel={`${amount} ${ticker}`}>
        {amount}
      </Text>
      <Text variant="technical" color="textSecondary" numberOfLines={1}>
        {balance.address.slice(0, 8)}…{balance.address.slice(-6)}
      </Text>
      {disputed ? <Text variant="small" color="danger">Independent indexers disagree on this balance. Sending is paused until they agree.</Text> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <IndexedLine height={balance.indexed_height} />
        <Button
          title="Send"
          size="sm"
          icon="arrow-up"
          variant="secondary"
          disabled={disputed || empty}
          accessibilityLabel={`Send ${ticker}`}
          onPress={() => router.push({ pathname: '/wallet/send', params: { wallet_id: balance.wallet_id, token_id: balance.token.id } })}
        />
      </View>
    </Card>
  );
}
