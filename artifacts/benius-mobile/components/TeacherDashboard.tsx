import React, { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { API_BASE_URL, apiGet, type MobileUser } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useAcademicSession } from '@/contexts/SessionContext';
import { useNetwork } from '@/contexts/NetworkContext';

export const teacherColors = { bg: '#151d30', surface: '#1c2939', edge: '#354052', white: '#f7f7f8', faint: '#8b96a8', teal: '#27bca7', violet: '#7779f6', coral: '#fb7185', amber: '#fbbf24' };
export type TeacherMe = {
  id: number; userId: number; fullName: string; email: string; phone: string | null;
  subject: string | null; assignedClass: string | null; assignedSection: string | null;
  designation: string | null; gender: string | null; dateOfBirth: string | null;
  joiningDate: string | null; qualifications: string | null; govtIdType: string | null;
  govtIdNumber: string | null; address: string | null; schoolId: number; schoolName: string;
  schoolCode: string; digitalTeacherId: string | null; profileImageUrl: string | null;
  mustChangePassword: boolean; attendanceDoneToday: boolean;
  mappings: { className: string; section: string; subject: string | null }[];
};
export const teacherKey = (u: MobileUser) => ['mobile/teacher/me', u.schoolId, u.role, u.id] as const;
export const pendingKey = (u: MobileUser) => ['mobile/teacher/pending-profiles/count', u.schoolId, u.role, u.id] as const;
export function useTeacherMe() {
  const { user } = useAuth();
  return useQuery({
    queryKey: user ? teacherKey(user) : ['mobile/teacher/me', 'guest'],
    queryFn: async ({ signal }) => {
      const result = await apiGet<TeacherMe>('/mobile/teacher/me', { signal });
      if (!result || result.schoolId !== user?.schoolId || result.id !== user.id || !result.fullName || !Array.isArray(result.mappings) || result.mustChangePassword) throw new Error('Teacher profile is unavailable for this account.');
      return result;
    },
    enabled: user?.role === 'teacher',
    staleTime: 60_000,
  });
}
export function safeTeacherPhoto(url: string | null | undefined, teacher: TeacherMe): string | undefined {
  if (!url || !API_BASE_URL || !Number.isSafeInteger(teacher.schoolId) || !Number.isSafeInteger(teacher.id)) return undefined;
  const path = `/uploads/schools/${teacher.schoolId}/teachers/${teacher.id}/`;
  if (!url.startsWith(path) || !/^\/uploads\/schools\/\d+\/teachers\/\d+\/[a-zA-Z0-9._-]+\.(jpg|jpeg|png|webp)$/i.test(url)) return undefined;
  return `${API_BASE_URL.slice(0, -4)}${url}`;
}
export function TeacherAvatar({ teacher, size = 32 }: { teacher: TeacherMe; size?: number }) {
  const [failed, setFailed] = useState(false);
  const uri = safeTeacherPhoto(teacher.profileImageUrl, teacher);
  const initials = teacher.fullName.trim().split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase();
  return <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: size > 50 ? 4 : 2, borderColor: '#217f70', backgroundColor: '#163f3d', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
    {uri && !failed ? <Image source={{ uri }} onError={() => setFailed(true)} style={{ width: size, height: size }} /> : <Text style={{ color: teacherColors.teal, fontSize: size > 50 ? 25 : 10, fontWeight: '700' }}>{initials}</Text>}
  </View>;
}
export function TeacherHeader({ teacher, back = false }: { teacher: TeacherMe; back?: boolean }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { logout } = useAuth();
  const { sessions, selectedId, loading, error, select } = useAcademicSession();
  const [busy, setBusy] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [switching, setSwitching] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const selected = sessions.find(s => s.id === selectedId);
  const signOut = async () => {
    setBusy(true); setLogoutError('');
    try { await logout(); router.replace('/'); }
    catch (e) { setLogoutError(e instanceof Error ? e.message : 'Could not sign out. Your session is still active.'); }
    finally { setBusy(false); }
  };
  return <View style={[s.headerWrap, { paddingTop: insets.top }]}>
    <StatusBar barStyle="light-content" backgroundColor={teacherColors.bg} />
    <View style={s.header}>
      {back && <Pressable testID="teacher-back" accessibilityLabel="Back to dashboard" onPress={() => router.replace('/')} style={s.headerButton}><Feather name="arrow-left" color={teacherColors.white} size={17} /></Pressable>}
      <View style={s.logo}><Feather name="book-open" color={teacherColors.white} size={19} /></View>
      <View style={{ flex: 1, minWidth: 0 }}><Text style={s.brand}>BENIUS</Text><Text numberOfLines={1} style={s.school}>{teacher.schoolName}</Text></View>
      <Pressable testID="teacher-session-picker" accessibilityRole="button" accessibilityLabel={selected ? `Academic session ${selected.sessionName}. Open session picker` : 'Academic sessions'} onPress={() => setSessionOpen(!sessionOpen)} style={s.sessionPill}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: selected && !selected.isActive ? teacherColors.amber : teacherColors.teal }} />
        <Feather name="chevron-down" color={teacherColors.faint} size={12} />
      </Pressable>
      <View style={{ width: 16 }} />
      <TeacherAvatar teacher={teacher} />
      <Pressable testID="teacher-logout" accessibilityLabel="Logout" disabled={busy} onPress={() => Alert.alert('Sign out?', 'BENIUS will revoke your mobile session.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => { void signOut(); } }])} style={[s.headerButton, { marginLeft: 9 }]}><Feather name="log-out" color={teacherColors.faint} size={17} /></Pressable>
    </View>
    {sessionOpen && <View style={s.sessionMenu}>
      <Text style={s.menuTitle}>ACADEMIC SESSIONS</Text>
      {loading ? <Text style={s.menuText}>Loading sessions…</Text> : error ? <Pressable onPress={() => router.push('/sessions')}><Text style={s.menuText}>Sessions unavailable · Retry</Text></Pressable> : sessions.length === 0 ? <Text style={s.menuText}>No academic sessions available</Text> : sessions.map(item => <Pressable key={item.id} testID={`teacher-session-${item.id}`} disabled={switching} onPress={() => {
        if (selectedId === item.id) { setSessionOpen(false); return; }
        setSwitching(true); setSessionError('');
        void select(item.id).then(() => setSessionOpen(false)).catch(e => setSessionError(e instanceof Error ? e.message : 'Could not switch session.')).finally(() => setSwitching(false));
      }} style={s.menuRow}><Text style={s.menuText}>{item.sessionName}</Text><Text style={{ color: item.isActive ? teacherColors.teal : teacherColors.amber, fontSize: 11 }}>{item.id === selectedId ? 'Viewing' : item.isActive ? 'Active' : 'Archive'}</Text></Pressable>)}
      {!!sessionError && <Text accessibilityRole="alert" style={{ color: teacherColors.coral, fontSize: 12, padding: 8 }}>{sessionError}</Text>}
      <Pressable onPress={() => { setSessionOpen(false); router.push('/sessions'); }} style={s.menuRow}><Text style={{ color: teacherColors.teal, fontSize: 12 }}>Manage session selection →</Text></Pressable>
    </View>}
    {!!logoutError && <Pressable onPress={() => { void signOut(); }} style={{ padding: 10 }}><Text style={{ color: teacherColors.coral }}>Sign out failed: {logoutError} · Retry</Text></Pressable>}
  </View>;
}

const tiles: { id: string; name: string; description: string; icon: React.ComponentProps<typeof Feather>['name']; zone: string }[] = [
  { id: 'profile', name: 'Teacher Profile', description: 'Your info, photo, subject & security', icon: 'user', zone: 'Classroom' },
  { id: 'attendance', name: 'Attendance', description: 'Mark daily class attendance rolls', icon: 'clipboard', zone: 'Classroom' },
  { id: 'homework', name: 'Homework', description: 'Assign and review student homework', icon: 'book', zone: 'Classroom' },
  { id: 'classwork', name: 'Classwork', description: 'In-class tasks and activity records', icon: 'edit-3', zone: 'Classroom' },
  { id: 'noticeboard', name: 'Noticeboard', description: 'Post notices to classes or school-wide', icon: 'bell', zone: 'School Life' },
  { id: 'complaint', name: 'Complaint', description: 'Raise or track staff complaints', icon: 'shield', zone: 'School Life' },
  { id: 'examination', name: 'Examination', description: 'Enter scores and manage exam results', icon: 'award', zone: 'School Life' },
  { id: 'gallery', name: 'Gallery', description: 'Class photos, events and memories', icon: 'image', zone: 'School Life' },
  { id: 'faculty-info', name: 'Faculty Info', description: 'All teachers & support staff directory', icon: 'users', zone: 'School Life' },
  { id: 'calendar', name: 'School Calendar', description: 'Events, holidays and academic schedule', icon: 'calendar', zone: 'School Life' },
  { id: 'library', name: 'Library', description: 'E-books, resources and reading material', icon: 'book-open', zone: 'School Life' },
  { id: 'leave', name: 'Leave', description: 'Apply for and track leave requests', icon: 'calendar', zone: 'Administration' },
  { id: 'timetable', name: 'Timetable', description: 'Your class periods and weekly schedule', icon: 'clock', zone: 'Administration' },
  { id: 'student-profiles', name: 'Approval Center', description: 'Review and approve student profile edits', icon: 'check-circle', zone: 'Administration' },
];

export default function TeacherDashboard() {
  const { user } = useAuth();
  const { online } = useNetwork();
  const router = useRouter();
  const { sessions, selectedId } = useAcademicSession();
  const me = useTeacherMe();
  const pending = useQuery({
    queryKey: user ? pendingKey(user) : ['mobile/teacher/pending-profiles/count', 'guest'],
    queryFn: async ({ signal }) => {
      const data = await apiGet<{ count: number }>('/mobile/teacher/pending-profiles/count', { signal });
      if (!data || !Number.isSafeInteger(data.count) || data.count < 0) throw new Error('Invalid approval count.');
      return data.count;
    },
    enabled: !!me.data && user?.role === 'teacher',
    refetchInterval: 60_000,
  });
  if (user?.role !== 'teacher') return null;
  if (me.isPending) return <View style={s.page}><View style={{ padding: 20, gap: 18 }}><View style={[s.skeleton, { height: 55 }]} /><View style={[s.skeleton, { height: 90 }]} /><View style={[s.skeleton, { height: 210 }]} /><View style={[s.skeleton, { height: 210 }]} /></View></View>;
  if (me.isError || !me.data) return <View style={[s.page, s.center]}><Feather name="wifi-off" size={30} color={teacherColors.teal} /><Text style={s.errorTitle}>Teacher workspace unavailable</Text><Text style={s.errorText}>{!online ? 'You are offline. Reconnect and try again.' : me.error?.message}</Text><Pressable testID="teacher-retry" onPress={() => { void me.refetch(); }} style={s.retry}><Text style={{ color: teacherColors.white }}>Try again</Text></Pressable></View>;
  const teacher = me.data;
  const first = teacher.fullName.trim().split(/\s+/)[0];
  const mappedClasses = teacher.mappings.length ? teacher.mappings.map(m => `${m.className}${m.section}`).join(', ') : [teacher.assignedClass, teacher.assignedSection].filter(Boolean).join('');
  const subjects = Array.from(new Set(teacher.mappings.map(m => m.subject).filter(Boolean))).join(', ') || teacher.subject;
  const archive = sessions.find(x => x.id === selectedId && !x.isActive);
  return <View style={s.page}>
    <TeacherHeader teacher={teacher} />
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 48 }}>
      <View style={s.welcome}><Text style={s.welcomeText}>Welcome back, {first}!</Text><Text style={{ fontSize: 30, color: teacherColors.teal, marginTop: 2 }}>●</Text>
        <View style={s.pills}>
          {pending.isError ? <Pressable onPress={() => { void pending.refetch(); }} style={[s.pill, { borderColor: teacherColors.coral }]}><Text style={{ color: teacherColors.coral, fontSize: 11 }}>Approvals unavailable · Retry</Text></Pressable> : pending.data != null && pending.data > 0 ? <View style={[s.pill, { borderColor: '#6a3b49', backgroundColor: '#332637' }]}><Text style={{ color: teacherColors.coral, fontSize: 11, fontWeight: '700' }}>● {pending.data} Pending Approvals</Text></View> : null}
          {!!(mappedClasses || subjects) && <View style={s.pill}><Text numberOfLines={1} style={{ color: '#a5a3ff', fontSize: 11 }}>{mappedClasses || '—'} · {subjects || '—'}</Text></View>}
        </View>
      </View>
      {archive && <View style={s.archive}><Feather name="clock" size={15} color={teacherColors.amber} /><Text style={{ color: teacherColors.amber, fontSize: 12, flex: 1 }}>Archive Mode — Viewing {archive.sessionName}. Historical school data is read-only.</Text></View>}
      {!online && <Text style={{ color: teacherColors.amber, marginBottom: 14 }}>Offline. Showing the last loaded profile; updates are unavailable.</Text>}
      {(['Classroom', 'School Life', 'Administration'] as const).map(zone => {
        const color = zone === 'Classroom' ? teacherColors.violet : zone === 'School Life' ? teacherColors.teal : teacherColors.coral;
        return <View key={zone} style={{ marginBottom: 34 }}><View style={s.zoneHead}><Text style={[s.zoneName, { color }]}>{zone.toUpperCase()}</Text><View style={[s.rule, { backgroundColor: color + '42' }]} /></View>
          <View style={s.grid}>{tiles.filter(t => t.zone === zone).map(t => <Pressable key={t.id} testID={`teacher-tile-${t.id}`} accessibilityRole="button" accessibilityLabel={`Open ${t.name}`} onPress={() => t.id === 'profile' ? router.push('/teacher/profile') : router.push({ pathname: '/teacher/[module]', params: { module: t.id } })} style={[s.tile, { borderTopColor: color }]}>
            {t.id === 'student-profiles' && !!pending.data && <View style={s.badge}><Text style={{ color: teacherColors.white, fontSize: 10, fontWeight: '700' }}>{pending.data > 9 ? '9+' : pending.data}</Text></View>}
            <View style={[s.iconBox, { backgroundColor: color + '13' }]}><Feather name={t.icon} size={28} color={color} /></View><Text style={s.tileName}>{t.name}</Text><Text style={s.tileDescription}>{t.description}</Text><Text style={[s.tileAction, { color }]}>Open  →</Text>
          </Pressable>)}</View>
        </View>;
      })}
    </ScrollView>
  </View>;
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: teacherColors.bg }, center: { alignItems: 'center', justifyContent: 'center', padding: 26 },
  headerWrap: { backgroundColor: '#151d2d', borderBottomWidth: 1, borderBottomColor: '#273144', zIndex: 4 },
  header: { height: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  logo: { width: 36, height: 36, borderRadius: 11, backgroundColor: '#3778b1', alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  brand: { color: teacherColors.white, fontWeight: '800', letterSpacing: 1, fontSize: 14 }, school: { color: teacherColors.faint, fontSize: 10, marginTop: 2 },
  headerButton: { width: 38, height: 34, borderRadius: 9, backgroundColor: '#222d3d', borderWidth: 1, borderColor: '#354052', alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  sessionPill: { width: 51, height: 30, borderRadius: 17, borderWidth: 1, borderColor: '#265453', backgroundColor: '#1a323a', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  sessionMenu: { position: 'absolute', right: 62, top: '100%', width: 232, backgroundColor: '#192639', borderRadius: 12, borderWidth: 1, borderColor: '#354052', padding: 10, elevation: 12 },
  menuTitle: { color: teacherColors.faint, fontSize: 10, fontWeight: '700', letterSpacing: 1, padding: 8 }, menuText: { color: teacherColors.white, fontSize: 12 },
  menuRow: { padding: 10, minHeight: 42, borderTopWidth: 1, borderColor: '#354052', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  welcome: { alignItems: 'center', paddingTop: 36, paddingBottom: 32 },
  welcomeText: { color: '#a2b2e9', textAlign: 'center', fontWeight: '800', fontSize: 29, letterSpacing: -1.2 },
  pills: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 6, marginTop: 13 },
  pill: { borderRadius: 20, borderWidth: 1, borderColor: '#373769', backgroundColor: '#222946', paddingHorizontal: 10, paddingVertical: 5, maxWidth: '100%' },
  zoneHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 }, zoneName: { fontWeight: '800', fontSize: 12, letterSpacing: 1.5 }, rule: { height: 1, flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  tile: { width: '47.7%', minHeight: 216, backgroundColor: '#202a3b', borderRadius: 16, borderWidth: 1, borderColor: '#333e50', borderTopWidth: 3, padding: 20, overflow: 'hidden' },
  iconBox: { width: 58, height: 58, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  tileName: { color: teacherColors.white, fontSize: 14, fontWeight: '700' }, tileDescription: { color: teacherColors.faint, fontSize: 12, lineHeight: 19, marginTop: 7, minHeight: 43 },
  tileAction: { fontSize: 11, fontWeight: '600', marginTop: 15 },
  badge: { position: 'absolute', right: 10, top: 10, backgroundColor: '#ef4444', borderRadius: 12, minWidth: 21, height: 21, alignItems: 'center', justifyContent: 'center' },
  archive: { flexDirection: 'row', gap: 8, borderRadius: 10, backgroundColor: '#302d30', padding: 12, marginBottom: 18 },
  skeleton: { backgroundColor: '#253147', borderRadius: 14 },
  errorTitle: { color: teacherColors.white, fontWeight: '700', fontSize: 20, marginTop: 16 }, errorText: { color: teacherColors.faint, textAlign: 'center', marginTop: 9 }, retry: { backgroundColor: teacherColors.teal, padding: 14, marginTop: 20, borderRadius: 10 },
});