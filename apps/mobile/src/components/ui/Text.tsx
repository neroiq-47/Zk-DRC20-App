import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import type { TypographyVariant, SemanticColors } from '@zoko/tokens';
import { useTheme } from '@/theme';

export interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  color?: keyof SemanticColors;
  tabular?: boolean; // tabular numerals for balances
}

export function Text({ variant = 'body', color = 'textPrimary', tabular, style, ...rest }: TextProps) {
  const t = useTheme();
  const { fontWeight: _w, ...type } = t.typography[variant];
  return (
    <RNText
      maxFontSizeMultiplier={1.6}
      {...rest}
      style={[type, { color: t.colors[color] }, tabular && { fontVariant: ['tabular-nums'] }, style]}
    />
  );
}
