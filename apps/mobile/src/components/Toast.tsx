import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { motion } from '@zoko/tokens';
import { useTheme } from '@/theme';
import { Text } from '@/components/ui';

type Tone = 'success' | 'error' | 'info';
interface ToastState {
  message: string | null;
  tone: Tone;
  seq: number;
  show: (message: string, tone?: Tone) => void;
  hide: () => void;
}

export const useToast = create<ToastState>((set) => ({
  message: null,
  tone: 'info',
  seq: 0,
  show: (message, tone = 'info') => set((s) => ({ message, tone, seq: s.seq + 1 })),
  hide: () => set({ message: null }),
}));

/** Imperative helper usable outside React. */
export const showToast = (message: string, tone?: Tone) => useToast.getState().show(message, tone);

/**
 * Renders the current toast as a banner at the top of the screen it is placed in.
 * Place one `<ToastHost />` as the last child of a screen.
 */
export function ToastHost({ duration = 2600 }: { duration?: number }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { message, tone, seq, hide } = useToast();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) return;
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: motion.publishSuccess, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: motion.publishSuccess, useNativeDriver: true }).start(() => hide());
    }, duration);
    return () => clearTimeout(timer);
  }, [seq, message, duration, anim, hide]);

  if (!message) return null;
  const bg = tone === 'success' ? t.colors.successSurface : tone === 'error' ? t.colors.dangerSurface : t.colors.surfaceElevated;
  const fg = tone === 'success' ? 'successText' : tone === 'error' ? 'danger' : 'textPrimary';
  const icon = tone === 'success' ? 'checkmark-circle' : tone === 'error' ? 'alert-circle' : 'information-circle';
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: insets.top + t.spacing.sm,
        left: t.spacing.lg,
        right: t.spacing.lg,
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }],
        zIndex: 100,
      }}
    >
      <View
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.spacing.sm,
          backgroundColor: bg,
          borderRadius: t.radii.md,
          paddingHorizontal: t.spacing.lg,
          paddingVertical: t.spacing.md,
          borderWidth: 1,
          borderColor: t.colors.border,
        }}
      >
        <Ionicons name={icon} size={20} color={t.colors[fg]} />
        <Text color={fg} style={{ flex: 1, fontFamily: 'Inter_500Medium' }}>
          {message}
        </Text>
      </View>
    </Animated.View>
  );
}
