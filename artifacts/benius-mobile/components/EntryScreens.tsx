import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError, API_BASE_URL } from '@/lib/api';
import type { Role } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { OfflineBanner } from './Foundation';

type PortalRole = Extract<Role, 'admin' | 'teacher' | 'student'>;
type PortalData = {
  role: PortalRole;
  href: '/login' | '/teacher-login' | '/student-login';
  label: string;
  title: string;
  description: string;
  badge: string;
  icon: React.ComponentProps<typeof Feather>['name'];
};

const portals: PortalData[] = [
  {
    role: 'admin',
    href: '/login',
    label: 'ADMINISTRATION',
    title: 'The Command Center',
    description: 'Secure ops, faculty mapping & global school oversight.',
    badge: 'Admin Portal',
    icon: 'shield',
  },
  {
    role: 'teacher',
    href: '/teacher-login',
    label: 'EDUCATORS',
    title: 'The Classroom Hub',
    description: 'Track student growth, manage schedules & resolve reports.',
    badge: 'Teacher Portal',
    icon: 'book-open',
  },
  {
    role: 'student',
    href: '/student-login',
    label: 'STUDENTS',
    title: 'The Learning Path',
    description: 'View timetables, track attendance & access your profile.',
    badge: 'Student Portal',
    icon: 'book',
  },
];

