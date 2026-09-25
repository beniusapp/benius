import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, AppState, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { useAcademicSession } from '@/contexts/SessionContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { ApiError, apiGetForSession } from '@/lib/api';
import { StudentDashboardResponse, validateStudentDashboard } from '@/lib/student-dashboard';
import { resolveStudentPhotoUrl, studentGreetingAt, studentYearAt } from '@/lib/student-dashboard-pure.mjs';
import { studentDashboardColors as C, studentDashboardTiles as TILES } from '@/constants/student-dashboard';

const HAND = 'ArchitectsDaughter_400Regular';
const studentTilePaths = {
  profile: '/student-profile',
  attendance: '/student/attendance',
  homework: '/student/homework',
  classwork: '/student/classwork',
  noticeboard: '/student/notices',
  fees: '/student/fees',
  examination: '/student/examination',
  complaints: '/student/complaints',
  gallery: '/student/gallery',
  'faculty-info': '/student/faculty',
  'school-calendar': '/student/calendar',
  leave: '/student/leave',
  timetable: '/student/timetable',
  'e-library': '/student/library',
} as const;

function currentDashboardClock() {
  const now = new Date();
  return { greeting: studentGreetingAt(now), year: studentYearAt(now) };
}

function PulseDot({ label, testID }: { label: string; testID: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(.75)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.parallel([
      Animated.sequence([Animated.timing(scale, { toValue: 2.2, duration: 950, useNativeDriver: true }), Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true })]),
      Animated.sequence([Animated.timing(opacity, { toValue: 0, duration: 950, useNativeDriver: true }), Animated.timing(opacity, { toValue: .75, duration: 0, useNativeDriver: true })]),
    ]));
    loop.start();
    return () => loop.stop();
  }, [scale, opacity]);
  return <View testID={testID} accessibilityLabel={label} style={s.dotPosition}>
    <Animated.View style={[s.dot, s.dotRing, { transform: [{ scale }], opacity }]} />
    <View style={s.dot} />
  </View>;
}

function LoadingCard() {
  return <View testID="student-dashboard-loading" accessibilityLabel="Loading your portal" style={s.loadingWrap}>
    <View style={[s.skeleton, { width: 72, height: 72, borderRadius: 36 }]} />
    <View style={[s.skeleton, { width: '62%', height: 18 }]} />
    <View style={[s.skeleton, { width: '78%', height: 27 }]} />
    <View style={s.skeletonRow}>
      <View style={[s.skeleton, { width: 104, height: 22 }]} />
      <View style={[s.skeleton, { width: 104, height: 22 }]} />
    </View>
    <Text style={s.loadingText}>Loading your portal…</Text>
  </View>;
}

function Message({ title, detail, retry, testID }: { title: string; detail: string; retry?: () => void; testID: string }) {
  return <View testID={testID} accessibilityRole="alert" style={s.message}>
    <Feather name={retry ? 'alert-circle' : 'info'} size={24} color={C.blue} />
    <Text style={s.messageTitle}>{title}</Text>
    <Text style={s.messageDetail}>{detail}</Text>
    {retry && <Pressable testID={`${testID}-retry`} accessibilityRole="button" onPress={retry} style={s.retry}>
      <Feather name="refresh-cw" size={14} color={C.blue} /><Text style={s.retryText}>Try again</Text>
    </Pressable>}
  </View>;
}

