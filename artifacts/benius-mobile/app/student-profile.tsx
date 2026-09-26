import React, { useCallback, useEffect, useState } from 'react';
import { Alert, BackHandler, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useAuth } from '@/contexts/AuthContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { apiGet, apiPost } from '@/lib/api';
import { formatSchoolProfileDate } from '@/lib/date';
import { resolveStudentPhotoUrl } from '@/lib/student-dashboard-pure.mjs';
import { profileForm, profilePhotoPart } from '@/lib/student-profile-pure.mjs';

// Student Profile intentionally follows the responsive web destination, not the dashboard tile styling.
const C = {
  canvas: '#f8fafc', white: '#ffffff', ink: '#1e293b', text: '#334155', muted: '#94a3b8',
  label: '#64748b', border: '#f1f5f9', line: '#e2e8f0', green: '#10b981', greenDark: '#047857',
  greenPale: '#ecfdf5', greenBorder: '#a7f3d0', blue: '#3b82f6', indigo: '#6366f1',
  bluePale: '#dbeafe', amber: '#a16207', amberPale: '#fefce8', amberBorder: '#fef08a',
  red: '#dc2626', redPale: '#fef2f2', redBorder: '#fecaca',
};
const HAND = 'OpenSans_400Regular';
type Profile = {
  id: number; studentId: number; schoolId: number; status: 'draft' | 'pending' | 'approved' | 'rejected';
  fullName: string | null; class: string | null; section: string | null; rollNo: string | null;
  fatherName: string | null; motherName: string | null; presentAddress: string | null;
  aadharNumber: string | null; gender: string | null; phone: string | null; dob: string | null;
  enrollmentDate: string | null; guardianName: string | null; bloodGroup: string | null;
  email: string | null; photoUrl: string | null; photoStatus: 'none' | 'pending' | 'approved';
  rejectionNote: string | null; submittedAt: string | null; verifiedAt: string | null;
};
type Student = {
  id: number; name: string; digitalStudentId: string; class: string; section: string;
  phone: string; dob: string; photoUrl: string | null; enrollmentDate: string | null;
  gender: string | null; rollNumber: number | null; guardianName: string | null;
  bloodGroup: string | null; fatherName: string | null; motherName: string | null;
  address: string | null; aadharNumber: string | null; email: string | null;
  schoolName: string; schoolCode: string; schoolId?: number;
};
type Snapshot = { fullName: string | null; fatherName: string | null; motherName: string | null;
  class: string | null; section: string | null; rollNo: string | null; presentAddress: string | null;
  photoUrl: string | null; approvedAt: string | null };
type Data = { student: Student | null; profile: Profile | null; approvedSnapshot: Snapshot | null;
  liveData: { name: string; class: string; section: string; digitalStudentId: string; photoUrl: string | null;
    enrollmentDate: string | null; verifiedProfile: unknown } | null;
  verificationLimit: { used: number; remaining: number; allowed: number } };
type Form = Pick<Profile, 'fullName' | 'rollNo' | 'fatherName' | 'motherName' | 'presentAddress' |
  'aadharNumber' | 'gender' | 'phone' | 'dob' | 'enrollmentDate' | 'guardianName' | 'bloodGroup' | 'email'>;
type FormValues = { [K in keyof Form]: string };

