import React from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useAcademicSession } from '@/contexts/SessionContext';
import { useColors } from '@/hooks/useColors';
import { AppHeader, Button, Card, Screen, State, styles } from './Foundation';

export function AccountGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Screen><State loading title="Checking your account" detail="Restoring a verified mobile session…" /></Screen>;
  if (!user) return <Login />;
  return <>{children}</>;
}
export function Login() {
  const c = useColors();
  return <Screen>
    <AppHeader subtitle="School Management" />
    <View style={{ height: 44 }} />
    <Text style={[styles.title, { color: c.foreground, fontSize: 30 }]}>Welcome to BENIUS.</Text>
    <Text style={{ color: c.mutedForeground, marginTop: 10, marginBottom: 28, lineHeight: 24 }}>Your school, always within reach.</Text>
    <Card>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <Feather name="lock" size={24} color={c.primary} />
        <Text style={[styles.title, { color: c.foreground, flex: 1 }]}>Mobile sign-in is coming</Text>
      </View>
      <Text style={{ color: c.mutedForeground, lineHeight: 23 }}>BENIUS currently signs in through browser sessions. The mobile app will not ask for your password until a secure, approved mobile sign-in method is available.</Text>
      <Button label="Sign in unavailable" disabled onPress={() => {}} />
    </Card>
    <Text style={{ color: c.mutedForeground, marginTop: 25, textAlign: 'center', lineHeight: 22 }}>For now, use the existing BENIUS website to access your school account.</Text>
  </Screen>;
}
const roleModules = {
  student: ['My learning', 'Attendance', 'Timetable', 'Examinations'],
  teacher: ['My classes', 'Attendance', 'Timetable', 'Assessments'],
  admin: ['School overview', 'People', 'Academic setup', 'Reports'],
};
export function Home() {
  const { user } = useAuth();
  const { sessions, selectedId, loading, error, refresh } = useAcademicSession();
  const router = useRouter();
  const c = useColors();
  if (!user) return null;
  return <Screen>
    <AppHeader subtitle={`${user.role.charAt(0).toUpperCase() + user.role.slice(1)} workspace`} />
    <View style={{ height: 35 }} />
    <Text style={{ color: c.mutedForeground, fontSize: 14 }}>YOUR SPACE</Text>
    <Text style={[styles.title, { color: c.foreground, fontSize: 32, marginTop: 7 }]}>Hello, {user.name}.</Text>
    <Text style={{ color: c.mutedForeground, marginTop: 8, marginBottom: 25 }}>A simpler way to stay connected to school.</Text>
    <Card>
      <Text style={{ color: c.mutedForeground }}>ACADEMIC SESSION</Text>
      {loading ? <State loading title="Loading sessions" /> : error ? <State title="Sessions unavailable" detail={error.message} retry={() => { void refresh(); }} /> :
        <Text style={[styles.title, { color: c.foreground }]}>{sessions.find(s => s.id === selectedId)?.sessionName ?? 'No sessions available'}</Text>}
      <Button label="Choose session" icon="calendar" secondary onPress={() => router.push('/sessions')} />
    </Card>
    <Text style={[styles.title, { color: c.foreground, marginTop: 30, marginBottom: 14 }]}>Explore</Text>
    {roleModules[user.role].map(module => <Card key={module}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Feather name="grid" size={20} color={c.primary} /><Text style={{ color: c.foreground, fontSize: 17, flex: 1 }}>{module}</Text>
      <Text style={{ color: c.mutedForeground }}>Future phase</Text>
    </View></Card>)}
    <View style={{ height: 20 }} />
    <Button label="Account & settings" icon="user" secondary onPress={() => router.push('/profile')} />
  </Screen>;
}
export function Sessions() {
  const { user } = useAuth();
  const { sessions, selectedId, loading, error, refresh, select } = useAcademicSession();
  const c = useColors();
  const router = useRouter();
  if (!user) return <AccountGate><></></AccountGate>;
  return <Screen scroll={false}>
    <AppHeader subtitle="Academic sessions" />
    <Text style={{ color: c.mutedForeground, marginVertical: 18 }}>Only sessions returned for your signed-in school are available.</Text>
    {loading ? <State loading title="Loading sessions" /> : error ? <State title="Could not load sessions" detail={error.message} retry={() => { void refresh(); }} /> :
      <FlatList data={sessions} keyExtractor={item => String(item.id)}
        refreshing={false} onRefresh={() => { void refresh(); }}
        ListEmptyComponent={<State title="No sessions yet" detail="Ask your school administrator to set up an academic session." />}
        renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityState={{ selected: item.id === selectedId }} onPress={() => { void select(item.id).then(() => router.back()).catch(() => Alert.alert('Session unavailable', 'Refresh and try again.')); }}
          style={{ minHeight: 58, flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: c.border, gap: 12 }}>
          <Text style={{ color: c.foreground, flex: 1, fontSize: 17 }}>{item.sessionName}</Text>{item.id === selectedId && <Feather name="check" size={20} color={c.primary} />}
        </Pressable>} />}
  </Screen>;
}
export function Profile() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const c = useColors();
  if (!user) return <AccountGate><></></AccountGate>;
  return <Screen>
    <AppHeader subtitle="Account" /><View style={{ height: 32 }} />
    <Card><Feather name="user" size={27} color={c.primary} /><Text style={[styles.title, { color: c.foreground }]}>{user.name}</Text>
      <Text style={{ color: c.mutedForeground }}>{user.role.toUpperCase()} · School account</Text></Card>
    <View style={{ height: 18 }} />
    <Button label="Academic session" secondary icon="calendar" onPress={() => router.push('/sessions')} />
    <View style={{ height: 12 }} />
    <Button label="Settings" secondary icon="settings" onPress={() => router.push('/settings')} />
    <View style={{ height: 30 }} />
    <Button label="Sign out" icon="log-out" onPress={() => Alert.alert('Sign out?', 'Your local session selection will be cleared.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => { void logout(); router.replace('/'); } },
    ])} />
  </Screen>;
}
export function Settings() {
  const c = useColors();
  return <AccountGate><Screen><AppHeader subtitle="Settings" /><View style={{ height: 36 }} />
    <Card><Text style={[styles.title, { color: c.foreground }]}>Appearance</Text><Text style={{ color: c.mutedForeground }}>Follows your device's light or dark mode.</Text></Card>
    <View style={{ height: 14 }} />
    <Card><Text style={[styles.title, { color: c.foreground }]}>About BENIUS Mobile</Text><Text style={{ color: c.mutedForeground, lineHeight: 22 }}>Foundation release. School features and secure mobile sign-in are not yet available.</Text></Card>
  </Screen></AccountGate>;
}