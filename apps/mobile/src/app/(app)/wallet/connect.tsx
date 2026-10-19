import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import type { WalletChallenge, WalletProvider } from '@zoko/contracts';
import { useTheme } from '@/theme';
import { Button, Card, ErrorState, LoadingState, Text, TextField } from '@/components/ui';
import { useCreateChallenge, useVerifyWallet, useWalletProviders } from '@/features/wallet/hooks';
import { addressProblemMessage, dogecoinAddressProblem } from '@/features/wallet/address';
import { CopyButton, Notice } from '@/features/wallet/components';
import { walletProofErrorMessage } from '@/features/wallet/problems';

function useSecondsLeft(expiresAt: string | undefined): number | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  if (!expiresAt) return null;
  return Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000));
}

const fmtCountdown = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function ConnectWalletScreen() {
  const t = useTheme();
  const providers = useWalletProviders();
  const createChallenge = useCreateChallenge();
  const verify = useVerifyWallet();

  const [provider, setProvider] = useState<WalletProvider | null>(null);
  const [address, setAddress] = useState('');
  const [addressTouched, setAddressTouched] = useState(false);
  const [challenge, setChallenge] = useState<WalletChallenge | null>(null);
  const [signature, setSignature] = useState('');
  const [error, setError] = useState<string | null>(null);
  const secondsLeft = useSecondsLeft(challenge?.expires_at);
  const expired = secondsLeft === 0;

  // Pick the only usable provider automatically.
  useEffect(() => {
    const usable = providers.data?.filter((p) => p.can_sign_message) ?? [];
    if (!provider && usable.length === 1) setProvider(usable[0]);
  }, [providers.data, provider]);

  const addrProblem = dogecoinAddressProblem(address);
  const addrError = addressTouched && addrProblem && addrProblem !== 'empty' ? addressProblemMessage(addrProblem) : null;

  const start = () => {
    setAddressTouched(true);
    setError(null);
    if (!provider || addrProblem) return;
    createChallenge.mutate(
      { address: address.trim(), provider: provider.id },
      {
        onSuccess: (c) => {
          setChallenge(c);
          setSignature('');
        },
        onError: (e) => setError(walletProofErrorMessage(e)),
      },
    );
  };

  const sigClean = signature.replace(/\s+/g, '');
  const sigLooksValid = /^[A-Za-z0-9+/]+={0,2}$/.test(sigClean) && sigClean.length >= 80 && sigClean.length <= 100;

  const submit = () => {
    if (!challenge || !provider) return;
    setError(null);
    verify.mutate(
      { challenge_id: challenge.challenge_id, signature: sigClean, provider: provider.id },
      {
        onSuccess: () => router.replace('/wallet'),
        onError: (e) => {
          const msg = walletProofErrorMessage(e);
          // Expired or already-used challenges cannot be retried: go back to request a fresh one.
          if (msg.includes('Start again')) {
            setChallenge(null);
            setSignature('');
          }
          setError(msg);
        },
      },
    );
  };

  const restart = () => {
    setChallenge(null);
    setSignature('');
    setError(null);
  };

  if (providers.isPending) return <><Stack.Screen options={{ title: 'Connect a wallet' }} /><LoadingState /></>;
  if (providers.isError) return <><Stack.Screen options={{ title: 'Connect a wallet' }} /><ErrorState onRetry={() => providers.refetch()} /></>;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
      <Stack.Screen options={{ title: 'Connect a wallet' }} />
      <ScrollView contentContainerStyle={{ padding: t.components.feedGutter, gap: t.spacing.lg, paddingBottom: t.spacing.xxxl }} keyboardShouldPersistTaps="handled">
        <Text color="textSecondary">
          Prove you own a Dogecoin address by signing a short message. Zoko never asks for your seed phrase or private keys, and signing a message does not move any funds.
        </Text>

        {!challenge ? (
          <>
            <Text variant="h3" accessibilityRole="header">1. Choose how you sign</Text>
            <View style={{ gap: t.spacing.sm }} accessibilityRole="radiogroup">
              {providers.data.map((p) => (
                <ProviderOption key={p.id} provider={p} selected={provider?.id === p.id} onPress={() => setProvider(p)} />
              ))}
            </View>

            <Text variant="h3" accessibilityRole="header">2. Enter your Dogecoin address</Text>
            <TextField
              label="Dogecoin address"
              value={address}
              onChangeText={(v) => {
                setAddress(v);
                setError(null);
              }}
              onBlur={() => setAddressTouched(true)}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              placeholder="D…"
              error={addrError}
              hint="Dogecoin mainnet addresses start with D, A or 9."
              style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 14 }}
            />
            {error ? <Notice tone="danger" icon="alert-circle" title={error} /> : null}
            <Button title="Get message to sign" onPress={start} loading={createChallenge.isPending} disabled={!provider || !!addrProblem} />
          </>
        ) : (
          <>
            <Text variant="h3" accessibilityRole="header">3. Sign this message</Text>
            <Text>Open your Dogecoin wallet, choose Sign message, paste this message, then paste the signature here.</Text>
            <Card style={{ gap: t.spacing.sm }}>
              <Text variant="caption" color="textSecondary">Message</Text>
              <Text variant="technical" selectable>
                {challenge.message}
              </Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="caption" color={expired ? 'danger' : 'textSecondary'} tabular accessibilityLiveRegion="polite">
                  {expired ? 'This message expired.' : `Expires in ${fmtCountdown(secondsLeft ?? 0)}`}
                </Text>
                <CopyButton value={challenge.message} label="Copy message" />
              </View>
            </Card>
            <Text variant="small" color="textSecondary">Sign with the address {address.trim()}. Use the message exactly as shown, including line breaks.</Text>

            {expired ? (
              <Notice tone="neutral" icon="time-outline" title="This message expired." body="Messages are valid for 10 minutes and work once. Get a fresh one to continue.">
                <Button title="Get a new message" variant="secondary" onPress={start} loading={createChallenge.isPending} />
              </Notice>
            ) : (
              <>
                <TextField
                  label="Signature"
                  value={signature}
                  onChangeText={(v) => {
                    setSignature(v);
                    setError(null);
                  }}
                  multiline
                  multilineHeight={96}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  placeholder="Paste the signature from your wallet"
                  hint="A signature is about 88 characters and usually ends with =."
                  error={signature && !sigLooksValid ? "This doesn't look like a Dogecoin message signature." : null}
                  style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 13 }}
                />
                {error ? <Notice tone="danger" icon="alert-circle" title={error} /> : null}
                <Button title="Verify and connect" onPress={submit} loading={verify.isPending} disabled={!sigLooksValid} />
              </>
            )}
            <Button title="Use a different address" variant="ghost" onPress={restart} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ProviderOption({ provider, selected, onPress }: { provider: WalletProvider; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  const disabled = !provider.can_sign_message;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={`${provider.name}. ${provider.can_sign_message ? 'Can sign messages' : 'Cannot sign messages'}. ${provider.can_sign_transaction ? 'Can sign transactions' : 'Cannot sign transactions'}.`}
      style={{
        borderRadius: t.radii.lg,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? t.colors.primary : t.colors.border,
        backgroundColor: t.colors.surface,
        padding: t.spacing.lg,
        gap: t.spacing.sm,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontFamily: 'Inter_600SemiBold' }}>{provider.name}</Text>
        <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? t.colors.primary : t.colors.textSecondary} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.md }}>
        <Capability ok={provider.can_sign_message} label="Sign message" />
        <Capability ok={provider.can_sign_transaction} label="Sign transaction" />
        <Capability ok label={provider.signing_method === 'copy_paste' ? 'Copy and paste' : 'Opens wallet app'} neutral />
      </View>
      {provider.notes ? <Text variant="small" color="textSecondary">{provider.notes}</Text> : null}
    </Pressable>
  );
}

function Capability({ ok, label, neutral }: { ok: boolean; label: string; neutral?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Ionicons name={neutral ? 'swap-horizontal' : ok ? 'checkmark' : 'close'} size={14} color={t.colors.textSecondary} />
      <Text variant="caption" color="textSecondary">{label}</Text>
    </View>
  );
}