function Info({ label, value, full, mono }: { label: string; value?: string | null; full?: boolean; mono?: boolean }) {
  return <View style={[s.info, full && s.full]}>
    <Text style={s.infoLabel}>{label.toUpperCase()}</Text>
    <Text style={[s.infoValue, mono && s.mono]}>{value || '—'}</Text>
  </View>;
}
function Notice({ icon, title, detail, tone = 'plain', retry }: {
  icon: React.ComponentProps<typeof Feather>['name']; title: string; detail?: string; tone?: 'plain' | 'green' | 'amber' | 'red'; retry?: () => void;
}) {
  const color = tone === 'green' ? C.greenDark : tone === 'amber' ? C.amber : tone === 'red' ? C.red : C.muted;
  return <View accessibilityRole="alert" style={[s.notice, tone === 'green' && s.greenNotice, tone === 'amber' && s.amberNotice, tone === 'red' && s.redNotice]}>
    <Feather name={icon} size={16} color={color} style={{ marginTop: 1 }} />
    <View style={{ flex: 1 }}><Text style={[s.noticeTitle, { color }]}>{title}</Text>{detail ? <Text style={[s.noticeDetail, { color }]}>{detail}</Text> : null}
      {retry && <Pressable accessibilityRole="button" onPress={retry} style={s.retry}><Text style={{ color: C.blue, fontWeight: '700', fontFamily: HAND }}>Try again</Text></Pressable>}
    </View>
  </View>;
}
function Action({ label, onPress, disabled, secondary = false, testID }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean; testID?: string }) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled}
    onPress={onPress} style={[s.action, secondary && s.secondaryAction, disabled && s.disabled]}>
    <Text style={[s.actionText, secondary && { color: C.text }]}>{label}</Text>
  </Pressable>;
}
function Field({ label, value, onChange, placeholder, secure, keyboardType, multiline, reveal }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; secure?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'numeric'; multiline?: boolean; reveal?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return <View style={s.field}><Text style={s.fieldLabel}>{label}</Text>
    <View style={s.inputRow}><TextInput style={[s.input, multiline && { minHeight: 86, textAlignVertical: 'top', paddingTop: 10 }]}
      value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={C.muted}
      secureTextEntry={secure && !visible} keyboardType={keyboardType} autoCapitalize={secure || keyboardType === 'email-address' ? 'none' : 'sentences'}
      multiline={multiline} accessibilityLabel={label} />
      {reveal && <Pressable accessibilityRole="button" accessibilityLabel={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} onPress={() => setVisible(!visible)} style={s.eye}>
        <Feather name={visible ? 'eye-off' : 'eye'} color={C.label} size={18} />
      </Pressable>}
    </View>
  </View>;
}

