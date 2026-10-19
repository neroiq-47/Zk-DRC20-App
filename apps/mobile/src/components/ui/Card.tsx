import { View, type ViewProps } from 'react-native';
import { useTheme } from '@/theme';

export function Card({ style, tone = 'surface', ...rest }: ViewProps & { tone?: 'surface' | 'gold' | 'success' | 'danger' | 'blue' }) {
  const t = useTheme();
  const bg =
    tone === 'gold' ? t.colors.goldSurface : tone === 'success' ? t.colors.successSurface : tone === 'danger' ? t.colors.dangerSurface : tone === 'blue' ? (t.scheme === 'light' ? '#E8F1FF' : t.colors.surfaceElevated) : t.colors.surface;
  return (
    <View
      style={[{ backgroundColor: bg, borderRadius: t.components.cardRadius, borderWidth: tone === 'surface' ? 1 : 0, borderColor: t.colors.border, padding: t.spacing.lg }, style]}
      {...rest}
    />
  );
}