export default function StudentDashboard() {
  const { user, logout } = useAuth();
  const { sessions, selectedId, loading: sessionsLoading, error: sessionsError, refresh } = useAcademicSession();
  const { online } = useNetwork();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [displayClock, setDisplayClock] = useState(currentDashboardClock);
  const [foreground, setForeground] = useState(() => Platform.OS === 'web'
    ? typeof document === 'undefined' || document.visibilityState !== 'hidden'
    : AppState.currentState === 'active');
  const [failedPhotoUrl, setFailedPhotoUrl] = useState<string | null>(null);
  const updateClock = useCallback(() => {
    const next = currentDashboardClock();
    setDisplayClock(previous =>
      previous.greeting === next.greeting && previous.year === next.year ? previous : next);
  }, []);
  useEffect(() => {
    const timer = setInterval(updateClock, 30_000);
    return () => clearInterval(timer);
  }, [updateClock]);
  useEffect(() => {
    if (Platform.OS === 'web') {
      const update = () => {
        const active = document.visibilityState !== 'hidden';
        setForeground(active);
        if (active) updateClock();
      };
      document.addEventListener('visibilitychange', update);
      return () => document.removeEventListener('visibilitychange', update);
    }
    const subscription = AppState.addEventListener('change', state => {
      const active = state === 'active';
      setForeground(active);
      if (active) updateClock();
    });
    return () => subscription.remove();
  }, [updateClock]);
  const selected = sessions.find(session => session.id === selectedId);
  const canRequest = user?.role === 'student' && selectedId !== null && !!selected && !sessionsLoading && !sessionsError && online;
  const dashboard = useQuery({
    queryKey: ['mobile/student/dashboard', user?.schoolId, user?.id, user?.role, selectedId],
    queryFn: async ({ signal }) => {
      if (!user || user.role !== 'student' || selectedId === null) throw new ApiError('A verified student and school year are required.', 'auth_unavailable');
      const response = await apiGetForSession<unknown>('/mobile/student/dashboard', selectedId, { signal });
      return validateStudentDashboard(response, user, selectedId);
    },
    enabled: canRequest,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchInterval: canRequest && foreground ? 60_000 : false,
  });

  if (!user || user.role !== 'student') return null;
  const data: StudentDashboardResponse | undefined =
    dashboard.data?.student.id === user.id
    && dashboard.data.student.schoolId === user.schoolId
    && dashboard.data.sessionId === selectedId ? dashboard.data : undefined;
  const signOut = async () => {
    setSigningOut(true);
    setLogoutError('');
    try {
      await logout();
      router.replace('/');
    } catch (reason) {
      setLogoutError(`Sign-out was not confirmed. Your mobile session remains active. ${reason instanceof Error ? reason.message : 'The request failed.'} Retry when connected.`);
    } finally {
      setSigningOut(false);
    }
  };
  const confirmSignOut = () => Alert.alert('Sign out?', 'BENIUS will revoke this mobile session before this device clears it.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign out', style: 'destructive', onPress: () => { void signOut(); } },
  ]);
  const initials = data?.student.name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
  const firstName = data?.student.name.trim().split(/\s+/)[0];
  const percent = data?.attendancePercent ?? null;
  const isArchive = selected ? !selected.isActive : false;
  const photoUri = resolveStudentPhotoUrl(data?.student.photoUrl, process.env.EXPO_PUBLIC_DOMAIN);

  return <View testID="student-dashboard" style={s.screen}>
    <View style={[s.header, { paddingTop: (Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top) + 8 }]}>
      <View style={s.brand}>
        <LinearGradient colors={[C.blue, C.indigo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.brandMark}>
          <MaterialCommunityIcons name="school-outline" size={22} color={C.background} />
        </LinearGradient>
        <View><Text style={s.brandName}>BENIUS</Text><Text style={s.brandSub}>Student Portal</Text></View>
      </View>
      <Pressable testID="button-session-picker" accessibilityRole="button"
        accessibilityLabel={`Academic sessions. ${selected ? `${selected.sessionName}, ${isArchive ? 'Archive' : 'Active'}` : sessionsLoading ? 'Loading' : sessionsError ? 'Unavailable' : 'No sessions'}. Open session selector`}
        onPress={() => router.push('/sessions')} style={[s.sessionPill, {
          backgroundColor: isArchive ? C.archivePill : C.activePill,
          borderColor: isArchive ? C.archivePillBorder : C.activeBorder,
        }]}>
        {isArchive ? <Feather name="clock" size={12} color={C.archiveText} /> : <View style={s.activeDot} />}
        <Feather name="chevron-down" size={12} color={isArchive ? C.archiveText : C.greenText} />
      </Pressable>
      <Pressable testID="button-student-logout" accessibilityRole="button" accessibilityLabel="Logout"
        accessibilityState={{ disabled: signingOut }} disabled={signingOut} onPress={confirmSignOut} style={s.logout}>
        <Feather name="log-out" size={17} color={C.section} />
      </Pressable>
    </View>
    <ScrollView contentContainerStyle={[s.content, { paddingBottom: (Platform.OS === 'web' ? Math.max(insets.bottom, 34) : insets.bottom) + 35 }]} showsVerticalScrollIndicator={false}>
      {!online && <View testID="student-dashboard-offline" accessibilityRole="alert" style={s.offline}>
        <Feather name="wifi-off" size={14} color={C.red} /><Text style={s.offlineText}>Offline · Connect to refresh your portal.</Text>
      </View>}
      {logoutError ? <Text testID="student-logout-error" accessibilityRole="alert" style={s.logoutError}>{logoutError}</Text> : null}
      {sessionsLoading ? <Message title="Loading academic sessions…" detail="Finding your school year." testID="student-sessions-loading" />
        : sessionsError ? <Message title="Sessions unavailable" detail={sessionsError.message} testID="student-sessions-error" retry={() => { void refresh(); }} />
        : !selected ? <Message title="No sessions found" detail="There are no academic sessions available for your school account yet." testID="student-sessions-empty" retry={() => { void refresh(); }} />
        : !online && !data ? <Message title="You're offline" detail="Connect to the internet to load your student portal." testID="student-dashboard-offline-empty" />
        : dashboard.isError ? <Message title="Could not load your portal" detail={dashboard.error instanceof Error ? dashboard.error.message : 'Please try again.'} testID="student-dashboard-error" retry={() => { void dashboard.refetch(); }} />
        : !data ? dashboard.isPending || dashboard.isFetching ? <LoadingCard />
          : <Message title="Dashboard unavailable" detail="Your student dashboard has no information for this school year yet." testID="student-dashboard-empty" retry={() => { void dashboard.refetch(); }} />
        : <>
          <View testID="card-student-profile" style={s.hero}>
            <LinearGradient colors={[C.blue, C.violet]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.avatar}>
              {photoUri && failedPhotoUrl !== photoUri ? <Image source={{ uri: photoUri }} accessibilityLabel={data.student.name} style={s.photo} onError={() => setFailedPhotoUrl(photoUri)} />
                : <Text testID="avatar-student" style={s.initials}>{initials}</Text>}
            </LinearGradient>
            <Text style={s.school}>{data.student.schoolName}</Text>
            <Text testID="text-student-name" style={s.greeting}>{displayClock.greeting}, {firstName}! 👋</Text>
            <View style={s.pillRow}>
              <View style={[s.infoPill, { backgroundColor: C.bluePill, borderColor: C.blueBorder }]}><Text testID="text-student-dsid" style={[s.infoText, { color: C.blue }]}>{data.student.digitalStudentId}</Text></View>
              <View style={[s.infoPill, { backgroundColor: C.greenPill, borderColor: C.greenBorder }]}><Text testID="text-student-class" style={[s.infoText, { color: C.emerald }]}>Class {data.student.class} – {data.student.section}</Text></View>
            </View>
            <View style={[s.pillRow, { marginTop: 12 }]}>
              <View style={[s.statPill, { backgroundColor: percent === null ? C.empty : percent >= 75 ? C.greenPill : C.redPill, borderColor: percent === null ? C.emptyBorder : percent >= 75 ? C.greenStatBorder : C.redBorder }]}>
                <Text testID="badge-attendance-pct" style={[s.statText, { color: percent === null ? C.muted : percent >= 75 ? C.emerald : C.red }]}>📊 Attendance: {percent === null ? '—' : `${percent}%`}</Text>
              </View>
              {data.unreadNoticeCount > 0 && <View style={[s.statPill, { backgroundColor: C.redPill, borderColor: C.redBorder }]}>
                <Text testID="badge-unread-notices" style={[s.statText, { color: C.red }]}>🔔 {data.unreadNoticeCount} New Notice{data.unreadNoticeCount === 1 ? '' : 's'}</Text>
              </View>}
            </View>
          </View>
          {isArchive && <View testID="banner-archive-dashboard" style={s.archiveBanner}>
            <Feather name="lock" size={17} color={C.archiveText} />
            <View style={{ flex: 1 }}>
              <Text style={s.archiveHeading}>Viewing Archive Mode — Read Only</Text>
              <Text style={s.archiveDetail}>Browsing {selected.sessionName}. All submission and payment actions are locked.</Text>
            </View>
          </View>}
          <View style={s.sectionHeading}>
            <Text style={s.sectionTitle}>My Modules</Text>
            <Text style={s.sectionSub}>Tap a card to access your portal</Text>
          </View>
          <View style={s.grid}>
            {TILES.map((tile, index) => <Pressable key={tile.id} testID={`tile-${tile.id}`} accessibilityRole="button"
                accessibilityLabel={`${tile.label}. Open ${tile.label}`}
                onPress={() => router.push(studentTilePaths[tile.id])}
              style={({ pressed }) => [s.tile, { borderTopColor: tile.accent, opacity: pressed ? .75 : 1 }]}>
              {(tile.id === 'noticeboard' && data.unreadNoticeCount > 0 || tile.id === 'fees' && data.feesOutstanding) &&
                <PulseDot testID={`badge-${tile.id}-pulse`} label={tile.id === 'fees' ? 'Fees outstanding' : `${data.unreadNoticeCount} unread notices`} />}
              <View style={[s.tileIcon, { backgroundColor: tile.bg, shadowColor: tile.accent }]}>
                <Text style={s.emoji}>{tile.emoji}</Text>
              </View>
              <Text style={s.tileLabel}>{tile.label}</Text>
            </Pressable>)}
          </View>
          <Text style={s.footer}>© {displayClock.year} BENIUS · {data.student.schoolName}</Text>
        </>}
    </ScrollView>
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  header: { minHeight: 64, paddingBottom: 10, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, backgroundColor: C.header, borderBottomWidth: 1, borderBottomColor: C.glassBorder, shadowColor: C.section, shadowOpacity: .07, shadowRadius: 18, elevation: 2, zIndex: 2 },
  brand: { flexDirection: 'row', gap: 10, alignItems: 'center', flexShrink: 0 },
  brandMark: { height: 36, width: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  brandName: { color: C.title, fontFamily: HAND, fontSize: 16, fontWeight: '700', letterSpacing: -.4, lineHeight: 20 },
  brandSub: { color: C.muted, fontSize: 11, fontFamily: HAND, lineHeight: 16 },
  sessionPill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, height: 29, width: 52 },
  activeDot: { height: 6, width: 6, borderRadius: 3, backgroundColor: C.emerald },
  logout: { width: 40, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: C.logout, borderWidth: 1, borderColor: C.logoutBorder, borderRadius: 8 },
  content: { paddingHorizontal: 16, paddingTop: 32 },
  offline: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: C.redPill, borderColor: C.redBorder, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 14 },
  offlineText: { color: C.red, fontSize: 12, fontWeight: '600' },
  logoutError: { color: C.red, backgroundColor: C.redPill, padding: 12, borderRadius: 10, marginBottom: 14, lineHeight: 20 },
  hero: { borderRadius: 24, paddingHorizontal: 14, paddingVertical: 24, minHeight: 258, alignItems: 'center', backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder, shadowColor: C.blue, shadowOpacity: .10, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  avatar: { width: 72, height: 72, borderRadius: 36, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', shadowColor: C.indigo, shadowOpacity: .2, shadowRadius: 10 },
  photo: { width: 72, height: 72, borderRadius: 36 },
  initials: { color: C.background, fontSize: 27, fontWeight: '700', fontFamily: HAND },
  school: { color: C.muted, fontFamily: HAND, fontSize: 14, textAlign: 'center', marginTop: 20 },
  greeting: { color: C.title, fontFamily: HAND, fontSize: 21, textAlign: 'center', marginTop: 2, marginBottom: 10 },
  pillRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  infoPill: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3 },
  infoText: { fontFamily: HAND, fontSize: 11 },
  statPill: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 5 },
  statText: { fontFamily: HAND, fontSize: 12 },
  archiveBanner: { marginTop: 26, flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 13, backgroundColor: C.archive, borderWidth: 1.5, borderColor: C.archiveBorder, borderRadius: 16 },
  archiveHeading: { color: C.amberText, fontSize: 14, fontWeight: '700' },
  archiveDetail: { color: C.archiveText, fontSize: 12, lineHeight: 18, marginTop: 3 },
  sectionHeading: { marginTop: 32, marginBottom: 30 },
  sectionTitle: { color: C.section, fontFamily: HAND, fontSize: 16 },
  sectionSub: { color: C.muted, fontFamily: HAND, fontSize: 12, marginTop: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 13 },
  tile: { width: '48.2%', minHeight: 140, paddingHorizontal: 10, paddingVertical: 20, backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder, borderTopWidth: 4, borderRadius: 20, alignItems: 'center', justifyContent: 'center', gap: 10, shadowColor: C.cardShadow, shadowOpacity: .12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  tileIcon: { width: 68, height: 68, borderRadius: 16, alignItems: 'center', justifyContent: 'center', shadowOpacity: .13, shadowRadius: 10 },
  emoji: { fontSize: 36, lineHeight: 47, textAlign: 'center' },
  tileLabel: { color: C.title, fontFamily: HAND, fontSize: 13, textAlign: 'center' },
  dotPosition: { position: 'absolute', right: 14, top: 13, height: 12, width: 12, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', width: 12, height: 12, borderRadius: 6, backgroundColor: C.red },
  dotRing: { backgroundColor: C.red },
  footer: { color: C.muted, fontSize: 11, textAlign: 'center', paddingTop: 38, fontFamily: HAND },
  loadingWrap: { alignItems: 'center', backgroundColor: C.glass, borderRadius: 24, padding: 28, gap: 16 },
  skeleton: { backgroundColor: C.emptyBorder, borderRadius: 10 },
  skeletonRow: { flexDirection: 'row', gap: 8 },
  loadingText: { color: C.muted, fontSize: 13, marginTop: 5 },
  message: { alignItems: 'center', backgroundColor: C.glass, borderColor: C.glassBorder, borderWidth: 1, borderRadius: 24, padding: 26, gap: 9 },
  messageTitle: { color: C.title, fontFamily: HAND, fontSize: 19, textAlign: 'center' },
  messageDetail: { color: C.muted, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  retry: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, marginTop: 6 },
  retryText: { color: C.blue, fontWeight: '700' },
});