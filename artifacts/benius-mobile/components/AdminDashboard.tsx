import React, { useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useAcademicSession } from '@/contexts/SessionContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { adminGroups, visibleAdminTiles, visibleMetrics } from '@/lib/admin-dashboard-pure.mjs';

type IconName = React.ComponentProps<typeof Feather>['name'];
type Overview = {
  role: 'admin' | 'support_staff'; schoolName: string; schoolCode: string | null;
  displayName: string; initials: string; allowedModuleIds: string[];
  studentCount: number | null; teacherCount: number | null; dailyPresence: number | null;
  actionRequiredCount: number | null; badges: { complaints: number | null; approvals: number | null; leaveRequests: number | null };
};
type Profile = {
  id: number; email: string; recoveryEmail: string | null; recoveryPhone: string | null;
  isInitialized: boolean; hasPin: boolean; logoUrl: string | null; signatureUrl: string | null;
  addressLine1: string | null; addressLine2: string | null; city: string | null;
  state: string | null; pinCode: string | null; country: string | null;
  schoolPhone: string | null; schoolEmail: string | null; schoolWebsite: string | null;
  schoolBoard: string | null; schoolType: string | null; affiliationNumber: string | null;
  udiseCode: string | null; establishedYear: number | null; registrationNumber: string | null;
  pan: string | null; gstin: string | null;
};

const c = {
  bg: '#161f30', header: '#141c2c', card: '#202b3c', border: '#344154',
  ink: '#f3f5f9', subdued: '#a4aec0', faint: '#78869b', cyan: '#06b6d4',
  indigo: '#898bff', green: '#27c295', gold: '#d4af37', red: '#f0777c',
};
const zones: Record<string, string> = { Foundation: '#898bff', Oversight: '#36bcd3', Management: '#39c9a0', Enterprise: '#d4af37' };

function InfoRow({ label, value }: { label: string; value: string | number | boolean | null | undefined }) {
  return <View style={s.infoRow}><Text style={s.infoLabel}>{label}</Text><Text selectable style={s.infoValue}>{value === null || value === undefined || value === '' ? 'Not provided' : typeof value === 'boolean' ? value ? 'Enabled' : 'Not enabled' : String(value)}</Text></View>;
}

