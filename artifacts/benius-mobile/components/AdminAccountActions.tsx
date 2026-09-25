import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Modal, Platform, Pressable, ScrollView, StatusBar,
  Text, TextInput, View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_BASE_URL, apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useColors } from '@/hooks/useColors';
import { Button, Field, styles } from '@/components/Foundation';

type Profile = {
  id: number;
  email: string;
  recoveryEmail: string | null;
  recoveryPhone: string | null;
  isInitialized: boolean;
  hasPin: boolean;
  logoUrl: string | null;
  signatureUrl: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pinCode: string | null;
  country: string | null;
  schoolPhone: string | null;
  schoolEmail: string | null;
  schoolWebsite: string | null;
  schoolBoard: string | null;
  schoolType: string | null;
  affiliationNumber: string | null;
  udiseCode: string | null;
  establishedYear: number | null;
  registrationNumber: string | null;
  pan: string | null;
  gstin: string | null;
};
type AuditEntry = {
  id: number;
  action: string;
  success: boolean;
  ipAddress: string | null;
  createdAt: string;
};
type Tab = 'info' | 'school' | 'password' | 'pin' | 'log';
type EditableProfile = {
  recoveryEmail: string;
  recoveryPhone: string;
  logoUrl: string | null;
  signatureUrl: string | null;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  pinCode: string;
  country: string;
  schoolPhone: string;
  schoolEmail: string;
  schoolWebsite: string;
  schoolBoard: string;
  schoolType: string;
  affiliationNumber: string;
  udiseCode: string;
  establishedYear: string;
  registrationNumber: string;
  pan: string;
  gstin: string;
};

const profileQueryKey = (schoolId?: number, role?: string, id?: number) =>
  ['mobile/admin/profile', schoolId, role, id];
const schoolFields: Array<[keyof EditableProfile, string]> = [
  ['addressLine1', 'Address line 1'],
  ['addressLine2', 'Address line 2'],
  ['city', 'City'],
  ['state', 'State'],
  ['pinCode', 'PIN code'],
  ['country', 'Country'],
  ['schoolPhone', 'School phone'],
  ['schoolEmail', 'School email'],
  ['schoolWebsite', 'Website'],
  ['schoolBoard', 'Board'],
  ['schoolType', 'School type'],
  ['affiliationNumber', 'Affiliation number'],
  ['udiseCode', 'UDISE code'],
  ['establishedYear', 'Established year'],
  ['registrationNumber', 'Registration number'],
  ['pan', 'PAN'],
  ['gstin', 'GSTIN'],
];

function emptyEditableProfile(): EditableProfile {
  return {
    recoveryEmail: '',
    recoveryPhone: '',
    logoUrl: null,
    signatureUrl: null,
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    pinCode: '',
    country: 'India',
    schoolPhone: '',
    schoolEmail: '',
    schoolWebsite: '',
    schoolBoard: '',
    schoolType: '',
    affiliationNumber: '',
    udiseCode: '',
    establishedYear: '',
    registrationNumber: '',
    pan: '',
    gstin: '',
  };
}

function profileValues(profile: Profile): EditableProfile {
  return {
    recoveryEmail: profile.recoveryEmail ?? '',
    recoveryPhone: profile.recoveryPhone ?? '',
    logoUrl: profile.logoUrl,
    signatureUrl: profile.signatureUrl,
    addressLine1: profile.addressLine1 ?? '',
    addressLine2: profile.addressLine2 ?? '',
    city: profile.city ?? '',
    state: profile.state ?? '',
    pinCode: profile.pinCode ?? '',
    country: profile.country ?? 'India',
    schoolPhone: profile.schoolPhone ?? '',
    schoolEmail: profile.schoolEmail ?? '',
    schoolWebsite: profile.schoolWebsite ?? '',
    schoolBoard: profile.schoolBoard ?? '',
    schoolType: profile.schoolType ?? '',
    affiliationNumber: profile.affiliationNumber ?? '',
    udiseCode: profile.udiseCode ?? '',
    establishedYear: profile.establishedYear == null ? '' : String(profile.establishedYear),
    registrationNumber: profile.registrationNumber ?? '',
    pan: profile.pan ?? '',
    gstin: profile.gstin ?? '',
  };
}

function imageUrl(value: string | null): string | null {
  if (!value) return null;
  const root = API_BASE_URL.replace(/\/api\/?$/, '');
  return value.startsWith('https://') || value.startsWith('http://') ? value : `${root}${value}`;
}

