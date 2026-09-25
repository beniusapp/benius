import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiGetForSession, apiPost, apiPostForSession } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { useAcademicSession } from '@/contexts/SessionContext';
import { Button, State } from '@/components/Foundation';
import AdminAcademicModules from '@/components/AdminAcademicModules';
import AdminWorkflowModules, { type AdminWorkflowModuleId } from '@/components/AdminWorkflowModules';
import AdminFinanceModules from '@/components/AdminFinanceModules';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const moduleNames: Record<string, string> = {
  'school-setup': 'School Setup',
  'exam-controller': 'Exam Controller',
  'attendance-overview': 'Attendance Overview',
  'student-registry': 'Student Registry',
  'visitor-log': 'Visitor Log',
  'audit-logs': 'Audit Logs',
  'school-calendar': 'School Calendar',
  timetable: 'Timetable Master',
  'complaint-hub': 'Complaint Hub',
  noticeboard: 'Noticeboard',
  'approval-center': 'Approval Center',
  'leave-requests': 'Leave Requests',
  'teacher-registry': 'Teacher Registry',
  'non-teaching-staff': 'Support Staff',
  'faculty-mapping': 'Faculty Mapping',
  'fees-manager': 'Fees & Payments',
  analytics: 'Analytics',
  'id-card-gen': 'ID Card Gen',
  assets: 'Assets & Inventory',
};
const academicModules = ['timetable', 'faculty-mapping', 'analytics', 'id-card-gen'] as const;
const workflowModules: AdminWorkflowModuleId[] = ['complaint-hub', 'noticeboard', 'approval-center', 'leave-requests', 'teacher-registry', 'non-teaching-staff'];

const workspace = {
  background: '#101a2c',
  card: '#1a2942',
  panel: '#0f1e35',
  border: '#334155',
  ink: '#f5f7fa',
  subdued: '#a4aec0',
  faint: '#77859a',
  gold: '#d4af37',
  green: '#37c993',
  red: '#f0777c',
  cyan: '#36bcd3',
};

type VisitorEntry = {
  id: number;
  visitorName: string;
  purpose: string;
  hostName: string;
  phone: string | null;
  email: string | null;
  visitorIdNumber: string | null;
  address: string | null;
  checkIn: string;
  checkOut: string | null;
};

type AuditEntry = {
  id: number;
  createdAt: string;
  actionType: string;
  entityType: string;
  actionByRole: string;
  details: string | null;
};

type CalendarEvent = {
  id: number;
  title: string;
  date: string;
  eventType: string;
  venue: string | null;
  description: string | null;
  colorCode: string | null;
  isRecurring: boolean;
  audienceScope: string;
  targetClass: string | null;
  targetSection: string | null;
};

type CalendarResponse = {
  events: CalendarEvent[];
  classes: string[];
  classSections: Record<string, string[]>;
};

type VisitorFilter = 'all' | 'day' | 'week' | 'month' | 'custom';

function formatIST(value: string | Date, withTime = true): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    ...(withTime ? { dateStyle: 'medium' as const, timeStyle: 'short' as const } : { dateStyle: 'medium' as const }),
  }).format(date);
}

function istDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function dateOffset(date: string, days: number): string {
  const current = new Date(`${date}T00:00:00.000Z`);
  current.setUTCDate(current.getUTCDate() + days);
  return current.toISOString().slice(0, 10);
}

function visitorRange(mode: VisitorFilter, today: string, from: string, to: string): [string, string] | null {
  if (mode === 'all') return null;
  if (mode === 'day') return [today, today];
  if (mode === 'month') return [today.slice(0, 7) + '-01', today];
  if (mode === 'custom') {
    if (!from || !to) return null;
    return from <= to ? [from, to] : [to, from];
  }
  const day = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return [dateOffset(today, mondayOffset), today];
}

function belongsToRange(dateTime: string, range: [string, string] | null): boolean {
  if (!range) return true;
  const key = istDateKey(new Date(dateTime));
  return key >= range[0] && key <= range[1];
}

