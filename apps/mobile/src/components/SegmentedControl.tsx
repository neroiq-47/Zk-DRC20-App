import { Pressable, View } from 'react-native';
import { useTheme } from '@/theme';
import { Text } from '@/components/ui';

export interface SegmentedControlProps<T extends string> {
  segments: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** 'pill' = filled track (Home), 'underline' = tab strip (profiles, search results). */
  variant?: 'pill' | 'underline';
}

export function SegmentedControl<T extends string>({ segments, value, onChange, variant = 'pill' }: SegmentedControlProps<T>) {
  const t = useTheme();
  if (variant === 'underline') {
    return (
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: t.colors.border }}>
        {segments.map((s) => {
          const active = s.value === value;
          return (
            <Pressable
              key={s.value}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={s.label}
              onPress={() => onChange(s.value)}
              style={{ flex: 1, height: 48, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text color={active ? 'textPrimary' : 'textSecondary'} style={{ fontFamily: active ? 'Inter_600SemiBold' : 'Inter_500Medium' }}>
                {s.label}
              </Text>
              <View
                style={{
                  position: 'absolute',
                  bottom: -1,
                  height: 3,
                  width: '40%',
                  borderRadius: 2,
                  backgroundColor: active ? t.colors.primary : 'transparent',
                }}
              />
            </Pressable>
          );
        })}
      </View>
    );
  }
  return (
    <View
      accessibilityRole="tablist"
      style={{ flexDirection: 'row', backgroundColor: t.colors.surface, borderRadius: t.radii.md, padding: 4, borderWidth: 1, borderColor: t.colors.border }}
    >
      {segments.map((s) => {
        const active = s.value === value;
        return (
          <Pressable
            key={s.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={s.label}
            onPress={() => onChange(s.value)}
            style={{
              flex: 1,
              minHeight: 40,
              borderRadius: t.radii.sm,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: active ? t.colors.primary : 'transparent',
            }}
          >
            <Text variant="small" color={active ? 'onPrimary' : 'textSecondary'} style={{ fontFamily: 'Inter_600SemiBold' }}>
              {s.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
