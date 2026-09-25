import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY = 'benius.mobile.session';
// Native mobile session material only; browser previews never persist bearer credentials.
export async function readApprovedSession(): Promise<string | null> {
  return Platform.OS === 'web' ? null : SecureStore.getItemAsync(KEY);
}
export async function saveApprovedSession(material: string): Promise<void> {
  if (Platform.OS === 'web') throw new Error('Native secure storage is required.');
  await SecureStore.setItemAsync(KEY, material, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}
export async function clearApprovedSession(): Promise<void> {
  if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(KEY);
}