function eventAudience(event: CalendarEvent): string {
  if (event.audienceScope === 'Entire_Class') return `Class ${event.targetClass || ''}`.trim();
  if (event.audienceScope === 'Specific_Section') return `Class ${event.targetClass || ''} · Section ${event.targetSection || ''}`.trim();
  return 'All School';
}

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function AdminFrame({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return <View style={[styles.page, {
    paddingTop: Platform.OS === 'web' ? Math.max(insets.top, 67) + 14 : insets.top + 14,
    paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom + 18,
  }]}>
    <View style={styles.topBar}>
      <Pressable testID="admin-module-back" accessibilityRole="button" accessibilityLabel="Back to Admin dashboard" onPress={onBack} style={styles.iconButton}>
        <Feather name="arrow-left" size={21} color={workspace.ink} />
      </Pressable>
      <View style={{ flex: 1 }}><Text style={styles.brand}>BENIUS</Text><Text style={styles.subtitle}>{title}</Text></View>
      <View style={styles.sessionIndicator}><Feather name="shield" size={17} color={workspace.gold} /></View>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>{children}</ScrollView>
  </View>;
}

function ModuleCard({ children }: { children: React.ReactNode }) {
  return <View style={styles.adminCard}>{children}</View>;
}

function ModuleField({ label, value, onChangeText, keyboardType, secureTextEntry }: {
  label: string; value: string; onChangeText: (value: string) => void;
  keyboardType?: React.ComponentProps<typeof TextInput>['keyboardType'];
  secureTextEntry?: boolean;
}) {
  return <View style={{ gap: 6 }}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput
      testID={`field-${label.toLowerCase().replace(/\s+/g, '-')}`}
      accessibilityLabel={label}
      value={value}
      onChangeText={onChangeText}
      keyboardType={keyboardType}
      secureTextEntry={secureTextEntry}
      autoCapitalize="none"
      autoCorrect={false}
      placeholder={label}
      placeholderTextColor={workspace.faint}
      style={styles.textInput}
    />
  </View>;
}

function SectionTitle({ title, detail }: { title: string; detail?: string }) {
  return <View style={styles.sectionHeading}><Text style={styles.heading}>{title}</Text>{detail && <Text style={styles.detail}>{detail}</Text>}</View>;
}

function Pill({ label, active, onPress, disabled = false, icon }: {
  label: string; active?: boolean; onPress?: () => void; disabled?: boolean; icon?: React.ComponentProps<typeof Feather>['name'];
}) {
  return <Pressable testID={`admin-pill-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} disabled={disabled || !onPress}
    accessibilityRole="button" accessibilityState={{ selected: !!active, disabled: disabled || !onPress }}
    onPress={onPress} style={[styles.pill, active && styles.pillActive, disabled && styles.disabled]}>
    {icon && <Feather name={icon} size={14} color={active ? workspace.background : workspace.subdued} />}
    <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
  </Pressable>;
}

function Line({ label, value }: { label: string; value: string }) {
  return <View style={styles.line}><Text style={styles.lineLabel}>{label}</Text><Text style={styles.lineValue}>{value || '—'}</Text></View>;
}

export default function AdminModule() {
  const params = useLocalSearchParams<{ module?: string | string[] }>();
  const requestedModule = Array.isArray(params.module) ? params.module[0] : params.module || '';
  const moduleId = requestedModule === 'attendance' ? 'attendance-overview' : requestedModule;
  const name = moduleNames[moduleId];
  const { user } = useAuth();
  const { online } = useNetwork();
  const router = useRouter();
  const sessions = useAcademicSession();
  const [calendarMonth, setCalendarMonth] = useState(calendarMonthKey());
  const support = user?.role === 'support_staff';
  const isAdmin = user?.role === 'admin';
  const canEnterModule = !!user && !!name && (isAdmin || user.role === 'support_staff' && (user.allowedModules || []).includes(requestedModule));
  const selectedSession = sessions.sessions.find(item => item.id === sessions.selectedId);
  const sessionRequired = moduleId === 'audit-logs' || moduleId === 'visitor-log'
    || moduleId === 'exam-controller' || moduleId === 'attendance-overview'
    || academicModules.some(id => id === moduleId)
    || workflowModules.some(id => id === moduleId)
    || moduleId === 'fees-manager';
  const sessionReady = !sessionRequired || support || !!sessions.selectedId;
  const onBack = () => router.replace('/');
  const viewPath = moduleId === 'audit-logs'
    ? '/mobile/admin/modules/audit-logs'
    : moduleId === 'visitor-log'
      ? '/mobile/admin/modules/visitor-log'
      : '/mobile/admin/modules/school-calendar';
  const queryIdentity = [moduleId, user?.schoolId, user?.id, support ? 'active-session' : sessions.selectedId];
  const viewQuery = useQuery({
    queryKey: ['admin-module', ...queryIdentity, moduleId === 'school-calendar' ? calendarMonth : ''],
    queryFn: async ({ signal }): Promise<AuditEntry[] | VisitorEntry[] | CalendarResponse> => {
      if (!user) throw new Error('Sign in to load this administrator module.');
      if (!online) throw new Error('You are offline. Reconnect and try again.');
      if (moduleId === 'school-calendar') {
        const result = await apiGet<CalendarResponse>(`${viewPath}?month=${calendarMonth}`, { signal });
        if (!result || !Array.isArray(result.events) || !Array.isArray(result.classes) || !result.classSections) {
          throw new Error('The server returned an invalid calendar response.');
        }
        return result;
      }
      const result = support
        ? await apiGet<AuditEntry[] | VisitorEntry[]>(viewPath, { signal })
        : await apiGetForSession<AuditEntry[] | VisitorEntry[]>(viewPath, sessions.selectedId!, { signal });
      if (!Array.isArray(result)) throw new Error('The server returned an invalid module response.');
      return result;
    },
    enabled: canEnterModule && sessionReady && ['audit-logs', 'visitor-log', 'school-calendar'].includes(moduleId),
    staleTime: moduleId === 'school-calendar' ? 30_000 : 0,
    refetchInterval: moduleId === 'visitor-log' ? 30_000 : false,
  });

  if (!user || !['admin', 'support_staff'].includes(user.role) || !canEnterModule) {
    return <AdminFrame title={name || 'Administrator'} onBack={onBack}>
      <State title="Access denied" detail="This module is not available to this account." />
    </AdminFrame>;
  }

  if (moduleId === 'school-setup') {
    return <SchoolSetupModule user={user} onBack={onBack} online={online} />;
  }

  if (moduleId === 'student-registry') {
    return <StudentRegistryModule user={user} onBack={onBack} online={online} />;
  }

  if (moduleId === 'attendance-overview') {
    return <AttendanceOverviewModule user={user} onBack={onBack} online={online}
      selectedSessionId={support ? null : sessions.selectedId}
      selectedSessionName={support ? 'Active session' : selectedSession?.sessionName || ''} />;
  }

  if (moduleId === 'exam-controller') {
    if (!selectedSession && !support) {
      return <AdminFrame title="Exam Controller" onBack={onBack}>
        <State title="Select an academic session" detail="Exam results and promotion decisions are isolated by academic session." retry={() => router.push('/sessions')} />
        <Button label="Choose academic session" icon="calendar" onPress={() => router.push('/sessions')} />
      </AdminFrame>;
    }
    if (sessions.loading && !support) {
      return <AdminFrame title="Exam Controller" onBack={onBack}><State title="Loading academic session" loading /></AdminFrame>;
    }
    if (sessions.error && !support) {
      return <AdminFrame title="Exam Controller" onBack={onBack}><State title="Academic session unavailable" detail={sessions.error.message} retry={() => { void sessions.refresh(); }} /></AdminFrame>;
    }
    return <ExamControllerModule user={user} onBack={onBack} online={online}
      selectedSessionId={support ? null : sessions.selectedId}
      selectedSessionName={support ? 'Active session' : selectedSession?.sessionName || ''}
      isArchive={!support && selectedSession ? !selectedSession.isActive : false} />;
  }

  if (sessionRequired && !support && (sessions.loading || sessions.error || !sessions.selectedId)) {
    return <AdminFrame title={name} onBack={onBack}>
      <State title={sessions.loading ? 'Loading academic session' : sessions.error ? 'Academic session unavailable' : 'Select an academic session'}
        detail={sessions.error?.message || 'Choose the school year for this module.'}
        loading={sessions.loading}
        retry={sessions.error ? () => { void sessions.refresh(); } : () => router.push('/sessions')} />
    </AdminFrame>;
  }

  if (academicModules.some(id => id === moduleId)) {
    return <AdminAcademicModules moduleId={moduleId as typeof academicModules[number]} user={user}
      sessionId={support ? null : sessions.selectedId}
      sessionName={support ? 'Active session' : selectedSession?.sessionName || ''}
      isArchive={!support && !!selectedSession && !selectedSession.isActive} schoolName={user.schoolName} />;
  }

  if (workflowModules.some(id => id === moduleId)) {
    return <AdminWorkflowModules moduleId={moduleId as AdminWorkflowModuleId} schoolId={user.schoolId}
      sessionId={support ? 0 : sessions.selectedId!}
      archived={!support && !!selectedSession && !selectedSession.isActive}
      allowedSubs={user.allowedModules?.filter(id => id.startsWith(`${moduleId}:`)).map(id => id.slice(moduleId.length + 1))} />;
  }

  if (moduleId === 'fees-manager' || moduleId === 'assets') {
    return <AdminFinanceModules moduleId={moduleId} />;
  }

  if (sessions.loading && sessionRequired && !support) {
    return <AdminFrame title={name} onBack={onBack}><State title="Loading academic session" loading /></AdminFrame>;
  }

  if (sessions.error && sessionRequired && !support) {
    return <AdminFrame title={name} onBack={onBack}>
      <State title="Academic session unavailable" detail={sessions.error.message} retry={() => { void sessions.refresh(); }} />
    </AdminFrame>;
  }

  if (!sessionReady) {
    return <AdminFrame title={name} onBack={onBack}>
      <State title="Select an academic session" detail="Choose the school year for this module before viewing its records." retry={() => router.push('/sessions')} />
      <Button label="Choose academic session" icon="calendar" onPress={() => router.push('/sessions')} />
    </AdminFrame>;
  }

  return <AdminFrame title={name} onBack={onBack}>
    {!online && <View style={styles.offline}><Feather name="wifi-off" color={workspace.ink} size={15} /><Text style={styles.offlineText}>Offline · Reconnect to refresh or save changes.</Text></View>}
    {sessionRequired && !support && selectedSession && <View style={styles.sessionBanner}>
      <Feather name="calendar" color={workspace.gold} size={15} />
      <Text style={styles.sessionText}>{selectedSession.sessionName}{!selectedSession.isActive ? ' · Archive · Changes locked' : ''}</Text>
      <Pressable testID="admin-change-session" onPress={() => router.push('/sessions')}><Text style={styles.sessionLink}>Change</Text></Pressable>
    </View>}
    {viewQuery.isPending ? <State title={`Loading ${name}`} loading />
      : viewQuery.isError || !viewQuery.data
        ? <State title={`${name} unavailable`} detail={viewQuery.error?.message || 'The server returned no data.'} retry={() => { void viewQuery.refetch(); }} />
        : moduleId === 'visitor-log'
          ? <VisitorModule
              data={viewQuery.data as VisitorEntry[]}
              queryKey={['admin-module', ...queryIdentity, '']}
              selectedSessionId={support ? null : sessions.selectedId}
              isArchive={isAdmin && selectedSession ? !selectedSession.isActive : false}
              canCheckIn={isAdmin || user.allowedModules?.includes('visitor-log:checkin') === true}
              canCheckOut={isAdmin || user.allowedModules?.includes('visitor-log:checkout') === true}
            />
          : moduleId === 'audit-logs'
            ? <AuditModule data={viewQuery.data as AuditEntry[]} />
            : <CalendarModule
                data={viewQuery.data as CalendarResponse}
                month={calendarMonth}
                onMonthChange={setCalendarMonth}
                queryKey={['admin-module', ...queryIdentity, calendarMonth]}
                canEdit={isAdmin || user.allowedModules?.includes('school-calendar:events') === true}
              />}
    <View style={styles.footer}><Text style={styles.footerText}>BENIUS Command Center · {user.schoolName}</Text></View>
  </AdminFrame>;
}

type SetupData = {
  metadata: Record<string, unknown>;
  sessions: Array<{ id: number; sessionName: string; startDate: string; endDate: string; isActive: boolean; status: string; newAdmissionsEnabled: boolean; promotionStrategy: string; copiedModules?: string | null }>;
  gradingTiers: Array<{ id: number; name: string; classes: string[]; passPercentage: number; gradingSystem: string; passingGrades: string[]; sortOrder: number }>;
  gradingRules: Array<{ id: number; tierId: number; gradeLabel: string; minPercent: number; maxPercent: number; gradePoint: string; remarks: string }>;
  examPolicyTiers: Array<{ id: number; tierName: string; applicableClasses: string[]; examWeights: string; promotionFailRules: string; resultsConfig: string }>;
  leavePolicies: Array<{ id: number; name: string; annualLimit: number; targetRoles: string; renewalMonth: number; renewalDay: number; expiryBehavior: string; isActive: boolean }>;
  attendancePolicies: Array<{ id: number; targetRole: string; policyName: string; applicableClasses: string[]; expectedArrivalTime: string; gracePeriodMinutes: number; halfDayCutoffTime: string; schoolEndTime: string; attendanceTarget: number; isActive: boolean }>;
};

type GradeDraft = {
  id?: number;
  name: string;
  classes: string[];
  passPercentage: string;
  gradingSystem: 'percentage' | 'grade' | 'both';
  passingGrades: string;
  rules: Array<{ gradeLabel: string; minPercent: string; maxPercent: string; gradePoint: string; remarks: string }>;
};
type PolicyTargetTerm = { name: string; components: Array<{ exam: string; weight: string }> };
type PolicyRule = { term: string; value: string };
type PolicyColumns = { profile: boolean; weighted: boolean; grade: boolean; fails: boolean; attendance: boolean; gate: boolean; report: boolean; cumulative: boolean; final: boolean };

const setupTabs = [
  { id: 'academic-sessions', label: 'Sessions' },
  { id: 'classes', label: 'Classes' },
  { id: 'sections', label: 'Sections' },
  { id: 'subjects', label: 'Subjects' },
  { id: 'exam-types', label: 'Exam Types' },
  { id: 'class-section-mapping', label: 'Class · Sections' },
  { id: 'class-subject-mapping', label: 'Class · Subjects' },
  { id: 'class-examtype-mapping', label: 'Class · Exams' },
  { id: 'grading', label: 'Grading' },
  { id: 'exam-policy', label: 'Exam Policy' },
  { id: 'leave-policy', label: 'Leave Policy' },
  { id: 'attendance-policy', label: 'Attendance Policy' },
] as const;

function SchoolSetupModule({ user, onBack, online }: {
  user: NonNullable<ReturnType<typeof useAuth>['user']>;
  onBack: () => void;
  online: boolean;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<(typeof setupTabs)[number]['id']>('academic-sessions');
  const [itemName, setItemName] = useState('');
  const [mapClass, setMapClass] = useState('');
  const [mappingDraft, setMappingDraft] = useState<string[]>([]);
  const [sessionName, setSessionName] = useState('');
  const [sessionStart, setSessionStart] = useState('');
  const [sessionEnd, setSessionEnd] = useState('');
  const [sessionActive, setSessionActive] = useState(false);
  const [newAdmissions, setNewAdmissions] = useState(false);
  const [promotionStrategy, setPromotionStrategy] = useState<'defer' | 'immediate'>('defer');
  const [copySourceId, setCopySourceId] = useState<number | null>(null);
  const [copyModuleIds, setCopyModuleIds] = useState<string[]>([]);
  const [gradeDraft, setGradeDraft] = useState<GradeDraft>({
    name: '', classes: [], passPercentage: '35', gradingSystem: 'percentage', passingGrades: '', rules: [],
  });
  const [selectedGradeTier, setSelectedGradeTier] = useState<number | null>(null);
  const [policyDraft, setPolicyDraft] = useState({ id: undefined as number | undefined, tierName: '', applicableClasses: [] as string[], examWeights: '{}', promotionFailRules: '{}', resultsConfig: '{}' });
  const [policyTerms, setPolicyTerms] = useState<PolicyTargetTerm[]>([{ name: '', components: [{ exam: '', weight: '' }] }]);
  const [policyFailRules, setPolicyFailRules] = useState<PolicyRule[]>([{ term: '', value: '3' }]);
  const [policyAttendanceRules, setPolicyAttendanceRules] = useState<PolicyRule[]>([{ term: '', value: '75' }]);
  const [policyColumns, setPolicyColumns] = useState<PolicyColumns>({ profile: true, weighted: true, grade: true, fails: true, attendance: true, gate: true, report: true, cumulative: false, final: false });
  const [leaveDraft, setLeaveDraft] = useState({ id: undefined as number | undefined, name: '', annualLimit: '12', targetRoles: 'all', renewalMonth: '1', renewalDay: '1', expiryBehavior: 'expire', isActive: true });
  const [attendanceDraft, setAttendanceDraft] = useState({ id: undefined as number | undefined, targetRole: 'TEACHER', policyName: '', applicableClasses: [] as string[], expectedArrivalTime: '09:00', gracePeriodMinutes: '0', halfDayCutoffTime: '12:00', schoolEndTime: '17:00', attendanceTarget: '85', isActive: true });
  const basePath = '/mobile/admin/modules/school-setup';
  const queryKey = ['mobile-school-setup', user.schoolId, user.id];
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => apiGet<SetupData>(basePath, { signal }),
    enabled: online,
    staleTime: 0,
  });
  const save = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => apiPost(path, body),
    onSuccess: () => { setItemName(''); void queryClient.invalidateQueries({ queryKey }); },
  });
  const createSession = useMutation({
    mutationFn: async () => {
      const created = await apiPost<{ id: number }>(`${basePath}/sessions`, {
        sessionName: sessionName.trim(), startDate: sessionStart, endDate: sessionEnd,
        setAsActive: sessionActive, newAdmissionsEnabled: newAdmissions, promotionStrategy,
      });
      if (copySourceId && copyModuleIds.length) {
        await apiPost(`${basePath}/sessions/${created.id}/copy-modules`, { sourceSessionId: copySourceId, subModuleIds: copyModuleIds });
      }
      return created;
    },
    onSuccess: () => {
      setSessionName(''); setSessionStart(''); setSessionEnd(''); setSessionActive(false);
      setNewAdmissions(false); setPromotionStrategy('defer'); setCopySourceId(null); setCopyModuleIds([]);
      void queryClient.invalidateQueries({ queryKey });
    },
  });
  const canEdit = (permission: string) => user.role === 'admin' || (user.allowedModules || []).includes(`school-setup:${permission}`);
  const data = query.data;
  const metadata = data?.metadata || {};
  const classNames = Array.isArray(metadata.classes) ? metadata.classes.filter((x): x is string => typeof x === 'string') : [];
  const sectionNames = Array.isArray(metadata.sections) ? metadata.sections.filter((x): x is string => typeof x === 'string') : [];
  const subjectNames = Array.isArray(metadata.subjects) ? metadata.subjects.filter((x): x is string => typeof x === 'string') : [];
  const examNames = Array.isArray(metadata.exam_types) ? metadata.exam_types.filter((x): x is string => typeof x === 'string') : [];
  const saved = (path: string, body: unknown) => save.mutate({ path, body });
  const loadPolicy = (tier: SetupData['examPolicyTiers'][number]) => {
    let weights: Record<string, Array<{ source_exam?: string; weight?: number }>> = {};
    let fails: { rule1?: { rules?: Array<{ term?: string; fail_count?: number }> }; rule_attendance?: { rules?: Array<{ term?: string; min_pct?: number }> } } = {};
    let columns: Record<string, any> = {};
    try { weights = JSON.parse(tier.examWeights || '{}'); } catch { /* invalid legacy data is shown as a fresh structured draft */ }
    try { fails = JSON.parse(tier.promotionFailRules || '{}'); } catch { /* noop */ }
    try { const result = JSON.parse(tier.resultsConfig || '{}'); columns = result.termConfigs || {}; } catch { /* noop */ }
    const terms = Object.entries(weights).map(([name, parts]) => ({ name, components: (parts || []).map(part => ({ exam: part.source_exam || '', weight: String(part.weight ?? '') })) }));
    setPolicyDraft({ ...tier });
    setPolicyTerms(terms.length ? terms : [{ name: '', components: [{ exam: '', weight: '' }] }]);
    setPolicyFailRules(fails.rule1?.rules?.map(rule => ({ term: rule.term || '', value: String(rule.fail_count ?? '') })) || [{ term: '', value: '3' }]);
    setPolicyAttendanceRules(fails.rule_attendance?.rules?.map(rule => ({ term: rule.term || '', value: String(rule.min_pct ?? '') })) || [{ term: '', value: '75' }]);
    const first = Object.values(columns)[0];
    if (first) setPolicyColumns({ profile: first.studentProfile !== false, weighted: first.weightedAvg !== false, grade: first.termGrade !== false, fails: first.subjectFails !== false, attendance: first.attendance !== false, gate: first.promotionGate !== false, report: first.reportCard !== false, cumulative: first.cumulativeTotal === true, final: first.finalGrade === true });
  };
  const resetPolicy = () => { setPolicyDraft({ id: undefined, tierName: '', applicableClasses: [], examWeights: '{}', promotionFailRules: '{}', resultsConfig: '{}' }); setPolicyTerms([{ name: '', components: [{ exam: '', weight: '' }] }]); setPolicyFailRules([{ term: '', value: '3' }]); setPolicyAttendanceRules([{ term: '', value: '75' }]); };
  const mutationError = save.error instanceof Error ? save.error.message : '';
  const listTab = tab === 'classes' || tab === 'sections' || tab === 'subjects' || tab === 'exam-types';
  const listKey = tab === 'exam-types' ? 'exam_types' : tab;
  const listPermission = tab === 'exam-types' ? 'exam-types' : tab;
  const listItems = Array.isArray(metadata[listKey]) ? (metadata[listKey] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const mappingInfo = tab === 'class-section-mapping'
    ? { key: 'class_sections', permission: 'class-section-mapping', choices: sectionNames, title: 'Sections assigned to each class' }
    : tab === 'class-subject-mapping'
      ? { key: 'class_subjects', permission: 'class-subject-mapping', choices: subjectNames, title: 'Subjects taught in each class' }
      : { key: 'class_exam_types', permission: 'class-examtype-mapping', choices: examNames, title: 'Exam types configured for each class' };
  const rawMapping = tab.includes('mapping') && metadata[mappingInfo.key] && typeof metadata[mappingInfo.key] === 'object'
    ? metadata[mappingInfo.key] as Record<string, string[]>
    : {};
  useEffect(() => {
    setMappingDraft(mapClass ? rawMapping[mapClass] || [] : []);
  }, [mapClass, tab, query.data]);
  const currentGrade = data?.gradingTiers.find(tier => tier.id === selectedGradeTier);
  const loadGrade = (id: number) => {
    const tier = data?.gradingTiers.find(item => item.id === id);
    if (!tier) return;
    setSelectedGradeTier(id);
    setGradeDraft({
      id: tier.id, name: tier.name, classes: tier.classes || [], passPercentage: String(tier.passPercentage),
      gradingSystem: tier.gradingSystem === 'grade' || tier.gradingSystem === 'both' ? tier.gradingSystem : 'percentage',
      passingGrades: (tier.passingGrades || []).join(', '),
      rules: data?.gradingRules.filter(rule => rule.tierId === id).map(rule => ({
        gradeLabel: rule.gradeLabel, minPercent: String(rule.minPercent), maxPercent: String(rule.maxPercent),
        gradePoint: rule.gradePoint || '', remarks: rule.remarks || '',
      })) || [],
    });
  };
  const toggleString = (values: string[], value: string) => values.includes(value) ? values.filter(item => item !== value) : [...values, value];
  const saveGrade = () => saved(`${basePath}/grading-tiers`, {
    ...gradeDraft, passPercentage: Number(gradeDraft.passPercentage), sortOrder: gradeDraft.id
      ? data?.gradingTiers.find(item => item.id === gradeDraft.id)?.sortOrder ?? 0
      : (data?.gradingTiers.length || 0),
    passingGrades: gradeDraft.passingGrades.split(',').map(value => value.trim()).filter(Boolean),
    rules: gradeDraft.rules.map(rule => ({ ...rule, minPercent: Number(rule.minPercent), maxPercent: Number(rule.maxPercent) })),
  });
  const saveExamPolicy = () => {
    const examWeights = Object.fromEntries(policyTerms.filter(term => term.name.trim()).map(term => [term.name.trim(), term.components.filter(component => component.exam.trim()).map(component => ({ source_exam: component.exam.trim(), weight: Number(component.weight) || 0 }))]));
    const promotionFailRules = { rule1: { enabled: true, rules: policyFailRules.filter(rule => rule.term.trim()).map(rule => ({ term: rule.term.trim(), fail_count: Number(rule.value) || 0 })) }, rule_attendance: { enabled: true, rules: policyAttendanceRules.filter(rule => rule.term.trim()).map(rule => ({ term: rule.term.trim(), min_pct: Number(rule.value) || 0 })) } };
    const termConfigs = Object.fromEntries(policyTerms.filter(term => term.name.trim()).map(term => [term.name.trim(), {
      studentProfile: policyColumns.profile, weightedAvg: policyColumns.weighted, termGrade: policyColumns.grade, subjectFails: policyColumns.fails,
      attendance: policyColumns.attendance, promotionGate: policyColumns.gate, reportCard: policyColumns.report, cumulativeTotal: policyColumns.cumulative, finalGrade: policyColumns.final,
    }]));
    saved(`${basePath}/exam-policy-tiers`, { ...policyDraft, examWeights: JSON.stringify(examWeights), promotionFailRules: JSON.stringify(promotionFailRules), resultsConfig: JSON.stringify({ termConfigs }) });
  };
  const saveLeave = () => saved(`${basePath}/leave-policies`, {
    ...leaveDraft, annualLimit: Number(leaveDraft.annualLimit), renewalMonth: Number(leaveDraft.renewalMonth), renewalDay: Number(leaveDraft.renewalDay),
  });
  const saveAttendance = () => saved(`${basePath}/attendance-policies`, {
    ...attendanceDraft, gracePeriodMinutes: Number(attendanceDraft.gracePeriodMinutes), attendanceTarget: Number(attendanceDraft.attendanceTarget),
  });

  if (!user || !['admin', 'support_staff'].includes(user.role)) {
    return <AdminFrame title="School Setup" onBack={onBack}><State title="Access denied" detail="Administrator access is required." /></AdminFrame>;
  }
  return <AdminFrame title="School Setup" onBack={onBack}>
    {!online && <View style={styles.offline}><Feather name="wifi-off" color={workspace.ink} size={15} /><Text style={styles.offlineText}>Offline · Reconnect to load and save school configuration.</Text></View>}
    <SectionTitle title="School setup" detail="Manage the school’s configured sessions, academic lists, mappings, grading, and policies." />
    <View style={styles.rowWrap}>{setupTabs.map(item => <Pill key={item.id} label={item.label} active={tab === item.id} onPress={() => setTab(item.id)} />)}</View>
    {query.isPending ? <State title="Loading school configuration" loading />
      : query.isError || !data ? <State title="School setup unavailable" detail={query.error?.message || 'The server returned no configuration.'} retry={() => { void query.refetch(); }} />
      : <>
        {!!mutationError && <Text style={styles.error}>{mutationError}</Text>}
        {save.isSuccess && <Text style={styles.success}>Configuration saved.</Text>}
        {tab === 'academic-sessions' && <ModuleCard>
          <Text style={styles.cardTitle}>Academic sessions</Text>
           <Text style={styles.muted}>Create a school-year record, copy approved configuration from a previous session, activate it, or remove an unused draft.</Text>
          {data.sessions.map(session => <View key={session.id} style={styles.adminCard}>
            <Text style={styles.cardTitle}>{session.sessionName}{session.isActive ? ' · Active' : ''}</Text>
            <Line label="Dates" value={`${session.startDate} — ${session.endDate}`} />
            <Line label="Status" value={session.status} />
            {!!session.copiedModules && <Line label="Copy report" value="Configuration copy report recorded" />}
            <View style={styles.rowWrap}>
              {!session.isActive && <Button label="Activate" icon="check" disabled={!canEdit('academic-sessions') || save.isPending} onPress={() => saved(`${basePath}/sessions/${session.id}/activate`, {})} />}
              {!session.isActive && <Button label="Delete" icon="trash-2" disabled={!canEdit('academic-sessions') || save.isPending} onPress={() => Alert.alert('Delete session?', `Delete ${session.sessionName}? Financial history prevents deletion.`, [
                { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => saved(`${basePath}/sessions/${session.id}/delete`, {}) },
              ])} />}
            </View>
          </View>)}
          <ModuleField label="Session name" value={sessionName} onChangeText={setSessionName} />
          <ModuleField label="Start date (YYYY-MM-DD)" value={sessionStart} onChangeText={setSessionStart} />
          <ModuleField label="End date (YYYY-MM-DD)" value={sessionEnd} onChangeText={setSessionEnd} />
           <Text style={styles.fieldLabel}>Copy configuration from (optional)</Text>
           <View style={styles.rowWrap}>
             <Pill label="Start fresh" active={!copySourceId} onPress={() => { setCopySourceId(null); setCopyModuleIds([]); }} />
             {data.sessions.map(session => <Pill key={session.id} label={session.sessionName} active={copySourceId === session.id} onPress={() => setCopySourceId(session.id)} />)}
           </View>
           {!!copySourceId && <>
             <Text style={styles.muted}>Select school setup configuration to record as shared and any recurring calendar entries to duplicate. Exam marks, attendance, and student identities are never copied.</Text>
             <View style={styles.rowWrap}>{[
               ['classes', 'Classes'], ['sections', 'Sections'], ['subjects', 'Subjects'], ['exam-types', 'Exam types'],
               ['class-mapping', 'Class-section map'], ['subject-mapping', 'Class-subject map'], ['class-exam-type-mapping', 'Class-exam map'],
               ['grading-policy', 'Grading policy'], ['promotion-policy', 'Exam policy'], ['attendance-policy', 'Attendance policy'], ['leave-policy', 'Leave policy'],
               ['holiday-templates', 'Holiday templates'], ['recurring-events', 'Recurring events'],
             ].map(([id, label]) => <Pill key={id} label={label} active={copyModuleIds.includes(id)} onPress={() => setCopyModuleIds(toggleString(copyModuleIds, id))} />)}</View>
           </>}
          <View style={styles.rowWrap}>
            <Pill label={sessionActive ? 'Activate after creation' : 'Create as draft'} active={sessionActive} onPress={() => setSessionActive(!sessionActive)} />
            <Pill label={newAdmissions ? 'Admissions enabled' : 'Admissions disabled'} active={newAdmissions} onPress={() => setNewAdmissions(!newAdmissions)} />
            <Pill label={`Promotion: ${promotionStrategy}`} active={promotionStrategy === 'immediate'} onPress={() => setPromotionStrategy(promotionStrategy === 'defer' ? 'immediate' : 'defer')} />
          </View>
           <Button label={createSession.isPending ? 'Creating session…' : 'Create academic session'} icon="plus" disabled={!canEdit('academic-sessions') || createSession.isPending || !sessionName.trim() || !sessionStart || !sessionEnd} onPress={() => createSession.mutate()} />
           {createSession.isError && <Text style={styles.error}>{createSession.error instanceof Error ? createSession.error.message : 'Unable to create session.'}</Text>}
        </ModuleCard>}
        {listTab && <ModuleCard>
          <Text style={styles.cardTitle}>{setupTabs.find(item => item.id === tab)?.label}</Text>
          <Text style={styles.muted}>These configured names are used in class rosters, results, and related school forms.</Text>
          <View style={styles.rowWrap}>{listItems.map(value => <Pill key={value} label={`${value} ×`} onPress={() => saved(`${basePath}/metadata`, { key: listKey, values: listItems.filter(item => item !== value) })} disabled={!canEdit(listPermission) || save.isPending} />)}</View>
          {!listItems.length && <Text style={styles.muted}>No values configured.</Text>}
          <ModuleField label="Add name" value={itemName} onChangeText={setItemName} />
          <Button label="Save configured names" icon="save" disabled={!canEdit(listPermission) || save.isPending || (!itemName.trim() && listItems.length === 0)} onPress={() => {
            const next = itemName.trim() && !listItems.includes(itemName.trim()) ? [...listItems, itemName.trim()] : listItems;
            saved(`${basePath}/metadata`, { key: listKey, values: next });
          }} />
        </ModuleCard>}
        {tab.includes('mapping') && <ModuleCard>
          <Text style={styles.cardTitle}>{mappingInfo.title}</Text>
          <Text style={styles.muted}>Select a class, toggle its configured values, then save the complete mapping.</Text>
          <View style={styles.rowWrap}>{classNames.map(value => <Pill key={value} label={value} active={mapClass === value} onPress={() => setMapClass(value)} />)}</View>
          {mapClass ? <>
            <View style={styles.rowWrap}>{mappingInfo.choices.map(value => <Pill key={value} label={value} active={mappingDraft.includes(value)} onPress={() => setMappingDraft(toggleString(mappingDraft, value))} />)}</View>
            <Button label="Save class mapping" icon="save" disabled={!canEdit(mappingInfo.permission) || save.isPending} onPress={() => saved(`${basePath}/metadata`, { key: mappingInfo.key, mapping: { ...rawMapping, [mapClass]: mappingDraft } })} />
          </> : <Text style={styles.muted}>Choose a class to edit its mapping.</Text>}
        </ModuleCard>}
        {tab === 'grading' && <ModuleCard>
          <Text style={styles.cardTitle}>Grading tiers and ranges</Text>
          <Text style={styles.muted}>Each tier assigns classes, passing criteria, grade labels, percentage ranges, points, and remarks.</Text>
          {data.gradingTiers.map(tier => <View key={tier.id} style={styles.rowWrap}>
            <Pill label={`${tier.name} · ${tier.classes.join(', ')}`} active={selectedGradeTier === tier.id} onPress={() => loadGrade(tier.id)} />
            <Pill label="Delete tier" onPress={() => Alert.alert('Delete grading tier?', `Delete ${tier.name} and its grade ranges?`, [
              { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => saved(`${basePath}/grading-tiers/${tier.id}/delete`, {}) },
            ])} disabled={!canEdit('grading') || save.isPending} />
          </View>)}
          <ModuleField label="Tier name" value={gradeDraft.name} onChangeText={value => setGradeDraft({ ...gradeDraft, name: value })} />
          <Text style={styles.fieldLabel}>Applicable classes</Text>
          <View style={styles.rowWrap}>{classNames.map(value => <Pill key={value} label={value} active={gradeDraft.classes.includes(value)} onPress={() => setGradeDraft({ ...gradeDraft, classes: toggleString(gradeDraft.classes, value) })} />)}</View>
          <ModuleField label="Pass percentage" value={gradeDraft.passPercentage} keyboardType="numeric" onChangeText={value => setGradeDraft({ ...gradeDraft, passPercentage: value })} />
          <View style={styles.rowWrap}>{(['percentage', 'grade', 'both'] as const).map(value => <Pill key={value} label={`System: ${value}`} active={gradeDraft.gradingSystem === value} onPress={() => setGradeDraft({ ...gradeDraft, gradingSystem: value })} />)}</View>
          <ModuleField label="Passing grade labels (comma-separated)" value={gradeDraft.passingGrades} onChangeText={value => setGradeDraft({ ...gradeDraft, passingGrades: value })} />
          {gradeDraft.rules.map((rule, index) => <View key={`grade-${index}`} style={styles.adminCard}>
            <Text style={styles.cardTitle}>Grade range {index + 1}</Text>
            <ModuleField label="Grade label" value={rule.gradeLabel} onChangeText={value => setGradeDraft({ ...gradeDraft, rules: gradeDraft.rules.map((item, i) => i === index ? { ...item, gradeLabel: value } : item) })} />
            <View style={styles.rowWrap}>
              <View style={{ flex: 1 }}><ModuleField label="Minimum %" value={rule.minPercent} keyboardType="numeric" onChangeText={value => setGradeDraft({ ...gradeDraft, rules: gradeDraft.rules.map((item, i) => i === index ? { ...item, minPercent: value } : item) })} /></View>
              <View style={{ flex: 1 }}><ModuleField label="Maximum %" value={rule.maxPercent} keyboardType="numeric" onChangeText={value => setGradeDraft({ ...gradeDraft, rules: gradeDraft.rules.map((item, i) => i === index ? { ...item, maxPercent: value } : item) })} /></View>
            </View>
            <ModuleField label="Grade point" value={rule.gradePoint} onChangeText={value => setGradeDraft({ ...gradeDraft, rules: gradeDraft.rules.map((item, i) => i === index ? { ...item, gradePoint: value } : item) })} />
            <ModuleField label="Remarks" value={rule.remarks} onChangeText={value => setGradeDraft({ ...gradeDraft, rules: gradeDraft.rules.map((item, i) => i === index ? { ...item, remarks: value } : item) })} />
            <Button label="Remove range" icon="trash-2" onPress={() => setGradeDraft({ ...gradeDraft, rules: gradeDraft.rules.filter((_, i) => i !== index) })} />
          </View>)}
          <View style={styles.rowWrap}>
            <Button label="Add grade range" icon="plus" onPress={() => setGradeDraft({ ...gradeDraft, rules: [...gradeDraft.rules, { gradeLabel: '', minPercent: '0', maxPercent: '100', gradePoint: '', remarks: '' }] })} />
            <Button label={gradeDraft.id ? 'Save grading tier' : 'Create grading tier'} icon="save" disabled={!canEdit('grading') || save.isPending || !gradeDraft.name.trim() || !gradeDraft.classes.length || !gradeDraft.rules.length} onPress={saveGrade} />
            {gradeDraft.id && <Button label="New tier" icon="x" onPress={() => { setSelectedGradeTier(null); setGradeDraft({ name: '', classes: [], passPercentage: '35', gradingSystem: 'percentage', passingGrades: '', rules: [] }); }} />}
          </View>
          {currentGrade && <Text style={styles.muted}>Editing {currentGrade.name}. Rules are replaced together when saved.</Text>}
        </ModuleCard>}
        {tab === 'exam-policy' && <ModuleCard>
          <Text style={styles.cardTitle}>Exam and promotion policy tiers</Text>
          <Text style={styles.muted}>Configure weighted target terms, promotion failure and attendance gates, and the result columns used by advancement rules.</Text>
          {data.examPolicyTiers.map(tier => <View key={tier.id} style={styles.rowWrap}>
            <Pill label={`${tier.tierName} · ${tier.applicableClasses.join(', ')}`} active={policyDraft.id === tier.id} onPress={() => loadPolicy(tier)} />
            <Pill label="Delete policy" onPress={() => Alert.alert('Delete exam policy?', `Delete ${tier.tierName}?`, [
              { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => saved(`${basePath}/exam-policy-tiers/${tier.id}/delete`, {}) },
            ])} disabled={!canEdit('exam-policy') || save.isPending} />
          </View>)}
          <ModuleField label="Policy tier name" value={policyDraft.tierName} onChangeText={value => setPolicyDraft({ ...policyDraft, tierName: value })} />
          <Text style={styles.fieldLabel}>Applicable classes</Text>
          <View style={styles.rowWrap}>{classNames.map(value => <Pill key={value} label={value} active={policyDraft.applicableClasses.includes(value)} onPress={() => setPolicyDraft({ ...policyDraft, applicableClasses: toggleString(policyDraft.applicableClasses, value) })} />)}</View>
          <Text style={styles.fieldLabel}>Target terms and weighted source exams</Text>
          {policyTerms.map((target, termIndex) => <View key={`term-${termIndex}`} style={styles.adminCard}>
            <ModuleField label="Target term name" value={target.name} onChangeText={value => setPolicyTerms(items => items.map((item, index) => index === termIndex ? { ...item, name: value } : item))} />
            {target.components.map((component, componentIndex) => <View key={`component-${componentIndex}`} style={styles.rowWrap}>
              <TextInput value={component.exam} onChangeText={value => setPolicyTerms(items => items.map((item, index) => index === termIndex ? { ...item, components: item.components.map((entry, child) => child === componentIndex ? { ...entry, exam: value } : entry) } : item))} placeholder="Source exam" placeholderTextColor={workspace.faint} style={[styles.textInput, { flex: 2 }]} />
              <TextInput value={component.weight} onChangeText={value => setPolicyTerms(items => items.map((item, index) => index === termIndex ? { ...item, components: item.components.map((entry, child) => child === componentIndex ? { ...entry, weight: value } : entry) } : item))} placeholder="Weight %" keyboardType="numeric" placeholderTextColor={workspace.faint} style={[styles.textInput, { flex: 1 }]} />
              <Button label="−" icon="x" onPress={() => setPolicyTerms(items => items.map((item, index) => index === termIndex ? { ...item, components: item.components.filter((_, child) => child !== componentIndex) } : item))} />
            </View>)}
            <View style={styles.rowWrap}><Button label="Add source exam" icon="plus" onPress={() => setPolicyTerms(items => items.map((item, index) => index === termIndex ? { ...item, components: [...item.components, { exam: '', weight: '' }] } : item))} /><Button label="Remove term" icon="trash-2" onPress={() => setPolicyTerms(items => items.filter((_, index) => index !== termIndex))} /></View>
          </View>)}
          <Button label="Add target term" icon="plus" onPress={() => setPolicyTerms(items => [...items, { name: '', components: [{ exam: '', weight: '' }] }])} />
          <Text style={styles.fieldLabel}>Promotion failure rules</Text>
          {policyFailRules.map((rule, index) => <View key={`fail-${index}`} style={styles.rowWrap}><ModuleField label="Term" value={rule.term} onChangeText={value => setPolicyFailRules(items => items.map((item, child) => child === index ? { ...item, term: value } : item))} /><ModuleField label="Maximum failed subjects" value={rule.value} keyboardType="numeric" onChangeText={value => setPolicyFailRules(items => items.map((item, child) => child === index ? { ...item, value } : item))} /></View>)}
          <Button label="Add failure rule" icon="plus" onPress={() => setPolicyFailRules(items => [...items, { term: '', value: '3' }])} />
          <Text style={styles.fieldLabel}>Minimum attendance rules</Text>
          {policyAttendanceRules.map((rule, index) => <View key={`attendance-${index}`} style={styles.rowWrap}><ModuleField label="Term" value={rule.term} onChangeText={value => setPolicyAttendanceRules(items => items.map((item, child) => child === index ? { ...item, term: value } : item))} /><ModuleField label="Minimum %" value={rule.value} keyboardType="numeric" onChangeText={value => setPolicyAttendanceRules(items => items.map((item, child) => child === index ? { ...item, value } : item))} /></View>)}
          <Button label="Add attendance rule" icon="plus" onPress={() => setPolicyAttendanceRules(items => [...items, { term: '', value: '75' }])} />
          <Text style={styles.fieldLabel}>Result columns (applied to every target term)</Text>
          <View style={styles.rowWrap}>{([
            ['profile', 'Student profile'], ['weighted', 'Weighted average'], ['grade', 'Term grade'], ['fails', 'Subject fails'], ['attendance', 'Attendance'], ['gate', 'Promotion gate'], ['report', 'Report card'], ['cumulative', 'Cumulative total'], ['final', 'Final grade'],
          ] as const).map(([key, label]) => <Pill key={key} label={label} active={policyColumns[key]} onPress={() => setPolicyColumns(columns => ({ ...columns, [key]: !columns[key] }))} />)}</View>
          <View style={styles.rowWrap}>
            <Button label={policyDraft.id ? 'Save exam policy' : 'Create exam policy'} icon="save" disabled={!canEdit('exam-policy') || save.isPending || !policyDraft.tierName.trim() || !policyDraft.applicableClasses.length} onPress={saveExamPolicy} />
            {policyDraft.id && <Button label="New policy" icon="x" onPress={resetPolicy} />}
          </View>
        </ModuleCard>}
        {tab === 'leave-policy' && <ModuleCard>
          <Text style={styles.cardTitle}>Leave policies</Text>
          <Text style={styles.muted}>Configure annual limits, eligible staff, renewal dates, carry-forward, and activation.</Text>
          {data.leavePolicies.map(policy => <View key={policy.id} style={styles.rowWrap}>
            <Pill label={`${policy.name} · ${policy.annualLimit} days · ${policy.targetRoles}${policy.isActive ? '' : ' · Inactive'}`} active={leaveDraft.id === policy.id} onPress={() => setLeaveDraft({ ...policy, annualLimit: String(policy.annualLimit), renewalMonth: String(policy.renewalMonth), renewalDay: String(policy.renewalDay) })} />
            <Pill label="Delete" onPress={() => Alert.alert('Delete leave policy?', `Delete ${policy.name}?`, [
              { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => saved(`${basePath}/leave-policies/${policy.id}/delete`, {}) },
            ])} disabled={!canEdit('leave-policy') || save.isPending} />
          </View>)}
          <ModuleField label="Policy name" value={leaveDraft.name} onChangeText={value => setLeaveDraft({ ...leaveDraft, name: value })} />
          <ModuleField label="Annual leave limit" keyboardType="numeric" value={leaveDraft.annualLimit} onChangeText={value => setLeaveDraft({ ...leaveDraft, annualLimit: value })} />
          <View style={styles.rowWrap}>{['all', 'teacher', 'non_teaching'].map(role => <Pill key={role} label={role === 'all' ? 'All staff' : role === 'teacher' ? 'Teaching staff' : 'Non-teaching'} active={leaveDraft.targetRoles === role} onPress={() => setLeaveDraft({ ...leaveDraft, targetRoles: role })} />)}</View>
          <View style={styles.rowWrap}>
            <View style={{ flex: 1 }}><ModuleField label="Renewal month" keyboardType="numeric" value={leaveDraft.renewalMonth} onChangeText={value => setLeaveDraft({ ...leaveDraft, renewalMonth: value })} /></View>
            <View style={{ flex: 1 }}><ModuleField label="Renewal day" keyboardType="numeric" value={leaveDraft.renewalDay} onChangeText={value => setLeaveDraft({ ...leaveDraft, renewalDay: value })} /></View>
          </View>
          <View style={styles.rowWrap}><Pill label="Expire unused days" active={leaveDraft.expiryBehavior === 'expire'} onPress={() => setLeaveDraft({ ...leaveDraft, expiryBehavior: 'expire' })} /><Pill label="Carry forward" active={leaveDraft.expiryBehavior === 'carry_forward'} onPress={() => setLeaveDraft({ ...leaveDraft, expiryBehavior: 'carry_forward' })} /><Pill label={leaveDraft.isActive ? 'Active' : 'Inactive'} active={leaveDraft.isActive} onPress={() => setLeaveDraft({ ...leaveDraft, isActive: !leaveDraft.isActive })} /></View>
          <View style={styles.rowWrap}><Button label={leaveDraft.id ? 'Save leave policy' : 'Create leave policy'} icon="save" disabled={!canEdit('leave-policy') || save.isPending || !leaveDraft.name.trim()} onPress={saveLeave} />{leaveDraft.id && <Button label="New policy" icon="x" onPress={() => setLeaveDraft({ id: undefined, name: '', annualLimit: '12', targetRoles: 'all', renewalMonth: '1', renewalDay: '1', expiryBehavior: 'expire', isActive: true })} />}</View>
        </ModuleCard>}
        {tab === 'attendance-policy' && <ModuleCard>
          <Text style={styles.cardTitle}>Attendance policies</Text>
          <Text style={styles.muted}>Set role/class coverage, expected arrival, grace, half-day cutoff, school end, and target attendance.</Text>
          {data.attendancePolicies.map(policy => <View key={policy.id} style={styles.rowWrap}>
            <Pill label={`${policy.policyName} · ${policy.targetRole}${policy.isActive ? '' : ' · Inactive'}`} active={attendanceDraft.id === policy.id} onPress={() => setAttendanceDraft({ ...policy, gracePeriodMinutes: String(policy.gracePeriodMinutes), attendanceTarget: String(policy.attendanceTarget) })} />
            <Pill label="Delete" onPress={() => Alert.alert('Delete attendance policy?', `Delete ${policy.policyName}?`, [
              { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => saved(`${basePath}/attendance-policies/${policy.id}/delete`, {}) },
            ])} disabled={!canEdit('attendance-policy') || save.isPending} />
          </View>)}
          <ModuleField label="Policy name" value={attendanceDraft.policyName} onChangeText={value => setAttendanceDraft({ ...attendanceDraft, policyName: value })} />
          <View style={styles.rowWrap}>{['TEACHER', 'STUDENT', 'ALL'].map(role => <Pill key={role} label={`Role: ${role}`} active={attendanceDraft.targetRole === role} onPress={() => setAttendanceDraft({ ...attendanceDraft, targetRole: role })} />)}</View>
          <Text style={styles.fieldLabel}>Applicable classes (empty means all configured classes)</Text>
          <View style={styles.rowWrap}>{classNames.map(value => <Pill key={value} label={value} active={attendanceDraft.applicableClasses.includes(value)} onPress={() => setAttendanceDraft({ ...attendanceDraft, applicableClasses: toggleString(attendanceDraft.applicableClasses, value) })} />)}</View>
          <ModuleField label="Expected arrival (HH:MM)" value={attendanceDraft.expectedArrivalTime} onChangeText={value => setAttendanceDraft({ ...attendanceDraft, expectedArrivalTime: value })} />
          <ModuleField label="Grace period (minutes)" keyboardType="numeric" value={attendanceDraft.gracePeriodMinutes} onChangeText={value => setAttendanceDraft({ ...attendanceDraft, gracePeriodMinutes: value })} />
          <ModuleField label="Half-day cutoff (HH:MM)" value={attendanceDraft.halfDayCutoffTime} onChangeText={value => setAttendanceDraft({ ...attendanceDraft, halfDayCutoffTime: value })} />
          <ModuleField label="School end (HH:MM)" value={attendanceDraft.schoolEndTime} onChangeText={value => setAttendanceDraft({ ...attendanceDraft, schoolEndTime: value })} />
          <ModuleField label="Attendance target (%)" keyboardType="numeric" value={attendanceDraft.attendanceTarget} onChangeText={value => setAttendanceDraft({ ...attendanceDraft, attendanceTarget: value })} />
          <View style={styles.rowWrap}><Pill label={attendanceDraft.isActive ? 'Active' : 'Inactive'} active={attendanceDraft.isActive} onPress={() => setAttendanceDraft({ ...attendanceDraft, isActive: !attendanceDraft.isActive })} /><Button label={attendanceDraft.id ? 'Save attendance policy' : 'Create attendance policy'} icon="save" disabled={!canEdit('attendance-policy') || save.isPending || !attendanceDraft.policyName.trim()} onPress={saveAttendance} />{attendanceDraft.id && <Button label="New policy" icon="x" onPress={() => setAttendanceDraft({ id: undefined, targetRole: 'TEACHER', policyName: '', applicableClasses: [], expectedArrivalTime: '09:00', gracePeriodMinutes: '0', halfDayCutoffTime: '12:00', schoolEndTime: '17:00', attendanceTarget: '85', isActive: true })} />}</View>
        </ModuleCard>}
      </>}
    <View style={styles.footer}><Text style={styles.footerText}>BENIUS Command Center · {user.schoolName}</Text></View>
  </AdminFrame>;
}

type AttendanceModuleData = {
  session: { id: number; sessionName: string; isActive: boolean; startDate: string; endDate: string };
  config: { classes: string[]; classSections: Record<string, string[]> };
  overview: { enrolledTotal: number; markedTotal: number; present: number; absent: number; leave: number; late: number; halfDay: number; missing: number; percentage: number };
  teacherSummary: {
    summary: { totalFaculty: number; present: number; notMarked: number; lateArrivals: number; pendingCorrections: number; totalCorrections: number };
    teachers: Array<{ teacherId: number; name: string; digitalTeacherId: string | null; assignedClassSections: string[]; subjects: string[]; selfStatus: string; selfCheckIn: string | null; selfCheckOut: string | null; selfWorkedMinutes: number; correctionCount: number; studentMarkStatus: string; submittedAt: string | null }>;
  };
  studentPolicy: { attendanceTarget: number };
  classDetail: null | {
    meta: { isSubmitted: boolean; submittedBy: string | null; submittedAt: string | null; lastModifiedAt: string | null; modifiedBy: string | null };
    students: Array<{ studentId: number; name: string; digitalStudentId: string; rollNo: string; photoUrl: string | null; status: string }>;
    summary: { percentage: number };
  };
};

function AttendanceOverviewModule({ user, onBack, online, selectedSessionId, selectedSessionName }: {
  user: NonNullable<ReturnType<typeof useAuth>['user']>;
  onBack: () => void;
  online: boolean;
  selectedSessionId: number | null;
  selectedSessionName: string;
}) {
  const [date, setDate] = useState(istDateKey());
  const [cls, setClass] = useState('');
  const [section, setSection] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [teacherSearch, setTeacherSearch] = useState('');
  const [teacherStatus, setTeacherStatus] = useState('all');
  const [profileStudentId, setProfileStudentId] = useState<number | null>(null);
  const queryKey = ['mobile-attendance-overview', user.schoolId, user.id, selectedSessionId ?? 'active', date, cls, section];
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ date });
      if (cls && section) { params.set('class', cls); params.set('section', section); }
      const path = `/mobile/admin/modules/attendance-overview?${params.toString()}`;
      return selectedSessionId
        ? apiGetForSession<AttendanceModuleData>(path, selectedSessionId, { signal })
        : apiGet<AttendanceModuleData>(path, { signal });
    },
    enabled: online && !!date,
  });
  const profileQuery = useQuery({
    queryKey: ['mobile-attendance-student-profile', user.schoolId, user.id, selectedSessionId, profileStudentId],
    queryFn: ({ signal }) => {
      type Profile = { student: { name: string; digitalStudentId: string; class: string; section: string; phone: string; fatherName: string | null; presentAddress: string | null; rollNo: string | null }; attendance: Array<{ date: string; status: string }> };
      return selectedSessionId
        ? apiGetForSession<Profile>(`/mobile/admin/modules/attendance-overview/student/${profileStudentId}`, selectedSessionId, { signal })
        : apiGet<Profile>(`/mobile/admin/modules/attendance-overview/student/${profileStudentId}`, { signal });
    },
    enabled: online && !!profileStudentId && !!selectedSessionId,
  });
  const data = query.data;
  const students = (data?.classDetail?.students || []).filter(student =>
    `${student.name} ${student.digitalStudentId} ${student.rollNo}`.toLowerCase().includes(studentSearch.toLowerCase()));
  const teachers = (data?.teacherSummary.teachers || []).filter(teacher => {
    const matchesSearch = `${teacher.name} ${teacher.digitalTeacherId || ''} ${teacher.subjects.join(' ')}`.toLowerCase().includes(teacherSearch.toLowerCase());
    const matchesStatus = teacherStatus === 'all'
      || teacherStatus === 'Corrections' && teacher.correctionCount > 0
      || teacherStatus === 'Present' && teacher.selfStatus === 'Present'
      || teacherStatus === 'Not Marked' && teacher.selfStatus === 'Not Marked'
      || teacherStatus === 'Late' && teacher.selfStatus === 'Late';
    return matchesSearch && matchesStatus;
  });
  const sections = cls ? data?.config.classSections[cls] || [] : [];
  const statusName = (value: string) => value === 'not-marked' ? 'Not marked' : value === 'halfday' ? 'Half day' : value.replace(/\b\w/g, letter => letter.toUpperCase());
  if (!user || !['admin', 'support_staff'].includes(user.role)) {
    return <AdminFrame title="Attendance Overview" onBack={onBack}><State title="Access denied" detail="Administrator access is required." /></AdminFrame>;
  }
  return <AdminFrame title="Attendance Overview" onBack={onBack}>
    {!online && <View style={styles.offline}><Feather name="wifi-off" color={workspace.ink} size={15} /><Text style={styles.offlineText}>Offline · Attendance reports require a live connection.</Text></View>}
    <View style={styles.sessionBanner}><Feather name="calendar" color={workspace.gold} size={15} /><Text style={styles.sessionText}>{selectedSessionName}</Text></View>
    <SectionTitle title="Attendance Overview" detail="Review daily student attendance and faculty check-ins for the selected school year." />
    <ModuleCard>
      <ModuleField label="Attendance date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
      <Text style={styles.fieldLabel}>Class</Text>
      <View style={styles.rowWrap}>{data?.config.classes.map(name => <Pill key={name} label={name} active={cls === name} onPress={() => {
        setClass(name);
        setSection(data.config.classSections[name]?.[0] || '');
      }} />)}</View>
      {cls && <><Text style={styles.fieldLabel}>Section</Text><View style={styles.rowWrap}>{sections.map(name => <Pill key={name} label={name} active={section === name} onPress={() => setSection(name)} />)}</View></>}
      <Button label="Refresh attendance" icon="refresh-cw" onPress={() => { void query.refetch(); }} />
    </ModuleCard>
    {query.isPending ? <State title="Loading attendance overview" loading />
      : query.isError || !data ? <State title="Attendance report unavailable" detail={query.error?.message || 'The server returned no report.'} retry={() => { void query.refetch(); }} />
        : <>
          <View style={styles.statsRow}>
            <View style={styles.statCard}><Text style={styles.statValue}>{data.overview.enrolledTotal}</Text><Text style={styles.statLabel}>ENROLLED</Text></View>
            <View style={styles.statCard}><Text style={styles.statValue}>{data.overview.markedTotal}</Text><Text style={styles.statLabel}>MARKED</Text></View>
            <View style={styles.statCard}><Text style={styles.statValue}>{data.overview.percentage}%</Text><Text style={styles.statLabel}>ATTENDANCE</Text></View>
          </View>
          <View style={styles.statsRow}>
            <View style={styles.statCard}><Text style={styles.statValue}>{data.overview.present}</Text><Text style={styles.statLabel}>PRESENT</Text></View>
            <View style={styles.statCard}><Text style={styles.statValue}>{data.overview.absent}</Text><Text style={styles.statLabel}>ABSENT</Text></View>
            <View style={styles.statCard}><Text style={styles.statValue}>{data.overview.leave}</Text><Text style={styles.statLabel}>LEAVE</Text></View>
          </View>
          {data.classDetail && <>
            <SectionTitle title={`${cls} · Section ${section}`} detail={`Daily student roster · target ${data.studentPolicy.attendanceTarget}%`} />
            <ModuleCard>
              <Line label="Class attendance" value={`${data.classDetail.summary.percentage}%`} />
              <Line label="Submission" value={data.classDetail.meta.isSubmitted ? `Submitted${data.classDetail.meta.submittedBy ? ` by ${data.classDetail.meta.submittedBy}` : ''}` : 'Not submitted'} />
              {data.classDetail.meta.submittedAt && <Line label="Submitted at" value={formatIST(data.classDetail.meta.submittedAt)} />}
              {data.classDetail.meta.lastModifiedAt && <Line label="Last modified" value={formatIST(data.classDetail.meta.lastModifiedAt)} />}
              <ModuleField label="Search student name, ID or roll" value={studentSearch} onChangeText={setStudentSearch} />
            </ModuleCard>
            {students.map(student => <Pressable key={`${student.studentId}-${student.digitalStudentId}`} onPress={() => setProfileStudentId(student.studentId)} style={styles.adminCard}>
              <Text style={styles.cardTitle}>{student.name}</Text>
              <Line label="Student ID / Roll" value={`${student.digitalStudentId} · ${student.rollNo || '—'}`} />
              <Line label="Attendance" value={statusName(student.status)} />
              <Text style={styles.muted}>Tap for profile and session attendance history</Text>
            </Pressable>)}
            {!students.length && <View style={styles.empty}><Text style={styles.emptyText}>No students match this class, section, and search.</Text></View>}
          </>}
          {profileStudentId && <ModuleCard>
            <View style={styles.visitorHead}><Text style={styles.cardTitle}>Student attendance profile</Text><Button label="Close" icon="x" onPress={() => setProfileStudentId(null)} /></View>
            {profileQuery.isPending ? <Text style={styles.muted}>Loading profile…</Text> : profileQuery.data && <>
              <Line label="Student" value={profileQuery.data.student.name} />
              <Line label="Class / section / roll" value={`${profileQuery.data.student.class} · ${profileQuery.data.student.section} · ${profileQuery.data.student.rollNo || '—'}`} />
              <Line label="Phone" value={profileQuery.data.student.phone || '—'} />
              <Line label="Father" value={profileQuery.data.student.fatherName || '—'} />
              <Line label="Attendance entries" value={String(profileQuery.data.attendance.length)} />
              {profileQuery.data.attendance.slice(-10).reverse().map(record => <Line key={`${record.date}-${record.status}`} label={record.date} value={statusName(record.status)} />)}
            </>}
          </ModuleCard>}
          <SectionTitle title="Faculty attendance" detail={`${data.teacherSummary.summary.present} present · ${data.teacherSummary.summary.lateArrivals} late · ${data.teacherSummary.summary.notMarked} not marked`} />
          <ModuleCard>
            <ModuleField label="Search teacher or subject" value={teacherSearch} onChangeText={setTeacherSearch} />
            <View style={styles.rowWrap}>{['all', 'Present', 'Late', 'Not Marked', 'Corrections'].map(status => <Pill key={status} label={status} active={teacherStatus === status} onPress={() => setTeacherStatus(status)} />)}</View>
            <Line label="Pending corrections" value={String(data.teacherSummary.summary.pendingCorrections)} />
          </ModuleCard>
          {teachers.map(teacher => <View key={teacher.teacherId} style={styles.adminCard}>
            <Text style={styles.cardTitle}>{teacher.name}</Text>
            <Line label="Teacher ID / subjects" value={`${teacher.digitalTeacherId || '—'} · ${teacher.subjects.join(', ') || '—'}`} />
            <Line label="Self attendance" value={`${teacher.selfStatus}${teacher.selfCheckIn ? ` · In ${formatIST(teacher.selfCheckIn)}` : ''}${teacher.selfCheckOut ? ` · Out ${formatIST(teacher.selfCheckOut)}` : ''}`} />
            <Line label="Class-section assignments" value={teacher.assignedClassSections.join(', ') || '—'} />
            <Line label="Correction requests" value={String(teacher.correctionCount)} />
            <Line label="Student attendance submission" value={`${teacher.studentMarkStatus}${teacher.submittedAt ? ` · ${formatIST(teacher.submittedAt)}` : ''}`} />
          </View>)}
          {!teachers.length && <View style={styles.empty}><Text style={styles.emptyText}>No faculty records match this filter.</Text></View>}
        </>}
    <View style={styles.footer}><Text style={styles.footerText}>BENIUS Command Center · {user.schoolName}</Text></View>
  </AdminFrame>;
}

type RegistryStudent = {
  id: number;
  digitalStudentId: string;
  name: string;
  class: string;
  section: string;
  phone: string;
  dob: string;
  enrollmentDate: string | null;
  gender: string | null;
  rollNumber: number | null;
  guardianName: string | null;
  bloodGroup: string | null;
  fatherName: string | null;
  motherName: string | null;
  address: string | null;
  aadharNumber: string | null;
  email: string | null;
  isActive: boolean;
  deactivationReason?: string | null;
};

type RegistryResponse = { data: RegistryStudent[]; total: number; page: number; pageSize: number; classes: string[]; sections: string[]; classSections: Record<string, string[]> };
type RegistryDraft = {
  name: string; class: string; section: string; phone: string; dob: string; enrollmentDate: string;
  gender: string; rollNumber: string; guardianName: string; bloodGroup: string; fatherName: string;
  motherName: string; address: string; aadharNumber: string; email: string;
};
const emptyRegistryDraft: RegistryDraft = {
  name: '', class: '', section: '', phone: '', dob: '', enrollmentDate: '', gender: '', rollNumber: '',
  guardianName: '', bloodGroup: '', fatherName: '', motherName: '', address: '', aadharNumber: '', email: '',
};

function StudentRegistryModule({ user, onBack, online }: {
  user: NonNullable<ReturnType<typeof useAuth>['user']>;
  onBack: () => void;
  online: boolean;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [cls, setClass] = useState('');
  const [section, setSection] = useState('');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RegistryStudent | null>(null);
  const [draft, setDraft] = useState<RegistryDraft>(emptyRegistryDraft);
  const [deactivateTarget, setDeactivateTarget] = useState<RegistryStudent | null>(null);
  const [deactivatePassword, setDeactivatePassword] = useState('');
  const [deactivateReason, setDeactivateReason] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkReason, setBulkReason] = useState('');
  const [bulkBatchYear, setBulkBatchYear] = useState('');
  const [bulkComments, setBulkComments] = useState('');
  const [bulkPassword, setBulkPassword] = useState('');
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [showDeactivated, setShowDeactivated] = useState(false);
  const [importText, setImportText] = useState('');
  const deactivatedQuery = useQuery({
    queryKey: ['mobile-student-registry-deactivated', user.schoolId, user.id],
    queryFn: ({ signal }) => apiGet<{ count: number; data: RegistryStudent[] }>('/mobile/admin/modules/student-registry/deactivated', { signal }),
    enabled: online && showDeactivated,
  });
  const exportRegistry = useMutation({
    mutationFn: () => apiGet<{ count: number; data: RegistryStudent[] }>(`/mobile/admin/modules/student-registry/export?${params.toString()}`),
    onSuccess: result => Alert.alert('Private export ready', `${result.count} student records were prepared. Use the secure app share/download flow to save this JSON export.`),
  });
  const exportRegistryXlsx = useMutation({
    mutationFn: () => apiGet<{ filename: string; count: number; contentBase64: string }>(`/mobile/admin/modules/student-registry/export.xlsx?${params.toString()}&encoding=base64`),
    onSuccess: async result => {
      const target = `${(FileSystem as unknown as { cacheDirectory?: string }).cacheDirectory || ''}${result.filename}`;
      await FileSystem.writeAsStringAsync(target, result.contentBase64, { encoding: FileSystem.EncodingType.Base64 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(target, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle: 'Share private student XLSX' });
      else Alert.alert('XLSX export ready', `${result.count} records were generated as ${result.filename}.`);
    },
  });
  const exportDeactivatedXlsx = useMutation({
    mutationFn: () => apiGet<{ filename: string; count: number; contentBase64: string }>('/mobile/admin/modules/student-registry/deactivated/export.xlsx?encoding=base64'),
    onSuccess: async result => {
      const target = `${(FileSystem as unknown as { cacheDirectory?: string }).cacheDirectory || ''}${result.filename}`;
      await FileSystem.writeAsStringAsync(target, result.contentBase64, { encoding: FileSystem.EncodingType.Base64 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(target, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle: 'Share deactivated student XLSX' });
      else Alert.alert('Deactivated XLSX ready', `${result.count} records were generated as ${result.filename}.`);
    },
  });
  const importRegistry = useMutation({
    mutationFn: () => {
      let rows: unknown;
      try { rows = JSON.parse(importText); } catch { throw new Error('Import must be a JSON array of student records.'); }
      return apiPost<{ imported: number }>('/mobile/admin/modules/student-registry/import', { rows: Array.isArray(rows) ? rows : (rows as { rows?: unknown[] })?.rows });
    },
    onSuccess: result => { setImportText(''); Alert.alert('Private import complete', `${result.imported} student records imported.`); void queryClient.invalidateQueries({ queryKey: ['mobile-student-registry', user.schoolId, user.id] }); },
  });
  const importWorkbook = useMutation({
    mutationFn: async () => {
      const picked = await DocumentPicker.getDocumentAsync({ type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets?.[0]) throw new Error('Workbook selection was cancelled.');
      const file = picked.assets[0];
      if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Choose an .xlsx workbook.');
      if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('Workbook must be 10 MB or smaller.');
      const fileBase64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
      return apiPost<{ imported: number; skipped: number; warnings: string[] }>('/mobile/admin/modules/student-registry/import.xlsx', { filename: file.name, fileBase64 });
    },
    onSuccess: result => { Alert.alert('XLSX import complete', `${result.imported} imported, ${result.skipped} skipped.${result.warnings.length ? `\n${result.warnings.slice(0, 3).join('\n')}` : ''}`); void queryClient.invalidateQueries({ queryKey: ['mobile-student-registry', user.schoolId, user.id] }); },
  });
  const params = new URLSearchParams({ page: String(page) });
  if (search.trim()) params.set('q', search.trim());
  if (cls) params.set('class', cls);
  if (cls && section) params.set('section', section);
  const queryKey = ['mobile-student-registry', user.schoolId, user.id, search, cls, section, page];
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => apiGet<RegistryResponse>(`/mobile/admin/modules/student-registry?${params.toString()}`, { signal }),
    enabled: online,
    staleTime: 0,
  });
  const statsQuery = useQuery({
    queryKey: ['mobile-student-registry-stats', user.schoolId, user.id, cls, section],
    queryFn: ({ signal }) => {
      const filters = new URLSearchParams();
      if (cls) filters.set('class', cls);
      if (section) filters.set('section', section);
      return apiGet<{ total: number; boys: number; girls: number }>(`/mobile/admin/modules/student-registry/stats?${filters.toString()}`, { signal });
    },
    enabled: online,
  });
  const canEdit = (permission: string) => user.role === 'admin' || (user.allowedModules || []).includes(`student-registry:${permission}`);
  const save = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => apiPost<RegistryStudent>(path, body),
    onSuccess: (student) => {
      setShowForm(false); setEditing(null); setDraft(emptyRegistryDraft);
      void queryClient.invalidateQueries({ queryKey: ['mobile-student-registry', user.schoolId, user.id] });
      if (student?.digitalStudentId) Alert.alert('Student saved', `Student ID: ${student.digitalStudentId}`);
    },
  });
  const deactivate = useMutation({
    mutationFn: ({ id, password, reason }: { id: number; password: string; reason: string }) =>
      apiPost<RegistryStudent>(`/mobile/admin/modules/student-registry/students/${id}/deactivate`, { password, reason }),
    onSuccess: () => {
      setDeactivateTarget(null); setDeactivatePassword(''); setDeactivateReason('');
      void queryClient.invalidateQueries({ queryKey: ['mobile-student-registry', user.schoolId, user.id] });
    },
  });
  const autoAssign = useMutation({
    mutationFn: () => apiPost<{ assigned: number; message: string }>('/mobile/admin/modules/student-registry/auto-assign-roll', { class: cls, section }),
    onSuccess: result => {
      Alert.alert('Roll numbers assigned', result.message);
      void queryClient.invalidateQueries({ queryKey: ['mobile-student-registry', user.schoolId, user.id] });
      void queryClient.invalidateQueries({ queryKey: ['mobile-student-registry-stats', user.schoolId, user.id] });
    },
  });
  const bulkDeactivate = useMutation({
    mutationFn: () => apiPost<{ deactivated: number }>('/mobile/admin/modules/student-registry/bulk-deactivate', {
      ids: selectedIds, reason: bulkReason, batchYear: bulkBatchYear, comments: bulkComments, password: bulkPassword,
    }),
    onSuccess: result => {
      setShowBulkConfirm(false); setSelectedIds([]); setBulkReason(''); setBulkBatchYear(''); setBulkComments(''); setBulkPassword('');
      Alert.alert('Students deactivated', `${result.deactivated} student record${result.deactivated === 1 ? '' : 's'} deactivated.`);
      void queryClient.invalidateQueries({ queryKey: ['mobile-student-registry', user.schoolId, user.id] });
    },
  });
  const updateDraft = (key: keyof RegistryDraft, value: string) => setDraft(current => ({ ...current, [key]: value }));
  const startEdit = (student: RegistryStudent) => {
    setEditing(student);
    setShowForm(true);
    setDraft({
      name: student.name, class: student.class, section: student.section, phone: student.phone, dob: student.dob?.slice(0, 10) || '',
      enrollmentDate: student.enrollmentDate?.slice(0, 10) || '', gender: student.gender || '', rollNumber: student.rollNumber == null ? '' : String(student.rollNumber),
      guardianName: student.guardianName || '', bloodGroup: student.bloodGroup || '', fatherName: student.fatherName || '',
      motherName: student.motherName || '', address: student.address || '', aadharNumber: student.aadharNumber || '', email: student.email || '',
    });
  };
  const submit = () => {
    if (!draft.name.trim() || !draft.class || !draft.section || !/^\d{10}$/.test(draft.phone) || !/^\d{4}-\d{2}-\d{2}$/.test(draft.dob)) return;
    const common = {
      name: draft.name.trim(), class: draft.class, section: draft.section, phone: draft.phone, dob: draft.dob,
      rollNumber: draft.rollNumber ? Number(draft.rollNumber) : null, email: draft.email || '',
    };
    const body = editing ? {
      ...common, enrollmentDate: draft.enrollmentDate, gender: draft.gender || null, bloodGroup: draft.bloodGroup || null,
      guardianName: draft.guardianName || null, fatherName: draft.fatherName || null, motherName: draft.motherName || null,
      address: draft.address || null, aadharNumber: draft.aadharNumber || null,
    } : {
      ...common, ...(draft.enrollmentDate ? { enrollmentDate: draft.enrollmentDate } : {}),
      ...(draft.gender ? { gender: draft.gender } : {}), ...(draft.bloodGroup ? { bloodGroup: draft.bloodGroup } : {}),
      ...(draft.guardianName ? { guardianName: draft.guardianName } : {}), ...(draft.fatherName ? { fatherName: draft.fatherName } : {}),
      ...(draft.motherName ? { motherName: draft.motherName } : {}), ...(draft.address ? { address: draft.address } : {}),
      ...(draft.aadharNumber ? { aadharNumber: draft.aadharNumber } : {}),
    };
    save.mutate({
      path: editing ? `/mobile/admin/modules/student-registry/students/${editing.id}/update` : '/mobile/admin/modules/student-registry/students',
      body,
    });
  };
  const sections = cls ? query.data?.classSections?.[cls] || [] : [];
  if (!user || !['admin', 'support_staff'].includes(user.role)) {
    return <AdminFrame title="Student Registry" onBack={onBack}><State title="Access denied" detail="Administrator access is required." /></AdminFrame>;
  }
  return <AdminFrame title="Student Registry" onBack={onBack}>
    {!online && <View style={styles.offline}><Feather name="wifi-off" color={workspace.ink} size={15} /><Text style={styles.offlineText}>Offline · Student records require a live connection.</Text></View>}
    <SectionTitle title="Student Registry" detail="School-wide student identities and profiles. Registry records are not filtered by academic session." />
    {query.isPending ? <State title="Loading student registry" loading />
      : query.isError || !query.data ? <State title="Student registry unavailable" detail={query.error?.message || 'The server returned no student records.'} retry={() => { void query.refetch(); }} />
        : <>
          <View style={styles.statsRow}>
            <View style={styles.statCard}><Text style={styles.statValue}>{statsQuery.data?.total ?? query.data.total}</Text><Text style={styles.statLabel}>ACTIVE STUDENTS</Text></View>
            <View style={styles.statCard}><Text style={styles.statValue}>{statsQuery.data?.boys ?? '—'}</Text><Text style={styles.statLabel}>BOYS</Text></View>
            <View style={styles.statCard}><Text style={styles.statValue}>{statsQuery.data?.girls ?? '—'}</Text><Text style={styles.statLabel}>GIRLS</Text></View>
            <View style={styles.statCard}><Text style={styles.statValue}>{page} / {Math.max(1, Math.ceil(query.data.total / query.data.pageSize))}</Text><Text style={styles.statLabel}>REGISTRY PAGE</Text></View>
          </View>
          <ModuleCard>
            <ModuleField label="Search student name, ID, or phone" value={search} onChangeText={value => { setSearch(value); setPage(1); }} />
            <Text style={styles.fieldLabel}>Class</Text>
            <View style={styles.rowWrap}>
              <Pill label="All classes" active={!cls} onPress={() => { setClass(''); setSection(''); setPage(1); }} />
              {query.data.classes.map(name => <Pill key={name} label={name} active={cls === name} onPress={() => {
                setClass(name); setSection(query.data.classSections[name]?.[0] || ''); setPage(1);
              }} />)}
            </View>
            {cls && <><Text style={styles.fieldLabel}>Section</Text><View style={styles.rowWrap}>
              <Pill label="All sections" active={!section} onPress={() => { setSection(''); setPage(1); }} />
              {sections.map(name => <Pill key={name} label={name} active={section === name} onPress={() => { setSection(name); setPage(1); }} />)}
            </View></>}
            <View style={styles.rowWrap}>
              {canEdit('add') && <Button label={showForm ? 'Close form' : 'Add student'} icon={showForm ? 'x' : 'user-plus'} onPress={() => {
                setShowForm(!showForm); setEditing(null); setDraft(emptyRegistryDraft);
              }} />}
              {user.role === 'admin' && <Button label={autoAssign.isPending ? 'Assigning…' : 'Auto-assign rolls'} icon="hash" disabled={!cls || !section || autoAssign.isPending} onPress={() => Alert.alert('Auto-assign roll numbers', `Assign roll numbers alphabetically for Class ${cls}-${section}?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Assign', onPress: () => autoAssign.mutate() },
              ])} />}
              {canEdit('deactivate') && user.role === 'admin' && <Button label={selectedIds.length ? `Deactivate ${selectedIds.length} selected` : 'Select students'} icon="users" disabled={!query.data.data.length} onPress={() => {
                if (selectedIds.length) setShowBulkConfirm(true);
                else setSelectedIds(query.data.data.map(student => student.id));
              }} />}
              {!!selectedIds.length && <Button label="Clear selection" icon="x" onPress={() => setSelectedIds([])} />}
              <Button label="Refresh" icon="refresh-cw" onPress={() => { void query.refetch(); }} />
              {canEdit('export') && <Button label={exportRegistry.isPending ? 'Preparing…' : 'Export private JSON'} icon="download" disabled={exportRegistry.isPending} onPress={() => exportRegistry.mutate()} />}
              {canEdit('export') && <Button label={exportRegistryXlsx.isPending ? 'Preparing XLSX…' : 'Export private XLSX'} icon="file" disabled={exportRegistryXlsx.isPending} onPress={() => exportRegistryXlsx.mutate()} />}
              {user.role === 'admin' && <Button label={showDeactivated ? 'Hide deactivated' : 'Show deactivated'} icon="archive" onPress={() => setShowDeactivated(value => !value)} />}
            </View>
          </ModuleCard>
          {user.role === 'admin' && <ModuleCard>
            <Text style={styles.cardTitle}>Private safe import</Text>
            <Text style={styles.muted}>Paste a JSON array of validated student records. Password hashes and credentials are generated server-side and never accepted from imports.</Text>
            <TextInput value={importText} onChangeText={setImportText} multiline autoCapitalize="none" autoCorrect={false} placeholder='[{"name":"…","class":"…","section":"…","phone":"…","dob":"YYYY-MM-DD"}]' placeholderTextColor={workspace.faint} style={[styles.textInput, { minHeight: 86, textAlignVertical: 'top' }]} />
            <Button label={importRegistry.isPending ? 'Importing…' : 'Import JSON records'} icon="upload" disabled={importRegistry.isPending || !importText.trim()} onPress={() => importRegistry.mutate()} />
            <Button label={importWorkbook.isPending ? 'Importing XLSX…' : 'Import XLSX workbook'} icon="file" disabled={importWorkbook.isPending} onPress={() => importWorkbook.mutate()} />
            {importRegistry.isError && <Text style={styles.error}>{importRegistry.error instanceof Error ? importRegistry.error.message : 'Unable to import records.'}</Text>}
            {importWorkbook.isError && <Text style={styles.error}>{importWorkbook.error instanceof Error ? importWorkbook.error.message : 'Unable to import workbook.'}</Text>}
          </ModuleCard>}
          {showDeactivated && <ModuleCard>
            <View style={styles.visitorHead}><Text style={styles.cardTitle}>Deactivated roster ({deactivatedQuery.data?.count ?? '…'})</Text><Button label="Export XLSX" icon="download" disabled={exportDeactivatedXlsx.isPending} onPress={() => exportDeactivatedXlsx.mutate()} /></View>
            {deactivatedQuery.isPending ? <Text style={styles.muted}>Loading deactivated records…</Text> : deactivatedQuery.data?.data.map(student => <View key={student.id} style={styles.adminCard}>
              <Text style={styles.cardTitle}>{student.name}</Text><Line label="Student ID" value={student.digitalStudentId} /><Line label="Class / section" value={`${student.class} · ${student.section}`} /><Line label="Reason" value={student.deactivationReason || '—'} />
            </View>)}
            {!deactivatedQuery.isPending && !deactivatedQuery.data?.data.length && <Text style={styles.muted}>No deactivated records.</Text>}
          </ModuleCard>}
          {showForm && <ModuleCard>
            <Text style={styles.cardTitle}>{editing ? `Edit ${editing.name}` : 'Add student'}</Text>
            <Text style={styles.muted}>A unique student ID and initial sign-in credential are generated by the school registry service.</Text>
            <ModuleField label="Full name" value={draft.name} onChangeText={value => updateDraft('name', value)} />
            <ModuleField label="Class" value={draft.class} onChangeText={value => updateDraft('class', value)} />
            <ModuleField label="Section" value={draft.section} onChangeText={value => updateDraft('section', value)} />
            <ModuleField label="Phone (10 digits)" value={draft.phone} onChangeText={value => updateDraft('phone', value)} keyboardType="phone-pad" />
            <ModuleField label="Date of birth (YYYY-MM-DD)" value={draft.dob} onChangeText={value => updateDraft('dob', value)} />
            <ModuleField label="Date of admission (YYYY-MM-DD)" value={draft.enrollmentDate} onChangeText={value => updateDraft('enrollmentDate', value)} />
            <ModuleField label="Gender (Boy or Girl)" value={draft.gender} onChangeText={value => updateDraft('gender', value)} />
            <ModuleField label="Roll number" value={draft.rollNumber} onChangeText={value => updateDraft('rollNumber', value)} keyboardType="numeric" />
            <ModuleField label="Guardian name" value={draft.guardianName} onChangeText={value => updateDraft('guardianName', value)} />
            <ModuleField label="Father name" value={draft.fatherName} onChangeText={value => updateDraft('fatherName', value)} />
            <ModuleField label="Mother name" value={draft.motherName} onChangeText={value => updateDraft('motherName', value)} />
            <ModuleField label="Blood group" value={draft.bloodGroup} onChangeText={value => updateDraft('bloodGroup', value)} />
            <ModuleField label="Email" value={draft.email} onChangeText={value => updateDraft('email', value)} keyboardType="email-address" />
            <ModuleField label="Aadhaar number (12 digits)" value={draft.aadharNumber} onChangeText={value => updateDraft('aadharNumber', value)} keyboardType="numeric" />
            <ModuleField label="Address" value={draft.address} onChangeText={value => updateDraft('address', value)} />
            <View style={styles.rowWrap}>
              <Button label={save.isPending ? 'Saving…' : editing ? 'Save student' : 'Create student'} icon="save" disabled={save.isPending || !(editing ? canEdit('edit') : canEdit('add'))} onPress={submit} />
              {editing && <Button label="Cancel" icon="x" onPress={() => { setShowForm(false); setEditing(null); setDraft(emptyRegistryDraft); }} />}
            </View>
            {save.isError && <Text style={styles.error}>{save.error instanceof Error ? save.error.message : 'Unable to save student.'}</Text>}
          </ModuleCard>}
          {query.data.data.map(student => <View key={student.id} style={styles.adminCard}>
            {user.role === 'admin' && canEdit('deactivate') && <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selectedIds.includes(student.id) }} onPress={() => setSelectedIds(current => current.includes(student.id) ? current.filter(id => id !== student.id) : [...current, student.id])} style={styles.checkRow}>
              <View style={[styles.checkbox, selectedIds.includes(student.id) && styles.checked]}>{selectedIds.includes(student.id) && <Feather name="check" size={13} color={workspace.background} />}</View>
              <Text style={styles.lineValue}>Select for bulk deactivation</Text>
            </Pressable>}
            <Text style={styles.cardTitle}>{student.name}</Text>
            <Line label="Student ID" value={student.digitalStudentId} />
            <Line label="Class / section / roll" value={`${student.class} · ${student.section} · ${student.rollNumber ?? '—'}`} />
            <Line label="Phone / email" value={`${student.phone} · ${student.email || '—'}`} />
            <Line label="Guardian" value={student.guardianName || student.fatherName || '—'} />
            <View style={styles.rowWrap}>
              {canEdit('edit') && <Button label="Edit" icon="edit-2" onPress={() => startEdit(student)} />}
              {canEdit('deactivate') && <Button label="Deactivate" icon="user-x" disabled={!student.isActive} onPress={() => {
                setDeactivateTarget(student); setDeactivatePassword(''); setDeactivateReason('');
              }} />}
            </View>
          </View>)}
          {!query.data.data.length && <View style={styles.empty}><Text style={styles.emptyText}>No active student records match these filters.</Text></View>}
          <View style={styles.rowWrap}>
            <Button label="Previous" icon="chevron-left" disabled={page <= 1} onPress={() => setPage(Math.max(1, page - 1))} />
            <Button label="Next" icon="chevron-right" disabled={page >= Math.max(1, Math.ceil(query.data.total / query.data.pageSize))} onPress={() => setPage(page + 1)} />
          </View>
          {deactivateTarget && <ModuleCard>
            <Text style={styles.cardTitle}>Deactivate {deactivateTarget.name}</Text>
            <Text style={styles.muted}>This removes the student from active rosters. A reason and your account password are required.</Text>
            <ModuleField label="Reason for deactivation" value={deactivateReason} onChangeText={setDeactivateReason} />
            <ModuleField label="Confirm account password" value={deactivatePassword} onChangeText={setDeactivatePassword} secureTextEntry />
            <View style={styles.rowWrap}>
              <Button label={deactivate.isPending ? 'Deactivating…' : 'Confirm deactivation'} icon="user-x" disabled={deactivate.isPending || !deactivatePassword || deactivateReason.trim().length < 3 || !canEdit('deactivate')} onPress={() => deactivate.mutate({ id: deactivateTarget.id, password: deactivatePassword, reason: deactivateReason.trim() })} />
              <Button label="Cancel" icon="x" onPress={() => setDeactivateTarget(null)} />
            </View>
            {deactivate.isError && <Text style={styles.error}>{deactivate.error instanceof Error ? deactivate.error.message : 'Unable to deactivate student.'}</Text>}
          </ModuleCard>}
          {showBulkConfirm && <ModuleCard>
            <Text style={styles.cardTitle}>Bulk deactivate {selectedIds.length} students</Text>
            <Text style={styles.muted}>This action removes selected students from active rosters. Confirm the reason, batch, comments, and administrator password.</Text>
            <ModuleField label="Reason" value={bulkReason} onChangeText={setBulkReason} />
            <ModuleField label="Batch year" value={bulkBatchYear} onChangeText={setBulkBatchYear} />
            <ModuleField label="Comments" value={bulkComments} onChangeText={setBulkComments} />
            <ModuleField label="Confirm administrator password" value={bulkPassword} onChangeText={setBulkPassword} secureTextEntry />
            <View style={styles.rowWrap}>
              <Button label={bulkDeactivate.isPending ? 'Deactivating…' : `Confirm deactivation (${selectedIds.length})`} icon="user-x" disabled={bulkDeactivate.isPending || !bulkReason.trim() || !bulkBatchYear.trim() || !bulkComments.trim() || !bulkPassword} onPress={() => bulkDeactivate.mutate()} />
              <Button label="Cancel" icon="x" onPress={() => setShowBulkConfirm(false)} />
            </View>
            {bulkDeactivate.isError && <Text style={styles.error}>{bulkDeactivate.error instanceof Error ? bulkDeactivate.error.message : 'Unable to bulk-deactivate students.'}</Text>}
          </ModuleCard>}
        </>}
    <View style={styles.footer}><Text style={styles.footerText}>BENIUS Command Center · {user.schoolName}</Text></View>
  </AdminFrame>;
}

