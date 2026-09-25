import React, { useState } from 'react';
import { Alert, Platform, Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useAcademicSession } from '@/contexts/SessionContext';
import { ApiError, Role } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { PortalLanding } from './EntryScreens';
import { AppHeader, Button, Card, Field, Screen, State, styles } from './Foundation';

const roles: { value: Role; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'teacher', label: 'Teacher' },
  { value: 'student', label: 'Student' },
  { value: 'support_staff', label: 'Support staff' },
];

export function AccountGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Screen><State loading title="Checking your account" detail="Restoring and verifying your mobile session…" /></Screen>;
  if (!user) return <PortalLanding />;
  return <>{children}</>;
}

export function Login() {
  const c = useColors();
  const router = useRouter();
  const auth = useAuth();
  const isWebPreview = Platform.OS === 'web';
  const [role, setRole] = useState<Role>('student');
  const [stage, setStage] = useState<'login' | 'pin' | 'initialize' | 'teacher-guidance'>('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryPhone, setRecoveryPhone] = useState('');
  const [challengeToken, setChallengeToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const showError = (reason: unknown) => setError(reason instanceof ApiError
    ? reason.message
    : 'Something went wrong. Please try again.');
  const submitLogin = async () => {
    if (!identifier.trim() || !password) {
      setError('Enter your account identifier and password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await auth.login({ role, identifier: identifier.trim(), password });
      if (result.state === 'pin_required') {
        setPassword('');
        setChallengeToken(result.challengeToken);
        setStage('pin');
      } else if (result.state === 'initialize_required') {
        setPassword('');
        setChallengeToken(result.challengeToken);
        setStage('initialize');
      } else if (result.state === 'password_change_required') {
        setPassword('');
        setStage('teacher-guidance');
      }
    } catch (reason) {
      showError(reason);
    } finally {
      setBusy(false);
    }
  };
  const submitPin = async () => {
    if (!/^\d{6}$/.test(pin)) {
      setError('Enter the six-digit PIN for your account.');
      return;
    }
    setBusy(true);
    setError('');
    try { await auth.verifyPin(challengeToken, pin); } catch (reason) { showError(reason); } finally { setBusy(false); }
  };
  const submitInitialization = async () => {
    if (!newPassword || !confirmPassword || !/^\d{6}$/.test(pin) || !/^\d{6}$/.test(confirmPin)) {
      setError('Complete both password fields and enter matching six-digit PINs.');
      return;
    }
    if (newPassword !== confirmPassword || pin !== confirmPin) {
      setError('Passwords and PIN confirmation must match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await auth.initialize({ challengeToken, newPassword, confirmPassword, pin, confirmPin, recoveryEmail: recoveryEmail.trim(), recoveryPhone: recoveryPhone.trim() });
    } catch (reason) {
      showError(reason);
    } finally {
      setBusy(false);
    }
  };

  const identityLabel = role === 'student' ? 'Student DSID' : role === 'admin' || role === 'teacher' ? 'Email address' : 'Account identifier';
  return <Screen>
    <AppHeader subtitle="Secure mobile sign-in" />
    <View style={{ height: 34 }} />
    <Text style={[styles.title, { color: c.foreground, fontSize: 30 }]}>Welcome to BENIUS.</Text>
    <Text style={{ color: c.mutedForeground, marginTop: 10, marginBottom: 24, lineHeight: 24 }}>Sign in with your school account. Your role and school access are verified by BENIUS.</Text>
    {isWebPreview && <Card>
      <Text style={{ color: c.foreground, lineHeight: 22 }}>Native sign-in is available in the Android and iOS app. This browser preview shows the form but cannot securely store mobile credentials.</Text>
    </Card>}
    {stage === 'login' && <>
      <Text style={{ color: c.foreground, marginBottom: 10 }}>Choose your account type</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        {roles.map(item => <Pressable key={item.value} testID={`role-${item.value}`} accessibilityRole="button" accessibilityState={{ selected: role === item.value }} onPress={() => { setRole(item.value); setError(''); }}
          style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, backgroundColor: role === item.value ? c.primary : c.secondary }}>
          <Text style={{ color: role === item.value ? c.primaryForeground : c.secondaryForeground }}>{item.label}</Text>
        </Pressable>)}
      </View>
      <Card>
        <Field label={identityLabel} value={identifier} onChangeText={setIdentifier} keyboardType={role === 'student' ? 'default' : 'email-address'} disabled={busy} />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry disabled={busy} />
        <Button label={isWebPreview ? 'Sign in on Android or iOS' : busy ? 'Signing in…' : 'Continue'} icon="arrow-right" disabled={busy || isWebPreview} onPress={() => { void submitLogin(); }} />
        {(role === 'student' || role === 'teacher' || role === 'admin') && <Pressable accessibilityRole="link" onPress={() => router.push(role === 'student' ? '/recovery/student' : role === 'teacher' ? '/recovery/teacher' : '/recovery/admin')} style={{ alignSelf: 'center', padding: 12 }}>
          <Text style={{ color: c.primary, textDecorationLine: 'underline' }}>Forgot your password?</Text>
        </Pressable>}
      </Card>
    </>}
    {stage === 'pin' && <Card>
      <Text style={[styles.title, { color: c.foreground }]}>Verify your admin PIN</Text>
      <Text style={{ color: c.mutedForeground, lineHeight: 22 }}>Enter the six-digit PIN associated with your admin account.</Text>
      <Field label="Six-digit PIN" value={pin} onChangeText={value => setPin(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" secureTextEntry disabled={busy} />
      <Button label={busy ? 'Verifying…' : 'Verify PIN'} icon="lock" disabled={busy} onPress={() => { void submitPin(); }} />
    </Card>}
    {stage === 'initialize' && <Card>
      <Text style={[styles.title, { color: c.foreground }]}>Set up your admin account</Text>
      <Text style={{ color: c.mutedForeground, lineHeight: 22 }}>Create your password and six-digit PIN. Recovery details are sent to BENIUS only for account recovery.</Text>
      <Field label="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry disabled={busy} />
      <Field label="Confirm password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry disabled={busy} />
      <Field label="New six-digit PIN" value={pin} onChangeText={value => setPin(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" secureTextEntry disabled={busy} />
      <Field label="Confirm PIN" value={confirmPin} onChangeText={value => setConfirmPin(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" secureTextEntry disabled={busy} />
      <Field label="Recovery email" value={recoveryEmail} onChangeText={setRecoveryEmail} keyboardType="email-address" disabled={busy} />
      <Field label="Recovery phone" value={recoveryPhone} onChangeText={setRecoveryPhone} keyboardType="phone-pad" disabled={busy} />
      <Button label={busy ? 'Setting up…' : 'Complete setup'} icon="check" disabled={busy} onPress={() => { void submitInitialization(); }} />
    </Card>}
    {stage === 'teacher-guidance' && <Card>
      <Text style={[styles.title, { color: c.foreground }]}>Password change required</Text>
      <Text style={{ color: c.mutedForeground, lineHeight: 23 }}>For your security, change your password on the existing BENIUS website, then return here and sign in with the updated password. Mobile sign-in cannot bypass this requirement.</Text>
      <Button label="Back to sign in" secondary onPress={() => { setPassword(''); setStage('login'); setError(''); }} />
    </Card>}
    {auth.restoreError ? <Text accessibilityRole="alert" style={{ color: c.destructive, marginTop: 14, lineHeight: 22 }}>{auth.restoreError} Your saved mobile session has not been deleted.</Text> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: c.destructive, marginTop: 14, lineHeight: 22 }}>{error}</Text> : null}
    {stage !== 'login' && stage !== 'teacher-guidance' && <Button label="Back" secondary onPress={() => {
      setError('');
      setStage('login');
      setPin('');
      setConfirmPin('');
      setNewPassword('');
      setConfirmPassword('');
      setChallengeToken('');
    }} />}
    <Text style={{ color: c.mutedForeground, marginTop: 22, textAlign: 'center', lineHeight: 22 }}>Need help signing in? Contact your school administrator.</Text>
  </Screen>;
}

export function Home() {
  const { user } = useAuth();
  const { sessions, selectedId, loading: sessionsLoading, error: sessionsError } = useAcademicSession();
  const router = useRouter();
  const c = useColors();
  if (!user) return null;
  const selectedSession = sessions.find(session => session.id === selectedId);
  const title = user.role === 'support_staff' ? 'Support staff workspace' : `${user.role.charAt(0).toUpperCase()}${user.role.slice(1)} workspace`;
  return <Screen>
    <AppHeader subtitle={title} />
    <View style={{ height: 35 }} />
    <Text style={{ color: c.mutedForeground, fontSize: 14 }}>YOUR SPACE</Text>
    <Text style={[styles.title, { color: c.foreground, fontSize: 32, marginTop: 7 }]}>Hello, {user.name}.</Text>
    <Text style={{ color: c.mutedForeground, marginTop: 8, marginBottom: 25 }}>{user.schoolName}</Text>
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Feather name="shield" size={20} color={c.primary} />
        <Text style={[styles.title, { color: c.foreground, flex: 1 }]}>Mobile sign-in is active</Text>
      </View>
      <Text style={{ color: c.mutedForeground, lineHeight: 23 }}>Your identity and school were verified by BENIUS. School modules are not yet available in the mobile app.</Text>
    </Card>
    {user.role !== 'support_staff' && <Pressable
      testID="home-session-selector"
      accessibilityRole="button"
      accessibilityLabel={`Academic sessions. ${selectedSession ? `${selectedSession.sessionName}, ${selectedSession.isActive ? 'Active' : 'Archive'}` : sessionsLoading ? 'Loading' : sessionsError ? 'Unavailable' : 'No session selected'}. Open session selector`}
      onPress={() => router.push('/sessions')}
      style={({ pressed }) => ({
        marginTop: 14, marginBottom: 18, minHeight: 58, paddingHorizontal: 16,
        flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 8,
        borderColor: c.border, backgroundColor: c.card, opacity: pressed ? 0.72 : 1,
      })}>
      <Feather name={selectedSession && !selectedSession.isActive ? 'clock' : 'calendar'} size={19} color={c.primary} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.mutedForeground, fontSize: 12 }}>ACADEMIC SESSION</Text>
        <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 15, marginTop: 3 }}>
          {selectedSession ? `${selectedSession.sessionName} · ${selectedSession.isActive ? 'Active' : 'Archive'}` : sessionsLoading ? 'Loading sessions…' : sessionsError ? 'Sessions unavailable' : 'Choose a session'}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={c.mutedForeground} />
    </Pressable>}
    {user.role === 'support_staff' && <Card>
      <Text style={[styles.title, { color: c.foreground }]}>Support staff navigation</Text>
      {user.allowedModules?.length
        ? user.allowedModules.map(module => <Text key={module} style={{ color: c.mutedForeground, lineHeight: 23 }}>{module} · Available in a later mobile phase</Text>)
        : <Text style={{ color: c.mutedForeground, lineHeight: 23 }}>No mobile modules are currently available for this account.</Text>}
    </Card>}
    <Button label="Account & settings" icon="user" secondary onPress={() => router.push('/profile')} />
  </Screen>;
}

export function Sessions() {
  const c = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const { sessions, selectedId, loading, error, refresh, select } = useAcademicSession();
  const [switchingId, setSwitchingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const selected = sessions.find(session => session.id === selectedId);
  const reload = async () => {
    setActionError('');
    setRefreshing(true);
    try { await refresh(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Could not refresh academic sessions.'); }
    finally { setRefreshing(false); }
  };
  const switchTo = async (id: number) => {
    if (switchingId !== null || id === selectedId) return;
    setActionError('');
    setSwitchingId(id);
    try { await select(id); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Could not switch academic session. Your previous selection is still in use.'); }
    finally { setSwitchingId(null); }
  };
  return <Screen>
    <AppHeader subtitle="Academic sessions" />
    <View style={{ height: 25 }} />
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, alignSelf: 'flex-start' }}>
      <Feather name="arrow-left" size={17} color={c.primary} /><Text style={{ color: c.primary }}>Back</Text>
    </Pressable>
    <Text style={[styles.title, { color: c.foreground, marginTop: 12, marginBottom: 8 }]}>Academic Sessions</Text>
    <Text style={{ color: c.mutedForeground, lineHeight: 22, marginBottom: 20 }}>Choose the school year you want to view. Archived sessions are for looking back; this does not change the school's active session.</Text>
    {user?.role === 'support_staff' ? <Card>
      <Feather name="info" size={22} color={c.primary} />
      <Text style={[styles.title, { color: c.foreground }]}>Sessions unavailable</Text>
      <Text style={{ color: c.mutedForeground, lineHeight: 22 }}>Academic-session switching is not available for support staff accounts in BENIUS Mobile. Contact your school administrator if you need access to a school year.</Text>
    </Card> : <>
      {selected && <View style={{ paddingVertical: 12, paddingHorizontal: 15, borderRadius: 8, borderWidth: 1, borderColor: selected.isActive ? '#86c8a0' : '#dfba77', backgroundColor: selected.isActive ? '#e9f6ee' : '#fff4dc', marginBottom: 20 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: selected.isActive ? '#15803d' : '#9a5709' }}>CURRENT VIEW · {selected.isActive ? 'ACTIVE SESSION' : 'ARCHIVE'}</Text>
        <Text style={{ fontSize: 16, fontWeight: '600', color: '#263449', marginTop: 4 }}>{selected.sessionName}</Text>
      </View>}
      {actionError ? <View accessibilityRole="alert" style={{ backgroundColor: c.card, borderColor: c.destructive, borderWidth: 1, borderRadius: 8, padding: 13, marginBottom: 14 }}>
        <Text style={{ color: c.destructive, lineHeight: 21 }}>{actionError}</Text>
        <Text style={{ color: c.mutedForeground, marginTop: 5 }}>Your previous session remains selected. Try again when connected.</Text>
      </View> : null}
      {error && <View accessibilityRole="alert" style={{ backgroundColor: c.card, borderColor: c.destructive, borderWidth: 1, borderRadius: 8, padding: 14, marginBottom: 14 }}>
        <Text style={{ color: c.destructive, lineHeight: 21 }}>Could not load academic sessions. {error.message}</Text>
        <Pressable testID="sessions-retry" accessibilityRole="button" accessibilityLabel="Try again" disabled={refreshing} onPress={() => { void reload(); }} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
          <Text style={{ color: c.primary, fontWeight: '600' }}>{refreshing ? 'Retrying…' : 'Try again'}</Text>
        </Pressable>
      </View>}
      {loading && sessions.length === 0 ? <View accessibilityLabel="Loading academic sessions" style={{ gap: 10 }}>
        <Text style={{ color: c.mutedForeground }}>Loading academic sessions…</Text>
        {[0, 1, 2].map(index => <View key={index} style={{ height: 64, backgroundColor: c.muted, borderRadius: 8, opacity: 1 - index * 0.2 }} />)}
      </View> : sessions.length === 0 && !error ? <Card>
        <Feather name="calendar" size={24} color={c.primary} />
        <Text style={[styles.title, { color: c.foreground }]}>No sessions found</Text>
        <Text style={{ color: c.mutedForeground, lineHeight: 22 }}>There are no academic sessions available for your school account yet.</Text>
        <Button label="Refresh sessions" secondary icon="refresh-cw" disabled={refreshing} onPress={() => { void reload(); }} />
      </Card> : sessions.length > 0 ? <View style={{ borderRadius: 8, borderWidth: 1, borderColor: c.border, overflow: 'hidden', backgroundColor: c.card }}>
        <Text style={{ color: c.mutedForeground, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border }}>SWITCH VIEW SESSION</Text>
        {sessions.map((session, index) => {
          const isSelected = session.id === selectedId;
          return <Pressable key={session.id} testID={`session-option-${session.id}`} accessibilityRole="button"
            accessibilityLabel={`${session.sessionName}, ${session.isActive ? 'Active session' : 'Archived'}${isSelected ? ', currently viewing' : ', switch view'}`}
            accessibilityState={{ selected: isSelected, disabled: switchingId !== null || isSelected }}
            disabled={switchingId !== null || isSelected} onPress={() => { void switchTo(session.id); }}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, minHeight: 64,
              borderBottomWidth: index === sessions.length - 1 ? 0 : 1, borderBottomColor: c.border, opacity: pressed ? 0.68 : 1,
              backgroundColor: isSelected ? c.accent : c.card })}>
            <View style={{ height: 8, width: 8, borderRadius: 4, backgroundColor: session.isActive ? '#14b8a6' : c.mutedForeground }} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.foreground, fontSize: 15, fontWeight: isSelected ? '700' : '500' }}>{session.sessionName}</Text>
              <Text style={{ color: session.isActive ? '#15803d' : '#b45309', fontSize: 12, marginTop: 3 }}>{session.isActive ? 'Active session' : isSelected ? 'Viewing archive' : 'Archived'}</Text>
            </View>
            {isSelected ? <Feather name="check" size={18} color={c.primary} /> : switchingId === session.id
              ? <Text style={{ color: c.mutedForeground, fontSize: 12 }}>Switching…</Text>
              : <Feather name="chevron-right" size={17} color={c.mutedForeground} />}
          </Pressable>;
        })}
      </View> : null}
    </>}
  </Screen>;
}

