import { ActivityIndicator, Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { Text } from './Text';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  title: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  loading?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({ title, variant = 'primary', size = 'md', loading, icon, fullWidth, disabled, style, ...rest }: ButtonProps) {
  const t = useTheme();
  const isDisabled = disabled || loading;
  const height = size === 'sm' ? 36 : variant === 'primary' ? t.components.buttonPrimaryHeight : t.components.buttonSecondaryHeight;
  const bg =
    variant === 'primary' ? t.colors.primary : variant === 'danger' ? t.colors.dangerSurface : variant === 'secondary' ? t.colors.surface : 'transparent';
  const fg = variant === 'primary' ? 'onPrimary' : variant === 'danger' ? 'danger' : variant === 'ghost' ? 'link' : 'textPrimary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      accessibilityLabel={title}
      disabled={isDisabled}
      hitSlop={size === 'sm' ? 6 : 0}
      style={({ pressed }) => [
        {
          height,
          paddingHorizontal: size === 'sm' ? t.spacing.md : t.spacing.xl,
          borderRadius: t.components.buttonRadius,
          backgroundColor: bg,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: t.colors.border,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: t.spacing.sm,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
          alignSelf: fullWidth ? 'stretch' : 'auto',
        },
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={t.colors[fg]} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
          {icon ? <Ionicons name={icon} size={size === 'sm' ? 16 : 20} color={t.colors[fg]} /> : null}
          <Text variant={size === 'sm' ? 'small' : 'body'} color={fg} style={{ fontFamily: 'Inter_600SemiBold' }}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
