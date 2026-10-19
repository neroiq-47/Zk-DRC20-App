import type { ReactNode } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { Text } from '@/components/ui';

export function SettingsSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ marginTop: t.spacing.xl }}>
      <View style={{ paddingHorizontal: t.components.feedGutter, marginBottom: t.spacing.sm, gap: 2 }}>
        <Text variant="caption" color="textSecondary" accessibilityRole="header" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
          {title}
        </Text>
        {description ? <Text variant="small" color="textSecondary">{description}</Text> : null}
      </View>
      <View style={{ marginHorizontal: t.components.feedGutter, backgroundColor: t.colors.surface, borderRadius: t.radii.lg, borderWidth: 1, borderColor: t.colors.border, overflow: 'hidden' }}>
        {children}
      </View>
    </View>
  );
}

export function SettingsRow({
  icon,
  label,
  value,
  onPress,
  destructive,
  right,
  hint,
  first,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
  right?: ReactNode;
  hint?: string;
  first?: boolean;
}) {
  const t = useTheme();
  const color = destructive ? 'danger' : 'textPrimary';
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${label}${value ? `, ${value}` : ''}`}
      accessibilityHint={hint}
      style={({ pressed }) => ({
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.md,
        paddingHorizontal: t.spacing.lg,
        paddingVertical: t.spacing.sm,
        borderTopWidth: first ? 0 : 1,
        borderColor: t.colors.border,
        backgroundColor: pressed && onPress ? t.colors.border : 'transparent',
      })}
    >
      {icon ? <Ionicons name={icon} size={20} color={destructive ? t.colors.danger : t.colors.textSecondary} /> : null}
      <View style={{ flex: 1 }}>
        <Text color={color}>{label}</Text>
        {hint ? <Text variant="caption" color="textSecondary">{hint}</Text> : null}
      </View>
      {value ? <Text variant="small" color="textSecondary">{value}</Text> : null}
      {right}
      {onPress && !right && !destructive ? <Ionicons name="chevron-forward" size={18} color={t.colors.textSecondary} /> : null}
    </Pressable>
  );
}

export function SettingsSwitch({ label, hint, value, onValueChange, first, disabled }: { label: string; hint?: string; value: boolean; onValueChange: (v: boolean) => void; first?: boolean; disabled?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.sm, borderTopWidth: first ? 0 : 1, borderColor: t.colors.border }}
    >
      <View style={{ flex: 1 }}>
        <Text>{label}</Text>
        {hint ? <Text variant="caption" color="textSecondary">{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ true: t.colors.primary, false: t.colors.border }}
        thumbColor={t.colors.onPrimary}
        ios_backgroundColor={t.colors.border}
      />
    </View>
  );
}

/** A row of mutually exclusive options (radio group). */
export function SettingsChoice<T extends string>({ label, options, value, onChange, first }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; first?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.md, gap: t.spacing.sm, borderTopWidth: first ? 0 : 1, borderColor: t.colors.border }}>
      <Text>{label}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', backgroundColor: t.colors.background, borderRadius: t.radii.md, padding: 4, gap: 4 }}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={o.label}
              style={{ flex: 1, minHeight: 40, borderRadius: t.radii.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? t.colors.primary : 'transparent' }}
            >
              <Text variant="small" color={selected ? 'onPrimary' : 'textSecondary'} style={{ fontFamily: 'Inter_600SemiBold' }}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
