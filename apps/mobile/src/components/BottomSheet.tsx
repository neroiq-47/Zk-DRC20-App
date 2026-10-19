import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { Text } from '@/components/ui';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children?: ReactNode;
}

/** Bottom sheet built on RN Modal, 24px top radius (brand sheet radius). */
export function BottomSheet({ visible, onClose, title, children }: BottomSheetProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: t.colors.overlay }}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: t.colors.surfaceElevated,
            borderTopLeftRadius: t.components.sheetRadius,
            borderTopRightRadius: t.components.sheetRadius,
            paddingTop: t.spacing.sm,
            paddingBottom: Math.max(insets.bottom, t.spacing.lg),
            maxHeight: '85%',
          }}
        >
          <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: t.colors.border, marginBottom: t.spacing.sm }} />
          {title ? (
            <Text variant="h3" accessibilityRole="header" style={{ paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.sm }}>
              {title}
            </Text>
          ) : null}
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export interface SheetOptionProps {
  label: string;
  icon?: ReactNode;
  onPress: () => void;
  destructive?: boolean;
  selected?: boolean;
}

/** A 52pt row for use inside BottomSheet. */
export function SheetOption({ label, icon, onPress, destructive, selected }: SheetOptionProps) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        minHeight: 52,
        paddingHorizontal: t.spacing.lg,
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.md,
        backgroundColor: pressed ? t.colors.border : 'transparent',
      })}
    >
      {icon}
      <Text color={destructive ? 'danger' : 'textPrimary'} style={{ flex: 1, fontFamily: selected ? 'Inter_600SemiBold' : undefined }}>
        {label}
      </Text>
    </Pressable>
  );
}
