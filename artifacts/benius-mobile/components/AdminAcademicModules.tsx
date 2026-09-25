import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useColors } from '@/hooks/useColors';
import { apiGet, apiGetForSession, apiPost, apiPostForSession, type MobileUser } from '@/lib/api';

type ModuleId = 'timetable' | 'faculty-mapping' | 'analytics' | 'id-card-gen';
type Props = {
  moduleId: ModuleId;
  user: MobileUser;
  sessionId: number | null;
  sessionName: string;
  isArchive: boolean;
};
type SessionAware<T> = (path: string, sessionId: number | null, signal?: AbortSignal) => Promise<T>;
type Slot = {
  id: number;
  teacherId: number;
  teacherName: string;
  dayOfWeek: number;
  period: number;
  class: string;
  section: string;
  subject: string;
};
type StructureRow = {
  id?: number;
  periodNumber: number;
  label: string;
  startTime: string;
  endTime: string;
  isBreak: boolean;
  sortOrder: number;
};
type AcademicContext = {
  classes: string[];
  sections: string[];
  subjects: string[];
  teachers?: Array<{ id: number; fullName: string; subject?: string | null }>;
  session?: { id: number; sessionName: string; isActive: boolean };
};
type FacultyData = {
  teachers: Array<{ id: number; fullName: string; email: string; subject?: string | null }>;
  mappings: Array<{ teacherId: number; teacherName: string; email: string; className: string; section: string; subject?: string | null }>;
  classes: string[];
  sections: string[];
  subjects: string[];
};
type AnalyticsContext = {
  classes: string[];
  sections: string[];
  subjects: string[];
  classSections: Record<string, string[]>;
  classSubjects: Record<string, string[]>;
  examTypes: string[];
  classExamTypes: Record<string, string[]>;
  examPolicyTiers: Array<{ id: number; applicableClasses: string[]; examWeights: string }>;
  gradingTiers: Array<{ id: number; classes: string[]; passPercentage: number }>;
  gradingRules: Array<{ id: number; tierId: number; gradeLabel: string; minPercent: number; maxPercent: number; remarks?: string | null }>;
};
type AnalyticsScore = { studentId: number; studentName: string; dsid?: string; subject: string; examType: string; marks: number; totalMarks: number; isAbsent: boolean };
type ResultData = {
  students: Array<{
    studentId: number; name: string; digitalStudentId: string; rollNumber?: string | null;
    scores: Array<{ subject: string; examType: string; marks: number; totalMarks: number; isAbsent: boolean }>;
    attendance: { attendancePct: number | null; presentDays: number; totalDays: number } | null;
  }>;
  policyTier: { examWeights: string } | null;
  passPercentage: number | null;
  gradingRules: Array<{ id: number; gradeLabel: string; minPercent: number; maxPercent: number; remarks?: string | null }>;
};
type CardRecord = {
  id: number;
  name: string;
  digitalStudentId?: string | null;
  digitalTeacherId?: string | null;
  rollNumber?: string | null;
  className?: string | null;
  section?: string | null;
  email?: string | null;
  subject?: string | null;
  role?: string | null;
};
type CardGroup = 'student' | 'teacher' | 'support-staff';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NUMBERS = [1, 2, 3, 4, 5, 6];
const EMPTY_NOTICE = 'No records match these selections.';

function useSessionGet(user: MobileUser, sessionId: number | null): SessionAware<unknown> {
  return async (path, selectedId, signal) => user.role === 'support_staff'
    ? apiGet(path, { signal })
    : apiGetForSession(path, selectedId ?? sessionId ?? 0, { signal });
}

function useSessionPost(user: MobileUser, sessionId: number | null) {
  return async <T,>(path: string, body: unknown): Promise<T> => user.role === 'support_staff'
    ? apiPost<T>(path, body)
    : apiPostForSession<T>(path, sessionId ?? 0, body);
}

function hasSubmodulePermission(user: MobileUser, moduleId: ModuleId, submodule: string): boolean {
  return user.role === 'admin' || user.allowedModules?.includes(`${moduleId}:${submodule}`) === true;
}

function TextLabel({ children, style }: { children: string; style?: StyleProp<TextStyle> }) {
  const c = useColors();
  return <Text style={[{ color: c.mutedForeground, fontSize: 12, fontWeight: '600', marginBottom: 7 }, style]}>{children}</Text>;
}

function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[{ backgroundColor: c.card, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 15, gap: 12 }, style]}>{children}</View>;
}

function Label({ children, color, style }: { children: React.ReactNode; color?: string; style?: StyleProp<TextStyle> }) {
  const c = useColors();
  return <Text style={[{ color: color ?? c.foreground, fontSize: 14 }, style]}>{children}</Text>;
}

