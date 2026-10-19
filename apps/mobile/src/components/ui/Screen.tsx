import { View, type ViewProps } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';

export function Screen({ style, edges = ['top'], padded, ...rest }: ViewProps & { edges?: Edge[]; padded?: boolean }) {
  const t = useTheme();
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View style={[{ flex: 1 }, padded && { paddingHorizontal: t.components.feedGutter }, style]} {...rest} />
    </SafeAreaView>
  );
}
