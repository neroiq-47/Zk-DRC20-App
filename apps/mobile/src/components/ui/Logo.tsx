import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { View } from 'react-native';
import { brand } from '@zoko/tokens';
import { useTheme } from '@/theme';
import { Text } from './Text';

// Brand guide section 03: white Z in a blue rounded square (160 unit artboard, field 7,7,146,146 r38),
// gold upper-right orbital dot, small mint lower-right dot. Below 32 px use the simplified monochrome Z.
export function LogoMark({ size = 48, variant = 'primary' }: { size?: number; variant?: 'primary' | 'inverse' | 'mono' }) {
  const simplified = size < 32 || variant === 'mono';
  const field = variant === 'inverse' ? '#FFFFFF' : brand.blue;
  const glyph = variant === 'inverse' ? brand.blue : '#FFFFFF';
  return (
    <Svg width={size} height={size} viewBox="0 0 160 160" accessibilityLabel="Zoko">
      <Rect x={7} y={7} width={146} height={146} rx={38} fill={field} />
      <Path d="M52 52 H108 L52 108 H108" stroke={glyph} strokeWidth={15} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {!simplified ? (
        <>
          <Circle cx={124} cy={36} r={11} fill={brand.gold} />
          <Circle cx={126} cy={126} r={6} fill={brand.mint} />
        </>
      ) : null}
    </Svg>
  );
}

export function Wordmark({ size = 28 }: { size?: number }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.35 }} accessibilityRole="header" accessibilityLabel="Zoko">
      <LogoMark size={size * 1.25} />
      <Text style={{ fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: size, lineHeight: size * 1.2, color: t.colors.textPrimary }}>zoko</Text>
    </View>
  );
}
