import { AccountGate, Home } from '@/components/Authenticated';
export default function Index() { return <AccountGate><Home /></AccountGate>; }