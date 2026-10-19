import { View } from 'react-native';
import { Stack, router } from 'expo-router';
import { useTheme } from '@/theme';
import { ToastHost } from '@/components/Toast';
import { PostList } from '@/features/posts/PostList';
import { useBookmarks } from '@/features/posts/hooks';

export default function Bookmarks() {
  const t = useTheme();
  const list = useBookmarks();
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <Stack.Screen options={{ title: 'Bookmarks' }} />
      <PostList
        query={list}
        empty={{
          icon: 'bookmark-outline',
          title: 'No bookmarks yet',
          body: 'Tap the bookmark on any post to save it here. Only you can see your bookmarks.',
          action: { title: 'Explore posts', onPress: () => router.navigate('/explore') },
        }}
      />
      <ToastHost />
    </View>
  );
}
