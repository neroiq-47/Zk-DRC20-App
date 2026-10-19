import { useRef, useState, type ComponentRef } from 'react';
import { TextInput } from 'react-native';
import { router } from 'expo-router';
import { Button, Text, TextField } from '@/components/ui';
import { AuthScaffold, FormError } from '@/features/auth/AuthForm';
import { describeAuthError, useSignIn } from '@/features/auth/useAuthSubmit';
import { isValidEmail } from '@/features/auth/validation';
import { DEMO_MODE } from '@/lib/config';

export default function SignIn() {
  const [email, setEmail] = useState(DEMO_MODE ? 'demo@zoko.app' : '');
  const [password, setPassword] = useState(DEMO_MODE ? 'demo-preview' : '');
  const pwRef = useRef<ComponentRef<typeof TextInput>>(null);
  const signIn = useSignIn();
  const { message, fields } = describeAuthError(signIn.error, 'signin');
  const valid = isValidEmail(email) && password.length > 0;

  const submit = () => {
    if (!valid || signIn.isPending) return;
    signIn.mutate({ email: email.trim().toLowerCase(), password });
  };

  return (
    <AuthScaffold title="Welcome back" subtitle={DEMO_MODE ? 'Preview with demo data. Any email and password work.' : 'Sign in to pick up where you left off.'}>
      <FormError message={message} />
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => pwRef.current?.focus()}
        error={fields.email}
      />
      <TextField
        ref={pwRef}
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
        error={fields.password}
      />
      <Button title="Sign in" fullWidth onPress={submit} loading={signIn.isPending} disabled={!valid} />
      <Text color="textSecondary" style={{ textAlign: 'center' }}>
        New to Zoko?{' '}
        <Text color="link" accessibilityRole="link" onPress={() => router.replace('/sign-up')}>
          Create an account
        </Text>
      </Text>
    </AuthScaffold>
  );
}