type ExamControllerConfig = {
  session: { id: number; sessionName: string; isActive: boolean };
  classes: string[];
  sections: string[];
  examTypes: string[];
  classSections: Record<string, string[]>;
  gradingTiers: Array<{ id: number; name: string; classes: string[]; passPercentage: number }>;
  examPolicyTiers: Array<{ id: number; tierName: string; applicableClasses: string[] }>;
};
type ExamLedgerRow = {
  class: string; section: string; term: string; status: 'none' | 'draft' | 'locked';
  totalStudents: number; lockedCount: number; manualInterventionCount: number; teacherName: string | null;
  lockedAt: string | null; adminExecuted: boolean; executedCount: number; readyCount: number; pendingCount: number;
};
type ExamStudent = {
  studentId: number; dsid: string; name: string; totalObtained: number; totalMax: number; percentage: number; subjects: string[];
  gradeLabel: string | null; gradePoint: string | null; gradeRemarks: string | null; tierPassThreshold: number;
  ledger: { decision: string; targetClass: string; targetSection: string; manualIntervention: boolean; locked: boolean; adminExecuted: boolean } | null;
};
type ExamCohort = {
  class: string; section: string; term: string; sessionId: number; students: ExamStudent[]; missingSubjects: string[];
  passThreshold: number; nextClass: string;
};