export function PortalLanding() {
  const c = useColors();
  const b = c.brand;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 640;

  return (
    <View style={[styles.landingRoot, { backgroundColor: b.landingBackground }]}>
      <LinearGradient
        colors={[b.landingTop, b.landingBackground, b.landingTeal, b.landingViolet]}
        locations={[0, 0.4, 0.73, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={[styles.glow, styles.glowTop, { backgroundColor: b.indigo }]} />
      <View pointerEvents="none" style={[styles.glow, styles.glowRight, { backgroundColor: b.cyan }]} />
      <View pointerEvents="none" style={[styles.glow, styles.glowBottom, { backgroundColor: b.violet }]} />
      <View pointerEvents="none" style={styles.dotPattern}>
        {Array.from({ length: 60 }, (_, index) => (
          <View key={index} style={[styles.dot, { backgroundColor: b.white, opacity: index % 3 === 0 ? 0.09 : 0.035 }]} />
        ))}
      </View>

      <View
        style={[
          styles.landingHeader,
          {
            paddingTop: Platform.OS === 'web' ? Math.max(insets.top, 12) : insets.top,
            borderBottomColor: b.glassBorder,
            backgroundColor: b.landingNav,
          },
        ]}
      >
        <View style={styles.landingHeaderInner}>
          <View style={styles.landingBrand}>
            <LinearGradient colors={[b.indigo, b.cyan]} style={styles.landingLogo}>
              <MaterialCommunityIcons name="school-outline" size={19} color={b.white} />
            </LinearGradient>
            <View style={styles.landingBrandText}>
              <Text style={[styles.landingWordmark, { color: b.white }]}>BENIUS</Text>
              {wide ? <Text style={[styles.landingSubtitle, { color: b.textSoft }]}>School Management</Text> : null}
            </View>
          </View>
          {wide ? (
            <View style={[styles.systemStatus, { borderColor: b.statusBorder, backgroundColor: b.statusBackground }]}>
              <View style={[styles.statusDot, { backgroundColor: b.green }]} />
              <Text style={{ color: b.green, fontSize: 11, fontWeight: '600' }}>
                System Status: Operational
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.landingContent,
          { paddingHorizontal: wide ? 24 : 16, paddingVertical: wide ? 20 : 10 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.landingInner, { maxWidth: 1024 }]}>
          <View style={styles.hero}>
            <View style={[styles.heroBadge, { borderColor: b.heroBadgeBorder, backgroundColor: b.heroBadgeBackground }]}>
              <View style={[styles.heroBadgeDot, { backgroundColor: b.indigoLight }]} />
              <Text style={[styles.heroBadgeText, { color: b.heroBadgeText }]}>NEXT-GEN EDTECH PLATFORM</Text>
            </View>
            <Text style={[styles.heroTitle, { color: b.white, fontSize: wide ? 52 : 31, lineHeight: wide ? 59 : 36 }]}>
              The Future of School
              {'\n'}
              <Text style={{ color: b.cyan }}>Management, Simplified.</Text>
            </Text>
            {wide ? (
              <Text style={[styles.heroDescription, { color: b.textMuted }]}>
                Empowering <Text style={{ color: b.heroText, fontWeight: '700' }}>10,000+ minds</Text> with real-time
                {' '}attendance, smart timetables, and secure administration.
              </Text>
            ) : null}
          </View>

          <View style={[styles.portalGrid, { flexDirection: wide ? 'row' : 'column' }]}>
            {portals.map((portal) => {
              const accent = b[portal.role];
              return (
                <Pressable
                  key={portal.href}
                  testID={`link-portal-${portal.role}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${portal.badge}: ${portal.title}`}
                  onPress={() => router.push(portal.href as Href)}
                  style={({ pressed }) => [
                    styles.portalCard,
                    {
                      minHeight: wide ? 248 : 70,
                      flex: wide ? 1 : undefined,
                      borderColor: accent.border,
                      backgroundColor: b.glass,
                      transform: [{ scale: pressed ? 0.985 : 1 }],
                    },
                  ]}
                >
                  <View style={[styles.portalAccent, { backgroundColor: accent.accentFrom }]} />
                  <LinearGradient
                    colors={[accent.orb1, accent.orb2]}
                    style={[
                      styles.portalIcon,
                      {
                        width: wide ? 48 : 44,
                        height: wide ? 48 : 44,
                        borderRadius: wide ? 14 : 12,
                      },
                    ]}
                  >
                    <Feather name={portal.icon} size={wide ? 22 : 20} color={b.white} />
                  </LinearGradient>
                  <View style={styles.portalText}>
                    <Text style={[styles.portalLabel, { color: accent.accentTo }]}>{portal.label}</Text>
                    <Text numberOfLines={wide ? 2 : 1} style={[styles.portalTitle, { color: b.white, fontSize: wide ? 21 : 15 }]}>
                      {portal.title}
                    </Text>
                    {wide ? (
                      <Text style={[styles.portalDescription, { color: b.textMuted }]}>{portal.description}</Text>
                    ) : null}
                  </View>
                  <View style={styles.portalAction}>
                    <Text style={{ color: accent.accentTo, fontSize: wide ? 12 : 11, fontWeight: '600' }}>
                      {wide ? 'Enter Portal' : 'Enter'}
                    </Text>
                    <Feather name="arrow-right" size={wide ? 15 : 17} color={accent.accentTo} />
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.accessHint, { color: b.textMuted }]}>
            Contact your school administrator for access credentials.
          </Text>
        </View>
      </ScrollView>

      <View style={[
        styles.footer,
        {
          borderTopColor: b.glassBorder,
          backgroundColor: b.footerBackground,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingVertical: wide ? 8 : 9,
          flexDirection: wide ? 'row' : 'column',
          justifyContent: wide ? 'space-between' : 'center',
          gap: wide ? 12 : 4,
        },
      ]}>
        <View style={styles.footerStatus}>
          <View style={[styles.statusDot, { backgroundColor: b.green }]} />
          <Text style={[styles.footerText, { color: b.textMuted }]}>All Systems Operational</Text>
        </View>
        <Text numberOfLines={1} style={[styles.footerText, { color: b.textMuted, textAlign: wide ? 'right' : 'center' }]}>
          © {new Date().getFullYear()} BENIUS · Secure Multi-Tenant Infrastructure
        </Text>
      </View>
    </View>
  );
}

type LoginStage = 'credentials' | 'pin' | 'initialize' | 'teacher-change-password';

export function RoleLoginScreen({ role }: { role: PortalRole }) {
  const c = useColors();
  const router = useRouter();
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const isWebPreview = Platform.OS === 'web';
  const [stage, setStage] = useState<LoginStage>('credentials');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryPhone, setRecoveryPhone] = useState('');
  const [challengeToken, setChallengeToken] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (auth.user) router.replace('/');
  }, [auth.user, router]);

  const showError = (reason: unknown) => setError(
    reason instanceof ApiError ? reason.message : 'Something went wrong. Please try again.',
  );

  const submitLogin = async () => {
    setError('');
    setSuccess('');
    if (role === 'admin' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim())) {
      setError('Enter a valid email address');
      return;
    }
    if (role === 'teacher' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim())) {
      setError('Enter a valid email address');
      return;
    }
    if (role === 'student' && !identifier.trim()) {
      setError('DSID is required');
      return;
    }
    if (!password) {
      setError(role === 'student' ? 'Password is required' : 'Password is required');
      return;
    }
    if (isWebPreview) return;

    setBusy(true);
    try {
      const result = await auth.login({ role, identifier: identifier.trim(), password });
      if (result.state === 'pin_required') {
        setPassword('');
        setChallengeToken(result.challengeToken);
        setPin('');
        setStage('pin');
      } else if (result.state === 'initialize_required') {
        setPassword('');
        setChallengeToken(result.challengeToken);
        setPin('');
        setStage('initialize');
      } else if (result.state === 'password_change_required') {
        setChallengeToken(result.challengeToken);
        setNewPassword('');
        setConfirmPassword('');
        setStage('teacher-change-password');
      }
    } catch (reason) {
      showError(reason);
    } finally {
      setBusy(false);
    }
  };

  const submitPin = async (value = pin) => {
    if (!/^\d{6}$/.test(value)) {
      setError('Enter the six-digit PIN for your account.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await auth.verifyPin(challengeToken, value);
    } catch (reason) {
      setPin('');
      showError(reason);
    } finally {
      setBusy(false);
    }
  };

  const submitInitialization = async () => {
    setError('');
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (!/^\d{6}$/.test(pin) || pin !== confirmPin) {
      setError('PINs must match and contain six digits.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmail.trim())) {
      setError('Enter a valid recovery email address.');
      return;
    }
    if (!/^\d{10}$/.test(recoveryPhone.trim())) {
      setError('Enter a valid 10-digit recovery phone number.');
      return;
    }
    setBusy(true);
    try {
      await auth.initialize({
        challengeToken,
        newPassword,
        confirmPassword,
        pin,
        confirmPin,
        recoveryEmail: recoveryEmail.trim(),
        recoveryPhone: recoveryPhone.trim(),
      });
    } catch (reason) {
      showError(reason);
    } finally {
      setBusy(false);
    }
  };

  const submitTeacherPasswordChange = async () => {
    setError('');
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (!challengeToken || !password) {
      setError('Your sign-in challenge has expired. Please sign in again.');
      setStage('credentials');
      setPassword('');
      return;
    }
    setBusy(true);
    try {
      await auth.changeTeacherFirstLoginPassword({
        challengeToken,
        currentPassword: password,
        newPassword,
        confirmPassword,
      });
      setPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setChallengeToken('');
      setStage('credentials');
      setSuccess('Security credentials updated successfully. Please log in again.');
    } catch (reason) {
      showError(reason);
    } finally {
      setBusy(false);
    }
  };

  const openRegistration = async () => {
    setError('');
    const origin = API_BASE_URL.replace(/\/api\/?$/, '');
    if (!origin) {
      setError('The BENIUS registration page is not available right now.');
      return;
    }
    const configuredBase = (process.env.EXPO_PUBLIC_WEB_BASE_PATH ?? '').trim();
    const basePath = configuredBase ? `/${configuredBase.replace(/^\/+|\/+$/g, '')}` : '';
    try {
      await Linking.openURL(`${origin}${basePath}/register`);
    } catch {
      setError('The BENIUS registration page could not be opened.');
    }
  };

  const openRecovery = () => {
    router.push(role === 'admin' ? '/recovery/admin' : role === 'teacher' ? '/recovery/teacher' : '/recovery/student');
  };

  const title = role === 'admin' ? 'Principal Login' : role === 'teacher' ? 'Teacher Login' : 'Student Login';
  const subtitle = role === 'admin'
    ? 'Sign in with your school admin credentials'
    : role === 'teacher'
      ? 'Sign in to your teacher account'
      : 'Sign in with your Digital Student ID and password';
  const brandSubtitle = role === 'student' ? 'Student Portal' : 'School Management';
  const accentIcon = role === 'admin' ? 'log-in' : role === 'teacher' ? 'user' : 'log-in';

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <OfflineBanner />
      {role !== 'teacher' ? (
        <View
          style={[
            styles.loginHeader,
            {
              paddingTop: Platform.OS === 'web' ? Math.max(insets.top, 12) : insets.top,
              borderBottomColor: c.border,
              backgroundColor: c.card,
            },
          ]}
        >
          <View style={styles.loginHeaderInner}>
            <View style={[styles.loginLogo, { backgroundColor: c.primary }]}>
              <MaterialCommunityIcons name="school-outline" size={21} color={c.primaryForeground} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Text style={[styles.loginWordmark, { color: c.foreground }]}>BENIUS</Text>
              <Text style={{ color: c.mutedForeground, fontSize: 13 }}>{brandSubtitle}</Text>
            </View>
          </View>
        </View>
      ) : null}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.loginScroll,
            {
              paddingTop: role === 'teacher' && Platform.OS === 'web' ? Math.max(insets.top, 67) + 12 : 28,
              paddingBottom: Math.max(insets.bottom, 24),
            },
          ]}
          keyboardShouldPersistTaps="handled"
        >
      <View style={[styles.loginCard, { backgroundColor: c.card, borderColor: c.border }]}>
            {role === 'teacher' ? (
              <View style={styles.teacherLoginHeading}>
                <View style={[styles.teacherLoginIcon, { backgroundColor: c.primary }]}>
                  <Feather name={stage === 'teacher-change-password' ? 'lock' : 'user'} size={26} color={c.primaryForeground} />
                </View>
                <Text style={[styles.teacherLoginTitle, { color: c.foreground }]}>
                  {stage === 'teacher-change-password' ? 'Change Password' : title}
                </Text>
                <Text style={[styles.loginDescription, { color: c.mutedForeground }]}>
                  {stage === 'teacher-change-password' ? 'Please set a new password to continue' : subtitle}
                </Text>
              </View>
            ) : (
              <View style={styles.loginCardHeading}>
                <Text style={[styles.loginTitle, { color: c.foreground }]}>
                  <Feather name={accentIcon} size={19} color={c.foreground} /> {stage === 'teacher-change-password' ? 'Change Password' : stage === 'pin' ? 'Enter Your PIN' : stage === 'initialize' ? 'Set up your admin account' : title}
                </Text>
                <Text style={[styles.loginDescription, { color: c.mutedForeground }]}>
                  {stage === 'pin'
                    ? 'Enter your 6-digit security PIN to continue'
                    : stage === 'initialize'
                      ? 'Create your password and six-digit PIN. Recovery details are sent to BENIUS only for account recovery.'
                      : subtitle}
                </Text>
              </View>
            )}

            {isWebPreview ? (
              <View style={[styles.previewNotice, { backgroundColor: c.muted, borderColor: c.border }]}>
                <Text style={{ color: c.mutedForeground, lineHeight: 21 }}>
                  Native sign-in is available in the Android and iOS app. This browser preview shows the form but cannot securely store mobile credentials.
                </Text>
              </View>
            ) : null}

            {success ? (
              <View accessibilityRole="alert" style={[styles.successNotice, { borderColor: c.brand.successBorder, backgroundColor: c.brand.successBackground }]}>
                <Feather name="check-circle" size={17} color={c.brand.successIcon} />
                <Text style={{ color: c.brand.successText, flex: 1, lineHeight: 20 }}>{success}</Text>
              </View>
            ) : null}
            {error ? (
              <View accessibilityRole="alert" style={[styles.errorNotice, { borderColor: c.destructive, backgroundColor: `${c.destructive}12` }]}>
                <Feather name="alert-circle" size={17} color={c.destructive} />
                <Text style={{ color: c.destructive, flex: 1, lineHeight: 20 }}>{error}</Text>
              </View>
            ) : null}
            {auth.restoreError ? (
              <View accessibilityRole="alert" style={[styles.errorNotice, { borderColor: c.destructive, backgroundColor: `${c.destructive}12` }]}>
                <Feather name="alert-circle" size={17} color={c.destructive} />
                <Text style={{ color: c.destructive, flex: 1, lineHeight: 20 }}>{auth.restoreError} Your saved mobile session has not been deleted.</Text>
              </View>
            ) : null}

            {stage === 'credentials' ? (
              <View style={styles.form}>
                <EntryField
                  label={role === 'student' ? 'Digital Student ID (DSID)' : 'Email'}
                  placeholder={role === 'student' ? 'e.g. MLS-0001' : role === 'admin' ? 'principal@school.com' : 'teacher@school.com'}
                  value={identifier}
                  onChangeText={setIdentifier}
                  keyboardType={role === 'student' ? 'default' : 'email-address'}
                  icon={role === 'teacher' ? 'mail' : undefined}
                  disabled={busy}
                />
                <EntryField
                  label="Password"
                  placeholder="Enter your password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  onToggleSecure={role !== 'student' ? () => setShowPassword(value => !value) : undefined}
                  icon={role === 'teacher' ? 'lock' : undefined}
                  disabled={busy}
                />
                <PrimaryAction
                  label={isWebPreview ? 'Sign in on Android or iOS' : 'Sign In'}
                  busy={busy}
                  disabled={busy || isWebPreview}
                  onPress={() => { void submitLogin(); }}
                />
                <Pressable
                  accessibilityRole="link"
                  disabled={busy}
                  onPress={openRecovery}
                  style={({ pressed }) => [styles.textLink, { opacity: pressed ? 0.72 : 1 }]}
                >
                  <Text style={[styles.linkText, { color: c.primary }]}>
                    {role === 'admin' ? 'Forgot password?' : role === 'teacher' ? 'Forgot Password?' : 'Forgot your password?'}
                  </Text>
                </Pressable>
                {role === 'student' ? (
                  <View style={styles.registerRow}>
                    <Text style={{ color: c.mutedForeground, fontSize: 13 }}>Haven't activated your account? </Text>
                    <Pressable accessibilityRole="link" onPress={() => { void openRegistration(); }}>
                      <Text style={[styles.linkText, { color: c.primary }]}>Register here</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : null}

            {stage === 'pin' ? (
              <View style={styles.form}>
                <PinKeypad
                  value={pin}
                  disabled={busy || isWebPreview}
                  onChange={(value) => { setPin(value); setError(''); }}
                />
                {busy ? <BusyLabel label="Verifying…" /> : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => { setStage('credentials'); setPin(''); setChallengeToken(''); setError(''); }}
                  style={styles.textLink}
                >
                  <Text style={{ color: c.mutedForeground, fontSize: 14 }}>‹  Back to login</Text>
                </Pressable>
              </View>
            ) : null}

            {stage === 'initialize' ? (
              <View style={styles.form}>
                <EntryField label="New password" placeholder="Min 6 characters" value={newPassword} onChangeText={setNewPassword} secureTextEntry disabled={busy} />
                <EntryField label="Confirm password" placeholder="Repeat password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry disabled={busy} />
                <EntryField label="New six-digit PIN" placeholder="6-digit PIN" value={pin} onChangeText={value => setPin(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" secureTextEntry disabled={busy} />
                <EntryField label="Confirm PIN" placeholder="Repeat PIN" value={confirmPin} onChangeText={value => setConfirmPin(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" secureTextEntry disabled={busy} />
                <EntryField label="Recovery email" placeholder="backup@gmail.com" value={recoveryEmail} onChangeText={setRecoveryEmail} keyboardType="email-address" disabled={busy} />
                <EntryField label="Recovery phone" placeholder="10-digit phone number" value={recoveryPhone} onChangeText={value => setRecoveryPhone(value.replace(/\D/g, '').slice(0, 10))} keyboardType="phone-pad" disabled={busy} />
                <PrimaryAction label="Complete setup" busy={busy} disabled={busy || isWebPreview} onPress={() => { void submitInitialization(); }} />
                <Pressable accessibilityRole="button" onPress={() => { setStage('credentials'); setError(''); setChallengeToken(''); }} style={styles.textLink}>
                  <Text style={{ color: c.mutedForeground, fontSize: 14 }}>‹  Back to login</Text>
                </Pressable>
              </View>
            ) : null}

            {stage === 'teacher-change-password' ? (
              <View style={styles.form}>
                <EntryField label="New Password" placeholder="At least 6 characters" value={newPassword} onChangeText={setNewPassword} secureTextEntry disabled={busy} />
                <EntryField label="Confirm Password" placeholder="Repeat your new password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry disabled={busy} />
                <PrimaryAction label="Update Password" busy={busy} disabled={busy || isWebPreview} onPress={() => { void submitTeacherPasswordChange(); }} />
              </View>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function EntryField({
  label,
  placeholder,
  value,
  onChangeText,
  keyboardType = 'default',
  secureTextEntry = false,
  onToggleSecure,
  icon,
  disabled = false,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: React.ComponentProps<typeof TextInput>['keyboardType'];
  secureTextEntry?: boolean;
  onToggleSecure?: () => void;
  icon?: React.ComponentProps<typeof Feather>['name'];
  disabled?: boolean;
}) {
  const c = useColors();
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, { color: c.foreground }]}>{label}</Text>
      <View style={[styles.inputWrap, { borderColor: c.input, backgroundColor: c.card }]}>
        {icon ? <Feather name={icon} size={16} color={c.mutedForeground} /> : null}
        <TextInput
          testID={`field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={c.mutedForeground}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry}
          editable={!disabled}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { color: c.foreground }]}
          returnKeyType="done"
        />
        {onToggleSecure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={secureTextEntry ? 'Show password' : 'Hide password'}
            onPress={onToggleSecure}
            style={{ padding: 4 }}
          >
            <Feather name={secureTextEntry ? 'eye' : 'eye-off'} size={16} color={c.mutedForeground} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function PrimaryAction({
  label,
  onPress,
  busy,
  disabled,
}: {
  label: string;
  onPress: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      testID={`button-${label.toLowerCase().replace(/\s+/g, '-')}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        { backgroundColor: c.primary, opacity: disabled ? 0.55 : pressed ? 0.8 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={c.primaryForeground} /> : null}
      <Text style={[styles.primaryButtonText, { color: c.primaryForeground }]}>{label}</Text>
    </Pressable>
  );
}

function BusyLabel({ label }: { label: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
      <ActivityIndicator size="small" color={c.primary} />
      <Text style={{ color: c.mutedForeground, fontSize: 14 }}>{label}</Text>
    </View>
  );
}

function PinKeypad({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const c = useColors();
  const keys: (number | 'delete' | null)[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, 'delete'];
  const pressKey = (key: number | 'delete' | null) => {
    if (disabled || key === null) return;
    if (key === 'delete') onChange(value.slice(0, -1));
    else if (value.length < 6) onChange(`${value}${key}`);
  };
  return (
    <View style={styles.pinPad}>
      <View accessibilityLabel={`${value.length} of 6 PIN digits entered`} style={styles.pinDots}>
        {Array.from({ length: 6 }, (_, index) => (
          <View key={index} style={[styles.pinDot, { borderColor: c.input, backgroundColor: index < value.length ? c.primary : 'transparent' }]} />
        ))}
      </View>
      <View style={styles.pinGrid}>
        {keys.map((key, index) => (
          <Pressable
            key={`${key ?? 'empty'}-${index}`}
            accessibilityRole={key === null ? undefined : 'button'}
            accessibilityLabel={key === 'delete' ? 'Delete last PIN digit' : key === null ? undefined : String(key)}
            disabled={disabled || key === null}
            onPress={() => pressKey(key)}
            style={({ pressed }) => [
              styles.pinKey,
              {
                backgroundColor: key === null ? 'transparent' : c.secondary,
                opacity: disabled ? 0.5 : pressed ? 0.72 : 1,
              },
            ]}
          >
            {key === 'delete'
              ? <Feather name="delete" size={18} color={c.secondaryForeground} />
              : key === null
                ? null
                : <Text style={{ color: c.secondaryForeground, fontSize: 20, fontWeight: '600' }}>{key}</Text>}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  landingRoot: { flex: 1, overflow: 'hidden' },
  glow: { position: 'absolute', borderRadius: 999, opacity: 0.1 },
  glowTop: { width: 430, height: 430, top: -160, left: -150 },
  glowRight: { width: 480, height: 480, top: 60, right: -260, opacity: 0.075 },
  glowBottom: { width: 380, height: 380, bottom: -210, left: '18%', opacity: 0.08 },
  dotPattern: { ...StyleSheet.absoluteFill, flexDirection: 'row', flexWrap: 'wrap', opacity: 0.6 },
  dot: { width: 2, height: 2, borderRadius: 1, margin: 17 },
  landingHeader: { minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, zIndex: 2 },
  landingHeaderInner: { minHeight: 56, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  landingBrand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  landingLogo: { width: 32, height: 32, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  landingBrandText: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  landingWordmark: { fontFamily: 'ArchitectsDaughter_400Regular', fontWeight: '900', fontSize: 18, letterSpacing: -0.4 },
  landingSubtitle: { fontSize: 11, fontWeight: '500' },
  systemStatus: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  landingContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  landingInner: { width: '100%', gap: 18 },
  hero: { alignItems: 'center', gap: 12, paddingHorizontal: 3 },
  heroBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroBadgeDot: { width: 6, height: 6, borderRadius: 3 },
  heroBadgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 1.15 },
  heroTitle: { fontFamily: 'ArchitectsDaughter_400Regular', fontWeight: '900', letterSpacing: -0.7, textAlign: 'center' },
  heroDescription: { maxWidth: 560, textAlign: 'center', fontSize: 15, lineHeight: 24 },
  portalGrid: { gap: 10 },
  portalCard: { position: 'relative', overflow: 'hidden', borderWidth: 1, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12 },
  portalAccent: { position: 'absolute', left: 0, top: 12, bottom: 12, width: 2, borderRadius: 2 },
  portalIcon: { alignItems: 'center', justifyContent: 'center', shadowOpacity: 0.25, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  portalText: { flex: 1, minWidth: 0 },
  portalLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.5, marginBottom: 3 },
  portalTitle: { fontFamily: 'ArchitectsDaughter_400Regular', fontWeight: '700', lineHeight: 21 },
  portalDescription: { fontSize: 12, lineHeight: 19, marginTop: 9 },
  portalAction: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  accessHint: { fontSize: 11, textAlign: 'center', marginTop: 1 },
  footer: { minHeight: 42, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 20, paddingTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  footerStatus: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  footerText: { fontSize: 10, fontWeight: '500', flexShrink: 1 },
  loginHeader: { borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 64 },
  loginHeaderInner: { minHeight: 64, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', gap: 12 },
  loginLogo: { width: 40, height: 40, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  loginWordmark: { fontFamily: 'ArchitectsDaughter_400Regular', fontWeight: '700', fontSize: 19, letterSpacing: -0.3 },
  loginScroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, paddingVertical: 24 },
  loginCard: { width: '100%', maxWidth: 448, borderWidth: 1, borderRadius: 8, padding: 22, gap: 20 },
  loginCardHeading: { alignItems: 'center', gap: 7 },
  teacherLoginHeading: { alignItems: 'center', gap: 9, paddingBottom: 2 },
  teacherLoginIcon: { width: 56, height: 56, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  teacherLoginTitle: { fontFamily: 'ArchitectsDaughter_400Regular', fontSize: 25, fontWeight: '700', textAlign: 'center' },
  loginTitle: { fontFamily: 'ArchitectsDaughter_400Regular', fontSize: 21, fontWeight: '700', textAlign: 'center' },
  loginDescription: { fontSize: 14, textAlign: 'center', lineHeight: 21 },
  previewNotice: { borderWidth: 1, borderRadius: 6, padding: 12 },
  successNotice: { borderWidth: 1, borderRadius: 6, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorNotice: { borderWidth: 1, borderRadius: 6, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  form: { gap: 16 },
  fieldGroup: { gap: 7 },
  fieldLabel: { fontSize: 14, fontWeight: '500' },
  inputWrap: { minHeight: 40, borderWidth: 1, borderRadius: 6, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 11, gap: 9 },
  input: { flex: 1, minWidth: 0, paddingVertical: 8, fontSize: 14, lineHeight: 20 },
  primaryButton: { minHeight: 42, borderRadius: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 14 },
  primaryButtonText: { fontFamily: 'ArchitectsDaughter_400Regular', fontSize: 16, fontWeight: '600' },
  textLink: { minHeight: 34, alignItems: 'center', justifyContent: 'center', paddingVertical: 5 },
  linkText: { fontSize: 14, fontWeight: '500' },
  registerRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' },
  pinPad: { gap: 16, alignItems: 'center' },
  pinDots: { flexDirection: 'row', gap: 12, justifyContent: 'center', paddingVertical: 8 },
  pinDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5 },
  pinGrid: { width: 246, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  pinKey: { width: 68, height: 56, margin: 4, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});