export function Profile() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const c = useColors();
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  if (!user) return <AccountGate><></></AccountGate>;
  const confirmLogout = async () => {
    setSigningOut(true);
    setLogoutError('');
    try {
      await logout();
      router.replace('/');
    } catch (reason) {
      const detail = reason instanceof ApiError ? reason.message : 'The request failed.';
      setLogoutError(`Sign-out was not confirmed. Your mobile session remains active. ${detail} Retry when connected.`);
    } finally {
      setSigningOut(false);
    }
  };
  return <Screen>
    <AppHeader subtitle="Account" /><View style={{ height: 32 }} />
    <Card><Feather name="user" size={27} color={c.primary} /><Text style={[styles.title, { color: c.foreground }]}>{user.name}</Text>
      <Text style={{ color: c.mutedForeground }}>{user.role.replace('_', ' ').toUpperCase()}</Text>
      <Text style={{ color: c.mutedForeground }}>{user.schoolName}</Text>
    </Card>
    <View style={{ height: 18 }} />
    <Button label="Academic sessions" secondary icon="calendar" onPress={() => router.push('/sessions')} />
    <View style={{ height: 12 }} />
    <Button label="Settings" secondary icon="settings" onPress={() => router.push('/settings')} />
    <View style={{ height: 30 }} />
    {logoutError ? <Text accessibilityRole="alert" style={{ color: c.destructive, lineHeight: 22 }}>{logoutError}</Text> : null}
    <Button label={signingOut ? 'Signing out…' : logoutError ? 'Retry sign out' : 'Sign out'} icon="log-out" disabled={signingOut}
      onPress={() => Alert.alert('Sign out?', 'BENIUS will revoke this mobile session before this device clears it.', [
        { text: 'Cancel', style: 'cancel' }, { text: logoutError ? 'Retry sign out' : 'Sign out', style: 'destructive', onPress: () => { void confirmLogout(); } },
      ])} />
  </Screen>;
}

export function Settings() {
  const c = useColors();
  return <AccountGate><Screen><AppHeader subtitle="Settings" /><View style={{ height: 36 }} />
    <Card><Text style={[styles.title, { color: c.foreground }]}>Appearance</Text><Text style={{ color: c.mutedForeground }}>Follows your device's light or dark mode.</Text></Card>
    <View style={{ height: 14 }} />
    <Card><Text style={[styles.title, { color: c.foreground }]}>About BENIUS Mobile</Text><Text style={{ color: c.mutedForeground, lineHeight: 22 }}>Secure native authentication and academic-session selection are available. School modules will be introduced in later phases.</Text></Card>
  </Screen></AccountGate>;
}