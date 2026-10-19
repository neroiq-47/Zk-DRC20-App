// Zoko design tokens (brand style guide v1.0, sections 02, 04, 05, 06 and 07).
// Changes to foundational tokens need design and engineering review.

export const brand = {
  blue: '#146FF4',
  mint: '#5DE0BD',
  gold: '#B79A30',
  navy: '#101C2E',
  white: '#F7FAFC',
  blueTint: '#E8F1FF',
  blueDeep: '#0751BE',
  mintTint: '#E1FAF2',
  mintDeep: '#08785E',
  goldTint: '#F8F0D3',
  goldDeep: '#765C10',
  surfaceBlue: '#19283E',
  slate: '#52647B',
} as const;

export type ColorScheme = 'light' | 'dark';

export interface SemanticColors {
  background: string;
  surface: string;
  surfaceElevated: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  primary: string;
  onPrimary: string;
  link: string;
  successText: string;
  successSurface: string;
  goldText: string;
  goldSurface: string;
  danger: string;
  dangerSurface: string;
  mint: string;
  overlay: string;
}

export const colors: Record<ColorScheme, SemanticColors> = {
  light: {
    background: '#F7FAFC',
    surface: '#FFFFFF',
    surfaceElevated: '#FFFFFF',
    textPrimary: '#101C2E',
    textSecondary: '#52647B',
    border: '#E3EAF2',
    primary: '#146FF4',
    onPrimary: '#FFFFFF',
    link: '#0751BE',
    successText: '#08785E',
    successSurface: '#E1FAF2',
    goldText: '#765C10',
    goldSurface: '#F8F0D3',
    danger: '#C6283E',
    dangerSurface: '#FDECEE',
    mint: '#5DE0BD',
    overlay: 'rgba(16, 28, 46, 0.5)',
  },
  dark: {
    background: '#101C2E',
    surface: '#19283E',
    surfaceElevated: '#22334B',
    textPrimary: '#F7FAFC',
    textSecondary: '#A9B8CB',
    border: '#2B3B51',
    primary: '#146FF4',
    onPrimary: '#FFFFFF',
    link: '#7EB1FF',
    successText: '#75E8C7',
    successSurface: '#123B36',
    goldText: '#F0D778',
    goldSurface: '#3A3420',
    danger: '#FF8592',
    dangerSurface: '#3D1F2A',
    mint: '#5DE0BD',
    overlay: 'rgba(0, 0, 0, 0.6)',
  },
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radii = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

export const fontFamilies = {
  display: 'SpaceGrotesk_700Bold',
  heading: 'SpaceGrotesk_600SemiBold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
  mono: 'JetBrainsMono_400Regular',
} as const;

export interface TextStyleToken {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600' | '700';
}

export const typography = {
  display: { fontFamily: fontFamilies.display, fontSize: 36, lineHeight: 42, fontWeight: '700' },
  h1: { fontFamily: fontFamilies.display, fontSize: 30, lineHeight: 36, fontWeight: '700' },
  h2: { fontFamily: fontFamilies.heading, fontSize: 24, lineHeight: 30, fontWeight: '600' },
  h3: { fontFamily: fontFamilies.heading, fontSize: 20, lineHeight: 26, fontWeight: '600' },
  body: { fontFamily: fontFamilies.body, fontSize: 16, lineHeight: 24, fontWeight: '400' },
  small: { fontFamily: fontFamilies.body, fontSize: 14, lineHeight: 20, fontWeight: '400' },
  caption: { fontFamily: fontFamilies.bodyMedium, fontSize: 12, lineHeight: 16, fontWeight: '500' },
  technical: { fontFamily: fontFamilies.mono, fontSize: 13, lineHeight: 18, fontWeight: '400' },
} as const satisfies Record<string, TextStyleToken>;

export type TypographyVariant = keyof typeof typography;

export const components = {
  buttonPrimaryHeight: 48,
  buttonSecondaryHeight: 44,
  inputHeight: 52,
  searchHeight: 48,
  cardRadius: radii.lg,
  buttonRadius: radii.md,
  inputRadius: radii.md,
  searchRadius: 14,
  sheetRadius: radii.xl,
  avatar: { sm: 32, md: 40, lg: 56, xl: 80 },
  icon: { sm: 20, md: 24 },
  feedGutter: spacing.lg,
  minTapTarget: 48,
} as const;

export const motion = {
  buttonPress: 120,
  modalEnter: 220,
  tabChange: 180,
  likePulse: 200,
  publishSuccess: 250,
} as const;

export const copy = {
  tagline: 'Connect freely. Create boldly.',
  secondary: 'Social first. Ownership when you want it.',
  onboarding: 'Welcome to your new social space.',
  walletEmpty: 'Connect a wallet to view your assets.',
  published: 'Your post is live.',
  pendingTx: 'Waiting for network confirmation.',
  privacy: 'Choose what you share.',
  publishFailed: "We couldn't publish your post. Try again.",
} as const;

// WCAG 2.x relative luminance contrast ratio between two #RRGGBB colors.
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
