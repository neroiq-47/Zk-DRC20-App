import { useMemo } from 'react';
import { Linking } from 'react-native';
import { router } from 'expo-router';
import { Text, type TextProps } from '@/components/ui';
import { parseRichText } from './richText';

export function openHashtag(tag: string) {
  router.push({ pathname: '/explore', params: { q: `#${tag}` } });
}

export function openProfile(handle: string) {
  router.push({ pathname: '/user/[handle]', params: { handle } });
}

/** Post body with tappable #hashtags, @mentions and links in the link color. */
export function RichText({ body, ...rest }: { body: string } & TextProps) {
  const segments = useMemo(() => parseRichText(body), [body]);
  return (
    <Text {...rest}>
      {segments.map((s, i) => {
        switch (s.type) {
          case 'text':
            return s.text;
          case 'hashtag':
            return (
              <Text key={i} color="link" accessibilityRole="link" accessibilityLabel={`Hashtag ${s.tag}`} onPress={() => openHashtag(s.tag)} style={rest.style}>
                {s.text}
              </Text>
            );
          case 'mention':
            return (
              <Text key={i} color="link" accessibilityRole="link" accessibilityLabel={`Profile of ${s.handle}`} onPress={() => openProfile(s.handle)} style={rest.style}>
                {s.text}
              </Text>
            );
          case 'link':
            return (
              <Text key={i} color="link" accessibilityRole="link" onPress={() => Linking.openURL(s.url).catch(() => undefined)} style={rest.style}>
                {s.text}
              </Text>
            );
        }
      })}
    </Text>
  );
}
