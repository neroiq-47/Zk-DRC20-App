import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEvent } from 'expo';
import { Ionicons } from '@expo/vector-icons';
import type { MediaItem } from '@zoko/contracts';
import { brand } from '@zoko/tokens';
import { useTheme } from '@/theme';

const GAP = 2;

function clampRatio(w: number | null, h: number | null, fallback = 16 / 9): number {
  if (!w || !h) return fallback;
  return Math.min(2, Math.max(0.8, w / h)); // between 4:5 portrait and 2:1 landscape
}

export function VideoPlayerView({ item, aspectRatio }: { item: MediaItem; aspectRatio: number }) {
  const t = useTheme();
  const player = useVideoPlayer(item.url, (p) => {
    p.muted = true;
    p.loop = true;
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { muted } = useEvent(player, 'mutedChange', { muted: player.muted });
  return (
    <View style={{ width: '100%', aspectRatio, backgroundColor: brand.navy }}>
      <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls={false} accessibilityLabel={item.alt_text ?? 'Video'} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? 'Pause video' : 'Play video'}
        onPress={() => (isPlaying ? player.pause() : player.play())}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}
      >
        {!isPlaying ? (
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: t.colors.overlay, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="play" size={28} color={t.colors.onPrimary} />
          </View>
        ) : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={muted ? 'Unmute video' : 'Mute video'}
        onPress={() => {
          player.muted = !player.muted;
        }}
        hitSlop={8}
        style={{
          position: 'absolute',
          right: 8,
          bottom: 8,
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: t.colors.overlay,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={18} color={t.colors.onPrimary} />
      </Pressable>
    </View>
  );
}

function Tile({ item, style, onPress }: { item: MediaItem; style: object; onPress?: () => void }) {
  const t = useTheme();
  if (item.kind === 'video') {
    return (
      <View style={[{ overflow: 'hidden' }, style]}>
        <VideoPlayerView item={item} aspectRatio={1} />
      </View>
    );
  }
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="image" accessibilityLabel={item.alt_text || 'Image'} style={style}>
      <Image
        source={{ uri: item.url }}
        placeholder={item.thumbnail_url ? { uri: item.thumbnail_url } : undefined}
        style={{ flex: 1, backgroundColor: t.colors.border }}
        contentFit="cover"
        transition={150}
        accessibilityIgnoresInvertColors
      />
    </Pressable>
  );
}

/** 1–4 item media grid. A single item keeps its aspect ratio (clamped); 2–4 use a fixed 16:9 frame. */
export function PostMedia({ media, onPressItem }: { media: MediaItem[]; onPressItem?: (index: number) => void }) {
  const t = useTheme();
  const items = media.slice(0, 4);
  if (items.length === 0) return null;
  const frame = { borderRadius: t.radii.md, overflow: 'hidden' as const, borderWidth: 1, borderColor: t.colors.border };
  const press = (i: number) => (onPressItem ? () => onPressItem(i) : undefined);

  if (items.length === 1) {
    const m = items[0];
    const ratio = clampRatio(m.width, m.height, m.kind === 'video' ? 16 / 9 : 4 / 3);
    return (
      <View style={frame}>
        {m.kind === 'video' ? <VideoPlayerView item={m} aspectRatio={ratio} /> : <Tile item={m} style={{ width: '100%', aspectRatio: ratio }} onPress={press(0)} />}
      </View>
    );
  }

  const cell = { flex: 1 };
  return (
    <View style={[frame, { aspectRatio: 16 / 9, flexDirection: 'row', gap: GAP }]}>
      {items.length === 2 ? (
        <>
          <Tile item={items[0]} style={cell} onPress={press(0)} />
          <Tile item={items[1]} style={cell} onPress={press(1)} />
        </>
      ) : items.length === 3 ? (
        <>
          <Tile item={items[0]} style={cell} onPress={press(0)} />
          <View style={{ flex: 1, gap: GAP }}>
            <Tile item={items[1]} style={cell} onPress={press(1)} />
            <Tile item={items[2]} style={cell} onPress={press(2)} />
          </View>
        </>
      ) : (
        <>
          <View style={{ flex: 1, gap: GAP }}>
            <Tile item={items[0]} style={cell} onPress={press(0)} />
            <Tile item={items[2]} style={cell} onPress={press(2)} />
          </View>
          <View style={{ flex: 1, gap: GAP }}>
            <Tile item={items[1]} style={cell} onPress={press(1)} />
            <Tile item={items[3]} style={cell} onPress={press(3)} />
          </View>
        </>
      )}
    </View>
  );
}
