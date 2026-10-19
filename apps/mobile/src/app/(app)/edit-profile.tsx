import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import type { UpdateMeRequest } from '@zoko/contracts';
import { useTheme } from '@/theme';
import { Avatar, Button, ErrorState, LoadingState, Text, TextField } from '@/components/ui';
import { BottomSheet, SheetOption } from '@/components/BottomSheet';
import { ToastHost, showToast } from '@/components/Toast';
import { ApiError } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { toDraft, uploadDraft } from '@/features/compose/media';
import { useUpdateMe } from '@/features/profile/hooks';

type ImageSlot = 'avatar' | 'cover';
interface PickedImage {
  uri: string;
  mediaId?: string;
  uploading: boolean;
}

export default function EditProfile() {
  const t = useTheme();
  const me = useMe();
  const update = useUpdateMe();
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState<PickedImage | null | undefined>(undefined); // undefined = unchanged, null = removed
  const [cover, setCover] = useState<PickedImage | null | undefined>(undefined);
  const [sheet, setSheet] = useState<ImageSlot | null>(null);

  useEffect(() => {
    if (me.data) {
      setDisplayName(me.data.display_name);
      setBio(me.data.bio ?? '');
    }
  }, [me.data]);

  if (me.isPending) return <LoadingState />;
  if (me.isError || !me.data) return <ErrorState onRetry={() => me.refetch()} />;
  const profile = me.data;

  const setSlot = (slot: ImageSlot, v: PickedImage | null | undefined) => (slot === 'avatar' ? setAvatar(v) : setCover(v));

  const pick = async (slot: ImageSlot) => {
    setSheet(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photo access is off', 'Allow photo library access in Settings to change your profile images.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: slot === 'avatar' ? [1, 1] : [3, 1],
      quality: 0.85,
    });
    if (res.canceled || !res.assets[0]) return;
    const draft = await toDraft(res.assets[0]);
    if ('rejected' in draft) return showToast(draft.rejected, 'error');
    setSlot(slot, { uri: draft.uri, uploading: true });
    try {
      const id = await uploadDraft({ ...draft, alt: slot === 'avatar' ? `${profile.display_name}'s avatar` : `${profile.display_name}'s cover image` }, () => undefined);
      setSlot(slot, { uri: draft.uri, mediaId: id, uploading: false });
    } catch {
      setSlot(slot, undefined);
      showToast("We couldn't upload that image. Try again.", 'error');
    }
  };

  const uploading = !!avatar?.uploading || !!cover?.uploading;
  const nameError = displayName.trim().length === 0 ? 'Add a display name.' : displayName.trim().length > 80 ? 'Use 80 characters or fewer.' : null;
  const bioError = bio.length > 500 ? 'Use 500 characters or fewer.' : null;
  const serverFields = update.error instanceof ApiError ? (update.error.problem?.errors ?? {}) : {};

  const save = () => {
    if (nameError || bioError || uploading) return;
    const body: UpdateMeRequest = {};
    if (displayName.trim() !== profile.display_name) body.display_name = displayName.trim();
    const nextBio = bio.trim() ? bio.trim() : null;
    if (nextBio !== profile.bio) body.bio = nextBio;
    if (avatar !== undefined) body.avatar_media_id = avatar?.mediaId ?? null;
    if (cover !== undefined) body.cover_media_id = cover?.mediaId ?? null;
    if (Object.keys(body).length === 0) return router.back();
    update.mutate(body, {
      onSuccess: () => {
        showToast('Profile updated.', 'success');
        router.back();
      },
      onError: (e) => {
        if (!(e instanceof ApiError && e.problem?.errors)) showToast("We couldn't save your profile. Try again.", 'error');
      },
    });
  };

  const avatarUri = avatar === undefined ? profile.avatar_url : avatar?.uri ?? null;
  const coverUri = cover === undefined ? profile.cover_url : cover?.uri ?? null;

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <Stack.Screen
        options={{
          title: 'Edit profile',
          headerRight: () => <Button title="Save" size="sm" onPress={save} loading={update.isPending} disabled={!!nameError || !!bioError || uploading} />,
        }}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: t.spacing.xxxl }}>
          <Pressable onPress={() => setSheet('cover')} accessibilityRole="button" accessibilityLabel="Change cover image" style={{ height: 140, backgroundColor: t.colors.surfaceElevated }}>
            {coverUri ? <Image source={{ uri: coverUri }} style={{ flex: 1 }} contentFit="cover" /> : null}
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.colors.overlay, alignItems: 'center', justifyContent: 'center' }}>
                {cover?.uploading ? <ActivityIndicator color={t.colors.onPrimary} /> : <Ionicons name="camera" size={22} color={t.colors.onPrimary} />}
              </View>
            </View>
          </Pressable>
          <View style={{ paddingHorizontal: t.components.feedGutter, marginTop: -40 }}>
            <Pressable onPress={() => setSheet('avatar')} accessibilityRole="button" accessibilityLabel="Change profile photo" style={{ alignSelf: 'flex-start', borderRadius: 44, borderWidth: 4, borderColor: t.colors.background }}>
              <Avatar uri={avatarUri} name={displayName || profile.display_name} size="xl" />
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.overlay }}>
                {avatar?.uploading ? <ActivityIndicator color={t.colors.onPrimary} /> : <Ionicons name="camera" size={22} color={t.colors.onPrimary} />}
              </View>
            </Pressable>
          </View>
          <View style={{ padding: t.components.feedGutter, gap: t.spacing.lg }}>
            <TextField label="Display name" value={displayName} onChangeText={setDisplayName} maxLength={80} error={serverFields.display_name ?? nameError} autoComplete="name" />
            <TextField
              label="Bio"
              value={bio}
              onChangeText={setBio}
              multiline
              maxLength={500}
              error={serverFields.bio ?? bioError}
              hint={`${bio.length}/500`}
              placeholder="Tell people a little about yourself"
            />
            <Text variant="small" color="textSecondary">
              Your handle is @{profile.handle}.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <BottomSheet visible={!!sheet} onClose={() => setSheet(null)} title={sheet === 'cover' ? 'Cover image' : 'Profile photo'}>
        <SheetOption label="Choose from library" icon={<Ionicons name="images-outline" size={22} color={t.colors.textPrimary} />} onPress={() => sheet && pick(sheet)} />
        {(sheet === 'avatar' ? avatarUri : coverUri) ? (
          <SheetOption
            label="Remove"
            destructive
            icon={<Ionicons name="trash-outline" size={22} color={t.colors.danger} />}
            onPress={() => {
              if (sheet) setSlot(sheet, null);
              setSheet(null);
            }}
          />
        ) : null}
      </BottomSheet>
      <ToastHost />
    </View>
  );
}