function fileExtension(asset: ImagePicker.ImagePickerAsset): string {
  const candidate = asset.fileName?.split('.').pop()?.toLowerCase();
  if (candidate && ['jpg', 'jpeg', 'png', 'webp'].includes(candidate)) return candidate;
  return asset.mimeType === 'image/png' ? 'png' : asset.mimeType === 'image/webp' ? 'webp' : 'jpg';
}

export default function AdminAccountActions({
  visible,
  close,
  displayName,
  schoolName,
  schoolCode,
}: {
  visible: boolean;
  close: () => void;
  displayName: string;
  schoolName: string;
  schoolCode: string | null;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user, clearAfterPasswordChange } = useAuth();
  const [tab, setTab] = useState<Tab>('info');
  const [form, setForm] = useState<EditableProfile>(emptyEditableProfile);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);

  const profileQuery = useQuery({
    queryKey: profileQueryKey(user?.schoolId, user?.role, user?.id),
    queryFn: ({ signal }) => apiGet<Profile>('/mobile/admin/profile', { signal }),
    enabled: visible && user?.role === 'admin',
    staleTime: 60_000,
  });
  const logQuery = useQuery({
    queryKey: ['mobile/admin/security-log', user?.schoolId, user?.id],
    queryFn: ({ signal }) => apiGet<AuditEntry[]>('/mobile/auth/admin/security-log', { signal }),
    enabled: visible && tab === 'log' && user?.role === 'admin',
    staleTime: 30_000,
  });

  useEffect(() => {
    if (profileQuery.data) setForm(profileValues(profileQuery.data));
  }, [profileQuery.data]);

  function setValue(key: keyof EditableProfile, value: string) {
    setForm(previous => ({ ...previous, [key]: value }));
  }

  function reportError(title: string, error: unknown) {
    Alert.alert(title, error instanceof Error ? error.message : 'Please try again.');
  }

  async function saveProfile() {
    if (busy) return;
    if (!form.recoveryEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.recoveryEmail.trim())) {
      return Alert.alert('Invalid recovery email', 'Enter a valid recovery email address.');
    }
    if (form.recoveryPhone && !/^\d{10}$/.test(form.recoveryPhone)) {
      return Alert.alert('Invalid phone number', 'Recovery phone must contain exactly 10 digits.');
    }
    setBusy(true);
    try {
      await apiPost('/mobile/auth/admin/profile/update', {
        recoveryEmail: form.recoveryEmail.trim(),
        recoveryPhone: form.recoveryPhone,
      });
      await queryClient.invalidateQueries({ queryKey: profileQueryKey(user?.schoolId, user?.role, user?.id) });
      Alert.alert('Profile updated', 'Your recovery information has been saved.');
    } catch (error) { reportError('Unable to update profile', error); }
    finally { setBusy(false); }
  }

  async function saveSchool() {
    if (busy) return;
    const year = form.establishedYear.trim();
    if (!form.addressLine1.trim() || !form.city.trim() || !form.state.trim()) {
      return Alert.alert('Required information', 'Address line 1, city and state are required.');
    }
    if (!/^[1-9]\d{5}$/.test(form.pinCode)) return Alert.alert('Invalid PIN code', 'Enter a valid 6-digit PIN code.');
    if (!/^[\d\s+\-()/]{7,20}$/.test(form.schoolPhone)) return Alert.alert('Invalid phone', 'Enter a valid school phone number.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.schoolEmail)) return Alert.alert('Invalid email', 'Enter a valid school email address.');
    if (form.schoolWebsite && !/^https?:\/\/.+\..+/.test(form.schoolWebsite)) {
      return Alert.alert('Invalid website', 'Enter a complete website URL.');
    }
    if (form.udiseCode && !/^\d{11}$/.test(form.udiseCode)) return Alert.alert('Invalid UDISE code', 'UDISE code must have exactly 11 digits.');
    if (year && (!/^\d{4}$/.test(year) || Number(year) < 1800 || Number(year) > new Date().getFullYear())) {
      return Alert.alert('Invalid year', `Enter a year between 1800 and ${new Date().getFullYear()}.`);
    }
    setBusy(true);
    try {
      await apiPost('/mobile/auth/admin/school/info', {
        addressLine1: form.addressLine1,
        addressLine2: form.addressLine2,
        city: form.city,
        state: form.state,
        pinCode: form.pinCode,
        country: form.country,
        schoolPhone: form.schoolPhone,
        schoolEmail: form.schoolEmail,
        schoolWebsite: form.schoolWebsite,
        schoolBoard: form.schoolBoard,
        schoolType: form.schoolType,
        affiliationNumber: form.affiliationNumber,
        udiseCode: form.udiseCode,
        establishedYear: year,
        registrationNumber: form.registrationNumber,
        pan: form.pan,
        gstin: form.gstin,
      });
      await queryClient.invalidateQueries({ queryKey: profileQueryKey(user?.schoolId, user?.role, user?.id) });
      Alert.alert('School information updated', 'Your changes have been saved.');
    } catch (error) { reportError('Unable to update school information', error); }
    finally { setBusy(false); }
  }

  async function changePassword() {
    if (busy) return;
    if (newPassword.length < 6) return Alert.alert('Password too short', 'Password must be at least 6 characters.');
    if (newPassword !== confirmPassword) return Alert.alert('Passwords do not match', 'Enter matching new passwords.');
    setBusy(true);
    try {
      await apiPost('/mobile/auth/admin/change-password', { currentPassword, newPassword, confirmPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      Alert.alert('Password changed', 'Sign in again with your new password.', [{
        text: 'Continue',
        onPress: () => { close(); void clearAfterPasswordChange(); },
      }]);
    } catch (error) { reportError('Unable to change password', error); }
    finally { setBusy(false); }
  }

  async function changePin() {
    if (busy) return;
    if (!/^\d{6}$/.test(currentPin) || !/^\d{6}$/.test(newPin)) {
      return Alert.alert('Invalid PIN', 'Current and new PINs must each contain 6 digits.');
    }
    if (newPin !== confirmPin) return Alert.alert('PINs do not match', 'Enter matching new PINs.');
    setBusy(true);
    try {
      await apiPost('/mobile/auth/admin/change-pin', { currentPin, newPin, confirmPin });
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      Alert.alert('PIN changed', 'Your administrator PIN has been updated.');
    } catch (error) { reportError('Unable to change PIN', error); }
    finally { setBusy(false); }
  }

  async function uploadImage(kind: 'logo' | 'signature') {
    if (busy) return;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Photo access required', 'Allow photo-library access to choose an image.');
        return;
      }
      const selection = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: kind === 'logo',
        ...(kind === 'logo' ? { aspect: [1, 1] as [number, number] } : {}),
        quality: 0.9,
      });
      if (selection.canceled || !selection.assets[0]) return;
      const asset = selection.assets[0];
      const maxSize = kind === 'logo' ? 5 * 1024 * 1024 : 2 * 1024 * 1024;
      if (asset.fileSize != null && asset.fileSize > maxSize) {
        Alert.alert('File too large', `Maximum allowed size is ${kind === 'logo' ? '5 MB' : '2 MB'}.`);
        return;
      }
      if (asset.mimeType && !['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(asset.mimeType.toLowerCase())) {
        Alert.alert('Unsupported format', 'Choose a JPG, PNG, or WebP image.');
        return;
      }
      setBusy(true);
      const extension = fileExtension(asset);
      const body = new FormData();
      body.append('file', {
        uri: asset.uri,
        name: `${kind}.${extension}`,
        type: asset.mimeType || (extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg'),
      } as any);
      const path = kind === 'logo' ? '/mobile/auth/admin/school/logo' : '/mobile/auth/admin/profile/signature';
      await apiPost(path, body);
      await queryClient.invalidateQueries({ queryKey: profileQueryKey(user?.schoolId, user?.role, user?.id) });
      Alert.alert(kind === 'logo' ? 'Logo updated' : 'Signature saved', 'Your image has been saved.');
    } catch (error) { reportError('Upload failed', error); }
    finally { setBusy(false); }
  }

  function confirmRemove(kind: 'logo' | 'signature') {
    Alert.alert(`Remove ${kind}?`, `The saved school ${kind} will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { void removeImage(kind); } },
    ]);
  }

  async function removeImage(kind: 'logo' | 'signature') {
    if (busy) return;
    setBusy(true);
    try {
      const path = kind === 'logo'
        ? '/mobile/auth/admin/school/logo/remove'
        : '/mobile/auth/admin/profile/signature/remove';
      await apiPost(path, {});
      await queryClient.invalidateQueries({ queryKey: profileQueryKey(user?.schoolId, user?.role, user?.id) });
      Alert.alert(kind === 'logo' ? 'Logo removed' : 'Signature removed', 'The saved image has been removed.');
    } catch (error) { reportError('Unable to remove image', error); }
    finally { setBusy(false); }
  }

  const tabs: Array<{ key: Tab; label: string; icon: React.ComponentProps<typeof Feather>['name'] }> = [
    { key: 'info', label: 'Profile', icon: 'user' },
    { key: 'school', label: 'School', icon: 'home' },
    { key: 'password', label: 'Password', icon: 'lock' },
    { key: 'pin', label: 'PIN', icon: 'key' },
    { key: 'log', label: 'Log', icon: 'activity' },
  ];
  const inputStyle = {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    color: colors.foreground,
    backgroundColor: colors.card,
    borderColor: colors.input,
    fontSize: 15,
  } as const;

  return <Modal visible={visible} onRequestClose={close} animationType="slide" presentationStyle="fullScreen">
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: Platform.OS === 'web' ? Math.max(insets.top, 24) : insets.top }}>
      <StatusBar barStyle={colors.foreground === '#eff0f1' ? 'light-content' : 'dark-content'} />
      <View style={{
        paddingHorizontal: 18, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: colors.border,
        flexDirection: 'row', alignItems: 'center', gap: 12,
      }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="user" size={20} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: '700' }}>{displayName}</Text>
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 3 }}>{schoolName}{schoolCode ? ` · ${schoolCode}` : ''}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close account settings" onPress={close} hitSlop={10}>
          <Feather name="x" size={22} color={colors.foreground} />
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{
        paddingHorizontal: 14, paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border,
      }}>
        {tabs.map(item => <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: tab === item.key }}
          onPress={() => setTab(item.key)} style={{
            flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20,
            paddingHorizontal: 12, paddingVertical: 9,
            backgroundColor: tab === item.key ? colors.primary : colors.card,
          }}>
          <Feather name={item.icon} size={14} color={tab === item.key ? colors.primaryForeground : colors.mutedForeground} />
          <Text style={{ color: tab === item.key ? colors.primaryForeground : colors.mutedForeground, fontSize: 12, fontWeight: '600' }}>{item.label}</Text>
        </Pressable>)}
      </ScrollView>

      {profileQuery.isLoading ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <ActivityIndicator color={colors.primary} />
        <Text style={{ color: colors.mutedForeground }}>Loading administrator account…</Text>
      </View> : profileQuery.isError ? <View style={{ padding: 24 }}>
        <Text style={{ color: colors.destructive, textAlign: 'center' }}>Unable to load the administrator profile.</Text>
        <Button label="Retry" onPress={() => { void profileQuery.refetch(); }} />
      </View> : <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 18, paddingBottom: Math.max(insets.bottom, 24) + 24, gap: 14 }}
      >
        {tab === 'info' && <>
          <Text style={[styles.title, { color: colors.foreground }]}>Recovery details</Text>
          <Text style={{ color: colors.mutedForeground, lineHeight: 21 }}>Keep your recovery email and phone current so your account can be secured if access is lost.</Text>
          <Field label="Recovery email" value={form.recoveryEmail} onChangeText={value => setValue('recoveryEmail', value)} keyboardType="email-address" />
          <Field label="Recovery phone (10 digits)" value={form.recoveryPhone} onChangeText={value => setValue('recoveryPhone', value.replace(/\D/g, '').slice(0, 10))} keyboardType="phone-pad" />
          <Text style={{ color: colors.mutedForeground }}>Account email: {profileQuery.data?.email}</Text>
          <Text style={{ color: colors.mutedForeground }}>PIN protection: {profileQuery.data?.hasPin ? 'Enabled' : 'Not configured'}</Text>
          <Button label={busy ? 'Saving…' : 'Save profile'} icon="save" disabled={busy} onPress={() => { void saveProfile(); }} />
          <View style={{ gap: 10, marginTop: 8 }}>
            <Text style={{ color: colors.foreground, fontWeight: '700' }}>School logo</Text>
            {form.logoUrl && <Image accessibilityLabel="School logo" source={{ uri: imageUrl(form.logoUrl) ?? undefined }} resizeMode="contain" style={{ width: 120, height: 100, borderRadius: 8, backgroundColor: colors.card }} />}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Button label="Upload logo" icon="image" disabled={busy} onPress={() => { void uploadImage('logo'); }} /></View>
              {!!form.logoUrl && <View style={{ flex: 1 }}><Button label="Remove logo" secondary icon="trash-2" disabled={busy} onPress={() => confirmRemove('logo')} /></View>}
            </View>
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>JPG, PNG or WebP · maximum 5 MB</Text>
          </View>
          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 6 }} />
          <View style={{ gap: 10 }}>
            <Text style={{ color: colors.foreground, fontWeight: '700' }}>Digital signature</Text>
            {form.signatureUrl && <Image accessibilityLabel="Digital signature" source={{ uri: imageUrl(form.signatureUrl) ?? undefined }} resizeMode="contain" style={{ width: 180, height: 90, borderRadius: 8, backgroundColor: colors.card }} />}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Button label="Upload signature" icon="edit-3" disabled={busy} onPress={() => { void uploadImage('signature'); }} /></View>
              {!!form.signatureUrl && <View style={{ flex: 1 }}><Button label="Remove signature" secondary icon="trash-2" disabled={busy} onPress={() => confirmRemove('signature')} /></View>}
            </View>
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>JPG, PNG or WebP · maximum 2 MB</Text>
          </View>
        </>}

        {tab === 'school' && <>
          <Text style={[styles.title, { color: colors.foreground }]}>School information</Text>
          <Text style={{ color: colors.mutedForeground, lineHeight: 21 }}>Contact, location, academic identity and legal details for your school.</Text>
          {schoolFields.map(([key, label]) => <View key={key} style={{ gap: 6 }}>
            <Text style={{ color: colors.foreground, fontSize: 14 }}>{label}</Text>
            <TextInput
              accessibilityLabel={label}
              value={String(form[key] ?? '')}
              onChangeText={value => setValue(key, value)}
              keyboardType={key === 'schoolEmail' ? 'email-address' : key === 'schoolPhone' || key === 'pinCode' || key === 'udiseCode' ? 'phone-pad' : 'default'}
              autoCapitalize={key === 'schoolEmail' || key === 'schoolWebsite' ? 'none' : 'sentences'}
              style={inputStyle}
              placeholderTextColor={colors.mutedForeground}
              placeholder={label}
            />
          </View>)}
          <Button label={busy ? 'Saving…' : 'Save school information'} icon="save" disabled={busy} onPress={() => { void saveSchool(); }} />
        </>}

        {tab === 'password' && <>
          <Text style={[styles.title, { color: colors.foreground }]}>Change password</Text>
          <Text style={{ color: colors.mutedForeground, lineHeight: 21 }}>Confirm your current password, then choose a new password of at least 6 characters.</Text>
          <Field label="Current password" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry />
          <Field label="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
          <Field label="Confirm new password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry />
          <Button label={busy ? 'Updating…' : 'Change password'} icon="lock" disabled={busy} onPress={() => { void changePassword(); }} />
        </>}

        {tab === 'pin' && <>
          <Text style={[styles.title, { color: colors.foreground }]}>Change administrator PIN</Text>
          <Text style={{ color: colors.mutedForeground, lineHeight: 21 }}>Your PIN must contain exactly 6 digits.</Text>
          <Field label="Current 6-digit PIN" value={currentPin} onChangeText={value => setCurrentPin(value.replace(/\D/g, '').slice(0, 6))} secureTextEntry keyboardType="number-pad" />
          <Field label="New 6-digit PIN" value={newPin} onChangeText={value => setNewPin(value.replace(/\D/g, '').slice(0, 6))} secureTextEntry keyboardType="number-pad" />
          <Field label="Confirm new PIN" value={confirmPin} onChangeText={value => setConfirmPin(value.replace(/\D/g, '').slice(0, 6))} secureTextEntry keyboardType="number-pad" />
          <Button label={busy ? 'Updating…' : 'Change PIN'} icon="key" disabled={busy} onPress={() => { void changePin(); }} />
        </>}

        {tab === 'log' && <>
          <Text style={[styles.title, { color: colors.foreground }]}>Security activity</Text>
          <Text style={{ color: colors.mutedForeground, lineHeight: 21 }}>The latest 20 security events for this administrator account.</Text>
          {logQuery.isLoading ? <ActivityIndicator color={colors.primary} />
            : logQuery.isError ? <Text style={{ color: colors.destructive }}>Unable to load the security log.</Text>
              : (logQuery.data ?? []).length === 0 ? <Text style={{ color: colors.mutedForeground }}>No security events were found.</Text>
                : logQuery.data?.map(entry => <View key={entry.id} style={{
                  borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 14,
                  backgroundColor: colors.card, gap: 6,
                }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Feather name={entry.success ? 'check-circle' : 'alert-circle'} size={16} color={entry.success ? colors.primary : colors.destructive} />
                    <Text style={{ color: colors.foreground, fontWeight: '600', flex: 1 }}>{entry.action.replace(/_/g, ' ')}</Text>
                  </View>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{new Date(entry.createdAt).toLocaleString()}</Text>
                  {entry.ipAddress && <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>IP: {entry.ipAddress}</Text>}
                </View>)}
        </>}
      </ScrollView>}
    </View>
  </Modal>;
}