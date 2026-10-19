import { View } from 'react-native';
import { Image } from 'expo-image';
import { brand } from '@zoko/tokens';
import { useTheme } from '@/theme';
import { Text } from './Text';

const SIZES = { sm: 32, md: 40, lg: 56, xl: 80 } as const;
const FILLS = [brand.blue, brand.blueDeep, brand.mintDeep, brand.slate, brand.surfaceBlue];

export function Avatar({ uri, name, size = 'md' }: { uri?: string | null; name: string; size?: keyof typeof SIZES }) {
  const t = useTheme();
  const px = SIZES[size];
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
  const fill = FILLS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % FILLS.length];
  if (uri) {
    return (
      <Image
        source={{ uri }}
        accessibilityLabel={`${name}'s avatar`}
        style={{ width: px, height: px, borderRadius: px / 2, backgroundColor: t.colors.border }}
        contentFit="cover"
        transition={150}
      />
    );
  }
  return (
    <View
      accessibilityLabel={`${name}'s avatar`}
      style={{ width: px, height: px, borderRadius: px / 2, backgroundColor: fill, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text variant={px >= 56 ? 'h3' : 'caption'} color="onPrimary" style={{ fontSize: px * 0.38, lineHeight: px * 0.46 }}>
        {initials}
      </Text>
    </View>
  );
}
