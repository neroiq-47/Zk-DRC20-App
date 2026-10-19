import { useRef, useState, type ComponentRef } from 'react';
import { TextInput } from 'react-native';
import { router } from 'expo-router';
import { Button, Text, TextField } from '@/components/ui';
import { AuthScaffold, FormError } from '@/features/auth/AuthForm';
import { describeAuthError, useSignUp } from '@/features/auth/useAuthSubmit';
import { MIN_PASSWORD, handleError, isValidEmail, isValidHandle, normalizeHandleInput, passwordError } from '@/features/auth/validation';

export default function SignUp() {
  const [email, setEmail] = useState('');
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [touchedEmail, setTouchedEmail] = useState(false);
  const handleRef = useRef<ComponentRef<typeof TextInput>>(null);
  const nameRef = useRef<ComponentRef<typeof TextInput>>(null);
  const pwRef = useRef<ComponentRef<typeof TextInput>>(null);
  const signUp = useSignUp();
  const { message, fields } = describeAuthError(signUp.error, 'signup');

  const valid = isValidEmail(email) && isValidHandle(handle) && password.length >= MIN_PASSWORD && displayName.trim().length <= 80;

  const submit = () => {
    if (!valid || signUp.isPending) return;
    signUp.mutate({
      email: email.trim().toLowerCase(),
      handle,
      password,
      display_name: displayName.trim() || undefined,
    });
  };

  return (
    <AuthScaffold title="Create your account" subtitle="Social first. Ownership when you want it.">
      <FormError message={message} />
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        onBlur={() => setTouchedEmail(true)}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => handleRef.current?.focus()}
        error={fields.email ?? (touchedEmail && email && !isValidEmail(email) ? 'Enter a valid email address.' : null)}
      />
      <TextField
        ref={handleRef}
        label="Handle"
        value={handle}
        onChangeText={(v) => setHandle(normalizeHandleInput(v))}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username-new"
        textContentType="username"
        returnKeyType="next"
        maxLength={30}
        onSubmitEditing={() => nameRef.current?.focus()}
        placeholder="yourname"
        error={fields.handle ?? handleError(handle)}
        hint={handle && isValidHandle(handle) ? `You'll be @${handle}` : '3–30 lowercase letters, numbers or underscores.'}
      />
      <TextField
        ref={nameRef}
        label="Display name"
        value={displayName}
        onChangeText={setDisplayName}
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
        maxLength={80}
        onSubmitEditing={() => pwRef.current?.focus()}
        placeholder="Optional"
        error={fields.display_name}
      />
      <TextField
        ref={pwRef}
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={submit}
        error={fields.password}
        hint={passwordError(password) ?? (password ? 'Looks good.' : `At least ${MIN_PASSWORD} characters. A short phrase works well.`)}
      />
      <Button title="Create account" fullWidth onPress={submit} loading={signUp.isPending} disabled={!valid} />
      <Text variant="caption" color="textSecondary" style={{ textAlign: 'center' }}>
        You can connect a Dogecoin wallet later. It's optional.
      </Text>
      <Text color="textSecondary" style={{ textAlign: 'center' }}>
        Already have an account?{' '}
        <Text color="link" accessibilityRole="link" onPress={() => router.replace('/sign-in')}>
          Sign in
        </Text>
      </Text>
    </AuthScaffold>
  );
}