function AdminProfile({ visible, close, overview }: { visible: boolean; close: () => void; overview: Overview }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { online } = useNetwork();
  const query = useQuery({
    queryKey: ['mobile/admin/profile', user?.schoolId, user?.role, user?.id],
    queryFn: ({ signal }) => apiGet<Profile>('/mobile/admin/profile', { signal }),
    enabled: visible && user?.role === 'admin',
    staleTime: 60_000,
  });
  return <Modal visible={visible} onRequestClose={close} animationType="slide" presentationStyle="fullScreen">
    <View style={[s.page, { paddingTop: Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={c.header} />
      <View style={s.profileHeader}>
        <View style={s.avatar}><Feather name="user" size={21} color={c.cyan} /></View>
        <View style={{ flex: 1 }}><Text style={s.profileTitle}>{overview.displayName}</Text><Text style={s.profileSubtitle} numberOfLines={1}>{overview.schoolName}{overview.schoolCode ? ` · ${overview.schoolCode}` : ''}</Text></View>
        <Pressable testID="admin-profile-close" accessibilityLabel="Close profile" onPress={close} style={s.iconButton}><Feather name="x" size={20} color={c.ink} /></Pressable>
      </View>
      {query.isPending ? <View style={s.pad}><View style={[s.skeleton, { height: 95 }]} /><View style={[s.skeleton, { height: 220, marginTop: 14 }]} /><View style={[s.skeleton, { height: 180, marginTop: 14 }]} /></View>
        : query.isError || !query.data ? <View style={s.center}><Feather name="alert-circle" size={30} color={c.red} /><Text style={s.errorTitle}>Profile unavailable</Text><Text style={s.muted}>{online ? 'Could not load your account details.' : 'You are offline. Reconnect and try again.'}</Text><Pressable testID="admin-profile-retry" onPress={() => void query.refetch()} style={s.retry}><Text style={s.retryText}>Try again</Text></Pressable></View>
          : <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 22, paddingBottom: Math.max(insets.bottom, 34) + 26 }}>
            {!online && <Text style={s.offline}>Offline · Showing the last loaded profile</Text>}
            <View style={s.profileNote}><Feather name="lock" color={c.gold} size={16} /><Text style={{ color: c.ink, flex: 1, fontSize: 12, lineHeight: 18 }}>Read-only account information. Editing profile, school details, password and PIN is not yet available on mobile.</Text></View>
            <Text style={s.sectionTitle}>ACCOUNT</Text>
            <InfoRow label="School" value={overview.schoolName} /><InfoRow label="School code" value={overview.schoolCode} />
            <InfoRow label="Admin email" value={query.data.email} /><InfoRow label="Account initialized" value={query.data.isInitialized} /><InfoRow label="PIN protection" value={query.data.hasPin} />
            <Text style={s.sectionTitle}>RECOVERY OPTIONS</Text>
            <InfoRow label="Recovery email" value={query.data.recoveryEmail} /><InfoRow label="Recovery phone" value={query.data.recoveryPhone} />
            <Text style={s.sectionTitle}>CONTACT & LOCATION</Text>
            <InfoRow label="Address" value={[query.data.addressLine1, query.data.addressLine2, query.data.city, query.data.state, query.data.pinCode, query.data.country].filter(Boolean).join(', ') || null} />
            <InfoRow label="School phone" value={query.data.schoolPhone} /><InfoRow label="School email" value={query.data.schoolEmail} /><InfoRow label="Website" value={query.data.schoolWebsite} />
            <Text style={s.sectionTitle}>ACADEMIC IDENTITY</Text>
            <InfoRow label="Board" value={query.data.schoolBoard} /><InfoRow label="School type" value={query.data.schoolType} /><InfoRow label="Affiliation number" value={query.data.affiliationNumber} /><InfoRow label="UDISE code" value={query.data.udiseCode} /><InfoRow label="Established" value={query.data.establishedYear} />
            <Text style={s.sectionTitle}>LEGAL & SECURITY</Text>
            <InfoRow label="Registration number" value={query.data.registrationNumber} /><InfoRow label="PAN" value={query.data.pan} /><InfoRow label="GSTIN" value={query.data.gstin} />
            <InfoRow label="School logo" value={query.data.logoUrl ? 'On file · editing unavailable' : 'Not uploaded'} /><InfoRow label="Digital signature" value={query.data.signatureUrl ? 'On file · editing unavailable' : 'Not uploaded'} />
            <View style={s.unavailable}><Text style={s.muted}>Password, PIN, audit log and account updates are available on the web dashboard only.</Text></View>
          </ScrollView>}
    </View>
  </Modal>;
}

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const { online } = useNetwork();
  const insets = useSafeAreaInsets();
  const { sessions, selectedId, loading: sessionLoading, error: sessionError, refresh: refreshSessions, select } = useAcademicSession();
  const [drawer, setDrawer] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const overview = useQuery({
    queryKey: ['mobile/admin/overview', user?.schoolId, user?.role, user?.id],
    queryFn: async ({ signal }) => {
      const result = await apiGet<Overview>('/mobile/admin/overview', { signal });
      if (!result || result.role !== user?.role || typeof result.schoolName !== 'string'
        || !Array.isArray(result.allowedModuleIds) || !result.allowedModuleIds.every(id => typeof id === 'string')
        || (user?.role === 'admin' && result.allowedModuleIds.length !== 19)) throw new Error('Dashboard permissions could not be verified.');
      return result;
    },
    enabled: user?.role === 'admin' || user?.role === 'support_staff',
    staleTime: 60_000,
  });
  if (user?.role !== 'admin' && user?.role !== 'support_staff') return null;
  const admin = user.role === 'admin';
  const selected = sessions.find(item => item.id === selectedId);
  const signOut = async () => {
    setBusy(true); setActionError('');
    try { await logout(); } catch (error) { setActionError(error instanceof Error ? error.message : 'Could not sign out. Try again.'); }
    finally { setBusy(false); }
  };
  const askSignOut = () => Alert.alert('Sign out?', 'BENIUS will revoke your mobile session.', [
    { text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
  ]);
  const top = Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top;
  return <View style={s.page}>
    <StatusBar barStyle="light-content" backgroundColor={c.header} />
    <View style={[s.headerWrap, { paddingTop: top }]}>
      <View style={s.header}>
        <Pressable testID="admin-menu" onPress={() => setDrawer(true)} accessibilityLabel="Open navigation" style={s.iconButton}><Feather name="menu" size={20} color={c.subdued} /></Pressable>
        <View style={s.logo}><Feather name="book-open" size={19} color={c.ink} /></View>
        <View style={{ flex: 1 }} />
        {admin && <Pressable testID="admin-session-picker" accessibilityLabel="Academic sessions" onPress={() => setSessionOpen(!sessionOpen)} style={s.sessionPill}><View style={[s.dot, { backgroundColor: selected && !selected.isActive ? c.gold : c.green }]} /><Feather name="chevron-down" size={13} color={c.subdued} /></Pressable>}
        {admin ? <Pressable testID="admin-profile" accessibilityLabel="Open admin profile" onPress={() => setProfileOpen(true)} style={s.avatar}><Text style={s.avatarText}>{overview.data?.initials || user.name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()}</Text></Pressable> : <View style={s.staffMark}><Feather name="shield" color={c.subdued} size={17} /></View>}
        <Pressable testID="admin-logout" accessibilityLabel="Sign out" disabled={busy} onPress={askSignOut} style={s.iconButton}><Feather name="log-out" color={c.subdued} size={18} /></Pressable>
      </View>
      {admin && sessionOpen && <View style={s.sessionMenu}>
        <Text style={s.menuLabel}>ACADEMIC SESSIONS</Text>
        {sessionLoading ? <Text style={s.muted}>Loading sessions…</Text> : sessionError ? <Pressable onPress={() => void refreshSessions()}><Text style={s.offline}>Sessions unavailable · Retry</Text></Pressable> : sessions.length === 0 ? <Text style={s.muted}>No academic sessions available</Text> : sessions.map(item => <Pressable key={item.id} testID={`admin-session-${item.id}`} disabled={busy} onPress={() => {
          if (item.id === selectedId) { setSessionOpen(false); return; }
          setBusy(true); setActionError('');
          void select(item.id).then(() => setSessionOpen(false)).catch(e => setActionError(e instanceof Error ? e.message : 'Could not switch session.')).finally(() => setBusy(false));
        }} style={s.menuRow}><Text style={s.menuText}>{item.sessionName}</Text><Text style={{ color: item.isActive ? c.green : c.gold, fontSize: 11 }}>{item.id === selectedId ? 'Viewing' : item.isActive ? 'Active' : 'Archive'}</Text></Pressable>)}
        {!!actionError && <Text style={s.offline}>{actionError}</Text>}
      </View>}
    </View>
    {overview.isPending ? <View style={s.pad}><View style={[s.skeleton, { height: 170 }]} /><View style={[s.skeleton, { height: 22, width: 130, marginTop: 28 }]} /><View style={[s.skeleton, { height: 205, marginTop: 15 }]} /><View style={[s.skeleton, { height: 205, marginTop: 15 }]} /></View>
      : overview.isError || !overview.data ? <View style={s.center}><Feather name={online ? 'alert-circle' : 'wifi-off'} size={32} color={c.cyan} /><Text style={s.errorTitle}>Dashboard unavailable</Text><Text style={s.muted}>{online ? overview.error?.message || 'Could not load your school workspace.' : 'You are offline. Reconnect and try again.'}</Text><Pressable testID="admin-retry" onPress={() => void overview.refetch()} style={s.retry}><Text style={s.retryText}>Try again</Text></Pressable></View>
        : <ScrollView contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, Platform.OS === 'web' ? 34 : 0) + 36 }}>
          {(() => {
            const data = overview.data;
            const tiles = visibleAdminTiles(data.role, data.allowedModuleIds);
            const metrics = visibleMetrics(data);
            const archive = admin ? sessions.find(item => item.id === selectedId && !item.isActive) : undefined;
            return <>
              <View style={s.summary}>
                <View style={s.summaryTop}><Text style={s.schoolName} numberOfLines={1}>{data.schoolName}</Text>{data.schoolCode && <Text style={s.schoolCode}>{data.schoolCode}</Text>}</View>
                {!online && <Text style={s.offline}>Offline · Showing last loaded overview</Text>}
                {metrics.length > 0 && <View style={s.stats}>{metrics.map(metric => <View key={metric.key} style={[s.statCard, { borderColor: metric.color + '40', backgroundColor: metric.color + '0d' }]}>
                  <View style={[s.statIcon, { borderColor: metric.color + '77' }]}><Feather name={metric.icon as IconName} size={19} color={metric.color || c.cyan} /></View>
                  <View style={{ flex: 1 }}><Text numberOfLines={1} style={s.statLabel}>{metric.label}</Text><Text style={s.statValue}>{Number(metric.value).toLocaleString('en-IN')}{metric.key === 'dailyPresence' ? '%' : ''}</Text></View>
                </View>)}</View>}
                {archive && <View style={s.archive}><Feather name="clock" color={c.gold} size={14} /><Text style={{ color: c.gold, flex: 1, fontSize: 12 }}>Archive mode · Viewing {archive.sessionName}</Text></View>}
                <Text style={s.date}>{new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}</Text>
              </View>
              <View style={s.content}>
                {tiles.length === 0 && <View style={s.empty}><Feather name="grid" color={c.cyan} size={28} /><Text style={s.errorTitle}>No modules assigned</Text><Text style={s.muted}>Your administrator has not assigned any dashboard modules to this account.</Text></View>}
                {adminGroups.map(group => {
                  const groupTiles = tiles.filter(t => t.group === group);
                  if (!groupTiles.length) return null;
                  return <View key={group} style={s.group}><View style={s.groupHeading}><Text style={[s.groupTitle, { color: zones[group] }]}>{group.toUpperCase()}</Text><View style={[s.rule, { backgroundColor: zones[group] + '55' }]} /></View>
                    <View style={s.grid}>{groupTiles.map(tile => <View key={tile.id} testID={`admin-tile-${tile.id}`} accessibilityLabel={`${tile.label}, coming to mobile`} style={[s.tile, { borderTopColor: tile.color }]}>
                      <View style={[s.tileIcon, { backgroundColor: tile.color + '17' }]}><Feather name={tile.icon as IconName} size={27} color={tile.color} /></View>
                      <Text style={s.tileTitle}>{tile.label}</Text><Text style={s.tileDesc}>{tile.desc}</Text><Text style={s.pending}>Coming to mobile</Text>
                    </View>)}</View>
                  </View>;
                })}
              </View>
              <Text style={s.footer}>BENIUS Command Center · {data.schoolName}{data.schoolCode ? ` · ${data.schoolCode}` : ''}</Text>
            </>;
          })()}
        </ScrollView>}
    <Modal visible={drawer} transparent animationType="fade" onRequestClose={() => setDrawer(false)}>
      <View style={s.drawerBackdrop}><Pressable accessibilityLabel="Close navigation" onPress={() => setDrawer(false)} style={StyleSheet.absoluteFill} />
        <View style={[s.drawerPanel, { paddingTop: top + 18, paddingBottom: insets.bottom + 24 }]}>
          <View style={s.drawerHead}><Text style={s.drawerBrand}>BENIUS</Text><Pressable testID="admin-menu-close" onPress={() => setDrawer(false)} accessibilityLabel="Close navigation"><Feather name="x" size={22} color={c.ink} /></Pressable></View>
          <Text style={s.drawerSchool}>{overview.data?.schoolName || user.schoolName}</Text>
          <ScrollView style={{ marginTop: 24 }}>
            <View style={s.drawerCurrent}><Feather name="grid" color={c.cyan} size={17} /><Text style={{ color: c.ink, fontWeight: '700' }}>Dashboard</Text></View>
            {overview.data && adminGroups.map(group => {
              const items = visibleAdminTiles(overview.data.role, overview.data.allowedModuleIds).filter(t => t.group === group);
              if (!items.length) return null;
              return <View key={group}><Text style={[s.drawerGroup, { color: zones[group] }]}>{group.toUpperCase()}</Text>{items.map(item => <View key={item.id} style={s.drawerRow}><Feather name={item.icon as IconName} size={15} color={c.faint} /><Text style={s.drawerRowText}>{item.label}</Text><Feather name="lock" size={12} color={c.faint} /></View>)}</View>;
            })}
          </ScrollView>
          {admin && <Pressable testID="admin-drawer-profile" onPress={() => { setDrawer(false); setProfileOpen(true); }} style={s.drawerAction}><Feather name="user" size={17} color={c.ink} /><Text style={s.drawerActionText}>Admin profile</Text></Pressable>}
          <Pressable testID="admin-drawer-logout" onPress={() => { setDrawer(false); askSignOut(); }} style={s.drawerAction}><Feather name="log-out" size={17} color={c.red} /><Text style={[s.drawerActionText, { color: c.red }]}>Sign out</Text></Pressable>
        </View>
      </View>
    </Modal>
    {admin && overview.data && <AdminProfile visible={profileOpen} close={() => setProfileOpen(false)} overview={overview.data} />}
    {!!actionError && !sessionOpen && <Pressable style={s.bottomError} onPress={() => setActionError('')}><Text style={{ color: c.ink }}>{actionError} · Dismiss</Text></Pressable>}
  </View>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.bg }, headerWrap: { backgroundColor: c.header, borderBottomColor: '#2a3548', borderBottomWidth: 1, zIndex: 5 },
  header: { height: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 11 },
  iconButton: { width: 29, height: 34, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 36, height: 36, borderRadius: 11, backgroundColor: '#327ab6', alignItems: 'center', justifyContent: 'center' },
  sessionPill: { width: 51, height: 29, borderRadius: 16, backgroundColor: '#1a333c', borderWidth: 1, borderColor: '#255257', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#183943', borderColor: '#286b72', borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 10, color: c.cyan, fontWeight: '700' }, staffMark: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  summary: { borderBottomWidth: 1, borderBottomColor: '#293346', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 13 },
  schoolName: { color: c.subdued, fontSize: 12, flex: 1, fontWeight: '600' }, schoolCode: { color: c.faint, fontSize: 10, letterSpacing: 1 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  statCard: { width: '48.2%', minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 10 },
  statIcon: { width: 41, height: 41, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  statLabel: { color: c.subdued, fontSize: 10, marginBottom: 3 }, statValue: { color: c.ink, fontSize: 20, fontWeight: '800', letterSpacing: -0.6 },
  date: { color: c.faint, fontSize: 11, textAlign: 'right', marginTop: 13 }, content: { paddingHorizontal: 16, paddingTop: 24 },
  group: { marginBottom: 36 }, groupHeading: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18 },
  groupTitle: { fontWeight: '800', fontSize: 12, letterSpacing: 2 }, rule: { height: 1, flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { width: '48.2%', minHeight: 205, backgroundColor: c.card, borderRadius: 16, borderColor: c.border, borderWidth: 1, borderTopWidth: 3, padding: 13 },
  tileIcon: { width: 51, height: 51, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 19 },
  tileTitle: { color: c.ink, fontSize: 14, fontWeight: '700', lineHeight: 17 },
  tileDesc: { color: c.subdued, fontSize: 11, lineHeight: 17, marginTop: 5, flex: 1 }, pending: { color: c.faint, fontSize: 10, fontWeight: '600', marginTop: 10 },
  footer: { color: c.faint, opacity: 0.7, fontSize: 10, textAlign: 'center', padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 26 },
  empty: { paddingVertical: 55, alignItems: 'center', gap: 8 }, errorTitle: { color: c.ink, fontWeight: '700', fontSize: 20, marginTop: 12, textAlign: 'center' },
  muted: { color: c.subdued, fontSize: 12, lineHeight: 19, textAlign: 'center', marginTop: 7 },
  retry: { backgroundColor: '#2776b1', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10, marginTop: 20 },
  retryText: { color: c.ink, fontWeight: '700' }, pad: { padding: 16 },
  skeleton: { backgroundColor: '#27354a', borderRadius: 12 }, offline: { color: c.gold, fontSize: 12, marginVertical: 8 },
  archive: { backgroundColor: '#343035', padding: 10, borderRadius: 8, flexDirection: 'row', gap: 8, marginTop: 12 },
  sessionMenu: { position: 'absolute', top: '100%', right: 55, width: 240, backgroundColor: '#1c2a3c', borderColor: c.border, borderWidth: 1, borderRadius: 12, padding: 12, elevation: 14 },
  menuLabel: { color: c.faint, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8 },
  menuRow: { paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.border, flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  menuText: { color: c.ink, fontSize: 12, flex: 1 },
  drawerBackdrop: { flex: 1, backgroundColor: '#080e1acc', flexDirection: 'row' },
  drawerPanel: { width: '82%', maxWidth: 340, backgroundColor: c.header, paddingHorizontal: 20 },
  drawerHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  drawerBrand: { color: c.ink, fontSize: 18, letterSpacing: 2, fontWeight: '900' },
  drawerSchool: { color: c.subdued, fontSize: 12, marginTop: 9 }, drawerCurrent: { padding: 13, borderRadius: 10, backgroundColor: '#25384c', flexDirection: 'row', gap: 12 },
  drawerGroup: { fontSize: 10, letterSpacing: 1.6, fontWeight: '800', marginTop: 25, marginBottom: 9 },
  drawerRow: { flexDirection: 'row', gap: 12, paddingVertical: 11, alignItems: 'center', opacity: 0.65 },
  drawerRowText: { color: c.subdued, fontSize: 13, flex: 1 }, drawerAction: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.border },
  drawerActionText: { color: c.ink, fontSize: 13, fontWeight: '600' }, bottomError: { position: 'absolute', bottom: 15, left: 16, right: 16, backgroundColor: '#833d4b', padding: 14, borderRadius: 10 },
  profileHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, borderBottomWidth: 1, borderBottomColor: c.border },
  profileTitle: { color: c.ink, fontSize: 16, fontWeight: '800' }, profileSubtitle: { color: c.subdued, fontSize: 11, marginTop: 4 },
  profileNote: { backgroundColor: '#243848', borderColor: '#456071', borderWidth: 1, padding: 13, borderRadius: 10, flexDirection: 'row', gap: 10, marginBottom: 20 },
  sectionTitle: { color: c.cyan, fontSize: 11, fontWeight: '800', letterSpacing: 1.7, marginTop: 18, marginBottom: 10 },
  infoRow: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, padding: 13, borderRadius: 10, marginBottom: 8 },
  infoLabel: { color: c.subdued, fontSize: 11 }, infoValue: { color: c.ink, fontSize: 14, fontWeight: '600', marginTop: 5 },
  unavailable: { marginTop: 16, padding: 14, borderWidth: 1, borderColor: c.border, borderRadius: 10 },
});