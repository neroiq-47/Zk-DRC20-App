import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import type { CreatePostRequest, Post, PostVisibility } from '@zoko/contracts';
import { copy } from '@zoko/tokens';
import { useTheme } from '@/theme';
import { Avatar, Button, Text, TextField } from '@/components/ui';
import { BottomSheet, SheetOption } from '@/components/BottomSheet';
import { IconButton } from '@/components/IconButton';
import { showToast } from '@/components/Toast';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { AuthorLine, QuotedPost } from '@/features/posts/PostCard';
import { RichText } from '@/features/posts/RichText';
import { updatePostEverywhere } from '@/features/posts/cache';
import { prependToList, usePost } from '@/features/posts/hooks';
import { postKeys } from '@/features/posts/keys';
import { MAX_BODY, MAX_MEDIA, captureWithCamera, pickFromLibrary, toDraft, uploadDraft, type DraftMedia, type UploadStatus } from './media';

export interface ComposerProps {
  replyTo?: string;
  quote?: string;
  /** Shown as a Cancel button in the top bar (modal usage). */
  onCancel?: () => void;
  onPublished: (post: Post) => void;
}

function ReplyTarget({ post }: { post: Post }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: t.spacing.md, paddingBottom: t.spacing.md }}>
      <View style={{ alignItems: 'center' }}>
        <Avatar uri={post.author.avatar_url} name={post.author.display_name} size="md" />
        <View style={{ flex: 1, width: 2, backgroundColor: t.colors.border, marginTop: 4 }} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <AuthorLine post={post} />
        {post.body ? <RichText body={post.body} numberOfLines={6} /> : null}
        {post.media.length ? (
          <Text variant="small" color="textSecondary">
            {post.media.length} {post.media.length === 1 ? 'attachment' : 'attachments'}
          </Text>
        ) : null}
        <Text variant="small" color="textSecondary">
          Replying to <Text variant="small" color="link">@{post.author.handle}</Text>
        </Text>
      </View>
    </View>
  );
}

const STATUS_LABEL: Record<UploadStatus, string> = {
  idle: '',
  uploading: 'Uploading',
  processing: 'Processing',
  done: 'Ready',
  error: 'Failed',
};