export default function StudentProfileScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user, loading, clearAfterPasswordChange } = useAuth();
  const { online } = useNetwork();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'read' | 'edit' | 'security'>('read');
  const [menuOpen, setMenuOpen] = useState(false);
  const [form, setForm] = useState<FormValues | null>(null);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [feedback, setFeedback] = useState('');
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  useEffect(() => { if (!loading && user?.role !== 'student' && !passwordChanged) router.replace('/'); }, [loading, user?.role, passwordChanged, router]);
  const cancel = useCallback(() => { setMenuOpen(false); setMode('read'); setForm(null); setPw({ currentPassword: '', newPassword: '', confirmPassword: '' }); setFeedback(''); }, []);
  useFocusEffect(useCallback(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (passwordChanged) return false;
      if (menuOpen) { setMenuOpen(false); return true; }
      if (mode !== 'read') { cancel(); return true; }
      return false;
    });
    return () => back.remove();
  }, [menuOpen, mode, cancel, passwordChanged]));
  useEffect(() => navigation.addListener('beforeRemove', event => {
    if (passwordChanged) return;
    if (menuOpen || mode !== 'read') {
      event.preventDefault();
      if (menuOpen) setMenuOpen(false);
      else cancel();
    }
  }), [navigation, menuOpen, mode, cancel, passwordChanged]);
  const key = ['mobile/student/profile', user?.schoolId, user?.id, user?.role];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => apiGet<Data>('/mobile/student/profile', { signal }),
    enabled: !loading && user?.role === 'student' && online,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const data = query.data?.student && query.data.student.id === user?.id
    && (query.data.student.schoolId === undefined || query.data.student.schoolId === user?.schoolId)
    ? query.data : undefined;
  const student = data?.student;
  const profile = data?.profile ?? null;
  const limit = data?.verificationLimit;
  const locked = limit ? limit.remaining <= 0 : true;
  const busy = useMutation({
    mutationFn: async (input: { kind: 'approval'; values: FormValues } | { kind: 'photo'; body: FormData }) => {
      if (input.kind === 'approval') {
        const { gender, bloodGroup, ...values } = input.values;
        const saved = await apiPost<Profile>('/mobile/student/profile', {
          ...values, ...(gender ? { gender } : {}), ...(bloodGroup ? { bloodGroup } : {}),
        });
        queryClient.setQueryData<Data>(key, old => old ? { ...old, profile: saved } : old);
        try { return await apiPost<Profile>('/mobile/student/profile/submit', {}); }
        catch (error) {
          void queryClient.invalidateQueries({ queryKey: key });
          throw new Error(`Details saved, but submission failed: ${error instanceof Error ? error.message : 'Please try again.'}`);
        }
      }
      return apiPost<Profile>('/mobile/student/profile/photo', input.body);
    },
    onSuccess: (next, input) => {
      queryClient.setQueryData<Data>(key, old => old ? { ...old, profile: next } : old);
      if (input.kind === 'approval') {
        setForm(null); setMode('read'); setFeedback('Submitted for verification.');
      } else setFeedback('Photo uploaded. Awaiting teacher approval.');
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: error => setFeedback(error instanceof Error ? error.message : 'Request failed. Please try again.'),
  });
  const passwordMutation = useMutation({
    mutationFn: () => apiPost<{ message: string }>('/mobile/student/profile/change-password',
      { currentPassword: pw.currentPassword, newPassword: pw.newPassword }),
    onSuccess: async () => {
      // A successful password hash change invalidates credentials. Never call logout with rejected tokens.
      setPasswordChanged(true);
      setPw({ currentPassword: '', newPassword: '', confirmPassword: '' });
      try { await clearAfterPasswordChange(); }
      catch { setFeedback('Password changed. Close the app and sign in again.'); }
    },
    onError: error => setFeedback(error instanceof Error ? error.message : 'Password change failed. Try again.'),
  });
  const goHome = () => router.replace('/');
  const startEdit = () => { if (!student || !online || busy.isPending || locked || profile?.status === 'pending') return;
    setForm(profileForm(student, profile)); setFeedback(''); setMenuOpen(false); setMode('edit'); };
  const update = (keyName: keyof FormValues) => (value: string) => setForm(previous => previous ? { ...previous, [keyName]: value } : previous);
  const photo = async () => {
    if (busy.isPending || !online) return;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Photo access needed', permission.canAskAgain ? 'Allow photo access to select a profile picture.' : 'Enable photo access in device settings to select a profile picture.');
        return;
      }
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: .85 });
      if (picked.canceled || !picked.assets[0]) return;
      const asset = picked.assets[0];
      if (asset.fileSize === undefined) { setFeedback('Could not verify photo size. Choose another photo smaller than 1 MB.'); return; }
      if (asset.fileSize > 1024 * 1024) { setFeedback('Image too large. Please choose a photo smaller than 1 MB.'); return; }
      const part = profilePhotoPart(asset);
      if (!part) { setFeedback('Unsupported photo format. Choose a JPEG, PNG or WebP image.'); return; }
      const fd = new FormData();
      // React Native FormData accepts file descriptors; the transport must not set a JSON Content-Type.
      fd.append('photo', part as unknown as Blob);
      setFeedback('');
      busy.mutate({ kind: 'photo', body: fd });
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Unable to select a photo.'); }
  };
  const changePassword = () => {
    if (!pw.currentPassword) { setFeedback('Enter your current password.'); return; }
    if (pw.newPassword !== pw.confirmPassword) { setFeedback('Passwords do not match.'); return; }
    if (!pw.newPassword) { setFeedback('Enter a new password.'); return; }
    setFeedback(''); passwordMutation.mutate();
  };
  if (passwordChanged) return <View style={[s.root, { paddingTop: insets.top + 70, paddingHorizontal: 20 }]}>
    <Notice icon="check-circle" title="Password changed" detail="Your previous session is no longer valid. Sign in again with your new password." tone="green" />
    {!!feedback && <Notice icon="alert-circle" title={feedback} tone="red" />}
    <Action label="Go to sign in" onPress={goHome} />
  </View>;
  if (loading || !user || user.role !== 'student') return <View style={s.root} />;
  const photoUri = resolveStudentPhotoUrl(profile?.photoUrl || student?.photoUrl, process.env.EXPO_PUBLIC_DOMAIN);
  const photoStatus = profile?.photoStatus || 'none';
  const status = profile?.status || 'draft';
  const Header = <View style={[s.header, { paddingTop: (Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top) + 8 }]}>
    <Pressable testID="button-back" accessibilityRole="button" accessibilityLabel={mode === 'read' ? 'Back to Home' : 'Cancel'} onPress={mode === 'read' ? goHome : cancel} style={s.headerButton}>
      <Feather name={mode === 'read' ? 'arrow-left' : 'x'} size={20} color={C.label} />
      {mode !== 'read' && <Text style={s.cancelText}>Cancel</Text>}
    </Pressable>
    <LinearGradient colors={[C.blue, C.indigo]} style={s.brand}><MaterialCommunityIcons name="school-outline" size={17} color={C.white} /></LinearGradient>
    <View style={{ flex: 1 }}><Text style={s.headerTitle}>{mode === 'edit' ? 'Verification Details' : mode === 'security' ? 'Security' : 'My Profile'}</Text>
      <Text numberOfLines={1} style={s.headerSubtitle}>{student?.schoolName || user.schoolName}</Text></View>
    {mode === 'read' && <Pressable testID="button-menu" accessibilityRole="button" accessibilityLabel="Profile options" accessibilityState={{ expanded: menuOpen }}
      onPress={() => setMenuOpen(!menuOpen)} style={s.headerButton}><Feather name="more-vertical" size={20} color={C.label} /></Pressable>}
  </View>;
  const content = <View style={[s.content, { paddingBottom: (Platform.OS === 'web' ? Math.max(insets.bottom, 34) : insets.bottom) + 28 }]}>
    {!online && <Notice icon="wifi-off" title="You're offline" detail="Connect to load or update your profile." tone="red" retry={() => { if (online) void query.refetch(); }} />}
    {!!feedback && <Notice icon={feedback.toLowerCase().includes('failed') || feedback.toLowerCase().includes('too large') ? 'alert-circle' : 'info'} title={feedback}
      tone={busy.isError || passwordMutation.isError ? 'red' : 'green'} />}
    {!online && !data ? <Notice icon="wifi-off" title="Profile unavailable offline" detail="Connect to the internet, then try again." tone="red" />
    : query.isPending && !query.data ? <View accessibilityLabel="Loading student profile" testID="student-profile-loading" style={s.card}>
      <View style={[s.skeleton, { width: 160, height: 16 }]} /><View style={[s.skeleton, { width: 80, height: 80, borderRadius: 40, marginTop: 24 }]} />
      {[190, 275, 235, 255].map((width, index) => <View key={index} style={[s.skeleton, { width, height: 15, marginTop: 20 }]} />)}
      <Text style={s.loadingText}>Loading your profile…</Text>
    </View> : query.isError && !data ? <Notice icon="alert-circle" title="Could not load your profile"
      detail={query.error instanceof Error ? query.error.message : 'Please try again.'} tone="red" retry={() => { void query.refetch(); }} />
    : !student ? <Notice icon="user" title="Profile unavailable" detail="Your student information is not available yet." retry={() => { void query.refetch(); }} />
    : <>
      {mode === 'read' && <>
        <Notice icon={status === 'approved' ? 'check-circle' : status === 'pending' ? 'clock' : status === 'rejected' ? 'x-circle' : 'alert-circle'}
          title={status === 'approved' ? 'Profile Verified' : status === 'pending' ? 'Awaiting Teacher Verification' : status === 'rejected' ? 'Rejected — Please resubmit' : 'Draft — Submit for verification to get approved'}
          detail={status === 'rejected' ? profile?.rejectionNote || undefined : status === 'approved' ? formatSchoolProfileDate(profile?.verifiedAt) : status === 'pending' ? formatSchoolProfileDate(profile?.submittedAt) : undefined}
          tone={status === 'approved' ? 'green' : status === 'pending' ? 'amber' : status === 'rejected' ? 'red' : 'plain'} />
        <View style={s.card}>
          <View style={s.identity}>
            <View style={s.avatarWrap}><View style={[s.avatar, { borderColor: photoStatus === 'approved' ? C.green : photoStatus === 'pending' ? C.amberBorder : C.line }]}>
              {photoUri && failedPhoto !== photoUri ? <Image source={{ uri: photoUri }} style={s.avatarImage} onError={() => setFailedPhoto(photoUri)} /> :
                <Text style={s.initials}>{student.name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()}</Text>}
            </View>{photoStatus !== 'none' && <View style={[s.photoBadge, { backgroundColor: photoStatus === 'approved' ? C.green : C.amberBorder }]}>
              <Feather name={photoStatus === 'approved' ? 'check' : 'clock'} size={13} color={C.white} /></View>}</View>
            <View style={{ flex: 1 }}><Text numberOfLines={2} style={s.name}>{profile?.fullName || student.name}</Text>
              <Text style={s.classText}>Class {student.class} – {student.section}</Text>
              <Text style={s.dsid}>{student.digitalStudentId}</Text></View>
          </View>
          <View style={s.infoGrid}>
            <Info label="Full Name" value={profile?.fullName || student.name} full />
            <Info label="Class" value={student.class} /><Info label="Section" value={student.section} />
            <Info label="Gender" value={student.gender} /><Info label="Roll Number" value={student.rollNumber == null ? null : String(student.rollNumber)} />
            <Info label="Guardian Name" value={student.guardianName} /><Info label="Phone" value={student.phone} mono />
            <Info label="Email" value={student.email} /><Info label="Date of Birth" value={formatSchoolProfileDate(student.dob)} />
            <Info label="Date of Admission" value={formatSchoolProfileDate(student.enrollmentDate)} /><Info label="Blood Group" value={student.bloodGroup} />
            <Info label="Father's Name" value={profile?.fatherName || student.fatherName} /><Info label="Mother's Name" value={profile?.motherName || student.motherName} />
            <Info label="Aadhaar Number" value={profile?.aadharNumber || student.aadharNumber} mono />
            <Info label="Address" value={profile?.presentAddress || student.address} full />
            <Info label="DSID" value={student.digitalStudentId} mono /><Info label="School" value={student.schoolCode} mono />
          </View>
        </View>
        {photoStatus === 'pending' && <Notice icon="camera" title="Your photo is pending teacher review and not yet visible on ID cards." tone="amber" />}
        {data?.approvedSnapshot && status !== 'approved' && <View style={s.snapshot}>
          <Text style={s.snapshotTitle}>LAST VERIFIED DATA  {formatSchoolProfileDate(data.approvedSnapshot.approvedAt)}</Text>
          {!!data.approvedSnapshot.fullName && <Text style={s.snapshotLine}>Full Name:  {data.approvedSnapshot.fullName}</Text>}
          {!!data.approvedSnapshot.fatherName && <Text style={s.snapshotLine}>Father:  {data.approvedSnapshot.fatherName}</Text>}
        </View>}
        <Notice icon="more-vertical" title="Tap the menu above to submit for verification or change your password." />
      </>}
      {mode === 'edit' && form && <>
        <Notice icon={locked ? 'lock' : 'file-text'}
          title={locked ? `Monthly limit (${limit?.allowed ?? 3}) reached. Please contact Admin.` : `${limit?.remaining} of ${limit?.allowed} submission attempts remaining this month.`}
          tone={locked ? 'red' : limit?.remaining === 1 ? 'amber' : 'green'} />
        <View style={[s.card, s.photoEdit]}>
          <View style={[s.avatar, { width: 96, height: 96, borderColor: C.greenBorder }]}>
            {photoUri && failedPhoto !== photoUri ? <Image source={{ uri: photoUri }} style={s.avatarImage} onError={() => setFailedPhoto(photoUri)} /> :
              <Text style={s.initials}>{student.name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()}</Text>}
          </View>
          {photoStatus === 'pending' && <Text style={s.pendingPhoto}>Photo pending teacher review</Text>}
          <Pressable testID="button-upload-photo" accessibilityRole="button" disabled={busy.isPending || !online} onPress={() => { void photo(); }} style={s.upload}>
            <Feather name="camera" size={15} color={C.green} /><Text style={{ color: C.green, fontSize: 12, fontFamily: HAND }}>{photoStatus === 'pending' ? 'Replace Photo' : 'Upload Photo'}</Text>
          </Pressable><Text style={s.caption}>Max size: 1 MB · Crop square before upload</Text>
        </View>
        <View style={s.card}>
          <View style={s.cardTitle}><Feather name="user" color={C.green} size={16} /><Text style={s.cardHeading}>Verification Details</Text>
            {status === 'pending' && <Text style={s.reviewPill}>Under Review</Text>}</View>
          <View style={s.formBody}>
            <Field label="Full Name" value={form.fullName} onChange={update('fullName')} placeholder="Full name as in certificate" />
            <View style={s.readOnlyRow}><Info label="Class (System-assigned)" value={`Class ${student.class}`} /><Info label="Section (System-assigned)" value={`Section ${student.section}`} /></View>
            <Text style={s.fieldLabel}>Gender</Text><View style={s.choices}>{['Not set', 'Boy', 'Girl'].map(item =>
              <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: form.gender === (item === 'Not set' ? '' : item) }}
                onPress={() => update('gender')(item === 'Not set' ? '' : item)} style={[s.choice, form.gender === (item === 'Not set' ? '' : item) && s.choiceActive]}>
                <Text style={{ fontFamily: HAND, color: form.gender === (item === 'Not set' ? '' : item) ? C.greenDark : C.label }}>{item}</Text></Pressable>)}</View>
            <Field label="Roll Number" value={form.rollNo} onChange={update('rollNo')} placeholder="e.g. 01" />
            <Field label="Guardian Name" value={form.guardianName} onChange={update('guardianName')} placeholder="Guardian's full name" />
            <Field label="Phone" value={form.phone} onChange={update('phone')} keyboardType="phone-pad" placeholder="10-digit mobile number" />
            <Field label="Email" value={form.email} onChange={update('email')} keyboardType="email-address" />
            <Field label="Date of Birth" value={form.dob} onChange={update('dob')} placeholder="YYYY-MM-DD" />
            <Field label="Date of Admission" value={form.enrollmentDate} onChange={update('enrollmentDate')} placeholder="YYYY-MM-DD" />
            <Text style={s.fieldLabel}>Blood Group</Text><View style={s.choices}>{['Not set', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(item =>
              <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: form.bloodGroup === (item === 'Not set' ? '' : item) }}
                onPress={() => update('bloodGroup')(item === 'Not set' ? '' : item)} style={[s.choice, form.bloodGroup === (item === 'Not set' ? '' : item) && s.choiceActive]}>
                <Text style={{ fontFamily: HAND, color: form.bloodGroup === (item === 'Not set' ? '' : item) ? C.greenDark : C.label }}>{item}</Text></Pressable>)}</View>
            <Field label="Father's Name" value={form.fatherName} onChange={update('fatherName')} placeholder="Father's full name" />
            <Field label="Mother's Name" value={form.motherName} onChange={update('motherName')} placeholder="Mother's full name" />
            <Field label="Aadhaar Number" value={form.aadharNumber} onChange={update('aadharNumber')} keyboardType="numeric" placeholder="12-digit Aadhaar number" />
            <Field label="Present Address" value={form.presentAddress} onChange={update('presentAddress')} multiline placeholder="Full residential address" />
          </View>
        </View>
        <View style={s.system}><Text style={s.infoLabel}>SYSTEM-ASSIGNED (READ-ONLY)</Text>
          <Text style={s.systemText}>DSID: {student.digitalStudentId}</Text><Text style={s.systemText}>School: {student.schoolCode}</Text>
          <Text style={s.systemText}>Enrolled: {formatSchoolProfileDate(student.enrollmentDate)}</Text></View>
        <Action label="Cancel" secondary onPress={cancel} />
        <Action testID="button-submit" label={status === 'pending' ? 'Awaiting Review' : locked ? 'Monthly limit reached' : busy.isPending ? 'Submitting…' : 'Submit for Approval'}
          disabled={!online || busy.isPending || locked || status === 'pending'}
          onPress={() => { setFeedback(''); busy.mutate({ kind: 'approval', values: form }); }} />
      </>}
      {mode === 'security' && <View style={s.card}>
        <View style={s.cardTitle}><Feather name="shield" size={19} color={C.blue} /><Text style={s.cardHeading}>Change Password</Text></View>
        <View style={s.formBody}>
          <Field label="Current Password" value={pw.currentPassword} onChange={value => setPw(old => ({ ...old, currentPassword: value }))}
            secure reveal placeholder="Enter current password" />
          <Field label="New Password" value={pw.newPassword} onChange={value => setPw(old => ({ ...old, newPassword: value }))}
            secure reveal placeholder="Enter new password" />
          <Field label="Confirm New Password" value={pw.confirmPassword} onChange={value => setPw(old => ({ ...old, confirmPassword: value }))}
            secure reveal placeholder="Confirm new password" />
          <Text style={s.caption}>Changing your password will end this mobile session. Sign in again with your new password.</Text>
          <Action label="Cancel" secondary onPress={cancel} />
          <Action testID="button-change-password" label={passwordMutation.isPending ? 'Changing…' : 'Change Password'}
            disabled={!online || passwordMutation.isPending} onPress={changePassword} />
        </View>
      </View>}
    </>}
  </View>;
  return <View testID="student-profile" style={s.root}>
    {Header}
    {menuOpen && mode === 'read' && <View style={[s.menu, { top: (Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top) + 62 }]}>
      <Pressable testID="menu-submit-verification" accessibilityRole="button" accessibilityState={{ disabled: !online || locked || status === 'pending' }}
        onPress={startEdit} disabled={!online || locked || status === 'pending'} style={[s.menuItem, (!online || locked || status === 'pending') && s.disabled]}>
        <View style={[s.menuIcon, { backgroundColor: C.greenPale }]}><Feather name="file-text" size={17} color={C.green} /></View>
        <View style={{ flex: 1 }}><Text style={s.menuTitle}>Submit for Verification</Text><Text style={s.menuSub}>{!online ? 'Connect to continue' : status === 'pending' ? 'Awaiting teacher review' : locked ? 'Limit reached this month' : limit ? `${limit.remaining} of ${limit.allowed} attempts left` : 'Unavailable'}</Text></View>
        <Feather name={locked ? 'lock' : 'chevron-right'} size={16} color={C.muted} /></Pressable>
      <View style={s.menuLine} />
      <Pressable testID="menu-security" accessibilityRole="button" onPress={() => { setMenuOpen(false); setMode('security'); setFeedback(''); }} style={s.menuItem}>
        <View style={[s.menuIcon, { backgroundColor: C.bluePale }]}><Feather name="shield" size={17} color={C.blue} /></View>
        <View style={{ flex: 1 }}><Text style={s.menuTitle}>Security</Text><Text style={s.menuSub}>Change password</Text></View>
        <Feather name="chevron-right" size={16} color={C.muted} /></Pressable>
    </View>}
    {mode === 'read' ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>{content}</ScrollView> :
      <KeyboardAwareScrollViewCompat bottomOffset={48} keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>{content}</KeyboardAwareScrollViewCompat>}
  </View>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.canvas },
  header: { height: undefined, minHeight: 56, paddingBottom: 8, paddingHorizontal: 16, backgroundColor: 'rgba(255,255,255,0.96)', borderBottomWidth: 1, borderBottomColor: C.border, flexDirection: 'row', alignItems: 'center', gap: 10, shadowColor: C.ink, shadowOpacity: .06, shadowRadius: 15, elevation: 2, zIndex: 3 },
  headerButton: { minWidth: 40, height: 40, paddingHorizontal: 9, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: '#f3f4f6', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  cancelText: { fontSize: 13, color: C.label, fontWeight: '600', fontFamily: HAND },
  brand: { width: 32, height: 32, borderRadius: 11, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 14, fontWeight: '700', color: C.ink, fontFamily: HAND }, headerSubtitle: { fontSize: 11, color: C.muted, marginTop: 1, fontFamily: HAND },
  content: { paddingHorizontal: 16, paddingTop: 24, gap: 16, width: '100%', maxWidth: 672, alignSelf: 'center' },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderWidth: 1, borderColor: C.border, borderRadius: 12, backgroundColor: C.canvas, paddingHorizontal: 16, paddingVertical: 12 },
  greenNotice: { backgroundColor: C.greenPale, borderColor: C.greenBorder },
  amberNotice: { backgroundColor: C.amberPale, borderColor: C.amberBorder },
  redNotice: { backgroundColor: C.redPale, borderColor: C.redBorder },
  noticeTitle: { fontSize: 12, fontWeight: '600', lineHeight: 18, fontFamily: HAND }, noticeDetail: { fontSize: 11, marginTop: 3, lineHeight: 17, fontFamily: HAND },
  retry: { paddingVertical: 8, alignSelf: 'flex-start' },
  card: { backgroundColor: C.white, borderRadius: 16, borderWidth: 1, borderColor: C.border, overflow: 'hidden', shadowColor: C.ink, shadowOpacity: .035, shadowRadius: 10, elevation: 1 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 20, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 20 },
  avatarWrap: { width: 80, height: 80 }, avatar: { width: 80, height: 80, borderRadius: 48, borderWidth: 3, backgroundColor: C.greenPale, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' }, initials: { color: C.green, fontSize: 21, fontWeight: '700', fontFamily: HAND },
  photoBadge: { position: 'absolute', bottom: -2, right: -2, width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: C.white, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 18, fontWeight: '700', color: C.ink, fontFamily: HAND }, classText: { fontSize: 14, color: C.greenDark, marginTop: 2, fontFamily: HAND },
  dsid: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), fontSize: 12, color: C.muted, marginTop: 4 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20, paddingBottom: 20, rowGap: 16 },
  info: { width: '50%', paddingRight: 8, gap: 3 }, full: { width: '100%' },
  infoLabel: { color: C.muted, fontSize: 10, letterSpacing: 1.1, fontWeight: '600', fontFamily: HAND },
  infoValue: { color: C.ink, fontSize: 14, fontWeight: '600', lineHeight: 20, fontFamily: HAND },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), letterSpacing: .2 },
  snapshot: { borderRadius: 16, borderWidth: 1, borderColor: C.greenBorder, backgroundColor: C.greenPale, padding: 16, gap: 8 },
  snapshotTitle: { fontSize: 11, fontWeight: '700', color: C.greenDark, letterSpacing: .5, fontFamily: HAND }, snapshotLine: { color: C.greenDark, fontSize: 12, fontFamily: HAND },
  menu: { position: 'absolute', right: 16, width: 258, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.white, zIndex: 10, shadowColor: C.ink, shadowOpacity: .14, shadowRadius: 22, elevation: 9, overflow: 'hidden' },
  menuItem: { paddingHorizontal: 15, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 11 },
  menuIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  menuTitle: { fontSize: 13, fontWeight: '700', color: C.ink, fontFamily: HAND }, menuSub: { fontSize: 10, color: C.label, marginTop: 3, fontFamily: HAND },
  menuLine: { height: 1, backgroundColor: C.border, marginHorizontal: 12 },
  disabled: { opacity: .48 },
  photoEdit: { alignItems: 'center', padding: 20, gap: 10 }, pendingPhoto: { fontSize: 12, color: C.amber, fontFamily: HAND },
  upload: { borderWidth: 1, borderColor: C.greenBorder, paddingHorizontal: 15, paddingVertical: 9, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 7 },
  caption: { color: C.muted, fontSize: 11, lineHeight: 17, textAlign: 'center', fontFamily: HAND },
  cardTitle: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  cardHeading: { color: C.ink, fontWeight: '700', fontSize: 14, flex: 1, fontFamily: HAND },
  reviewPill: { color: C.amber, fontSize: 10, backgroundColor: C.amberPale, padding: 5, borderRadius: 8, fontFamily: HAND },
  formBody: { padding: 20, gap: 15 }, field: { gap: 7 }, fieldLabel: { color: C.label, fontWeight: '600', fontSize: 12, fontFamily: HAND },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.white, borderColor: '#cbd5e1', borderWidth: 1, borderRadius: 12 },
  input: { flex: 1, minHeight: 44, paddingHorizontal: 12, fontSize: 16, color: C.ink, fontFamily: HAND },
  eye: { padding: 12 }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: -8 },
  choice: { paddingHorizontal: 11, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.white },
  choiceActive: { backgroundColor: C.greenPale, borderColor: C.greenBorder },
  readOnlyRow: { flexDirection: 'row', padding: 12, backgroundColor: C.canvas, borderRadius: 10 },
  system: { padding: 16, gap: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.canvas, borderRadius: 12 },
  systemText: { color: C.label, fontSize: 12, fontFamily: HAND },
  action: { backgroundColor: C.green, borderRadius: 12, minHeight: 48, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 },
  secondaryAction: { borderWidth: 1, borderColor: C.line, backgroundColor: C.white },
  actionText: { color: C.white, fontSize: 14, fontWeight: '700', fontFamily: HAND },
  skeleton: { backgroundColor: C.line, borderRadius: 8 }, loadingText: { color: C.label, marginTop: 24, fontSize: 12, fontFamily: HAND },
});