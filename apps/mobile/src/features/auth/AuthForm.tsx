import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { Screen, Text } from '@/components/ui';

export function AuthScaffold({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <Screen edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: t.spacing.xl, gap: t.spacing.lg }}>
          <View style={{ gap: t.spacing.xs }}>
            <Text variant="h1" accessibilityRole="header">
              {title}
            </Text>
            {subtitle ? <Text color="textSecondary">{subtitle}</Text> : null}
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

export function FormError({ message }: { message: string | null }) {
  const t = useTheme();
  if (!message) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={{ flexDirection: 'row', gap: t.spacing.sm, backgroundColor: t.colors.dangerSurface, padding: t.spacing.md, borderRadius: t.radii.md, alignItems: 'center' }}
    >
      <Ionicons name="alert-circle" size={18} color={t.colors.danger} />
      <Text variant="small" color="danger" style={{ flex: 1 }}>
        {message}
      </Text>
    </View>
  );
}