function MediaThumb({ item, onRemove, onAlt, busy }: { item: DraftMedia; onRemove: () => void; onAlt: () => void; busy: boolean }) {
  const t = useTheme();
  return (
    <View style={{ width: 120, height: 120, borderRadius: t.radii.md, overflow: 'hidden', backgroundColor: t.colors.border }}>
      <Image source={{ uri: item.uri }} style={{ flex: 1 }} contentFit="cover" accessibilityLabel={item.alt || (item.kind === 'video' ? 'Selected video' : 'Selected photo')} />
      {item.kind === 'video' ? (
        <View style={{ position: 'absolute', left: 6, bottom: 6, backgroundColor: t.colors.overlay, borderRadius: 10, padding: 3 }}>
          <Ionicons name="videocam" size={14} color={t.colors.onPrimary} />
        </View>
      ) : null}
      {item.status === 'uploading' || item.status === 'processing' ? (
        <View
          accessibilityLabel={STATUS_LABEL[item.status]}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: t.colors.overlay, alignItems: 'center', justifyContent: 'center', gap: 4 }}
        >
          <ActivityIndicator color={t.colors.onPrimary} />
          <Text variant="caption" color="onPrimary">
            {STATUS_LABEL[item.status]}
          </Text>
        </View>
      ) : null}
      {item.status === 'done' ? (
        <View accessibilityLabel="Uploaded" style={{ position: 'absolute', left: 6, top: 6, backgroundColor: t.colors.successSurface, borderRadius: 10, padding: 2 }}>
          <Ionicons name="checkmark" size={14} color={t.colors.successText} />
        </View>
      ) : null}
      {item.status === 'error' ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: t.colors.dangerSurface, padding: 4 }}>
          <Text variant="caption" color="danger" numberOfLines={2}>
            {item.error ?? 'Upload failed'}
          </Text>
        </View>
      ) : null}
      {!busy ? (
        <>
          <Pressable
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel="Remove attachment"
            hitSlop={8}
            style={{ position: 'absolute', top: 4, right: 4, width: 28, height: 28, borderRadius: 14, backgroundColor: t.colors.overlay, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="close" size={16} color={t.colors.onPrimary} />
          </Pressable>
          {item.kind === 'image' && item.status !== 'error' ? (
            <Pressable
              onPress={onAlt}
              accessibilityRole="button"
              accessibilityLabel={item.alt ? 'Edit image description' : 'Add image description'}
              hitSlop={6}
              style={{
                position: 'absolute',
                right: 4,
                bottom: 4,
                paddingHorizontal: 6,
                height: 24,
                borderRadius: 6,
                backgroundColor: item.alt ? t.colors.primary : t.colors.overlay,
                justifyContent: 'center',
              }}
            >
              <Text variant="caption" color="onPrimary" style={{ fontFamily: 'Inter_600SemiBold' }}>
                {item.alt ? 'ALT ✓' : '+ALT'}
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

export function Composer({ replyTo, quote, onCancel, onPublished }: ComposerProps) {
  const t = useTheme();
  const qc = useQueryClient();
  const me = useMe().data;
  const target = usePost(replyTo ?? quote);
  const [body, setBody] = useState('');
  const [items, setItems] = useState<DraftMedia[]>([]);
  const [visibility, setVisibility] = useState<PostVisibility | null>(null);
  const [visSheet, setVisSheet] = useState(false);
  const [altFor, setAltFor] = useState<string | null>(null);
  const [altDraft, setAltDraft] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const effectiveVisibility: PostVisibility = visibility ?? me?.settings.default_visibility ?? 'public';
  const remaining = MAX_BODY - [...body].length;
  const hasContent = body.trim().length > 0 || items.length > 0 || !!quote;
  const canPost = hasContent && remaining >= 0 && !publishing && (!replyTo || !!target.data);

  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(id);
  }, [replyTo, quote]);

  const patch = (key: string, p: Partial<DraftMedia>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const addAssets = async (source: 'library' | 'camera') => {
    const room = MAX_MEDIA - items.length;
    if (room <= 0) return showToast('You can add up to 4 photos or videos.', 'info');
    const res = source === 'library' ? await pickFromLibrary(room) : await captureWithCamera();
    if (res === 'denied') {
      Alert.alert(
        source === 'library' ? 'Photo access is off' : 'Camera access is off',
        `Allow ${source === 'library' ? 'photo library' : 'camera'} access in Settings to add media to your post.`,
      );
      return;
    }
    const drafts: DraftMedia[] = [];
    for (const a of res) {
      const d = await toDraft(a);
      if ('rejected' in d) showToast(d.rejected, 'error');
      else drafts.push(d);
    }
    if (drafts.length) setItems((list) => [...list, ...drafts].slice(0, MAX_MEDIA));
  };

  const reset = () => {
    setBody('');
    setItems([]);
    setVisibility(null);
    setFailed(false);
  };

  const publish = async () => {
    if (!canPost) return;
    setPublishing(true);
    setFailed(false);
    try {
      const mediaIds: string[] = [];
      let uploadFailed = false;
      for (const item of itemsRef.current) {
        if (item.status === 'done' && item.mediaId) {
          mediaIds.push(item.mediaId);
          continue;
        }
        try {
          const id = await uploadDraft(item, (s) => patch(item.key, { status: s, error: undefined }));
          patch(item.key, { status: 'done', mediaId: id });
          mediaIds.push(id);
        } catch (e) {
          uploadFailed = true;
          patch(item.key, { status: 'error', error: e instanceof Error && !('status' in e) ? e.message : 'Upload failed' });
        }
      }
      if (uploadFailed) throw new Error('upload');

      const req: CreatePostRequest = { body: body.trim(), visibility: effectiveVisibility };
      if (mediaIds.length) req.media_ids = mediaIds;
      if (replyTo) req.parent_id = replyTo;
      if (quote) req.quote_post_id = quote;
      const post = await api<Post>('/posts', { method: 'POST', body: req, idempotent: true });

      // Update caches so the new post shows immediately, then refresh in the background.
      if (replyTo) {
        updatePostEverywhere(qc, replyTo, (p) => ({ ...p, reply_count: p.reply_count + 1 }));
        qc.invalidateQueries({ queryKey: postKeys.replies(replyTo) });
      } else {
        prependToList(qc, postKeys.feed('following'), post);
      }
      if (quote) updatePostEverywhere(qc, quote, (p) => ({ ...p, repost_count: p.repost_count + 1 }));
      qc.invalidateQueries({ queryKey: ['feed'] });
      if (me) qc.invalidateQueries({ queryKey: ['userPosts', me.handle] });
      qc.invalidateQueries({ queryKey: ['me'] });

      showToast(copy.published, 'success');
      reset();
      onPublished(post);
    } catch {
      setFailed(true);
      showToast(copy.publishFailed, 'error');
    } finally {
      setPublishing(false);
    }
  };

  const title = replyTo ? 'Reply' : quote ? 'Quote post' : 'New post';
  const altItem = items.find((i) => i.key === altFor);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: t.spacing.sm,
          height: 56,
          borderBottomWidth: 1,
          borderBottomColor: t.colors.border,
        }}
      >
        {onCancel ? (
          <Button title="Cancel" variant="ghost" size="sm" onPress={onCancel} disabled={publishing} />
        ) : (
          <View style={{ width: 72 }} />
        )}
        <Text variant="h3" accessibilityRole="header">
          {title}
        </Text>
        <Button title={replyTo ? 'Reply' : 'Post'} size="sm" onPress={publish} loading={publishing} disabled={!canPost} style={{ minWidth: 72, marginRight: t.spacing.sm }} />
      </View>

      {failed ? (
        <View accessibilityLiveRegion="polite" style={{ backgroundColor: t.colors.dangerSurface, paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.md, flexDirection: 'row', gap: t.spacing.sm, alignItems: 'center' }}>
          <Ionicons name="alert-circle" size={18} color={t.colors.danger} />
          <Text variant="small" color="danger" style={{ flex: 1 }}>
            {copy.publishFailed}
          </Text>
        </View>
      ) : null}

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: t.components.feedGutter, gap: t.spacing.md }}>
        {replyTo ? (
          target.isPending ? (
            <ActivityIndicator color={t.colors.primary} />
          ) : target.data ? (
            <ReplyTarget post={target.data} />
          ) : (
            <Text color="danger">We couldn't load the post you're replying to.</Text>
          )
        ) : null}

        <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
          {me ? <Avatar uri={me.avatar_url} name={me.display_name} size="md" /> : null}
          <View style={{ flex: 1, gap: t.spacing.md }}>
            {!replyTo ? (
              <Pressable
                onPress={() => setVisSheet(true)}
                accessibilityRole="button"
                accessibilityLabel={`Visibility: ${effectiveVisibility === 'public' ? 'Everyone' : 'Followers'}. Change`}
                style={{
                  alignSelf: 'flex-start',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  minHeight: 32,
                  paddingHorizontal: t.spacing.md,
                  borderRadius: t.radii.pill,
                  borderWidth: 1,
                  borderColor: t.colors.primary,
                }}
              >
                <Ionicons name={effectiveVisibility === 'public' ? 'earth' : 'people'} size={14} color={t.colors.link} />
                <Text variant="small" color="link" style={{ fontFamily: 'Inter_600SemiBold' }}>
                  {effectiveVisibility === 'public' ? 'Everyone' : 'Followers'}
                </Text>
                <Ionicons name="chevron-down" size={14} color={t.colors.link} />
              </Pressable>
            ) : null}
            <TextInput
              ref={inputRef}
              value={body}
              onChangeText={setBody}
              multiline
              editable={!publishing}
              placeholder={replyTo ? 'Post your reply' : quote ? 'Add a comment' : "What's happening?"}
              placeholderTextColor={t.colors.textSecondary}
              accessibilityLabel="Post text"
              style={[t.typography.body, { fontWeight: undefined, fontSize: 18, lineHeight: 26, color: t.colors.textPrimary, minHeight: 100, textAlignVertical: 'top', padding: 0 }]}
            />
            {items.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.sm }}>
                {items.map((i) => (
                  <MediaThumb
                    key={i.key}
                    item={i}
                    busy={publishing}
                    onRemove={() => setItems((list) => list.filter((x) => x.key !== i.key))}
                    onAlt={() => {
                      setAltDraft(i.alt);
                      setAltFor(i.key);
                    }}
                  />
                ))}
              </ScrollView>
            ) : null}
            {quote ? target.data ? <QuotedPost post={target.data} /> : target.isPending ? <ActivityIndicator color={t.colors.primary} /> : null : null}
          </View>
        </View>
      </ScrollView>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: t.spacing.sm,
          borderTopWidth: 1,
          borderTopColor: t.colors.border,
          backgroundColor: t.colors.background,
          minHeight: 52,
        }}
      >
        <IconButton icon="image-outline" color="link" accessibilityLabel="Add photos or videos" onPress={() => addAssets('library')} disabled={publishing || items.length >= MAX_MEDIA} />
        <IconButton icon="camera-outline" color="link" accessibilityLabel="Take a photo or video" onPress={() => addAssets('camera')} disabled={publishing || items.length >= MAX_MEDIA} />
        <View style={{ flex: 1 }} />
        <Text
          variant="small"
          tabular
          color={remaining < 0 ? 'danger' : remaining <= 20 ? 'goldText' : 'textSecondary'}
          accessibilityLabel={`${remaining} characters left`}
          style={{ marginRight: t.spacing.md }}
        >
          {[...body].length}/{MAX_BODY}
        </Text>
      </View>

      <BottomSheet visible={visSheet} onClose={() => setVisSheet(false)} title="Who can see this?">
        <SheetOption
          label="Everyone"
          selected={effectiveVisibility === 'public'}
          icon={<Ionicons name="earth" size={22} color={t.colors.textPrimary} />}
          onPress={() => {
            setVisibility('public');
            setVisSheet(false);
          }}
        />
        <SheetOption
          label="Followers only"
          selected={effectiveVisibility === 'followers'}
          icon={<Ionicons name="people" size={22} color={t.colors.textPrimary} />}
          onPress={() => {
            setVisibility('followers');
            setVisSheet(false);
          }}
        />
      </BottomSheet>

      <BottomSheet visible={!!altItem} onClose={() => setAltFor(null)} title="Describe this image">
        <View style={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.md, paddingBottom: t.spacing.md }}>
          {altItem ? <Image source={{ uri: altItem.uri }} style={{ height: 160, borderRadius: t.radii.md }} contentFit="contain" /> : null}
          <TextField
            label="Alt text"
            value={altDraft}
            onChangeText={setAltDraft}
            multiline
            multilineHeight={96}
            maxLength={1000}
            hint="Helps people using screen readers understand your image."
            placeholder="A golden retriever catching a frisbee at the beach"
          />
          <Button
            title="Save"
            onPress={() => {
              if (altFor) patch(altFor, { alt: altDraft, status: 'idle', mediaId: undefined });
              setAltFor(null);
            }}
          />
        </View>
      </BottomSheet>
    </KeyboardAvoidingView>
  );
}
