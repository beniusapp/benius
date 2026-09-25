import React, { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { apiPost } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { TeacherAvatar, TeacherHeader, teacherColors as c, teacherKey, useTeacherMe } from '@/components/TeacherDashboard';

const icons = ['check-circle', 'user', 'mail', 'phone', 'briefcase', 'book-open', 'award', 'user', 'calendar', 'calendar', 'award', 'credit-card', 'map-pin'] as const;
const names = ['Teacher ID (DTID)', 'Full Name', 'Email', 'Phone', 'Designation', 'Subject', 'Assigned Classes', 'Gender', 'Date of Birth', 'Joining Date', 'Qualification', 'Government ID', 'Address'];
export default function TeacherProfile() {
  const { user, clearAfterPasswordChange } = useAuth();
  const { online } = useNetwork();
  const queryClient = useQueryClient();
  const router = useRouter();
  const me = useTeacherMe();
  const [menu, setMenu] = useState(false);
  const [security, setSecurity] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  if (!user || user.role !== 'teacher') return <View style={p.page}><Text style={p.error}>Teacher access is required.</Text><Pressable onPress={() => router.replace('/')} style={p.button}><Text style={p.buttonText}>Back to home</Text></Pressable></View>;
  if (me.isPending) return <View style={p.page}><View style={{ padding: 16, gap: 10 }}><View style={[p.skeleton, { height: 60 }]} /><View style={[p.skeleton, { height: 280 }]} />{[0, 1, 2, 3].map(i => <View key={i} style={[p.skeleton, { height: 62 }]} />)}</View></View>;
  if (me.isError || !me.data) return <View style={[p.page, p.center]}><Feather name="wifi-off" size={28} color={c.teal} /><Text style={p.error}>Profile unavailable</Text><Text style={p.subtle}>{online ? me.error?.message : 'You are offline. Reconnect and try again.'}</Text><Pressable testID="teacher-profile-retry" onPress={() => { void me.refetch(); }} style={p.button}><Text style={p.buttonText}>Try again</Text></Pressable><Pressable onPress={() => router.replace('/')} style={p.button}><Text style={p.buttonText}>Back to dashboard</Text></Pressable></View>;
  const t = me.data;
  const classes = t.mappings.length ? t.mappings.map(m => `${m.className}${m.section}`).join(', ') : `${t.assignedClass || ''}${t.assignedSection || ''}`;
  const subjects = Array.from(new Set(t.mappings.map(m => m.subject).filter(Boolean))).join(', ') || t.subject;
  const values = [t.digitalTeacherId, t.fullName, t.email, t.phone, t.designation, subjects, classes, t.gender, t.dateOfBirth, t.joiningDate, t.qualifications, t.govtIdType && t.govtIdNumber ? `${t.govtIdType}: ${t.govtIdNumber}` : t.govtIdNumber, t.address];
  const reset = () => { setSecurity(false); setCurrent(''); setNext(''); setConfirm(''); setVisible(false); setFeedback(''); };
  const changePassword = async () => {
    if (!current || !next || !confirm) { setFeedback('All fields are required.'); return; }
    if (next.length < 6) { setFeedback('New password must be at least 6 characters.'); return; }
    if (next !== confirm) { setFeedback('Passwords do not match.'); return; }
    if (!online) { setFeedback('Reconnect to change your password.'); return; }
    setBusy(true); setFeedback('');
    try {
      await apiPost<{ message: string }>('/mobile/teacher/change-password', { currentPassword: current, newPassword: next });
      reset();
      // The server invalidates all sessions after success. Do not call logout with an invalid token.
      await clearAfterPasswordChange();
      router.replace('/');
      Alert.alert('Password changed', 'Please sign in again with your new password.');
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Could not update password. Your session remains active.'); }
    finally { setBusy(false); }
  };
  const changePhoto = async () => {
    if (!online) { setFeedback('Reconnect before updating your photo.'); return; }
    setFeedback('');
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) { setFeedback('Photo access was denied. Allow photo access in device settings to choose an image.'); return; }
      const selection = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      if (selection.canceled || !selection.assets[0]) return;
      const asset = selection.assets[0];
      const filename = asset.fileName || asset.uri.split('/').pop()?.split('?')[0] || 'profile.jpg';
      const ext = filename.split('.').pop()?.toLowerCase();
      const mime = asset.mimeType?.toLowerCase() || (ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) { setFeedback('Choose a JPG, PNG or WebP image.'); return; }
      if (asset.fileSize == null) { setFeedback('This photo has no file size information. Choose another image.'); return; }
      if (asset.fileSize > 1024 * 1024) { setFeedback('File too large. Maximum size is 1 MB. Choose a smaller image.'); return; }
      const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
      const file = { uri: asset.uri, name: `profile.${extension}`, type: mime };
      const form = new FormData();
      form.append('file', file as unknown as Blob);
      setBusy(true);
      const result = await apiPost<{ profileImageUrl: string }>('/mobile/teacher/profile-photo', form);
      if (!result.profileImageUrl) throw new Error('Photo was saved but the response was incomplete. Refresh to check your profile.');
      queryClient.setQueryData(teacherKey(user), { ...t, profileImageUrl: result.profileImageUrl });
      setFeedback('Profile photo updated.');
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Could not upload photo. Please retry.'); }
    finally { setBusy(false); }
  };
  return <View style={p.page}>
    <TeacherHeader teacher={t} back />
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 28, paddingBottom: 44 }}>
      <View style={p.card}>
        <Pressable testID="teacher-profile-menu" accessibilityLabel="Options menu" onPress={() => setMenu(!menu)} style={p.menuButton}><Feather name="more-vertical" size={20} color={c.faint} /></Pressable>
        {menu && <View style={p.menu}><Pressable testID="teacher-security-option" onPress={() => { setMenu(false); setSecurity(true); setFeedback(''); }} style={p.menuItem}><Feather name="lock" size={16} color={c.teal} /><Text style={{ color: c.white, fontSize: 13 }}>Security & Credentials</Text></Pressable></View>}
        <View style={p.identity}>
          <Pressable disabled={busy} accessibilityLabel="Change photo" onPress={() => { void changePhoto(); }}><TeacherAvatar teacher={t} size={96} /></Pressable>
          <Pressable testID="teacher-change-photo" disabled={busy} onPress={() => { void changePhoto(); }} style={p.photoButton}><Feather name="camera" size={12} color={c.teal} /><Text style={{ color: c.teal, fontSize: 12, fontWeight: '600' }}>{busy ? 'Please wait…' : 'Change Photo'}</Text></Pressable>
          <Text style={{ color: c.faint, fontSize: 10, marginTop: 4 }}>Max size: <Text style={{ color: c.amber }}>1MB</Text></Text>
          <Text style={p.name}>{t.fullName}</Text>
          <Text style={p.school}>{t.schoolName} · {t.schoolCode}</Text>
        </View>
        {!!feedback && <Text accessibilityRole="alert" style={p.feedback}>{feedback}</Text>}
        <View style={{ paddingHorizontal: 20, paddingBottom: 24, gap: 8 }}>
          {names.map((label, i) => <View key={label} style={p.field}><Feather name={icons[i]} size={16} color={c.teal} /><View style={{ flex: 1 }}><Text style={p.fieldLabel}>{label.toUpperCase()}</Text><Text style={p.fieldValue}>{values[i] || '—'}</Text></View></View>)}
        </View>
      </View>
    </ScrollView>
    <Modal transparent visible={security} animationType="fade" onRequestClose={() => !busy && reset()}>
      <View style={p.overlay}><View style={p.dialog}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Feather name="shield" size={18} color={c.teal} /><Text style={[p.fieldValue, { fontWeight: '700', flex: 1 }]}>Update Password</Text><Pressable onPress={reset} disabled={busy} accessibilityLabel="Close"><Feather name="x" size={20} color={c.faint} /></Pressable></View>
        <Text style={[p.subtle, { marginTop: 6, marginBottom: 17 }]}>Enter your current password to confirm identity</Text>
        {[['Current Password', current, setCurrent], ['New Password (min 6 chars)', next, setNext], ['Confirm New Password', confirm, setConfirm]].map(([label, value, setter]) => <View key={label as string} style={{ marginBottom: 13 }}><Text style={p.fieldLabel}>{label as string}</Text><TextInput testID={`teacher-${(label as string).split(' ')[0].toLowerCase()}-password`} value={value as string} onChangeText={setter as (text: string) => void} secureTextEntry={!visible} editable={!busy} placeholder={label as string} placeholderTextColor={c.faint} style={p.input} /></View>)}
        <Pressable onPress={() => setVisible(!visible)} style={{ alignSelf: 'flex-end', marginBottom: 12 }}><Text style={{ color: c.teal }}>{visible ? 'Hide passwords' : 'Show passwords'}</Text></Pressable>
        {!!feedback && <Text accessibilityRole="alert" style={[p.feedback, { marginBottom: 12 }]}>{feedback}</Text>}
        <View style={{ flexDirection: 'row', gap: 10 }}><Pressable disabled={busy} onPress={reset} style={[p.button, { flex: 1, backgroundColor: c.surface }]}><Text style={p.buttonText}>Cancel</Text></Pressable><Pressable testID="teacher-change-password" disabled={busy} onPress={() => { void changePassword(); }} style={[p.button, { flex: 1 }]}><Text style={p.buttonText}>{busy ? 'Updating…' : 'Update Security'}</Text></Pressable></View>
      </View></View>
    </Modal>
  </View>;
}
const p = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.bg }, center: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { borderRadius: 16, borderWidth: 1, borderColor: '#354052', backgroundColor: '#182639' },
  menuButton: { position: 'absolute', right: 12, top: 12, zIndex: 3, padding: 10 },
  menu: { position: 'absolute', zIndex: 4, top: 52, right: 12, backgroundColor: '#122033', borderWidth: 1, borderColor: c.edge, borderRadius: 12, elevation: 10 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  identity: { alignItems: 'center', paddingTop: 28, paddingHorizontal: 20, paddingBottom: 26 },
  photoButton: { borderWidth: 1, borderColor: '#256655', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  name: { color: c.white, fontSize: 20, fontWeight: '700', marginTop: 17, textAlign: 'center' },
  school: { color: '#79c9aa', fontSize: 14, marginTop: 6, textAlign: 'center' },
  field: { minHeight: 60, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#364153', backgroundColor: '#233144', flexDirection: 'row', alignItems: 'center', gap: 12 },
  fieldLabel: { color: c.faint, fontSize: 10, letterSpacing: 0.4, marginBottom: 2 },
  fieldValue: { color: c.white, fontSize: 14, fontWeight: '500' },
  skeleton: { borderRadius: 12, backgroundColor: '#253147' }, error: { color: c.white, fontSize: 19, fontWeight: '700', marginTop: 12 },
  subtle: { color: c.faint, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 8 },
  button: { backgroundColor: '#169f86', borderRadius: 10, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, marginTop: 10 },
  buttonText: { color: c.white, fontSize: 13, fontWeight: '700' }, feedback: { color: c.amber, fontSize: 12, textAlign: 'center', marginHorizontal: 20, marginBottom: 12 },
  overlay: { flex: 1, backgroundColor: '#050a12bb', justifyContent: 'center', padding: 20 },
  dialog: { backgroundColor: '#152236', borderColor: c.edge, borderWidth: 1, borderRadius: 18, padding: 20 },
  input: { color: c.white, backgroundColor: '#253144', borderColor: c.edge, borderWidth: 1, borderRadius: 9, height: 44, paddingHorizontal: 12, marginTop: 5 },
});