function Heading({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return <Text style={{ color: c.foreground, fontSize: 19, fontWeight: '700' }}>{children}</Text>;
}

function Status({ title, detail, retry, loading = false }: { title: string; detail?: string; retry?: () => void; loading?: boolean }) {
  const c = useColors();
  return <View style={[styles.status, { backgroundColor: c.card, borderColor: c.border }]}>
    {loading ? <ActivityIndicator color={c.primary} /> : <Feather name="alert-circle" size={21} color={c.destructive} />}
    <Text style={[styles.statusTitle, { color: c.foreground }]}>{title}</Text>
    {!!detail && <Text style={[styles.statusDetail, { color: c.mutedForeground }]}>{detail}</Text>}
    {!!retry && <Pressable onPress={retry} accessibilityRole="button" style={[styles.secondaryButton, { borderColor: c.border }]}>
      <Text style={{ color: c.primary, fontWeight: '700' }}>Try again</Text>
    </Pressable>}
  </View>;
}

function Chip({ label, selected, onPress, disabled = false }: { label: string; selected: boolean; onPress: () => void; disabled?: boolean }) {
  const c = useColors();
  return <Pressable disabled={disabled} accessibilityRole="button" accessibilityState={{ selected, disabled }}
    onPress={onPress} style={[styles.chip, { borderColor: selected ? c.primary : c.border, backgroundColor: selected ? c.primary : c.background }, disabled && styles.disabled]}>
    <Text style={{ color: selected ? c.primaryForeground : c.foreground, fontSize: 13, fontWeight: selected ? '700' : '500' }}>{label}</Text>
  </Pressable>;
}

function Action({ label, icon, onPress, disabled = false, tone = 'primary' }: {
  label: string; icon: React.ComponentProps<typeof Feather>['name']; onPress: () => void; disabled?: boolean; tone?: 'primary' | 'danger' | 'neutral';
}) {
  const c = useColors();
  const background = tone === 'primary' ? c.primary : tone === 'danger' ? c.destructive : c.card;
  const foreground = tone === 'neutral' ? c.foreground : '#ffffff';
  return <Pressable disabled={disabled} onPress={onPress} accessibilityRole="button" accessibilityState={{ disabled }}
    style={[styles.action, { backgroundColor: background, borderColor: tone === 'neutral' ? c.border : background }, disabled && styles.disabled]}>
    <Feather name={icon} size={16} color={foreground} />
    <Text style={{ color: foreground, fontWeight: '700', fontSize: 13 }}>{label}</Text>
  </Pressable>;
}

function ChoiceModal({ visible, title, options, selected, onSelect, onClose }: {
  visible: boolean; title: string; options: Array<{ id: string; label: string }>; selected: string; onSelect: (id: string) => void; onClose: () => void;
}) {
  const c = useColors();
  return <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
    <View style={styles.modalBackdrop}>
      <View style={[styles.modalCard, { backgroundColor: c.background, borderColor: c.border }]}>
        <View style={styles.rowBetween}><Heading>{title}</Heading><Pressable accessibilityLabel="Close selection" onPress={onClose}><Feather name="x" color={c.foreground} size={23} /></Pressable></View>
        <ScrollView style={{ maxHeight: 400 }} keyboardShouldPersistTaps="handled">
          {options.length ? options.map(option => <Pressable key={option.id} onPress={() => { onSelect(option.id); onClose(); }}
            style={[styles.choiceRow, { borderColor: c.border }]}>
            <Text style={{ flex: 1, color: c.foreground, fontSize: 15 }}>{option.label}</Text>
            {selected === option.id && <Feather name="check" color={c.primary} size={18} />}
          </Pressable>) : <Label>No options configured.</Label>}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

function SessionBanner({ name, archived }: { name: string; archived: boolean }) {
  const c = useColors();
  return <View style={[styles.sessionBanner, { backgroundColor: archived ? c.muted : c.accent }]}>
    <Feather name={archived ? 'lock' : 'calendar'} size={15} color={archived ? c.mutedForeground : c.primary} />
    <Text style={{ color: c.foreground, fontSize: 12, fontWeight: '600', flex: 1 }}>
      {name || 'Active academic session'}{archived ? ' · Archive · Read only' : ''}
    </Text>
  </View>;
}

function TimetableModule({ user, sessionId, sessionName, isArchive }: Omit<Props, 'moduleId'>) {
  const c = useColors();
  const queryClient = useQueryClient();
  const get = useSessionGet(user, sessionId);
  const post = useSessionPost(user, sessionId);
  const canSchedule = hasSubmodulePermission(user, 'timetable', 'schedule');
  const canStructure = hasSubmodulePermission(user, 'timetable', 'structure');
  const canPublish = hasSubmodulePermission(user, 'timetable', 'publish');
  const tabs = [
    ...(canSchedule ? [{ id: 'schedule', label: 'Schedule' }] : []),
    ...(canStructure ? [{ id: 'structure', label: 'Bell structure' }] : []),
    ...(canPublish ? [{ id: 'publish', label: 'Publish' }] : []),
  ];
  const [tab, setTab] = useState(tabs[0]?.id ?? '');
  const [cls, setCls] = useState('');
  const [section, setSection] = useState('');
  const [structureClass, setStructureClass] = useState('');
  const [drafts, setDrafts] = useState<Record<string, { teacherId: number; subject: string } | null>>({});
  const [selectedCell, setSelectedCell] = useState<{ day: number; period: number } | null>(null);
  const [teacherPicker, setTeacherPicker] = useState(false);
  const [subjectPicker, setSubjectPicker] = useState(false);

  const context = useQuery({
    queryKey: ['mobile-admin-academic', 'timetable-context', user.schoolId, user.role, sessionId ?? 'active'],
    queryFn: ({ signal }) => get('/mobile/admin/modules/timetable/context', sessionId, signal) as Promise<AcademicContext>,
  });
  const teacherQuery = useQuery({
    queryKey: ['mobile-admin-academic', 'timetable-teachers', user.schoolId, sessionId],
    queryFn: ({ signal }) => get('/mobile/admin/modules/timetable/teachers', sessionId, signal) as Promise<Array<{ id: number; fullName: string; subject?: string | null }>>,
    enabled: canSchedule,
  });
  const teachers = teacherQuery.data ?? [];
  const view = useQuery({
    queryKey: ['mobile-admin-academic', 'timetable-view', user.schoolId, sessionId, cls, section],
    queryFn: ({ signal }) => get(`/mobile/admin/modules/timetable/class-view?class=${encodeURIComponent(cls)}&section=${encodeURIComponent(section)}`, sessionId, signal) as Promise<{ entries: Slot[]; structure: StructureRow[] }>,
    enabled: !!cls && !!section && canSchedule,
  });
  const bell = useQuery({
    queryKey: ['mobile-admin-academic', 'timetable-structure', user.schoolId, sessionId, structureClass],
    queryFn: ({ signal }) => get(`/mobile/admin/modules/timetable/structure?class=${encodeURIComponent(structureClass)}`, sessionId, signal) as Promise<StructureRow[]>,
    enabled: !!structureClass && canStructure,
  });
  const status = useQuery({
    queryKey: ['mobile-admin-academic', 'timetable-status', user.schoolId, sessionId],
    queryFn: ({ signal }) => get('/mobile/admin/modules/timetable/status', sessionId, signal) as Promise<Array<{ class: string; section: string; totalCount: number; draftCount: number; publishedCount: number }>>,
    enabled: canPublish,
  });

  const saveSlots = useMutation({
    mutationFn: (changes: unknown[]) => post<{ errors?: string[] }>('/mobile/admin/modules/timetable/save', { changes }),
    onSuccess: async (result: { errors?: string[] }) => {
      setDrafts({});
      setSelectedCell(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mobile-admin-academic', 'timetable-view', user.schoolId, sessionId] }),
        queryClient.invalidateQueries({ queryKey: ['mobile-admin-academic', 'timetable-status', user.schoolId, sessionId] }),
      ]);
      Alert.alert(result.errors?.length ? 'Saved with warnings' : 'Timetable saved', result.errors?.join('\n') || 'The timetable changes are saved.');
    },
  });
  const publish = useMutation({
    mutationFn: (target: { class: string; section: string }) => post('/mobile/admin/modules/timetable/publish', target),
    onSuccess: async (_result, target) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mobile-admin-academic', 'timetable-view', user.schoolId, sessionId] }),
        queryClient.invalidateQueries({ queryKey: ['mobile-admin-academic', 'timetable-status', user.schoolId, sessionId] }),
      ]);
      Alert.alert('Timetable published', `Class ${target.class}-${target.section} is now published.`);
    },
  });

  if (context.isPending) return <Status title="Loading timetable" loading />;
  if (context.isError || !context.data) return <Status title="Timetable unavailable" detail={(context.error as Error)?.message} retry={() => { void context.refetch(); }} />;
  const data = context.data;
  const entries = view.data?.entries ?? [];
  const configuredPeriodCount = Math.max(1, ...(view.data?.structure ?? []).filter(row => !row.isBreak).map(row => row.periodNumber), 8);
  const effectiveSlot = (day: number, period: number) => {
    const key = `${day}-${period}`;
    if (key in drafts) {
      const draft = drafts[key];
      return draft ? { ...draft, teacherName: teachers.find(item => item.id === draft.teacherId)?.fullName ?? '', pending: true } : null;
    }
    const found = entries.find(item => item.dayOfWeek === day && item.period === period);
    return found ? { teacherId: found.teacherId, subject: found.subject, teacherName: found.teacherName, pending: false } : null;
  };
  const setDraftForSelection = (teacherId: number | null, subject: string) => {
    if (!selectedCell) return;
    const key = `${selectedCell.day}-${selectedCell.period}`;
    setDrafts(current => ({ ...current, [key]: teacherId === null ? null : { teacherId, subject } }));
  };
  const saveChanges = () => {
    if (!cls || !section || !Object.keys(drafts).length) return;
    const changes = Object.entries(drafts).map(([key, draft]) => {
      const [dayOfWeek, period] = key.split('-').map(Number);
      return draft
        ? { dayOfWeek, period, class: cls, section, teacherId: draft.teacherId, subject: draft.subject }
        : { dayOfWeek, period, class: cls, section, _delete: true };
    });
    saveSlots.mutate(changes);
  };

  return <View style={styles.module}>
    <SessionBanner name={sessionName} archived={isArchive} />
    <Heading>Timetable Master</Heading>
    <View style={styles.wrapRow}>{tabs.map(item => <Chip key={item.id} label={item.label} selected={tab === item.id} onPress={() => setTab(item.id)} />)}</View>
    {!tabs.length ? <Status title="No timetable sections available" detail="Your account has no allowed timetable submodule." /> : null}

    {tab === 'schedule' && <>
      <Card>
        <TextLabel>Class</TextLabel>
        <View style={styles.wrapRow}>{data.classes.map(option => <Chip key={option} label={`Class ${option}`} selected={cls === option} onPress={() => { setCls(option); setDrafts({}); setSelectedCell(null); }} />)}</View>
        <TextLabel>Section</TextLabel>
        <View style={styles.wrapRow}>{data.sections.map(option => <Chip key={option} label={option} selected={section === option} onPress={() => { setSection(option); setDrafts({}); setSelectedCell(null); }} />)}</View>
        {isArchive && <Label>Archived timetables are available for review only.</Label>}
      </Card>
      {!cls || !section ? <Status title="Choose a class and section" detail="Select the cohort to review its real timetable." />
        : view.isPending ? <Status title="Loading class timetable" loading />
          : view.isError ? <Status title="Timetable unavailable" detail={(view.error as Error).message} retry={() => { void view.refetch(); }} />
            : <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 9, paddingVertical: 3 }}>
                {Array.from({ length: configuredPeriodCount }, (_, index) => index + 1).map(period => {
                  const row = view.data?.structure.find(item => !item.isBreak && item.periodNumber === period);
                  const current = selectedCell?.period === period;
                  return <View key={period} style={{ gap: 8 }}>
                    <Text style={{ color: c.mutedForeground, fontSize: 11, textAlign: 'center', fontWeight: '700' }}>{row?.label ?? `Period ${period}`}</Text>
                    {DAY_NUMBERS.map((day, index) => {
                      const key = `${day}-${period}`;
                      const slot = effectiveSlot(day, period);
                      const pending = key in drafts;
                      return <Pressable key={day} disabled={isArchive || !canSchedule} onPress={() => setSelectedCell({ day, period })}
                        accessibilityRole="button" accessibilityLabel={`${DAYS[index]}, period ${period}${slot ? ` ${slot.subject}` : ' empty'}`}
                        style={[styles.slot, { borderColor: current ? c.primary : pending ? c.accent : c.border, backgroundColor: pending ? c.accent : c.card }]}>
                        <Text style={{ color: c.mutedForeground, fontSize: 10, fontWeight: '600' }}>{DAYS[index]}</Text>
                        {slot ? <><Text numberOfLines={1} style={{ color: c.foreground, fontWeight: '700', fontSize: 11 }}>{slot.subject}</Text><Text numberOfLines={1} style={{ color: c.mutedForeground, fontSize: 10 }}>{slot.teacherName}</Text></>
                          : <Text style={{ color: c.mutedForeground, fontSize: 11 }}>—</Text>}
                      </Pressable>;
                    })}
                  </View>;
                })}
              </ScrollView>
              {!isArchive && canSchedule && selectedCell && <Card>
                <Heading>{DAYS[selectedCell.day - 1]} · Period {selectedCell.period}</Heading>
                <Label>{effectiveSlot(selectedCell.day, selectedCell.period)?.teacherName || 'No teacher assigned'} · {effectiveSlot(selectedCell.day, selectedCell.period)?.subject || 'No subject assigned'}</Label>
                <View style={styles.wrapRow}>
                  <Action label="Choose teacher" icon="user" tone="neutral" onPress={() => setTeacherPicker(true)} />
                  <Action label="Choose subject" icon="book-open" tone="neutral" onPress={() => setSubjectPicker(true)} />
                  <Action label="Remove slot" icon="trash-2" tone="danger" disabled={!effectiveSlot(selectedCell.day, selectedCell.period)} onPress={() => { setDraftForSelection(null, ''); setSelectedCell(null); }} />
                </View>
                <Action label={`Save ${Object.keys(drafts).length} changes`} icon="save" disabled={!Object.keys(drafts).length || saveSlots.isPending || !teachers.length || !data.subjects.length} onPress={saveChanges} />
              </Card>}
              {saveSlots.isError && <Label color={c.destructive}>{(saveSlots.error as Error).message}</Label>}
            </>}
      <ChoiceModal visible={teacherPicker} title="Assign teacher" options={teachers.map(item => ({ id: String(item.id), label: `${item.fullName}${item.subject ? ` · ${item.subject}` : ''}` }))} selected={String(selectedCell ? effectiveSlot(selectedCell.day, selectedCell.period)?.teacherId ?? '' : '')}
        onSelect={id => { const old = selectedCell ? effectiveSlot(selectedCell.day, selectedCell.period) : null; setDraftForSelection(Number(id), old?.subject ?? data.subjects[0] ?? ''); }} onClose={() => setTeacherPicker(false)} />
      <ChoiceModal visible={subjectPicker} title="Choose subject" options={data.subjects.map(item => ({ id: item, label: item }))} selected={selectedCell ? effectiveSlot(selectedCell.day, selectedCell.period)?.subject ?? '' : ''}
        onSelect={subject => { const old = selectedCell ? effectiveSlot(selectedCell.day, selectedCell.period) : null; if (old) setDraftForSelection(old.teacherId, subject); }} onClose={() => setSubjectPicker(false)} />
    </>}

    {tab === 'structure' && <StructureEditor key={`${sessionId}-${structureClass}`} classes={data.classes} isArchive={isArchive} user={user} sessionId={sessionId} selectedSessionName={sessionName}
      cls={structureClass} onClassChange={setStructureClass} rows={bell.data ?? []} loading={!!structureClass && bell.isPending} error={bell.isError ? (bell.error as Error).message : ''} />}
    {tab === 'publish' && <>
      {status.isPending ? <Status title="Loading publication status" loading /> : status.isError
        ? <Status title="Publication status unavailable" detail={(status.error as Error).message} retry={() => { void status.refetch(); }} />
        : (status.data ?? []).length === 0 ? <Status title="No timetable entries yet" detail="Class schedules appear here once saved." />
          : (status.data ?? []).map((item, index) => <Card key={`${item.class}-${item.section}-${index}`}>
            <View style={styles.rowBetween}><Heading>{item.class} · {item.section}</Heading><Feather name={item.publishedCount ? 'check-circle' : 'clock'} size={19} color={item.publishedCount ? c.primary : c.mutedForeground} /></View>
            <Label>{item.totalCount} periods · {item.publishedCount} published · {item.draftCount} draft</Label>
            <Action label={item.publishedCount ? 'Publish latest version' : 'Publish timetable'} icon="send" disabled={isArchive || publish.isPending || item.totalCount === 0} onPress={() => publish.mutate({ class: item.class, section: item.section })} />
          </Card>)}
      {publish.isError && <Label color={c.destructive}>{(publish.error as Error).message}</Label>}
    </>}
  </View>;
}

