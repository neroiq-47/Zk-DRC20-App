import { useState, type ComponentRef, type Ref } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '@/theme';
import { Text } from './Text';

export interface TextFieldProps extends TextInputProps {
  label?: string;
  error?: string | null;
  hint?: string;
  multilineHeight?: number;
  ref?: Ref<ComponentRef<typeof TextInput>>;
}

export function TextField({ label, error, hint, style, multiline, multilineHeight = 120, onFocus, onBlur, ref, ...rest }: TextFieldProps) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: t.spacing.xs }}>
      {label ? (
        <Text variant="small" color="textSecondary" style={{ fontFamily: 'Inter_500Medium' }}>
          {label}
        </Text>
      ) : null}
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={t.colors.textSecondary}
        multiline={multiline}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          t.typography.body,
          {
            fontWeight: undefined,
            minHeight: multiline ? multilineHeight : t.components.inputHeight,
            borderRadius: t.components.inputRadius,
            borderWidth: focused ? 2 : 1,
            borderColor: error ? t.colors.danger : focused ? t.colors.primary : t.colors.border,
            backgroundColor: t.colors.surface,
            color: t.colors.textPrimary,
            paddingHorizontal: t.spacing.lg,
            paddingVertical: multiline ? t.spacing.md : 0,
            textAlignVertical: multiline ? 'top' : 'center',
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text variant="small" color="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color="textSecondary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
