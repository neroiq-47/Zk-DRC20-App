import { useState, type ComponentRef, type Ref } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';

export function SearchField({ value, onChangeText, onSubmit, ref }: { value: string; onChangeText: (v: string) => void; onSubmit?: () => void; ref?: Ref<ComponentRef<typeof TextInput>> }) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={{
        height: t.components.searchHeight,
        borderRadius: t.components.searchRadius,
        backgroundColor: t.colors.surface,
        borderWidth: focused ? 2 : 1,
        borderColor: focused ? t.colors.primary : t.colors.border,
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: t.spacing.md,
        gap: t.spacing.sm,
      }}
    >
      <Ionicons name="search" size={20} color={t.colors.textSecondary} />
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={onSubmit}
        placeholder="Search people, posts and #tags"
        placeholderTextColor={t.colors.textSecondary}
        accessibilityLabel="Search"
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="never"
        style={[t.typography.body, { fontWeight: undefined, flex: 1, color: t.colors.textPrimary, height: '100%', padding: 0 }]}
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} accessibilityRole="button" accessibilityLabel="Clear search" style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="close-circle" size={20} color={t.colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}
