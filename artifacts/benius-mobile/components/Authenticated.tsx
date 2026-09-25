import React, { useState } from 'react';
import { Alert, Platform, Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError, Role } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
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
  if (!user) return <Login />;
  return <>{children}</>;
}

export function Login() {
  const c = useColors();
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
  const router = useRouter();
  const c = useColors();
  if (!user) return null;
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
      <Text style={{ color: c.mutedForeground, lineHeight: 23 }}>Your identity and school were verified by BENIUS. Academic sessions and school modules are deferred to a later mobile release; this app will not use browser-only session endpoints.</Text>
    </Card>
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
  return <Screen>
    <AppHeader subtitle="Academic sessions" />
    <View style={{ height: 30 }} />
    <Card>
      <Text style={[styles.title, { color: c.foreground }]}>Academic sessions are deferred</Text>
      <Text style={{ color: c.mutedForeground, lineHeight: 23 }}>The existing Academic Session endpoints use browser cookies and are not part of mobile authentication. BENIUS Mobile will not call them or treat their cookie-auth failure as a sign-out.</Text>
    </Card>
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
    <Card><Text style={[styles.title, { color: c.foreground }]}>About BENIUS Mobile</Text><Text style={{ color: c.mutedForeground, lineHeight: 22 }}>Secure native authentication is enabled. School modules and academic-session support will be introduced in later phases.</Text></Card>
  </Screen></AccountGate>;
}