import { useRouter } from 'expo-router';
import { Screen, State } from '@/components/Foundation';
export default function NetworkError() {
  const router = useRouter();
  return <Screen><State title="Connection unavailable" detail="Check your connection, then try again. Nothing has been saved while offline." retry={() => router.back()} /></Screen>;
}