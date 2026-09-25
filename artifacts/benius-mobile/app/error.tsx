import { useRouter } from 'expo-router';
import { Screen, State } from '@/components/Foundation';
export default function ErrorScreen() {
  const router = useRouter();
  return <Screen><State title="Something went wrong" detail="BENIUS could not complete this action. No changes have been confirmed." retry={() => router.replace('/')} /></Screen>;
}