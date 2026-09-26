import React from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useNetwork } from '@/contexts/NetworkContext';
import { KeyboardAwareScrollViewCompat } from './KeyboardAwareScrollViewCompat';

export function Screen({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const padding = { paddingTop: Platform.OS === 'web' ? Math.max(insets.top, 67) + 14 : insets.top + 14, paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom + 18, paddingHorizontal: 22 };
  return <View style={{ flex: 1, backgroundColor: c.background }}>
    <OfflineBanner />
    {scroll ? <KeyboardAwareScrollViewCompat contentContainerStyle={[{ flexGrow: 1 }, padding]}>{children}</KeyboardAwareScrollViewCompat>
      : <View style={[{ flex: 1 }, padding]}>{children}</View>}
  </View>;
}
export function OfflineBanner() {
  const { online } = useNetwork();
  const c = useColors();
  return online ? null : <View accessibilityRole="alert" style={{ backgroundColor: c.destructive, padding: 10 }}><Text style={{ color: c.destructiveForeground, textAlign: 'center' }}>Offline · Connect to refresh. Changes are not saved.</Text></View>;
}
export function AppHeader({ subtitle }: { subtitle: string }) {
  const c = useColors();
  return <View style={styles.brandRow}>
    <View style={[styles.brandIcon, { backgroundColor: c.primary }]}><Feather name="book-open" size={24} color={c.primaryForeground} /></View>
    <View><Text style={[styles.brand, { color: c.foreground }]}>BENIUS</Text><Text style={{ color: c.mutedForeground, fontSize: 13 }}>{subtitle}</Text></View>
  </View>;
}
export function Button({ label, onPress, disabled = false, secondary = false, icon }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean; icon?: React.ComponentProps<typeof Feather>['name'] }) {
  const c = useColors();
  return <Pressable testID={`button-${label.toLowerCase().replace(/\s+/g, '-')}`} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, { backgroundColor: secondary ? c.secondary : c.primary, opacity: disabled ? .48 : pressed ? .75 : 1 }]}>
    {icon && <Feather name={icon} size={18} color={secondary ? c.secondaryForeground : c.primaryForeground} />}
    <Text style={{ fontFamily: 'OpenSans_400Regular', fontSize: 17, color: secondary ? c.secondaryForeground : c.primaryForeground }}>{label}</Text>
  </Pressable>;
}
export function Field({ label, value, onChangeText, secureTextEntry, disabled, keyboardType }: { label: string; value: string; onChangeText: (v: string) => void; secureTextEntry?: boolean; disabled?: boolean; keyboardType?: React.ComponentProps<typeof TextInput>['keyboardType'] }) {
  const c = useColors();
  return <View style={{ gap: 6 }}><Text style={{ color: c.foreground, fontSize: 14 }}>{label}</Text><TextInput testID={`field-${label.toLowerCase().replace(/\s+/g, '-')}`} accessibilityLabel={label} editable={!disabled} autoCapitalize="none" autoCorrect={false} keyboardType={keyboardType} secureTextEntry={secureTextEntry} value={value} onChangeText={onChangeText} placeholder={label} placeholderTextColor={c.mutedForeground} style={[styles.input, { color: c.foreground, borderColor: c.input, backgroundColor: c.card }]} /></View>;
}
export function Card({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>{children}</View>;
}
export function State({ title, detail, retry, loading = false }: { title: string; detail?: string; retry?: () => void; loading?: boolean }) {
  const c = useColors();
  return <View style={{ alignItems: 'center', paddingVertical: 28, gap: 12 }}>
    {loading ? <ActivityIndicator color={c.primary} /> : <Feather name={retry ? 'alert-circle' : 'info'} size={26} color={c.primary} />}
    <Text style={[styles.title, { color: c.foreground, textAlign: 'center' }]}>{title}</Text>
    {detail && <Text style={{ color: c.mutedForeground, textAlign: 'center', lineHeight: 22 }}>{detail}</Text>}
    {retry && <Button label="Try again" onPress={retry} secondary />}
  </View>;
}
export const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandIcon: { width: 48, height: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  brand: { fontFamily: 'OpenSans_400Regular', fontSize: 25 },
  title: { fontFamily: 'OpenSans_400Regular', fontSize: 23 },
  button: { minHeight: 50, borderRadius: 8, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  input: { minHeight: 50, borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, fontSize: 16 },
  card: { borderWidth: 1, borderRadius: 8, padding: 18, gap: 14 },
});