function StructureEditor({ classes, isArchive, user, sessionId, selectedSessionName, cls, onClassChange, rows, loading, error }: {
  classes: string[]; isArchive: boolean; user: MobileUser; sessionId: number | null; selectedSessionName: string;
  cls: string; onClassChange: (value: string) => void; rows: StructureRow[]; loading: boolean; error: string;
}) {
  const c = useColors();
  const queryClient = useQueryClient();
  const post = useSessionPost(user, sessionId);
  const [draftRows, setDraftRows] = useState<StructureRow[] | null>(null);
  const visible = draftRows ?? rows;
  const save = useMutation({
    mutationFn: () => post('/mobile/admin/modules/timetable/structure', { class: cls, rows: visible.map((row, index) => ({ ...row, sortOrder: index })) }),
    onSuccess: async () => {
      setDraftRows(null);
      await queryClient.invalidateQueries({ queryKey: ['mobile-admin-academic', 'timetable-structure', user.schoolId, sessionId, cls] });
      Alert.alert('Bell schedule saved', `Class ${cls} structure updated for ${selectedSessionName || 'the selected session'}.`);
    },
  });
  return <Card>
    <TextLabel>Class</TextLabel>
    <View style={styles.wrapRow}>{classes.map(item => <Chip key={item} label={`Class ${item}`} selected={cls === item} onPress={() => { onClassChange(item); setDraftRows(null); }} />)}</View>
    {loading ? <ActivityIndicator color={c.primary} /> : error ? <Label color={c.destructive}>{error}</Label> : !cls ? <Label>Select a class to edit its period bell schedule.</Label> : <>
      <View style={styles.rowBetween}><Heading>{cls ? `Class ${cls} periods` : 'Periods'}</Heading>
        <View style={styles.wrapRow}>
          <Action label="Add period" icon="plus" tone="neutral" disabled={isArchive} onPress={() => setDraftRows([...visible, { periodNumber: visible.filter(row => !row.isBreak).length + 1, label: `Period ${visible.filter(row => !row.isBreak).length + 1}`, startTime: '', endTime: '', isBreak: false, sortOrder: visible.length }])} />
          <Action label="Add break" icon="coffee" tone="neutral" disabled={isArchive} onPress={() => setDraftRows([...visible, { periodNumber: 0, label: 'Break', startTime: '', endTime: '', isBreak: true, sortOrder: visible.length }])} />
        </View>
      </View>
      {visible.map((row, index) => <View key={`${row.id ?? 'new'}-${index}`} style={[styles.structureRow, { borderColor: c.border }]}>
        <View style={styles.rowBetween}><Label style={{ fontWeight: '700' }}>{row.isBreak ? 'Break' : row.label}</Label>
          <Pressable disabled={isArchive} accessibilityLabel="Remove period row" onPress={() => setDraftRows(visible.filter((_, i) => i !== index).map((entry, i) => ({ ...entry, sortOrder: i })))}>
            <Feather name="trash-2" color={isArchive ? c.mutedForeground : c.destructive} size={17} />
          </Pressable>
        </View>
        <TextInput value={row.label} editable={!isArchive} onChangeText={value => setDraftRows(visible.map((entry, i) => i === index ? { ...entry, label: value } : entry))}
          placeholder="Period label" placeholderTextColor={c.mutedForeground} style={[styles.input, { color: c.foreground, borderColor: c.border }]} />
        <View style={styles.wrapRow}>
          <TextInput value={row.startTime} editable={!isArchive} onChangeText={value => setDraftRows(visible.map((entry, i) => i === index ? { ...entry, startTime: value } : entry))}
            placeholder="Start (08:00)" placeholderTextColor={c.mutedForeground} style={[styles.input, styles.timeInput, { color: c.foreground, borderColor: c.border }]} />
          <TextInput value={row.endTime} editable={!isArchive} onChangeText={value => setDraftRows(visible.map((entry, i) => i === index ? { ...entry, endTime: value } : entry))}
            placeholder="End (08:45)" placeholderTextColor={c.mutedForeground} style={[styles.input, styles.timeInput, { color: c.foreground, borderColor: c.border }]} />
        </View>
      </View>)}
      {!visible.length && <Label>No bell periods configured.</Label>}
      <Action label={save.isPending ? 'Saving…' : 'Save bell structure'} icon="save" disabled={isArchive || !cls || !draftRows || save.isPending} onPress={() => save.mutate()} />
      {save.isError && <Label color={c.destructive}>{(save.error as Error).message}</Label>}
    </>}
  </Card>;
}

