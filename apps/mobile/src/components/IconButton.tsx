import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SemanticColors } from '@zoko/tokens';
import { useTheme } from '@/theme';

export type IconName = keyof typeof Ionicons.glyphMap;

export interface IconButtonProps {
  icon: IconName;
  onPress?: () => void;
  accessibilityLabel: string;
  /** Semantic token name (e.g. 'link') or a raw color string. Defaults to textPrimary. */
  color?: keyof SemanticColors | (string & {});
  /** Icon size in px. The tap target is always at least 44pt. */
  size?: number;
  active?: boolean;
  disabled?: boolean;
  badge?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function IconButton({ icon, onPress, accessibilityLabel, color, size = 24, active, disabled, badge, style }: IconButtonProps) {
  const t = useTheme();
  const resolved = color ? ((t.colors as unknown as Record<string, string>)[color] ?? color) : t.colors.textPrimary;
  const box = Math.max(44, size + 20);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled, selected: active }}
      hitSlop={4}
      style={({ pressed }) => [
        { width: box, height: box, borderRadius: box / 2, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : pressed ? 0.6 : 1 },
        style,
      ]}
    >
      <Ionicons name={icon} size={size} color={resolved} />
      {badge ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{
            position: 'absolute',
            top: box / 2 - size / 2 - 1,
            right: box / 2 - size / 2 - 1,
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: t.colors.primary,
            borderWidth: 2,
            borderColor: t.colors.background,
          }}
        />
      ) : null}
    </Pressable>
  );
}
