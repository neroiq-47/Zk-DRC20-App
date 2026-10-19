import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import type { AssetStatus } from '@zoko/contracts';
import { useTheme } from '@/theme';
import { Text } from '@/components/ui';
import { truncateMiddle } from './address';
import type { StepState, StepView } from './transferSteps';

export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => mounted && setReduce(v))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = async (value: string, key = value) => {
    await Clipboard.setStringAsync(value);
    Haptics.selectionAsync().catch(() => undefined);
    setCopied(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1800);
    AccessibilityInfo.announceForAccessibility('Copied');
  };
  return { copied, copy };
}

export function CopyButton({ value, label = 'Copy', accessibilityLabel }: { value: string; label?: string; accessibilityLabel?: string }) {
  const t = useTheme();
  const { copied, copy } = useCopy();
  const done = copied !== null;
  return (
    <Pressable
      onPress={() => copy(value)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={8}
      style={({ pressed }) => ({
        minHeight: 44,
        minWidth: 44,
        paddingHorizontal: t.spacing.md,
        borderRadius: t.radii.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: t.spacing.xs,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={done ? 'checkmark' : 'copy-outline'} size={18} color={t.colors.link} />
      <Text variant="small" color="link" style={{ fontFamily: 'Inter_600SemiBold' }}>
        {done ? 'Copied' : label}
      </Text>
    </Pressable>
  );
}

/** Address or txid in JetBrains Mono, truncated in the middle, with a copy button. */
export function MonoValue({ value, label, full, head = 8, tail = 8 }: { value: string; label: string; full?: boolean; head?: number; tail?: number }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
      <Text
        variant="technical"
        selectable
        accessibilityLabel={`${label}: ${value}`}
        numberOfLines={full ? undefined : 1}
        style={{ flex: 1 }}
      >
        {full ? value : truncateMiddle(value, head, tail)}
      </Text>
      <CopyButton value={value} accessibilityLabel={`Copy ${label.toLowerCase()}`} />
    </View>
  );
}

const STATUS_COPY: Record<AssetStatus, { label: string; icon: keyof typeof Ionicons.glyphMap; explain?: string }> = {
  confirmed: { label: 'Confirmed', icon: 'checkmark-circle' },
  pending: { label: 'Pending', icon: 'time-outline', explain: 'Waiting for network confirmation.' },
  unverified: { label: 'Unverified', icon: 'information-circle-outline', explain: 'Not yet checked by an independent indexer.' },
  disputed: { label: 'Disputed', icon: 'alert-circle', explain: 'Independent indexers disagree on this balance.' },
};

export function StatusChip({ status }: { status: AssetStatus }) {
  const t = useTheme();
  const c = STATUS_COPY[status];
  const bg = status === 'confirmed' ? t.colors.successSurface : status === 'disputed' ? t.colors.dangerSurface : t.colors.background;
  const fg = status === 'confirmed' ? 'successText' : status === 'disputed' ? 'danger' : 'textSecondary';
  return (
    <View
      accessibilityLabel={`Status: ${c.label}${c.explain ? `. ${c.explain}` : ''}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        alignSelf: 'flex-start',
        paddingHorizontal: t.spacing.sm,
        paddingVertical: 2,
        borderRadius: t.radii.pill,
        backgroundColor: bg,
        borderWidth: status === 'pending' || status === 'unverified' ? 1 : 0,
        borderColor: t.colors.border,
      }}
    >
      <Ionicons name={c.icon} size={14} color={t.colors[fg]} />
      <Text variant="caption" color={fg}>
        {c.label}
      </Text>
    </View>
  );
}

export function statusExplanation(status: AssetStatus): string | undefined {
  return STATUS_COPY[status].explain;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: t.spacing.xl, marginBottom: t.spacing.sm }}>
      <Text variant="h3" accessibilityRole="header">
        {children}
      </Text>
      {right}
    </View>
  );
}

/** Neutral, continuous progress for pending transfers. Static when reduced motion is on. */
export function PendingProgress({ style }: { style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const reduce = useReduceMotion();
  const x = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.timing(x, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, x]);
  const segment = Math.max(40, width * 0.3);
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="progressbar"
      accessibilityLabel="Waiting for network confirmation"
      style={[{ height: 4, borderRadius: 2, backgroundColor: t.colors.border, overflow: 'hidden' }, style]}
    >
      {reduce ? (
        <View style={{ flexDirection: 'row', gap: 6, height: 4 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <View key={i} style={{ width: 6, height: 4, borderRadius: 2, backgroundColor: t.colors.textSecondary }} />
          ))}
        </View>
      ) : (
        <Animated.View
          style={{
            width: segment,
            height: 4,
            borderRadius: 2,
            backgroundColor: t.colors.textSecondary,
            transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-segment, width] }) }],
          }}
        />
      )}
    </View>
  );
}

/** Determinate confirmations bar in neutral tones. */
export function ConfirmationBar({ confirmations, required }: { confirmations: number; required: number }) {
  const t = useTheme();
  const pct = Math.max(0, Math.min(1, confirmations / required));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`${confirmations} of ${required} confirmations`}
      accessibilityValue={{ min: 0, max: required, now: confirmations }}
      style={{ height: 6, borderRadius: 3, backgroundColor: t.colors.border, overflow: 'hidden' }}
    >
      <View style={{ width: `${pct * 100}%`, height: 6, borderRadius: 3, backgroundColor: t.colors.textSecondary }} />
    </View>
  );
}

const STEP_ICON: Record<StepState, keyof typeof Ionicons.glyphMap> = {
  complete: 'checkmark',
  current: 'ellipse',
  upcoming: 'ellipse-outline',
  failed: 'close',
  stopped: 'remove',
};

const STATE_WORD: Record<StepState, string> = {
  complete: 'done',
  current: 'in progress',
  upcoming: 'not started',
  failed: 'failed',
  stopped: 'stopped',
};

/**
 * Vertical stepper. Only a fully confirmed transfer gets the mint "success" treatment on its last
 * row; every other completed step stays neutral so pending work never looks settled.
 */
export function Stepper({ steps, confirmedTransfer, renderDetail }: { steps: StepView[]; confirmedTransfer: boolean; renderDetail?: (s: StepView) => ReactNode }) {
  const t = useTheme();
  return (
    <View accessibilityRole="list">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const success = confirmedTransfer && last;
        const dotBg =
          s.state === 'failed'
            ? t.colors.danger
            : success
              ? t.colors.successText
              : s.state === 'complete'
                ? t.colors.textSecondary
                : s.state === 'current'
                  ? t.colors.primary
                  : t.colors.surface;
        const iconColor = s.state === 'upcoming' || s.state === 'stopped' ? t.colors.textSecondary : t.colors.onPrimary;
        const detail = renderDetail?.(s);
        return (
          <View key={s.key} style={{ flexDirection: 'row', gap: t.spacing.md }} accessibilityLabel={`${s.label}, ${STATE_WORD[s.state]}`}>
            <View style={{ alignItems: 'center', width: 28 }}>
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: dotBg,
                  borderWidth: s.state === 'upcoming' || s.state === 'stopped' ? 1 : 0,
                  borderColor: t.colors.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name={STEP_ICON[s.state]} size={s.state === 'current' ? 10 : 16} color={iconColor} />
              </View>
              {!last ? <View style={{ flex: 1, width: 2, minHeight: 16, backgroundColor: t.colors.border }} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: last ? 0 : t.spacing.lg, paddingTop: 3, gap: t.spacing.sm }}>
              <Text
                color={s.state === 'upcoming' ? 'textSecondary' : s.state === 'failed' ? 'danger' : success ? 'successText' : 'textPrimary'}
                style={{ fontFamily: s.state === 'current' ? 'Inter_600SemiBold' : 'Inter_500Medium' }}
              >
                {s.label}
              </Text>
              {detail}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: 2, paddingVertical: t.spacing.sm }}>
      <Text variant="caption" color="textSecondary">
        {label}
      </Text>
      {typeof children === 'string' ? <Text tabular>{children}</Text> : children}
    </View>
  );
}

export function Notice({ tone = 'neutral', icon, title, body, children }: { tone?: 'neutral' | 'danger' | 'gold'; icon?: keyof typeof Ionicons.glyphMap; title: string; body?: string; children?: ReactNode }) {
  const t = useTheme();
  const bg = tone === 'danger' ? t.colors.dangerSurface : tone === 'gold' ? t.colors.goldSurface : t.colors.surface;
  const fg = tone === 'danger' ? 'danger' : tone === 'gold' ? 'goldText' : 'textPrimary';
  return (
    <View
      accessibilityRole="summary"
      style={{ backgroundColor: bg, borderRadius: t.radii.lg, padding: t.spacing.lg, gap: t.spacing.sm, borderWidth: tone === 'neutral' ? 1 : 0, borderColor: t.colors.border }}
    >
      <View style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'center' }}>
        {icon ? <Ionicons name={icon} size={20} color={t.colors[fg]} /> : null}
        <Text color={fg} style={{ fontFamily: 'Inter_600SemiBold', flex: 1 }}>
          {title}
        </Text>
      </View>
      {body ? <Text variant="small" color={tone === 'neutral' ? 'textSecondary' : fg}>{body}</Text> : null}
      {children}
    </View>
  );
}