function FacultyMappingModule({ user, sessionId, sessionName, isArchive }: Omit<Props, 'moduleId'>) {
  const c = useColors();
  const queryClient = useQueryClient();
  const get = useSessionGet(user, sessionId);
  const post = useSessionPost(user, sessionId);
  const canAssign = hasSubmodulePermission(user, 'faculty-mapping', 'assign') && !isArchive;
  const [teacherId, setTeacherId] = useState<number | null>(null);
  const [selectedCells, setSelectedCells] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const data = useQuery({
    queryKey: ['mobile-admin-academic', 'faculty-mapping', user.schoolId],
    queryFn: ({ signal }) => get('/mobile/admin/modules/faculty-mapping', sessionId, signal) as Promise<FacultyData>,
  });
  const save = useMutation({
    mutationFn: () => {
      if (!teacherId) throw new Error('Choose a teacher first.');
      const mappings = Object.entries(selectedCells).map(([key, subject]) => {
        const [className, section] = key.split('|');
        return { className, section, subject: subject || null };
      });
      return post('/mobile/admin/modules/faculty-mapping/save', { teacherId, mappings });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['mobile-admin-academic', 'faculty-mapping', user.schoolId] });
      Alert.alert('Faculty mapping saved', 'The teacher assignments have been updated.');
    },
  });
  const clear = useMutation({
    mutationFn: () => post('/mobile/admin/modules/faculty-mapping/clear', { teacherId }),
    onSuccess: async () => {
      setSelectedCells({});
      await queryClient.invalidateQueries({ queryKey: ['mobile-admin-academic', 'faculty-mapping', user.schoolId] });
      Alert.alert('Assignments cleared', 'The selected teacher has no class assignments.');
    },
  });
  const selectedTeacher = data.data?.teachers.find(item => item.id === teacherId);
  const mappings = data.data?.mappings ?? [];
  const mappedCount = useMemo(() => new Set(mappings.map(item => item.teacherId)).size, [mappings]);
  const filteredTeachers = data.data?.teachers.filter(item => `${item.fullName} ${item.email} ${item.subject ?? ''}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  if (data.isPending) return <Status title="Loading faculty mapping" loading />;
  if (data.isError || !data.data) return <Status title="Faculty mapping unavailable" detail={(data.error as Error)?.message} retry={() => { void data.refetch(); }} />;
  const chooseTeacher = (id: number) => {
    setTeacherId(id);
    const chosen = mappings.filter(item => item.teacherId === id);
    setSelectedCells(Object.fromEntries(chosen.map(item => [`${item.className}|${item.section}`, item.subject ?? ''])));
  };
  const getMappedCell = (className: string, section: string) => mappings.find(item => item.teacherId === teacherId && item.className === className && item.section === section);
  return <View style={styles.module}>
    <SessionBanner name={sessionName} archived={isArchive} />
    <Heading>Faculty Mapping</Heading>
    <Card>
      <View style={styles.rowBetween}><View><Heading>{mappedCount} assigned</Heading><Label>{data.data.teachers.length - mappedCount} without a mapping</Label></View><Feather name="users" color={c.primary} size={22} /></View>
      <TextInput value={search} onChangeText={setSearch} placeholder="Search faculty by name or subject" placeholderTextColor={c.mutedForeground}
        accessibilityLabel="Search faculty" style={[styles.input, { color: c.foreground, borderColor: c.border }]} />
      <View style={{ gap: 7 }}>{filteredTeachers.map(teacher => {
        const count = mappings.filter(item => item.teacherId === teacher.id).length;
        return <Pressable key={teacher.id} onPress={() => chooseTeacher(teacher.id)} style={[styles.teacherRow, { borderColor: teacherId === teacher.id ? c.primary : c.border, backgroundColor: teacherId === teacher.id ? c.accent : c.background }]}>
          <View style={[styles.avatar, { backgroundColor: c.primary }]}><Text style={{ color: c.primaryForeground, fontWeight: '800' }}>{teacher.fullName.trim().slice(0, 1).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}><Label style={{ fontWeight: '700' }}>{teacher.fullName}</Label><Text style={{ color: c.mutedForeground, fontSize: 11 }}>{teacher.email || teacher.subject || 'Faculty'}</Text></View>
          <Text style={{ color: count ? c.primary : c.mutedForeground, fontSize: 11, fontWeight: '700' }}>{count} classes</Text>
        </Pressable>;
      })}</View>
    </Card>
    {selectedTeacher && <>
      <Card>
        <View style={styles.rowBetween}><Heading>{selectedTeacher.fullName}</Heading><Text style={{ color: canAssign ? c.primary : c.mutedForeground, fontWeight: '700', fontSize: 12 }}>{canAssign ? 'Editing allowed' : isArchive ? 'Archive · Read only' : 'View only'}</Text></View>
        <Label>Tap a class/section to assign or remove it. A mapping applies to this teacher only.</Label>
        {data.data.classes.map(className => <View key={className} style={{ gap: 7 }}>
          <Text style={{ color: c.foreground, fontWeight: '700', fontSize: 13 }}>Class {className}</Text>
          <View style={styles.wrapRow}>{data.data.sections.map(section => {
            const key = `${className}|${section}`;
            const assigned = key in selectedCells;
            const original = getMappedCell(className, section);
            return <Pressable key={key} disabled={!canAssign} onPress={() => setSelectedCells(current => {
              const next = { ...current };
              if (key in next) delete next[key];
              else next[key] = '';
              return next;
            })} style={[styles.mapCell, { borderColor: assigned ? c.primary : c.border, backgroundColor: assigned ? c.accent : c.background }]}>
              <Text style={{ color: assigned ? c.primary : c.foreground, fontSize: 12, fontWeight: '700' }}>{section}{original?.subject ? ` · ${original.subject}` : ''}</Text>
              <Feather name={assigned ? 'check-circle' : 'plus-circle'} size={15} color={assigned ? c.primary : c.mutedForeground} />
            </Pressable>;
          })}</View>
        </View>)}
        {Object.keys(selectedCells).filter(key => !selectedCells[key]).length > 0 && <View style={{ gap: 7 }}>
          <TextLabel>Choose subjects for new assignments</TextLabel>
          {Object.entries(selectedCells).filter(([, subject]) => !subject).map(([key]) => <View key={key} style={styles.rowBetween}>
            <Label>{key.replace('|', ' · ')}</Label>
            <View style={styles.wrapRow}>{data.data.subjects.map(subject => <Chip key={`${key}-${subject}`} label={subject} selected={selectedCells[key] === subject} onPress={() => setSelectedCells(current => ({ ...current, [key]: current[key] === subject ? '' : subject }))} />)}</View>
          </View>)}
        </View>}
        <View style={styles.wrapRow}>
          <Action label="Save assignments" icon="save" disabled={!canAssign || save.isPending} onPress={() => save.mutate()} />
          <Action label="Clear" icon="trash-2" tone="danger" disabled={!canAssign || clear.isPending || !mappings.some(item => item.teacherId === teacherId)} onPress={() => Alert.alert('Clear faculty assignments?', `Remove all class assignments for ${selectedTeacher.fullName}?`, [
            { text: 'Cancel', style: 'cancel' }, { text: 'Clear assignments', style: 'destructive', onPress: () => clear.mutate() },
          ])} />
        </View>
        {(save.isError || clear.isError) && <Label color={c.destructive}>{((save.error || clear.error) as Error).message}</Label>}
      </Card>
    </>}
  </View>;
}

function AnalyticsModule({ user, sessionId, sessionName, isArchive }: Omit<Props, 'moduleId'>) {
  const c = useColors();
  const get = useSessionGet(user, sessionId);
  const canView = hasSubmodulePermission(user, 'analytics', 'view');
  const canResults = hasSubmodulePermission(user, 'analytics', 'results');
  const tabs = [...(canView ? [{ id: 'view', label: 'View marks' }] : []), ...(canResults ? [{ id: 'results', label: 'Results' }] : [])];
  const [tab, setTab] = useState(tabs[0]?.id ?? '');
  const [viewClass, setViewClass] = useState('');
  const [viewSection, setViewSection] = useState('');
  const [subject, setSubject] = useState('');
  const [examType, setExamType] = useState('');
  const [resultClass, setResultClass] = useState('');
  const [resultSection, setResultSection] = useState('');
  const [search, setSearch] = useState('');
  const context = useQuery({
    queryKey: ['mobile-admin-academic', 'analytics-context', user.schoolId, sessionId],
    queryFn: ({ signal }) => get('/mobile/admin/modules/analytics/context', sessionId, signal) as Promise<AnalyticsContext>,
  });
  const marks = useQuery({
    queryKey: ['mobile-admin-academic', 'analytics-view', user.schoolId, sessionId, viewClass, viewSection, subject, examType],
    queryFn: ({ signal }) => get(`/mobile/admin/modules/analytics/view?class=${encodeURIComponent(viewClass)}&section=${encodeURIComponent(viewSection)}&subject=${encodeURIComponent(subject)}&examType=${encodeURIComponent(examType)}`, sessionId, signal) as Promise<AnalyticsScore[]>,
    enabled: tab === 'view' && !!viewClass && !!viewSection && !!subject && !!examType,
  });
  const results = useQuery({
    queryKey: ['mobile-admin-academic', 'analytics-results', user.schoolId, sessionId, resultClass, resultSection],
    queryFn: ({ signal }) => get(`/mobile/admin/modules/analytics/results?class=${encodeURIComponent(resultClass)}&section=${encodeURIComponent(resultSection)}`, sessionId, signal) as Promise<ResultData>,
    enabled: tab === 'results' && !!resultClass && !!resultSection,
  });
  if (context.isPending) return <Status title="Loading performance analytics" loading />;
  if (context.isError || !context.data) return <Status title="Analytics unavailable" detail={(context.error as Error)?.message} retry={() => { void context.refetch(); }} />;
  const data = context.data;
  const viewSections = viewClass ? data.classSections[viewClass]?.length ? data.classSections[viewClass] : data.sections : [];
  const viewSubjects = viewClass ? data.classSubjects[viewClass] ?? [] : [];
  const viewExams = viewClass ? data.classExamTypes[viewClass] ?? data.examTypes : data.examTypes;
  const resultSections = resultClass ? data.classSections[resultClass]?.length ? data.classSections[resultClass] : data.sections : [];
  const visibleResults = (results.data?.students ?? []).filter(item => `${item.name} ${item.digitalStudentId} ${item.rollNumber ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return <View style={styles.module}>
    <SessionBanner name={sessionName} archived={isArchive} />
    <Heading>Performance Analytics</Heading>
    <View style={styles.wrapRow}>{tabs.map(item => <Chip key={item.id} label={item.label} selected={tab === item.id} onPress={() => setTab(item.id)} />)}</View>
    {!tabs.length ? <Status title="No analytics sections available" detail="Your account has no allowed analytics submodule." /> : null}
    {tab === 'view' && <Card>
      <Heading>Class marks</Heading>
      <TextLabel>Class</TextLabel><View style={styles.wrapRow}>{data.classes.map(item => <Chip key={item} label={`Class ${item}`} selected={viewClass === item} onPress={() => { setViewClass(item); setViewSection(''); setSubject(''); setExamType(''); }} />)}</View>
      {!!viewClass && <><TextLabel>Section</TextLabel><View style={styles.wrapRow}>{viewSections.map(item => <Chip key={item} label={item} selected={viewSection === item} onPress={() => setViewSection(item)} />)}</View></>}
      {!!viewSection && <><TextLabel>Subject</TextLabel><View style={styles.wrapRow}>{viewSubjects.map(item => <Chip key={item} label={item} selected={subject === item} onPress={() => setSubject(item)} />)}</View></>}
      {!!subject && <><TextLabel>Exam</TextLabel><View style={styles.wrapRow}>{viewExams.map(item => <Chip key={item} label={item} selected={examType === item} onPress={() => setExamType(item)} />)}</View></>}
      {!viewClass || !viewSection || !subject || !examType ? <Label>Select class, section, subject and exam to load persisted marks for this session.</Label>
        : marks.isPending ? <ActivityIndicator color={c.primary} />
          : marks.isError ? <Label color={c.destructive}>{(marks.error as Error).message}</Label>
            : !marks.data?.length ? <Label>{EMPTY_NOTICE}</Label>
              : marks.data.map(item => <View key={`${item.studentId}-${item.subject}-${item.examType}`} style={[styles.rowBetween, styles.resultLine, { borderColor: c.border }]}>
                <View style={{ flex: 1 }}><Label style={{ fontWeight: '700' }}>{item.studentName}</Label><Text style={{ color: c.mutedForeground, fontSize: 11 }}>{item.dsid || item.subject}</Text></View>
                <Text style={{ color: c.foreground, fontSize: 14, fontWeight: '800' }}>{item.isAbsent ? 'Absent' : `${item.marks} / ${item.totalMarks}`}</Text>
              </View>)}
    </Card>}
    {tab === 'results' && <Card>
      <Heading>Class results</Heading>
      <TextLabel>Class</TextLabel><View style={styles.wrapRow}>{data.classes.map(item => <Chip key={item} label={`Class ${item}`} selected={resultClass === item} onPress={() => { setResultClass(item); setResultSection(''); setSearch(''); }} />)}</View>
      {!!resultClass && <><TextLabel>Section</TextLabel><View style={styles.wrapRow}>{resultSections.map(item => <Chip key={item} label={item} selected={resultSection === item} onPress={() => setResultSection(item)} />)}</View></>}
      {!!resultSection && <>
        <TextInput value={search} onChangeText={setSearch} placeholder="Search students" placeholderTextColor={c.mutedForeground} style={[styles.input, { color: c.foreground, borderColor: c.border }]} />
        {results.isPending ? <ActivityIndicator color={c.primary} /> : results.isError ? <Label color={c.destructive}>{(results.error as Error).message}</Label>
          : visibleResults.length === 0 ? <Label>{EMPTY_NOTICE}</Label>
              : visibleResults.map(student => <View key={student.studentId} style={[styles.resultCard, { borderColor: c.border }]}>
                <View style={styles.rowBetween}><View style={{ flex: 1 }}><Label style={{ fontWeight: '700' }}>{student.name}</Label><Text style={{ color: c.mutedForeground, fontSize: 11 }}>{student.digitalStudentId}{student.rollNumber ? ` · Roll ${student.rollNumber}` : ''}</Text></View>
                  <Text style={{ color: c.primary, fontSize: 12, fontWeight: '700' }}>{student.attendance?.attendancePct == null ? 'Attendance —' : `Attendance ${Math.round(student.attendance.attendancePct)}%`}</Text></View>
                {!student.scores.length ? <Text style={{ color: c.mutedForeground, fontSize: 12 }}>No recorded marks in this session.</Text>
                  : student.scores.map((score, index) => <Text key={`${score.subject}-${score.examType}-${index}`} style={{ color: c.mutedForeground, fontSize: 11 }}>
                    {score.subject} · {score.examType}: {score.isAbsent ? 'Absent' : `${score.marks}/${score.totalMarks}`}
                  </Text>)}
              </View>)}
      </>}
    </Card>}
  </View>;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] ?? char);
}