function ExamControllerModule({ user, onBack, online, selectedSessionId, selectedSessionName, isArchive }: {
  user: NonNullable<ReturnType<typeof useAuth>['user']>;
  onBack: () => void;
  online: boolean;
  selectedSessionId: number | null;
  selectedSessionName: string;
  isArchive: boolean;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [view, setView] = useState<'ledger' | 'cohort' | 'history'>('ledger');
  const [term, setTerm] = useState('');
  const [cohortKey, setCohortKey] = useState<{ class: string; section: string } | null>(null);
  const [selectedStudents, setSelectedStudents] = useState<number[]>([]);
  const [selectedReminderKeys, setSelectedReminderKeys] = useState<string[]>([]);
  const [destinationDrafts, setDestinationDrafts] = useState<Record<number, { targetClass: string; targetSection: string }>>({});
  const [historyStudentId, setHistoryStudentId] = useState('');
  const basePath = '/mobile/admin/modules/exam-controller';
  const queryIdentity = ['mobile-exam-controller', user.schoolId, user.id, selectedSessionId ?? 'active'];
  const get = <T,>(path: string, signal?: AbortSignal) => selectedSessionId
    ? apiGetForSession<T>(path, selectedSessionId, { signal })
    : apiGet<T>(path, { signal });
  const post = <T,>(path: string, body: unknown) => selectedSessionId
    ? apiPostForSession<T>(path, selectedSessionId, body)
    : apiPost<T>(path, body);
  const configQuery = useQuery({
    queryKey: [...queryIdentity, 'config'],
    queryFn: ({ signal }) => get<ExamControllerConfig>(basePath, signal),
    enabled: online,
  });
  const activeTerm = term || configQuery.data?.examTypes[0] || '';
  const ledgerQuery = useQuery({
    queryKey: [...queryIdentity, 'ledger', activeTerm],
    queryFn: ({ signal }) => get<{ term: string; rows: ExamLedgerRow[] }>(`${basePath}/ledger?term=${encodeURIComponent(activeTerm)}`, signal),
    enabled: online && !!activeTerm,
  });
  const cohortQuery = useQuery({
    queryKey: [...queryIdentity, 'cohort', cohortKey?.class, cohortKey?.section, activeTerm],
    queryFn: ({ signal }) => get<ExamCohort>(`${basePath}/cohort?class=${encodeURIComponent(cohortKey!.class)}&section=${encodeURIComponent(cohortKey!.section)}&term=${encodeURIComponent(activeTerm)}`, signal),
    enabled: online && view === 'cohort' && !!cohortKey && !!activeTerm,
  });
  const historyQuery = useQuery({
    queryKey: [...queryIdentity, 'history', historyStudentId],
    queryFn: ({ signal }) => get<Array<{ id: number; studentId: number; fromClass: string; fromSection: string; toClass: string; toSection: string; examType: string; percentage: number; archivedAt: string }>>(
      `${basePath}/history${historyStudentId ? `?studentId=${encodeURIComponent(historyStudentId)}` : ''}`, signal),
    enabled: online && view === 'history',
  });
  const write = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => post(path, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...queryIdentity, 'ledger'] });
      void queryClient.invalidateQueries({ queryKey: [...queryIdentity, 'cohort'] });
      void queryClient.invalidateQueries({ queryKey: [...queryIdentity, 'history'] });
    },
  });
  const canWizard = user.role === 'admin' || (user.allowedModules || []).includes('exam-controller:wizard');
  const canLedger = user.role === 'admin' || (user.allowedModules || []).includes('exam-controller:ledger');
  const canHistory = user.role === 'admin' || (user.allowedModules || []).includes('exam-controller:history');
  const openCohort = (row: ExamLedgerRow) => {
    setCohortKey({ class: row.class, section: row.section });
    setSelectedStudents([]);
    setView('cohort');
  };
  const requestDecision = (student: ExamStudent, decision: 'promote' | 'retain' | 'grace_pass', cohort: ExamCohort) => {
    const savedClass = student.ledger?.targetClass || (student.percentage >= cohort.passThreshold ? cohort.nextClass : cohort.class);
    const nextClass = destinationDrafts[student.studentId]?.targetClass || (decision === 'retain' ? cohort.class : savedClass);
    const nextSection = destinationDrafts[student.studentId]?.targetSection || (decision === 'retain' ? cohort.section
      : student.ledger?.targetClass === nextClass ? student.ledger.targetSection : configQuery.data?.classSections[nextClass]?.[0] || cohort.section);
    write.mutate({ path: `${basePath}/decision`, body: {
      class: cohort.class, section: cohort.section, term: activeTerm, studentId: student.studentId,
      decision, targetClass: nextClass, targetSection: nextSection,
    } });
  };
  const clearDecision = (student: ExamStudent, cohort: ExamCohort) => Alert.alert('Clear manual decision', `Remove the saved decision for ${student.name}?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Clear', style: 'destructive', onPress: () => write.mutate({
      path: `${basePath}/decision/clear`,
      body: { class: cohort.class, section: cohort.section, term: activeTerm, studentId: student.studentId },
    }) },
  ]);
  const toggleStudent = (id: number) => setSelectedStudents(previous => previous.includes(id)
    ? previous.filter(item => item !== id) : [...previous, id]);
  const runExecution = (cohort: ExamCohort, ids?: number[]) => {
    const detail = ids?.length ? `Execute the selected ${ids.length} student(s)` : `Execute all ${cohort.students.length} students`;
    Alert.alert('Confirm promotion execution', `${detail} in ${cohort.class} · ${cohort.section} for ${activeTerm}? This archives academic history and updates student class placement.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Execute', style: 'destructive', onPress: () => write.mutate({
        path: `${basePath}/execute`,
        body: { class: cohort.class, section: cohort.section, term: activeTerm, ...(ids?.length ? { studentIds: ids } : {}) },
      }) },
    ]);
  };
  const sendReminder = (row: ExamLedgerRow) => write.mutate({ path: `${basePath}/reminder`, body: { class: row.class, section: row.section, term: activeTerm } });
  const sendReminderAll = () => {
    const cohorts = (ledgerQuery.data?.rows || []).filter(row => selectedReminderKeys.includes(`${row.class}|${row.section}`)).map(row => ({ class: row.class, section: row.section }));
    if (!cohorts.length) return;
    Alert.alert('Remind selected teachers', `Dispatch ${cohorts.length} reminders for ${selectedSessionName}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Dispatch', onPress: () => write.mutate({ path: `${basePath}/reminder-all`, body: { term: activeTerm, cohorts } }) },
    ]);
  };
  const clearCohort = (cohort: ExamCohort) => Alert.alert('Clear unsent decisions', `Clear all unexecuted decisions for ${cohort.class}-${cohort.section}?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Clear', style: 'destructive', onPress: () => write.mutate({ path: `${basePath}/decision/clear-cohort`, body: { class: cohort.class, section: cohort.section, term: activeTerm } }) },
  ]);
  const bulkPromote = (cohort: ExamCohort) => {
    const items = selectedStudents.map(studentId => {
      const student = cohort.students.find(item => item.studentId === studentId)!;
      const targetClass = destinationDrafts[studentId]?.targetClass || (student.percentage >= cohort.passThreshold ? cohort.nextClass : cohort.class);
      return { studentId, decision: 'promote' as const, targetClass, targetSection: destinationDrafts[studentId]?.targetSection || configQuery.data?.classSections[targetClass]?.[0] || cohort.section };
    });
    write.mutate({ path: `${basePath}/decision/bulk`, body: { class: cohort.class, section: cohort.section, term: activeTerm, items } });
  };
  const error = [configQuery.error, ledgerQuery.error, cohortQuery.error, historyQuery.error, write.error]
    .find(item => item instanceof Error) as Error | undefined;

  if (!user || !['admin', 'support_staff'].includes(user.role)) {
    return <AdminFrame title="Exam Controller" onBack={onBack}><State title="Access denied" detail="Administrator access is required." /></AdminFrame>;
  }
  return <AdminFrame title="Exam Controller" onBack={onBack}>
    {!online && <View style={styles.offline}><Feather name="wifi-off" color={workspace.ink} size={15} /><Text style={styles.offlineText}>Offline · Exam data and decision changes require a connection.</Text></View>}
    <View style={styles.sessionBanner}>
      <Feather name="calendar" color={workspace.gold} size={15} />
      <Text style={styles.sessionText}>{selectedSessionName || 'Academic session'}{isArchive ? ' · Archive · Changes locked' : ''}</Text>
      {user.role === 'admin' && <Pressable onPress={() => router.push('/sessions')}><Text style={styles.sessionLink}>Change</Text></Pressable>}
    </View>
    <SectionTitle title="Exam Controller" detail="Session-scoped results, promotion decisions, ledger status, and execution history." />
    {configQuery.isPending ? <State title="Loading Exam Controller" loading />
      : configQuery.isError || !configQuery.data ? <State title="Exam Controller unavailable" detail={configQuery.error?.message || 'The server returned no configuration.'} retry={() => { void configQuery.refetch(); }} />
      : <>
        {!!error && <Text style={styles.error}>{error.message}</Text>}
        {write.isSuccess && <Text style={styles.success}>Session-scoped action completed.</Text>}
        <View style={styles.rowWrap}>
          <Pill label="Promotion ledger" active={view === 'ledger'} onPress={() => setView('ledger')} />
          <Pill label="Student decision wizard" active={view === 'cohort'} disabled={!canWizard} onPress={() => setView('cohort')} />
          <Pill label="Execution history" active={view === 'history'} disabled={!canHistory} onPress={() => setView('history')} />
        </View>
        {view !== 'history' && <>
          <ModuleCard>
            <Text style={styles.cardTitle}>Exam term</Text>
            <View style={styles.rowWrap}>{configQuery.data.examTypes.map(item => <Pill key={item} label={item} active={activeTerm === item} onPress={() => {
              setTerm(item);
              setCohortKey(null);
              setView('ledger');
            }} />)}</View>
            {!configQuery.data.examTypes.length && <Text style={styles.muted}>No promotion-gated exam types are configured. Configure exam terms in School Setup.</Text>}
          </ModuleCard>
          {view === 'ledger' && <>
            {ledgerQuery.isPending ? <State title="Loading promotion ledger" loading />
              : ledgerQuery.isError || !ledgerQuery.data ? <State title="Promotion ledger unavailable" detail={ledgerQuery.error?.message || 'Select a configured exam type.'} retry={() => { void ledgerQuery.refetch(); }} />
                : <>
                  <View style={styles.statsRow}>
                    <View style={styles.statCard}><Text style={styles.statValue}>{ledgerQuery.data.rows.length}</Text><Text style={styles.statLabel}>COHORTS</Text></View>
                    <View style={styles.statCard}><Text style={styles.statValue}>{ledgerQuery.data.rows.filter(row => row.readyCount > 0).length}</Text><Text style={styles.statLabel}>READY</Text></View>
                    <View style={styles.statCard}><Text style={styles.statValue}>{ledgerQuery.data.rows.filter(row => row.adminExecuted).length}</Text><Text style={styles.statLabel}>EXECUTED</Text></View>
                  </View>
                  {canLedger && <Button label="Delete this session’s ledger" icon="trash-2" disabled={isArchive || write.isPending} onPress={() => Alert.alert('Delete promotion ledger?', `Delete ${activeTerm} ledger records for ${selectedSessionName}?`, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => write.mutate({ path: `${basePath}/ledger/delete`, body: { term: activeTerm } }) },
                  ])} />}
                   {canLedger && <View style={styles.adminCard}>
                     <Text style={styles.cardTitle}>Bulk teacher reminders</Text>
                     <Text style={styles.muted}>Select class-sections below. Only this session and selected exam term are included; each notice is pinned to its school-mapped teacher.</Text>
                     <View style={styles.rowWrap}>
                       <Button label="Select all cohorts" icon="check-square" disabled={isArchive} onPress={() => setSelectedReminderKeys(ledgerQuery.data!.rows.map(row => `${row.class}|${row.section}`))} />
                       <Button label="Clear" icon="x" onPress={() => setSelectedReminderKeys([])} />
                       <Button label={`Remind selected (${selectedReminderKeys.length})`} icon="bell" disabled={isArchive || write.isPending || !selectedReminderKeys.length} onPress={sendReminderAll} />
                     </View>
                   </View>}
                   {ledgerQuery.data.rows.map(row => <View key={`${row.class}|${row.section}`} style={styles.adminCard}><Pressable onPress={() => openCohort(row)}>
                     <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selectedReminderKeys.includes(`${row.class}|${row.section}`) }} onPress={() => setSelectedReminderKeys(current => current.includes(`${row.class}|${row.section}`) ? current.filter(key => key !== `${row.class}|${row.section}`) : [...current, `${row.class}|${row.section}`])} style={styles.checkRow}>
                       <View style={[styles.checkbox, selectedReminderKeys.includes(`${row.class}|${row.section}`) && styles.checked]}>{selectedReminderKeys.includes(`${row.class}|${row.section}`) && <Feather name="check" size={13} color={workspace.background} />}</View><Text style={styles.lineValue}>Select for bulk reminder</Text>
                     </Pressable>
                    <View style={styles.visitorHead}><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{row.class} · Section {row.section}</Text><Text style={styles.muted}>{row.totalStudents} saved decisions · {row.manualInterventionCount} manual interventions</Text></View><Feather name="chevron-right" color={workspace.subdued} size={18} /></View>
                    <View style={styles.rowWrap}>
                      <Pill label={`${row.executedCount || 0} executed`} active={row.adminExecuted} />
                      <Pill label={`${row.readyCount || row.lockedCount || 0} ready`} active={row.status === 'locked'} />
                      <Pill label={`${row.pendingCount ?? Math.max(0, row.totalStudents - row.lockedCount)} pending`} />
                    </View>
                    {row.teacherName && <Line label="Submitted by" value={row.teacherName} />}
                   </Pressable><Button label="Remind teacher" icon="bell" disabled={isArchive || write.isPending} onPress={() => sendReminder(row)} /></View>)}
                  {!ledgerQuery.data.rows.length && <View style={styles.empty}><Text style={styles.emptyText}>No promotion ledger records have been saved for this exam type in this session.</Text></View>}
                </>}
          </>}
          {view === 'cohort' && <>
            <View style={styles.rowWrap}><Button label="Back to promotion ledger" icon="arrow-left" onPress={() => setView('ledger')} /></View>
            {!cohortKey ? <View style={styles.empty}><Text style={styles.emptyText}>Choose a class and section from the promotion ledger to review its student results.</Text></View>
              : cohortQuery.isPending ? <State title="Loading session results" loading />
                : cohortQuery.isError || !cohortQuery.data ? <State title="Cohort results unavailable" detail={cohortQuery.error?.message || 'The server returned no results.'} retry={() => { void cohortQuery.refetch(); }} />
                  : <>
                    <ModuleCard>
                      <Text style={styles.cardTitle}>{cohortQuery.data.class} · Section {cohortQuery.data.section} · {activeTerm}</Text>
                      <Line label="Pass threshold" value={`${cohortQuery.data.passThreshold}%`} />
                      <Line label="Students with session results" value={String(cohortQuery.data.students.length)} />
                      {!!cohortQuery.data.missingSubjects.length && <Text style={styles.validation}>Missing mapped subjects: {cohortQuery.data.missingSubjects.join(', ')}</Text>}
                      <View style={styles.rowWrap}>
                        <Button label="Select all" icon="check-square" onPress={() => setSelectedStudents(cohortQuery.data!.students.map(item => item.studentId))} />
                        <Button label="Clear selection" icon="x" onPress={() => setSelectedStudents([])} />
                        <Button label="Execute all" icon="play" disabled={isArchive || !canWizard || write.isPending || !cohortQuery.data.students.length} onPress={() => runExecution(cohortQuery.data!)} />
                        {!!selectedStudents.length && <Button label={`Execute selected (${selectedStudents.length})`} icon="play" disabled={isArchive || !canWizard || write.isPending} onPress={() => runExecution(cohortQuery.data!, selectedStudents)} />}
                        {!!selectedStudents.length && <Button label={`Promote selected (${selectedStudents.length})`} icon="check" disabled={isArchive || !canWizard || write.isPending} onPress={() => bulkPromote(cohortQuery.data!)} />}
                        <Button label="Clear unsent decisions" icon="trash-2" disabled={isArchive || !canWizard || write.isPending} onPress={() => clearCohort(cohortQuery.data!)} />
                      </View>
                    </ModuleCard>
                    {cohortQuery.data.students.map(student => {
                      const isSelected = selectedStudents.includes(student.studentId);
                      const suggestion = student.percentage >= cohortQuery.data!.passThreshold ? 'promoted' : 'retained';
                      const defaultTargetClass = student.ledger?.targetClass || (student.percentage >= cohortQuery.data!.passThreshold ? cohortQuery.data!.nextClass : cohortQuery.data!.class);
                      const targetClass = destinationDrafts[student.studentId]?.targetClass || defaultTargetClass;
                      const targetSection = destinationDrafts[student.studentId]?.targetSection
                        || (student.ledger?.targetClass === targetClass ? student.ledger.targetSection : configQuery.data.classSections[targetClass]?.[0] || cohortQuery.data!.section);
                      return <View key={student.studentId} style={styles.adminCard}>
                        <View style={styles.visitorHead}>
                          <Pill label={isSelected ? 'Selected' : 'Select'} active={isSelected} onPress={() => toggleStudent(student.studentId)} />
                          <View style={{ flex: 1 }}><Text style={styles.cardTitle}>{student.name}</Text><Text style={styles.muted}>{student.dsid} · {student.totalObtained}/{student.totalMax} · {student.percentage.toFixed(1)}%</Text></View>
                        </View>
                        <Line label="Subjects" value={student.subjects.join(', ')} />
                        <Line label="Grade / pass rule" value={`${student.gradeLabel || '—'} · ${student.tierPassThreshold}%`} />
                        {student.ledger && <Line label="Saved decision" value={`${student.ledger.decision} · ${student.ledger.targetClass} / ${student.ledger.targetSection}${student.ledger.adminExecuted ? ' · Executed' : ''}`} />}
                        <Text style={styles.muted}>Automatic suggestion: {suggestion}</Text>
                        <Text style={styles.fieldLabel}>Destination class</Text>
                        <View style={styles.rowWrap}>{configQuery.data.classes.map(optionClass => <Pill key={optionClass} label={`Class ${optionClass}`} active={targetClass === optionClass} disabled={isArchive || !canWizard} onPress={() => setDestinationDrafts(current => ({
                          ...current,
                          [student.studentId]: { targetClass: optionClass, targetSection: configQuery.data.classSections[optionClass]?.[0] || cohortQuery.data!.class },
                        }))} />)}</View>
                        <Text style={styles.fieldLabel}>Destination section</Text>
                        <View style={styles.rowWrap}>{(configQuery.data.classSections[targetClass] || []).map(optionSection => <Pill key={optionSection} label={`Section ${optionSection}`} active={targetSection === optionSection} disabled={isArchive || !canWizard} onPress={() => setDestinationDrafts(current => ({
                          ...current,
                          [student.studentId]: { targetClass, targetSection: optionSection },
                        }))} />)}</View>
                        <View style={styles.rowWrap}>
                          <Pill label="Promote" active={student.ledger?.decision === 'promoted'} disabled={isArchive || !canWizard || write.isPending} onPress={() => requestDecision(student, 'promote', cohortQuery.data!)} />
                          <Pill label="Retain" active={student.ledger?.decision === 'retained'} disabled={isArchive || !canWizard || write.isPending} onPress={() => requestDecision(student, 'retain', cohortQuery.data!)} />
                          <Pill label="Grace pass" active={student.ledger?.decision === 'grace_pass'} disabled={isArchive || !canWizard || write.isPending} onPress={() => requestDecision(student, 'grace_pass', cohortQuery.data!)} />
                          {!!student.ledger && <Pill label="Clear decision" icon="x" disabled={isArchive || !canWizard || write.isPending || student.ledger.adminExecuted} onPress={() => clearDecision(student, cohortQuery.data!)} />}
                        </View>
                      </View>;
                    })}
                    {!cohortQuery.data.students.length && <View style={styles.empty}><Text style={styles.emptyText}>No exam scores are recorded for this cohort in the selected academic session.</Text></View>}
                  </>}
          </>}
        </>}
        {view === 'history' && <>
          <ModuleCard>
            <Text style={styles.cardTitle}>Promotion execution history</Text>
            <Text style={styles.muted}>Only archived records from {selectedSessionName} are shown.</Text>
            <ModuleField label="Filter by student ID (optional)" value={historyStudentId} keyboardType="numeric" onChangeText={setHistoryStudentId} />
          </ModuleCard>
          {historyQuery.isPending ? <State title="Loading execution history" loading />
            : historyQuery.isError || !historyQuery.data ? <State title="Execution history unavailable" detail={historyQuery.error?.message || 'No history response.'} retry={() => { void historyQuery.refetch(); }} />
              : historyQuery.data.map(item => <ModuleCard key={item.id}>
                <Text style={styles.cardTitle}>Student #{item.studentId} · {item.examType} · {item.percentage}%</Text>
                <Line label="From" value={`${item.fromClass} · ${item.fromSection}`} />
                <Line label="To" value={`${item.toClass} · ${item.toSection}`} />
                <Line label="Archived" value={formatIST(item.archivedAt)} />
              </ModuleCard>)}
          {historyQuery.data?.length === 0 && <View style={styles.empty}><Text style={styles.emptyText}>No promotion history exists for this academic session.</Text></View>}
        </>}
      </>}
    <View style={styles.footer}><Text style={styles.footerText}>BENIUS Command Center · {user.schoolName}</Text></View>
  </AdminFrame>;
}

