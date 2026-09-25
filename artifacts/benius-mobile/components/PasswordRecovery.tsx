import React, { useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { API_BASE_URL } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { AppHeader, Button, Card, Field, Screen, styles } from '@/components/Foundation';

type Role = 'admin' | 'student' | 'teacher';
type Step = 'start' | 'otp' | 'pin' | 'reset' | 'success';

const genericMessage =
  'If those details match, an OTP has been sent to your recovery email. Please check and try again.';

async function recoveryRequest<T>(path: string, body: unknown): Promise<T> {
  if (!API_BASE_URL) throw new Error('Backend address is not configured.');
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    credentials: 'omit',
  });
  let result: unknown;
  try { result = await response.json(); } catch { result = null; }
  if (!response.ok) {
    const message = result && typeof result === 'object' && 'message' in result
      && typeof result.message === 'string' ? result.message : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  if (!result || typeof result !== 'object') throw new Error('The server returned an invalid recovery response.');
  return result as T;
}

export default function PasswordRecovery({ role }: { role: Role }) {
  const colors = useColors();
  const router = useRouter();
  const [step, setStep] = useState<Step>('start');
  const [schoolCode, setSchoolCode] = useState('');
  const [identity, setIdentity] = useState('');
  const [otp, setOtp] = useState('');
  const [resetPin, setResetPin] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newPin, setNewPin] = useState('');
  const [ticket, setTicket] = useState('');
  const [recoveryToken, setRecoveryToken] = useState('');
  const [message, setMessage] = useState(genericMessage);
  const [busy, setBusy] = useState(false);

  const isStudent = role === 'student';
  const isAdmin = role === 'admin';
  const recoveryPath = `/mobile/auth/recovery/${role}`;

  async function startRecovery() {
    if (busy) return;
    if (!schoolCode.trim() || !identity.trim()) {
      Alert.alert('Details required', isStudent
        ? 'Enter your school code and student ID.'
        : 'Enter your school code and registered email.');
      return;
    }
    setBusy(true);
    try {
      const startBody = isStudent
        ? { schoolCode: schoolCode.trim(), dsid: identity.trim() }
        : isAdmin
          ? { schoolCode: schoolCode.trim(), recoveryEmail: identity.trim() }
          : { schoolCode: schoolCode.trim(), email: identity.trim() };
      const result = await recoveryRequest<{ message?: string; ticket: string }>(`${recoveryPath}/start`, startBody);
      if (typeof result.ticket !== 'string' || !result.ticket) {
        throw new Error('The server did not provide a recovery challenge. Please try again.');
      }
      setTicket(result.ticket);
      setOtp('');
      setMessage(typeof result.message === 'string' ? result.message : genericMessage);
      setStep('otp');
    } catch (error) {
      Alert.alert('Unable to send OTP', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    if (busy) return;
    if (!/^\d{6}$/.test(otp)) {
      Alert.alert('OTP required', 'Enter the complete 6-digit OTP from your email.');
      return;
    }
    setBusy(true);
    try {
      const result = await recoveryRequest<{
        success: boolean;
        recoveryToken: string;
        requiresPin?: boolean;
      }>(`${recoveryPath}/verify`, {
        ticket,
        otp,
      });
      if (!result.success || typeof result.recoveryToken !== 'string' || !result.recoveryToken) {
        throw new Error('The recovery response was incomplete. Request a new OTP.');
      }
      setRecoveryToken(result.recoveryToken);
      if (isAdmin && result.requiresPin) {
        setResetPin('');
        setStep('pin');
        return;
      }
      setNewPassword('');
      setConfirmPassword('');
      setNewPin('');
      setStep('reset');
    } catch (error) {
      Alert.alert('Unable to verify OTP', error instanceof Error
        ? error.message
        : 'The OTP is invalid or expired. Request another OTP and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyResetPin() {
    if (busy) return;
    if (!/^\d{6}$/.test(resetPin)) {
      Alert.alert('PIN required', 'Enter your current 6-digit administrator PIN.');
      return;
    }
    setBusy(true);
    try {
      const result = await recoveryRequest<{ success: boolean; recoveryToken: string }>(
        `${recoveryPath}/verify-pin`,
        { recoveryToken, pin: resetPin },
      );
      if (!result.success || typeof result.recoveryToken !== 'string' || !result.recoveryToken) {
        throw new Error('The recovery response was incomplete. Request a new OTP.');
      }
      setRecoveryToken(result.recoveryToken);
      setResetPin('');
      setNewPassword('');
      setConfirmPassword('');
      setNewPin('');
      setStep('reset');
    } catch (error) {
      Alert.alert('Unable to verify PIN', error instanceof Error
        ? error.message : 'The PIN is invalid or the recovery session has expired.');
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (busy) return;
    if (newPassword.length < 6) {
      Alert.alert('Password too short', 'Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Passwords do not match', 'Enter the same password in both fields.');
      return;
    }
    if (isAdmin && newPin && !/^\d{6}$/.test(newPin)) {
      Alert.alert('Invalid PIN', 'The optional new PIN must contain exactly 6 digits.');
      return;
    }
    setBusy(true);
    try {
      const body = isStudent
        ? { recoveryToken, newPassword }
        : { recoveryToken, newPassword, confirmPassword, ...(isAdmin && newPin ? { newPin } : {}) };
      await recoveryRequest(`${recoveryPath}/reset`, body);
      setTicket('');
      setRecoveryToken('');
      setOtp('');
      setNewPassword('');
      setConfirmPassword('');
      setNewPin('');
      setResetPin('');
      setStep('success');
    } catch (error) {
      Alert.alert('Unable to reset password', error instanceof Error
        ? error.message
        : 'Your recovery session may have expired. Please start again.');
    } finally {
      setBusy(false);
    }
  }

  function returnToSignIn() {
    setTicket('');
    setRecoveryToken('');
    setOtp('');
    setResetPin('');
    setNewPassword('');
    setConfirmPassword('');
    setNewPin('');
    router.back();
  }

  const accountLabel = isAdmin ? 'Administrator' : isStudent ? 'Student' : 'Teacher';
  const title = step === 'start' ? 'Recover password'
    : step === 'otp' ? 'Verify your email'
      : step === 'pin' ? 'Verify your PIN'
      : step === 'reset' ? 'Set a new password' : 'Password updated';

  return <Screen>
    <View style={{ flex: 1, justifyContent: 'center', gap: 22 }}>
      <AppHeader subtitle={`${accountLabel} account recovery`} />
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{
            width: 42, height: 42, borderRadius: 12, backgroundColor: colors.accent,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Feather name={step === 'success' ? 'check-circle' : 'shield'} size={21} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={[styles.title, { color: colors.foreground, fontSize: 22 }]}>{title}</Text>
            <Text style={{ color: colors.mutedForeground, lineHeight: 20 }}>
              {step === 'start' ? 'We will send a one-time code to the recovery email on file.'
                : step === 'otp' ? 'Enter the 6-digit code sent to your recovery email.'
                  : step === 'pin' ? 'Enter your existing administrator PIN to confirm your identity.'
                  : step === 'reset' ? 'Your new password must contain at least 6 characters.'
                    : 'Your password has been reset securely. Sign in with the new password.'}
            </Text>
          </View>
        </View>

        {step === 'start' && <View style={{ gap: 14, marginTop: 8 }}>
          <Field label="School code" value={schoolCode} onChangeText={setSchoolCode} />
          <Field
            label={isStudent ? 'Student ID' : isAdmin ? 'Recovery email' : 'Registered email'}
            value={identity}
            onChangeText={setIdentity}
            keyboardType={isStudent ? 'default' : 'email-address'}
          />
          <Button
            label={busy ? 'Sending…' : 'Send recovery code'}
            icon="mail"
            disabled={busy}
            onPress={() => { void startRecovery(); }}
          />
        </View>}

        {step === 'otp' && <View style={{ gap: 16, marginTop: 8 }}>
          <View style={{ padding: 12, borderRadius: 8, backgroundColor: colors.muted }}>
            <Text style={{ color: colors.mutedForeground, textAlign: 'center', lineHeight: 20 }}>{message}</Text>
          </View>
          <View style={{ gap: 6 }}>
            <Text style={{ color: colors.foreground, fontSize: 14 }}>Six-digit OTP</Text>
            <TextInput
              accessibilityLabel="Six-digit OTP"
              value={otp}
              onChangeText={value => setOtp(value.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={6}
              editable={!busy}
              placeholder="000000"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, {
                color: colors.foreground, borderColor: colors.input, backgroundColor: colors.background,
                textAlign: 'center', fontSize: 22, letterSpacing: 8, fontWeight: '700',
              }]}
            />
          </View>
          <Button label={busy ? 'Verifying…' : 'Verify OTP'} icon="check" disabled={busy} onPress={() => { void verifyOtp(); }} />
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void startRecovery(); }} style={{ padding: 8 }}>
            <Text style={{ color: colors.primary, textAlign: 'center', fontWeight: '600' }}>Resend OTP</Text>
          </Pressable>
        </View>}

        {step === 'pin' && <View style={{ gap: 14, marginTop: 8 }}>
          <View style={{ gap: 6 }}>
            <Text style={{ color: colors.foreground, fontSize: 14 }}>Current 6-digit PIN</Text>
            <TextInput
              accessibilityLabel="Current 6-digit PIN"
              value={resetPin}
              onChangeText={value => setResetPin(value.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              editable={!busy}
              placeholder="••••••"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { color: colors.foreground, borderColor: colors.input, backgroundColor: colors.background, textAlign: 'center', letterSpacing: 8 }]}
            />
          </View>
          <Button label={busy ? 'Verifying…' : 'Verify PIN'} icon="key" disabled={busy} onPress={() => { void verifyResetPin(); }} />
        </View>}

        {step === 'reset' && <View style={{ gap: 14, marginTop: 8 }}>
          <Field label="New password (at least 6 characters)" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
          <Field label="Confirm new password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry />
          {isAdmin && <View style={{ gap: 6 }}>
            <Text style={{ color: colors.foreground, fontSize: 14 }}>New 6-digit PIN (optional)</Text>
            <TextInput
              accessibilityLabel="New 6-digit PIN, optional"
              value={newPin}
              onChangeText={value => setNewPin(value.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              editable={!busy}
              placeholder="Leave blank to keep the existing PIN"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { color: colors.foreground, borderColor: colors.input, backgroundColor: colors.background }]}
            />
          </View>}
          <Button label={busy ? 'Updating…' : 'Reset password'} icon="lock" disabled={busy} onPress={() => { void resetPassword(); }} />
        </View>}

        {step === 'success' && <View style={{ gap: 14, marginTop: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Feather name="check-circle" size={18} color={colors.primary} />
            <Text style={{ color: colors.foreground, flex: 1 }}>Please sign in using your new password.</Text>
          </View>
          <Button label="Back to sign in" icon="arrow-left" onPress={returnToSignIn} />
        </View>}

        {step !== 'success' && <Pressable accessibilityRole="button" onPress={returnToSignIn} style={{ paddingTop: 8 }}>
          <Text style={{ color: colors.mutedForeground, textAlign: 'center' }}>Back to sign in</Text>
        </Pressable>}
      </Card>
    </View>
  </Screen>;
}