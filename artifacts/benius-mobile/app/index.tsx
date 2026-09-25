import { AccountGate } from '@/components/Authenticated';
import AdminDashboard from '@/components/AdminDashboard';
import StudentDashboard from '@/components/StudentDashboard';
import TeacherDashboard from '@/components/TeacherDashboard';
import { useAuth } from '@/contexts/AuthContext';
import { dashboardForRole } from '@/lib/admin-dashboard-pure.mjs';

function VerifiedHome() {
  const { user } = useAuth();
  const destination = dashboardForRole(user?.role);
  if (destination === 'student') return <StudentDashboard />;
  if (destination === 'teacher') return <TeacherDashboard />;
  if (destination === 'admin') return <AdminDashboard />;
  return null;
}

export default function Index() {
  return <AccountGate><VerifiedHome /></AccountGate>;
}