function calendarMonthKey(date = new Date()): string {
  const key = istDateKey(date);
  return key.slice(0, 7);
}

function VisitorModule({ data, queryKey, selectedSessionId, isArchive, canCheckIn, canCheckOut }: {
  data: VisitorEntry[];
  queryKey: unknown[];
  selectedSessionId: number | null;
  isArchive: boolean;
  canCheckIn: boolean;
  canCheckOut: boolean;
}) {
  const queryClient = useQueryClient();
  const { online } = useNetwork();
  const [filter, setFilter] = useState<VisitorFilter>('all');
  const [from, setFrom] = useState(istDateKey());
  const [to, setTo] = useState(istDateKey());
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [visitorName, setVisitorName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [hostName, setHostName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [visitorIdNumber, setVisitorIdNumber] = useState('');
  const [address, setAddress] = useState('');
  const [feedback, setFeedback] = useState('');
  const today = istDateKey();
  const canWrite = !isArchive && online;
  const checkInMutation = useMutation({
    mutationFn: async () => {
      const body = { visitorName: visitorName.trim(), purpose: purpose.trim(), hostName: hostName.trim(), phone: phone || null, email: email || null, visitorIdNumber: visitorIdNumber || null, address: address || null };
      return selectedSessionId
        ? apiPostForSession<VisitorEntry>('/mobile/admin/modules/visitor-log/check-in', selectedSessionId, body)
        : apiPost<VisitorEntry>('/mobile/admin/modules/visitor-log/check-in', body);
    },
    onSuccess: async () => {
      setFeedback('Visitor Checked In · The entry has been logged on campus.');
      setVisitorName(''); setPurpose(''); setHostName(''); setPhone(''); setEmail(''); setVisitorIdNumber(''); setAddress('');
      setShowForm(false);
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: error => setFeedback(error instanceof Error ? error.message : 'Unable to check in this visitor.'),
  });
  const checkOutMutation = useMutation({
    mutationFn: async (id: number) => selectedSessionId
      ? apiPostForSession<VisitorEntry>(`/mobile/admin/modules/visitor-log/${id}/check-out`, selectedSessionId, {})
      : apiPost<VisitorEntry>(`/mobile/admin/modules/visitor-log/${id}/check-out`, {}),
    onSuccess: async () => {
      setFeedback('Visitor Checked Out');
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: error => setFeedback(error instanceof Error ? error.message : 'Unable to check out this visitor.'),
  });
  const active = useMemo(() => data.filter(entry => !entry.checkOut), [data]);
  const past = useMemo(() => data.filter(entry => !!entry.checkOut), [data]);
  const range = visitorRange(filter, today, from, to);
  const filteredPast = past.filter(entry => belongsToRange(entry.checkIn, range)
    && (!search.trim() || [entry.visitorName, entry.purpose, entry.hostName, entry.phone].some(value => value?.toLowerCase().includes(search.trim().toLowerCase()))));
  const dailyCount = data.filter(entry => belongsToRange(entry.checkIn, [today, today])).length;
  const weeklyRange = visitorRange('week', today, from, to);
  const monthlyRange = visitorRange('month', today, from, to);
  const weeklyCount = data.filter(entry => belongsToRange(entry.checkIn, weeklyRange)).length;
  const monthlyCount = data.filter(entry => belongsToRange(entry.checkIn, monthlyRange)).length;
  const invalidPhone = !!phone && !/^\d{10}$/.test(phone);
  const invalidEmail = !!email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const canSubmit = !!visitorName.trim() && !!purpose.trim() && !!hostName.trim()
    && !invalidPhone && !invalidEmail && canWrite && !checkInMutation.isPending;

  return <View style={{ gap: 16 }}>
    <SectionTitle title="Visitor Log" detail={`${active.length} currently on campus · India Standard Time`} />
    <View style={styles.statsRow}>{[
      { label: 'TODAY', value: dailyCount, icon: 'sun' as const },
      { label: 'THIS WEEK', value: weeklyCount, icon: 'calendar' as const },
      { label: 'THIS MONTH', value: monthlyCount, icon: 'trending-up' as const },
    ].map(item => <View key={item.label} style={styles.statCard}><Feather name={item.icon} size={17} color={workspace.gold} /><Text style={styles.statValue}>{item.value}</Text><Text style={styles.statLabel}>{item.label}</Text></View>)}</View>
    <View style={styles.rowWrap}>
      {canCheckIn && <Button label={showForm ? 'Close Check In' : 'Check In Visitor'} icon={showForm ? 'x' : 'plus'} disabled={!canWrite} onPress={() => { setShowForm(!showForm); setFeedback(''); }} />}
    </View>
    {isArchive && <View style={styles.archive}><Feather name="lock" color={workspace.gold} size={15} /><Text style={styles.archiveText}>Archive mode · Visitor check-in and check-out are locked.</Text></View>}
    {showForm && canCheckIn && <ModuleCard>
      <Text style={styles.cardTitle}>New Visitor Entry</Text>
      <ModuleField label="Visitor Name *" value={visitorName} onChangeText={setVisitorName} />
      <ModuleField label="Purpose *" value={purpose} onChangeText={setPurpose} />
      <ModuleField label="Host / Meeting *" value={hostName} onChangeText={setHostName} />
      <ModuleField label="Phone" value={phone} onChangeText={value => setPhone(value.replace(/\D/g, '').slice(0, 10))} keyboardType="phone-pad" />
      {!!phone && invalidPhone && <Text style={styles.validation}>Enter exactly 10 digits.</Text>}
      <ModuleField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
      {!!email && invalidEmail && <Text style={styles.validation}>Enter a valid email address.</Text>}
      <ModuleField label="ID / ID Number" value={visitorIdNumber} onChangeText={setVisitorIdNumber} />
      <ModuleField label="Address" value={address} onChangeText={setAddress} />
      <Button label={checkInMutation.isPending ? 'Checking In…' : 'Check In Visitor'} icon="user-check" disabled={!canSubmit} onPress={() => { setFeedback(''); checkInMutation.mutate(); }} />
    </ModuleCard>}
    {!!feedback && <Text accessibilityRole="alert" style={feedback.includes('Unable') || feedback.includes('required') || feedback.includes('valid') ? styles.error : styles.success}>{feedback}</Text>}
    <View style={styles.tabRow}>
      <Text style={styles.cardTitle}>Currently on Campus</Text>
      <View style={styles.countBadge}><Text style={styles.countText}>{active.length}</Text></View>
    </View>
    {active.length === 0 ? <View style={styles.empty}><Feather name="users" size={24} color={workspace.faint} /><Text style={styles.emptyText}>No visitors currently checked in</Text></View>
      : active.map(entry => <VisitorCard key={entry.id} entry={entry} canCheckOut={canCheckOut && canWrite}
        onCheckOut={() => Alert.alert('Check Out Visitor', `Check out ${entry.visitorName}?`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Check Out', onPress: () => { setFeedback(''); checkOutMutation.mutate(entry.id); } },
        ])} busy={checkOutMutation.isPending && checkOutMutation.variables === entry.id} />)}
    <View style={styles.divider} />
    <SectionTitle title="Visitor History" detail={`${filteredPast.length} checked-out entries`} />
    <ModuleField label="Search visitors" value={search} onChangeText={setSearch} />
    <View style={styles.rowWrap}>
      {(['all', 'day', 'week', 'month', 'custom'] as VisitorFilter[]).map(value => <Pill key={value} label={value === 'all' ? 'All Time' : value === 'day' ? 'Today' : value === 'week' ? 'This Week' : value === 'month' ? 'This Month' : 'Custom Range'} active={filter === value} onPress={() => setFilter(value)} />)}
    </View>
    {filter === 'custom' && <View style={styles.rowWrap}>
      <TextInput accessibilityLabel="Custom range start date" testID="visitor-filter-custom-from" value={from} onChangeText={setFrom} placeholder="YYYY-MM-DD" placeholderTextColor={workspace.faint} style={[styles.textInput, { flex: 1 }]} />
      <TextInput accessibilityLabel="Custom range end date" testID="visitor-filter-custom-to" value={to} onChangeText={setTo} placeholder="YYYY-MM-DD" placeholderTextColor={workspace.faint} style={[styles.textInput, { flex: 1 }]} />
    </View>}
    {filteredPast.length === 0 ? <View style={styles.empty}><Feather name="clock" size={22} color={workspace.faint} /><Text style={styles.emptyText}>No visitor history for this period</Text></View>
      : filteredPast.map(entry => <VisitorCard key={entry.id} entry={entry} canCheckOut={false} />)}
  </View>;
}

function VisitorCard({ entry, canCheckOut, onCheckOut, busy }: {
  entry: VisitorEntry; canCheckOut: boolean; onCheckOut?: () => void; busy?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const elapsed = entry.checkOut
    ? `${Math.max(0, Math.floor((new Date(entry.checkOut).getTime() - new Date(entry.checkIn).getTime()) / 60_000))} min`
    : `${Math.max(0, Math.floor((Date.now() - new Date(entry.checkIn).getTime()) / 60_000))} min`;
  return <ModuleCard>
    <Pressable testID={`visitor-row-${entry.id}`} accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={styles.visitorHead}>
      <View style={[styles.statusDot, { backgroundColor: entry.checkOut ? workspace.faint : workspace.green }]} />
      <View style={{ flex: 1 }}><Text style={styles.cardTitle}>{entry.visitorName}</Text><Text style={styles.muted}>{entry.purpose}</Text></View>
      <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={workspace.subdued} />
    </Pressable>
    <View style={styles.visitorMeta}><Text style={styles.metaText}>{entry.checkOut ? 'Checked out' : 'Active'} · {elapsed}</Text><Text style={styles.metaText}>{formatIST(entry.checkIn)}</Text></View>
    <Line label="Host / Meeting" value={entry.hostName} />
    {expanded && <>
      {!!entry.phone && <Line label="Phone" value={entry.phone} />}
      {!!entry.email && <Line label="Email" value={entry.email} />}
      {!!entry.visitorIdNumber && <Line label="ID Number" value={entry.visitorIdNumber} />}
      {!!entry.address && <Line label="Address" value={entry.address} />}
      {!!entry.checkOut && <Line label="Check Out" value={formatIST(entry.checkOut)} />}
    </>}
    {canCheckOut && onCheckOut && <Pressable testID={`visitor-checkout-${entry.id}`} accessibilityRole="button" disabled={busy} onPress={onCheckOut} style={[styles.actionButton, busy && styles.disabled]}>
      {busy ? <ActivityIndicator color={workspace.background} /> : <><Feather name="log-out" size={15} color={workspace.background} /><Text style={styles.actionButtonText}>Check Out Visitor</Text></>}
    </Pressable>}
  </ModuleCard>;
}

function AuditModule({ data }: { data: AuditEntry[] }) {
  const [search, setSearch] = useState('');
  const visible = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return normalized ? data.filter(item => [item.actionType, item.entityType, item.actionByRole, item.details]
      .some(value => value?.toLowerCase().includes(normalized))) : data;
  }, [data, search]);
  return <View style={{ gap: 14 }}>
    <SectionTitle title="Audit Logs" detail="Complete immutable trail of school actions · Last 100 entries · Asia/Kolkata (IST)" />
    <ModuleField label="Search audit trail" value={search} onChangeText={setSearch} />
    {visible.length === 0 ? <View style={styles.empty}><Feather name="shield" size={24} color={workspace.faint} /><Text style={styles.emptyText}>{data.length ? 'No matching audit events' : 'No audit events recorded yet'}</Text></View>
      : visible.map(log => <ModuleCard key={log.id}>
          <View style={styles.visitorHead}>
            <Feather name="shield" size={17} color={log.actionType === 'approve' || log.actionType === 'verify' ? workspace.green : log.actionType === 'reject' ? workspace.red : workspace.cyan} />
            <Text style={[styles.auditAction, { flex: 1 }]}>{log.actionType.toUpperCase()}</Text>
            <Text style={styles.auditRole}>{titleCase(log.actionByRole)}</Text>
          </View>
          <View style={styles.visitorMeta}><Text style={styles.metaText}>{titleCase(log.entityType)}</Text><Text style={styles.metaText}>{formatIST(log.createdAt)}</Text></View>
          <Text style={styles.auditDetails} numberOfLines={3}>{log.details || '—'}</Text>
        </ModuleCard>)}
  </View>;
}

type CalendarForm = {
  title: string; description: string; eventType: 'holiday' | 'academic' | 'examination' | 'event';
  startDate: string; endDate: string; isRecurring: boolean; audienceScope: 'All_School' | 'Entire_Class' | 'Specific_Section';
  targetClass: string; targetSection: string; venue: string; colorCode: string;
};
const emptyCalendarForm = (): CalendarForm => ({ title: '', description: '', eventType: 'holiday', startDate: istDateKey(), endDate: istDateKey(), isRecurring: false, audienceScope: 'All_School', targetClass: '', targetSection: '', venue: '', colorCode: workspace.cyan });

function CalendarModule({ data, queryKey, canEdit, month, onMonthChange }: {
  data: CalendarResponse; queryKey: unknown[]; canEdit: boolean; month: string; onMonthChange: (month: string) => void;
}) {
  const queryClient = useQueryClient();
  const { online } = useNetwork();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CalendarForm>(emptyCalendarForm());
  const [feedback, setFeedback] = useState('');
  const [eventFilter, setEventFilter] = useState('all');
  const year = Number(month.slice(0, 4));
  const monthNum = Number(month.slice(5, 7));
  const firstWeekday = new Date(Date.UTC(year, monthNum - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  const events = data.events.filter(event => eventFilter === 'all' || event.eventType === eventFilter);
  const eventsByDay = useMemo(() => {
    const result = new Map<number, CalendarEvent[]>();
    for (const event of events) {
      const day = Number(event.date.slice(8, 10));
      result.set(day, [...(result.get(day) ?? []), event]);
    }
    return result;
  }, [events]);
  const write = useMutation({
    mutationFn: async () => {
      if (!online) throw new Error('Reconnect before changing the school calendar.');
      if (!canEdit) throw new Error('You do not have permission to create or edit calendar events.');
      const body = {
        ...form,
        date: form.startDate,
        targetClass: form.audienceScope === 'All_School' ? null : form.targetClass.trim(),
        targetSection: form.audienceScope === 'Specific_Section' ? form.targetSection.trim() : null,
      };
      if (editingId) return apiPost<CalendarEvent>(`/mobile/admin/modules/school-calendar/${editingId}/update`, body);
      return apiPost<CalendarEvent[]>('/mobile/admin/modules/school-calendar', body);
    },
    onSuccess: async () => {
      setShowForm(false); setEditingId(null); setForm(emptyCalendarForm()); setFeedback('Calendar event saved.');
      await queryClient.invalidateQueries({ queryKey: ['admin-module'] });
    },
    onError: error => setFeedback(error instanceof Error ? error.message : 'Unable to save calendar event.'),
  });
  const remove = useMutation({
    mutationFn: async (id: number) => {
      if (!online || !canEdit) throw new Error(!online ? 'Reconnect before deleting calendar events.' : 'You do not have permission to delete events.');
      return apiPost<{ message: string }>(`/mobile/admin/modules/school-calendar/${id}/delete`, {});
    },
    onSuccess: async () => {
      setFeedback('Calendar event deleted.');
      await queryClient.invalidateQueries({ queryKey: ['admin-module'] });
    },
    onError: error => setFeedback(error instanceof Error ? error.message : 'Unable to delete calendar event.'),
  });

  function updateMonth(delta: number) {
    const current = new Date(Date.UTC(year, monthNum - 1 + delta, 1));
    if (current.getUTCFullYear() < 2026 || current.getUTCFullYear() > 2126) return;
    onMonthChange(`${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, '0')}`);
  }

  function startEdit(event: CalendarEvent) {
    setEditingId(event.id); setShowForm(true);
    setForm({
      title: event.title, description: event.description || '', eventType: event.eventType as CalendarForm['eventType'],
      startDate: event.date, endDate: event.date, isRecurring: event.isRecurring,
      audienceScope: event.audienceScope === 'Entire_Class' || event.audienceScope === 'Specific_Section' ? event.audienceScope : 'All_School',
      targetClass: event.targetClass || '', targetSection: event.targetSection || '', venue: event.venue || '', colorCode: event.colorCode || workspace.cyan,
    });
    setFeedback('');
  }

  const classSections = data.classSections[form.targetClass] || [];
  const monthLabel = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, monthNum - 1, 1)));
  const today = istDateKey();
  const canSubmit = !!form.title.trim() && /^\d{4}-\d{2}-\d{2}$/.test(form.startDate)
    && /^\d{4}-\d{2}-\d{2}$/.test(form.endDate) && form.startDate <= form.endDate
    && (form.audienceScope === 'All_School' || !!form.targetClass.trim())
    && (form.audienceScope !== 'Specific_Section' || !!form.targetSection.trim())
    && canEdit && online && !write.isPending;

  return <View style={{ gap: 16 }}>
    <SectionTitle title="School Calendar" detail="Global school calendar · Events are not scoped to an Academic Session" />
    <View style={styles.calendarHeader}>
      <Pressable testID="calendar-previous-month" accessibilityLabel="Previous month" disabled={year === 2026 && monthNum === 1} onPress={() => updateMonth(-1)} style={[styles.iconButton, year === 2026 && monthNum === 1 && styles.disabled]}><Feather name="chevron-left" color={workspace.ink} size={20} /></Pressable>
      <Text style={styles.calendarMonth}>{monthLabel}</Text>
      <Pressable testID="calendar-next-month" accessibilityLabel="Next month" disabled={year === 2126 && monthNum === 12} onPress={() => updateMonth(1)} style={[styles.iconButton, year === 2126 && monthNum === 12 && styles.disabled]}><Feather name="chevron-right" color={workspace.ink} size={20} /></Pressable>
    </View>
    <View style={styles.calendarGrid}>
      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <Text key={day} style={styles.weekday}>{day}</Text>)}
      {Array.from({ length: firstWeekday }, (_, index) => <View key={`blank-${index}`} style={styles.dayCell} />)}
      {Array.from({ length: daysInMonth }, (_, index) => {
        const day = index + 1;
        const key = `${month}-${String(day).padStart(2, '0')}`;
        const onToday = key === today;
        const dayEvents = eventsByDay.get(day) || [];
        return <View key={key} testID={`calendar-day-${key}`} style={[styles.dayCell, onToday && styles.todayCell]}>
          <Text style={[styles.dayNumber, onToday && styles.todayNumber]}>{day}</Text>
          {dayEvents.slice(0, 2).map(event => <View key={event.id} style={[styles.eventDot, { backgroundColor: event.colorCode || workspace.cyan }]} />)}
          {dayEvents.length > 2 && <Text style={styles.extraEvents}>+{dayEvents.length - 2}</Text>}
        </View>;
      })}
    </View>
    <View style={styles.rowWrap}>
      {[
        { value: 'all', label: 'All Events' },
        { value: 'holiday', label: 'Holidays' },
        { value: 'academic', label: 'Academic' },
        { value: 'examination', label: 'Examination' },
        { value: 'event', label: 'Events' },
      ].map(item => <Pill key={item.value} label={item.label} active={eventFilter === item.value} onPress={() => setEventFilter(item.value)} />)}
    </View>
    {canEdit && <Button label={showForm ? 'Close Event Form' : 'Create Event'} icon={showForm ? 'x' : 'plus'} disabled={!online} onPress={() => {
      if (showForm) { setShowForm(false); setEditingId(null); setForm(emptyCalendarForm()); }
      else { setShowForm(true); setEditingId(null); setForm(emptyCalendarForm()); }
      setFeedback('');
    }} />}
    {!canEdit && <View style={styles.archive}><Feather name="lock" size={15} color={workspace.gold} /><Text style={styles.archiveText}>Calendar edit permission is required to create, update, or delete events.</Text></View>}
    {showForm && <ModuleCard>
      <Text style={styles.cardTitle}>{editingId ? 'Edit Calendar Event' : 'Create Calendar Event'}</Text>
      <ModuleField label="Event Title *" value={form.title} onChangeText={value => setForm(prev => ({ ...prev, title: value }))} />
      <ModuleField label="Start Date * (YYYY-MM-DD)" value={form.startDate} onChangeText={value => setForm(prev => ({ ...prev, startDate: value, endDate: prev.endDate < value ? value : prev.endDate }))} />
      {!editingId && <ModuleField label="End Date * (YYYY-MM-DD)" value={form.endDate} onChangeText={value => setForm(prev => ({ ...prev, endDate: value }))} />}
      <Text style={styles.fieldLabel}>Event Type</Text>
      <View style={styles.rowWrap}>{([
        ['holiday', 'Holiday'], ['academic', 'Academic'], ['examination', 'Examination'], ['event', 'Event'],
      ] as const).map(([value, label]) => <Pill key={value} label={label} active={form.eventType === value} onPress={() => setForm(prev => ({ ...prev, eventType: value }))} />)}</View>
      <Text style={styles.fieldLabel}>Audience</Text>
      <View style={styles.rowWrap}>{([
        ['All_School', 'All School'], ['Entire_Class', 'Entire Class'], ['Specific_Section', 'Specific Section'],
      ] as const).map(([value, label]) => <Pill key={value} label={label} active={form.audienceScope === value} onPress={() => setForm(prev => ({ ...prev, audienceScope: value, targetClass: '', targetSection: '' }))} />)}</View>
      {form.audienceScope !== 'All_School' && <>
        {data.classes.length > 0
          ? <View style={styles.rowWrap}>{data.classes.map(cls => <Pill key={cls} label={`Class ${cls}`} active={form.targetClass === cls} onPress={() => setForm(prev => ({ ...prev, targetClass: cls, targetSection: '' }))} />)}</View>
          : <ModuleField label="Class" value={form.targetClass} onChangeText={value => setForm(prev => ({ ...prev, targetClass: value }))} />}
        {form.audienceScope === 'Specific_Section' && <>
          {classSections.length > 0
            ? <View style={styles.rowWrap}>{classSections.map(section => <Pill key={section} label={`Section ${section}`} active={form.targetSection === section} onPress={() => setForm(prev => ({ ...prev, targetSection: section }))} />)}</View>
            : <ModuleField label="Section" value={form.targetSection} onChangeText={value => setForm(prev => ({ ...prev, targetSection: value }))} />}
        </>}
      </>}
      <ModuleField label="Description" value={form.description} onChangeText={value => setForm(prev => ({ ...prev, description: value }))} />
      <ModuleField label="Venue" value={form.venue} onChangeText={value => setForm(prev => ({ ...prev, venue: value }))} />
      <Text style={styles.fieldLabel}>Calendar color</Text>
      <View style={styles.rowWrap}>{[
        workspace.cyan, '#22c55e', '#f59e0b', '#ef4444', '#a78bfa', '#ec4899', '#64748b',
      ].map(color => <Pressable key={color} accessibilityRole="radio" accessibilityState={{ selected: form.colorCode === color }} onPress={() => setForm(prev => ({ ...prev, colorCode: color }))} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: color, borderWidth: form.colorCode === color ? 3 : 1, borderColor: form.colorCode === color ? workspace.ink : workspace.border }} />)}</View>
      {!editingId && <Pressable testID="calendar-recurring-toggle" accessibilityRole="checkbox" accessibilityState={{ checked: form.isRecurring }} onPress={() => setForm(prev => ({ ...prev, isRecurring: !prev.isRecurring }))} style={styles.checkRow}>
        <View style={[styles.checkbox, form.isRecurring && styles.checked]}>{form.isRecurring && <Feather name="check" size={13} color={workspace.background} />}</View>
        <Text style={styles.lineValue}>Repeat annually through 2126</Text>
      </Pressable>}
      <Button label={write.isPending ? 'Saving…' : editingId ? 'Save Changes' : 'Create Event'} icon="save" disabled={!canSubmit} onPress={() => { setFeedback(''); write.mutate(); }} />
    </ModuleCard>}
    {!!feedback && <Text accessibilityRole="alert" style={feedback.startsWith('Unable') || feedback.startsWith('You do not') ? styles.error : styles.success}>{feedback}</Text>}
    <SectionTitle title="Events" detail={`${events.length} event${events.length === 1 ? '' : 's'} this month`} />
    {events.length === 0 ? <View style={styles.empty}><Feather name="calendar" size={24} color={workspace.faint} /><Text style={styles.emptyText}>No events scheduled this month</Text></View>
      : events.map(event => <ModuleCard key={event.id}>
        <View style={styles.visitorHead}><View style={[styles.eventTypeMark, { backgroundColor: event.colorCode || workspace.cyan }]} /><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{event.title}</Text><Text style={styles.muted}>{titleCase(event.eventType)} · {formatIST(`${event.date}T12:00:00`, false)}</Text></View></View>
        <Line label="Audience" value={eventAudience(event)} />
        {!!event.venue && <Line label="Venue" value={event.venue} />}
        {!!event.description && <Text style={styles.auditDetails}>{event.description}</Text>}
        {event.isRecurring && <Text style={styles.metaText}>Repeats annually</Text>}
        {canEdit && <View style={styles.rowWrap}>
          <Pill label="Edit" icon="edit-2" onPress={() => startEdit(event)} />
          <Pill label={remove.isPending && remove.variables === event.id ? 'Deleting…' : 'Delete'} icon="trash-2"
            disabled={!online || remove.isPending} onPress={() => Alert.alert('Delete Calendar Event', `Delete “${event.title}”?`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(event.id) },
            ])} />
        </View>}
      </ModuleCard>)}
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: workspace.background },
  topBar: { minHeight: 70, paddingHorizontal: 18, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#141c2c', borderBottomWidth: 1, borderBottomColor: workspace.border },
  iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 9, borderWidth: 1, borderColor: workspace.border, backgroundColor: workspace.card },
  brand: { color: workspace.ink, fontSize: 18, fontWeight: '700', letterSpacing: 1 },
  subtitle: { color: workspace.subdued, fontSize: 13, marginTop: 2 },
  sessionIndicator: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: '#d4af371c' },
  content: { padding: 18, gap: 18 },
  sectionHeading: { gap: 5 },
  heading: { color: workspace.ink, fontWeight: '700', fontSize: 20 },
  detail: { color: workspace.subdued, fontSize: 13, lineHeight: 18 },
  footer: { paddingVertical: 12, paddingHorizontal: 18, borderTopWidth: 1, borderTopColor: workspace.border },
  footerText: { color: workspace.faint, fontSize: 11, textAlign: 'center' },
  sessionBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: '#d4af3714', borderBottomWidth: 1, borderColor: '#d4af3744' },
  sessionText: { flex: 1, color: workspace.gold, fontSize: 12 },
  sessionLink: { color: workspace.ink, fontSize: 12, fontWeight: '600' },
  offline: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, padding: 9, backgroundColor: '#b91c1c' },
  offlineText: { color: workspace.ink, fontSize: 12 },
  archive: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#d4af3744', backgroundColor: '#d4af3714' },
  archiveText: { color: workspace.gold, flex: 1, fontSize: 12, lineHeight: 17 },
  statsRow: { flexDirection: 'row', gap: 9 },
  statCard: { flex: 1, minHeight: 100, justifyContent: 'center', alignItems: 'center', padding: 10, gap: 6, borderRadius: 10, borderWidth: 1, borderColor: workspace.border, backgroundColor: workspace.panel },
  adminCard: { borderWidth: 1, borderRadius: 10, padding: 15, gap: 12, backgroundColor: workspace.card, borderColor: workspace.border },
  statValue: { color: workspace.ink, fontSize: 24, fontWeight: '800' },
  statLabel: { color: workspace.faint, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  pill: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', minHeight: 37, paddingHorizontal: 11, borderRadius: 8, borderWidth: 1, borderColor: workspace.border, backgroundColor: workspace.card },
  pillActive: { backgroundColor: workspace.gold, borderColor: workspace.gold },
  pillText: { color: workspace.subdued, fontSize: 12, fontWeight: '500' },
  pillTextActive: { color: workspace.background, fontWeight: '700' },
  disabled: { opacity: 0.45 },
  cardTitle: { color: workspace.ink, fontSize: 15, fontWeight: '700' },
  muted: { color: workspace.subdued, fontSize: 13, marginTop: 3 },
  validation: { color: workspace.red, fontSize: 12 },
  error: { color: workspace.red, fontSize: 13, lineHeight: 19 },
  success: { color: workspace.green, fontSize: 13 },
  tabRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  countBadge: { minWidth: 23, height: 23, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#36bcd322' },
  countText: { color: workspace.cyan, fontSize: 12, fontWeight: '700' },
  empty: { minHeight: 110, padding: 18, alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, borderWidth: 1, borderColor: workspace.border, backgroundColor: workspace.card },
  emptyText: { color: workspace.subdued, fontSize: 13, textAlign: 'center' },
  visitorHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  visitorMeta: { marginTop: 11, flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 5 },
  metaText: { color: workspace.faint, fontSize: 11 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingTop: 9, borderTopWidth: 1, borderTopColor: '#ffffff14' },
  lineLabel: { color: workspace.faint, fontSize: 11, flexShrink: 0 },
  lineValue: { color: workspace.subdued, fontSize: 12, flexShrink: 1, textAlign: 'right' },
  actionButton: { minHeight: 42, marginTop: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 8, backgroundColor: workspace.gold },
  actionButtonText: { color: workspace.background, fontSize: 13, fontWeight: '700' },
  divider: { height: 1, backgroundColor: workspace.border, marginVertical: 4 },
  textInput: { minHeight: 48, borderWidth: 1, borderColor: workspace.border, borderRadius: 8, paddingHorizontal: 12, backgroundColor: workspace.panel, color: workspace.ink, fontSize: 14 },
  auditAction: { color: workspace.ink, fontWeight: '700', fontSize: 12, letterSpacing: 0.7 },
  auditRole: { color: workspace.faint, fontSize: 11 },
  auditDetails: { color: workspace.subdued, fontSize: 12, lineHeight: 18, marginTop: 7 },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  calendarMonth: { color: workspace.ink, fontSize: 18, fontWeight: '700' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderLeftWidth: 1, borderColor: workspace.border, borderRadius: 8, overflow: 'hidden', backgroundColor: workspace.panel },
  weekday: { width: '14.2857%', height: 34, textAlign: 'center', textAlignVertical: 'center', paddingTop: 8, color: workspace.faint, fontSize: 10, fontWeight: '700', borderRightWidth: 1, borderBottomWidth: 1, borderColor: workspace.border },
  dayCell: { width: '14.2857%', minHeight: 51, padding: 5, alignItems: 'flex-start', borderRightWidth: 1, borderBottomWidth: 1, borderColor: workspace.border },
  todayCell: { backgroundColor: '#d4af3714' },
  dayNumber: { color: workspace.subdued, fontSize: 11 },
  todayNumber: { color: workspace.gold, fontWeight: '800' },
  eventDot: { width: 5, height: 5, borderRadius: 3, marginTop: 4 },
  extraEvents: { color: workspace.faint, fontSize: 8, marginTop: 1 },
  fieldLabel: { color: workspace.subdued, fontSize: 13, fontWeight: '500' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 43 },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: workspace.subdued, alignItems: 'center', justifyContent: 'center' },
  checked: { borderColor: workspace.gold, backgroundColor: workspace.gold },
  eventTypeMark: { width: 10, height: 10, borderRadius: 5 },
});