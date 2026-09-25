import { AccountGate, Home } from '@/components/Authenticated';
import StudentDashboard from '@/components/StudentDashboard';
import { useAuth } from '@/contexts/AuthContext';

function VerifiedHome() {
  const { user } = useAuth();
  return user?.role === 'student' ? <StudentDashboard /> : <Home />;
}

export default function Index() {
  return <AccountGate><VerifiedHome /></AccountGate>;
}