function IdCardModule({ user, sessionId, sessionName, isArchive }: Omit<Props, 'moduleId'> & { schoolName: string }) {
  const c = useColors();
  const get = useSessionGet(user, sessionId);
  const groups: Array<{ id: CardGroup; label: string }> = [
    { id: 'student', label: 'Students' }, { id: 'teacher', label: 'Teachers' }, { id: 'support-staff', label: 'Support staff' },
  ].filter((item): item is { id: CardGroup; label: string } => hasSubmodulePermission(user, 'id-card-gen', item.id));
  const [group, setGroup] = useState<CardGroup>(groups[0]?.id ?? 'student');
  const [cls, setCls] = useState('');
  const [section, setSection] = useState('');
  const [search, setSearch] = useState('');
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const context = useQuery({
    queryKey: ['mobile-admin-academic', 'id-card-context', user.schoolId, sessionId],
    queryFn: ({ signal }) => get('/mobile/admin/modules/id-card-gen/context', sessionId, signal) as Promise<Pick<AcademicContext, 'classes' | 'sections'>>,
    enabled: group === 'student',
  });
  const roster = useQuery({
    queryKey: ['mobile-admin-academic', 'id-card-roster', user.schoolId, sessionId, group, searched, cls, section, search],
    queryFn: ({ signal }) => get(`/mobile/admin/modules/id-card-gen/roster?group=${group}&class=${encodeURIComponent(cls)}&section=${encodeURIComponent(section)}&q=${encodeURIComponent(search)}`, sessionId, signal) as Promise<{ group: CardGroup; roster: CardRecord[]; session: { sessionName: string } }>,
    enabled: searched && groups.length > 0,
  });
  const records = roster.data?.roster ?? [];
  const toggle = (id: number) => setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const selectAll = () => setSelected(selected.length === records.length ? [] : records.map(item => item.id));
  const createPdf = async () => {
    const printable = records.filter(item => selected.length === 0 || selected.includes(item.id));
    if (!printable.length) return;
    const cards = printable.map(item => {
      const subtitle = group === 'student'
        ? `${item.className ? `Class ${escapeHtml(item.className)}` : ''}${item.section ? ` · ${escapeHtml(item.section)}` : ''}`
        : escapeHtml(item.role ?? item.subject ?? (group === 'teacher' ? 'Faculty' : 'Staff'));
      const identity = group === 'student' ? item.digitalStudentId : group === 'teacher' ? item.digitalTeacherId : item.email;
      return `<article class="card"><div class="brand">${escapeHtml(user.schoolName)}</div><div class="rule"></div><h2>${escapeHtml(item.name)}</h2><p class="subtitle">${subtitle}</p><p class="id">${escapeHtml(identity || `Record ${item.id}`)}</p><footer>${escapeHtml(sessionName || roster.data?.session.sessionName || 'Academic session')}</footer></article>`;
    }).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      *{box-sizing:border-box}body{margin:0;background:#eef2f6;font-family:Arial,sans-serif;color:#12233d;padding:20px}
      .grid{display:grid;grid-template-columns:repeat(2,minmax(240px,1fr));gap:14px}
      .card{position:relative;height:170px;background:#fff;border:1px solid #cfdae7;border-radius:12px;padding:16px;break-inside:avoid;overflow:hidden}
      .brand{font-size:12px;font-weight:bold;color:#0b60ea;text-transform:uppercase;letter-spacing:1px}
      .rule{height:2px;background:#0b60ea;margin:10px 0}
      h2{font-size:17px;margin:0 0 5px}.subtitle{font-size:12px;color:#46566b;margin:0 0 11px}
      .id{font-size:12px;font-weight:bold;margin:0}.extra{font-size:10px;color:#46566b;margin:8px 0}
      footer{position:absolute;bottom:12px;font-size:9px;color:#66758a}
      @media print{body{padding:8px;background:#fff}.grid{gap:8px}.card{border-radius:6px}}
    </style></head><body><main class="grid">${cards}</main></body></html>`;
    const file = await Print.printToFileAsync({ html });
    if (!await Sharing.isAvailableAsync()) {
      Alert.alert('PDF created', `The cards PDF is ready at ${file.uri}, but sharing is unavailable on this device.`);
      return;
    }
    await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: 'Share ID cards' });
  };
  if (!groups.length) return <Status title="No ID card groups available" detail="Your account has no permitted ID card submodule." />;
  return <View style={styles.module}>
    <SessionBanner name={sessionName} archived={isArchive} />
    <Heading>ID Card Generator</Heading>
    <Text style={{ color: c.mutedForeground, fontSize: 13, lineHeight: 20 }}>Prepare printable cards from the school’s actual roster records.</Text>
    <View style={styles.wrapRow}>{groups.map(item => <Chip key={item.id} label={item.label} selected={group === item.id} onPress={() => { setGroup(item.id); setSearched(false); setSelected([]); }} />)}</View>
    <Card>
      <TextInput value={search} onChangeText={setSearch} placeholder={group === 'student' ? 'Search name or student ID' : 'Search name, email or role'}
        placeholderTextColor={c.mutedForeground} style={[styles.input, { color: c.foreground, borderColor: c.border }]} />
      {group === 'student' && <>
        <TextLabel>Class</TextLabel><ScrollView horizontal contentContainerStyle={styles.wrapRow} showsHorizontalScrollIndicator={false}>
          <Chip label="All classes" selected={!cls} onPress={() => setCls('')} />
          {(context.data?.classes ?? []).map(item => <Chip key={item} label={`Class ${item}`} selected={cls === item} onPress={() => setCls(item)} />)}
        </ScrollView>
        <TextLabel>Section</TextLabel><ScrollView horizontal contentContainerStyle={styles.wrapRow} showsHorizontalScrollIndicator={false}>
          <Chip label="All sections" selected={!section} onPress={() => setSection('')} />
          {(context.data?.sections ?? []).map(item => <Chip key={item} label={item} selected={section === item} onPress={() => setSection(item)} />)}
        </ScrollView>
      </>}
      <Action label={searched ? 'Refresh roster' : 'Load roster'} icon="search" onPress={() => { setSearched(true); setSelected([]); }} disabled={group === 'student' && context.isPending} />
    </Card>
    {searched && (roster.isPending ? <Status title="Loading roster" loading />
      : roster.isError ? <Status title="Roster unavailable" detail={(roster.error as Error).message} retry={() => { void roster.refetch(); }} />
        : !records.length ? <Status title={EMPTY_NOTICE} detail="Try clearing the search or changing the class filter." />
          : <>
            <Card>
              <View style={styles.rowBetween}><Label>{records.length} records · {selected.length ? `${selected.length} selected` : 'all will export'}</Label><Pressable onPress={selectAll}><Text style={{ color: c.primary, fontWeight: '700' }}>{selected.length === records.length ? 'Clear' : 'Select all'}</Text></Pressable></View>
              <Text style={{ color: c.mutedForeground, fontSize: 11 }}>Showing up to 100 matching records.</Text>
              {records.map(item => {
                const chosen = selected.includes(item.id);
                return <Pressable key={item.id} onPress={() => toggle(item.id)} style={[styles.teacherRow, { borderColor: chosen ? c.primary : c.border, backgroundColor: chosen ? c.accent : c.background }]}>
                  <Feather name={chosen ? 'check-circle' : 'circle'} size={19} color={chosen ? c.primary : c.mutedForeground} />
                  <View style={{ flex: 1 }}>
                    <Label style={{ fontWeight: '700' }}>{item.name}</Label>
                    <Text style={{ color: c.mutedForeground, fontSize: 11 }}>{group === 'student' ? `${item.digitalStudentId || `Record ${item.id}`} · ${item.className ?? ''}-${item.section ?? ''}` : item.role ?? item.subject ?? item.email ?? 'Staff'}</Text>
                  </View>
                </Pressable>;
              })}
            </Card>
            <Action label={`Create PDF · ${selected.length || records.length}`} icon="download" onPress={() => { void createPdf().catch(error => Alert.alert('PDF export failed', error instanceof Error ? error.message : 'Unable to create ID cards.')); }} disabled={Platform.OS === 'web'} />
            {Platform.OS === 'web' && <Label>PDF export is available on the iOS and Android app.</Label>}
          </>)}
  </View>;
}

function AdminAcademicModuleContent(props: Props & { schoolName?: string }) {
  const c = useColors();
  if (props.user.role !== 'admin' && props.user.role !== 'support_staff') {
    return <Status title="Access denied" detail="Administrator or permitted support staff access is required." />;
  }
  if (props.user.role !== 'admin' && !props.user.allowedModules?.includes(props.moduleId)) {
    return <Status title="Access denied" detail="This module is not available to this account." />;
  }
  if (props.user.role === 'admin' && !props.sessionId) {
    return <Status title="Select an academic session" detail="Choose an academic year before opening this module." />;
  }
  return <ScrollView contentContainerStyle={[styles.content, { backgroundColor: c.background }]} keyboardShouldPersistTaps="handled">
    {props.moduleId === 'timetable'
      ? <TimetableModule {...props} />
      : props.moduleId === 'faculty-mapping'
        ? <FacultyMappingModule {...props} />
        : props.moduleId === 'analytics'
          ? <AnalyticsModule {...props} />
          : <IdCardModule {...props} schoolName={props.schoolName ?? props.user.schoolName} />}
  </ScrollView>;
}

export default function AdminAcademicModules(props: Props & { schoolName?: string }) {
  return <AdminAcademicModuleContent key={`${props.moduleId}-${props.user.schoolId}-${props.sessionId ?? 'active'}`} {...props} />;
}

const styles = StyleSheet.create({
  content: { gap: 15, padding: 16, paddingBottom: 36, ...(Platform.OS === 'web' ? { paddingTop: 67 } : {}) },
  module: { gap: 14 },
  rowBetween: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  wrapRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sessionBanner: { alignItems: 'center', borderRadius: 11, flexDirection: 'row', gap: 9, paddingHorizontal: 11, paddingVertical: 9 },
  chip: { alignItems: 'center', borderRadius: 20, borderWidth: 1, minHeight: 36, justifyContent: 'center', paddingHorizontal: 13, paddingVertical: 7 },
  action: { alignItems: 'center', borderRadius: 11, borderWidth: 1, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 43, paddingHorizontal: 14, paddingVertical: 10 },
  secondaryButton: { alignItems: 'center', borderRadius: 9, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9, marginTop: 5 },
  disabled: { opacity: 0.46 },
  status: { alignItems: 'center', borderRadius: 15, borderWidth: 1, gap: 10, padding: 22 },
  statusTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  statusDetail: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  input: { borderRadius: 10, borderWidth: 1, fontSize: 14, minHeight: 44, paddingHorizontal: 12, paddingVertical: 10 },
  modalBackdrop: { backgroundColor: 'rgba(0,0,0,0.48)', flex: 1, justifyContent: 'flex-end' },
  modalCard: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, gap: 14, padding: 18, paddingBottom: 36 },
  choiceRow: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, minHeight: 48, paddingVertical: 12 },
  slot: { borderRadius: 9, borderWidth: 1, gap: 3, height: 82, justifyContent: 'center', padding: 7, width: 106 },
  structureRow: { borderRadius: 11, borderWidth: 1, gap: 9, padding: 11 },
  timeInput: { flex: 1, minWidth: 115 },
  teacherRow: { alignItems: 'center', borderRadius: 11, borderWidth: 1, flexDirection: 'row', gap: 10, minHeight: 54, paddingHorizontal: 10, paddingVertical: 8 },
  avatar: { alignItems: 'center', borderRadius: 16, height: 32, justifyContent: 'center', width: 32 },
  mapCell: { alignItems: 'center', borderRadius: 10, borderWidth: 1, flexDirection: 'row', gap: 6, justifyContent: 'space-between', minHeight: 38, paddingHorizontal: 10 },
  resultLine: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
  resultCard: { borderRadius: 11, borderWidth: 1, gap: 8, padding: 12 },
});