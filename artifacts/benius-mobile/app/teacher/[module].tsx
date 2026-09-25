import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Modal, Platform, Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import * as Location from 'expo-location';
import { Directory, File, Paths } from 'expo-file-system';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_BASE_URL, apiGetForSession, apiPostForSession, authTransport, type MobileUser } from '@/lib/api';
import { formatSchoolDate, formatSchoolInstant } from '@/lib/date';
import { useAcademicSession } from '@/contexts/SessionContext';
import { useAuth } from '@/contexts/AuthContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { teacherColors } from '@/components/TeacherDashboard';

type ModuleId = 'attendance' | 'homework' | 'classwork' | 'noticeboard' | 'complaint'
  | 'examination' | 'gallery' | 'faculty-info' | 'calendar' | 'library'
  | 'leave' | 'timetable' | 'student-profiles';
type TeacherScope = { className: string; section: string; subject: string | null };
type Item = Record<string, any>;
type TeacherModuleData = {
  scopes?: TeacherScope[];
  items?: Item[];
  entries?: Item[];
  students?: Item[];
  history?: Item[];
  studentItems?: Item[];
  studentHistory?: Item[];
  subjects?: string[];
  examTypes?: string[];
  promotionTerms?: string[];
  promotionDecisions?: Item[];
  date?: string;
  className?: string;
  section?: string;
  balance?: Record<string, unknown>;
  policies?: Item[];
  classFeed?: Item[];
  myBooks?: Item[];
  myEbooks?: Item[];
  myUploads?: Item[];
  selfAttendance?: { today?: Item; policy?: Item; rate?: Item; history?: Item[]; corrections?: Item[] };
};

const definitions: Record<ModuleId, { title: string; subtitle: string; icon: React.ComponentProps<typeof Feather>['name'] }> = {
  attendance: { title: 'Attendance', subtitle: 'Daily class attendance', icon: 'clipboard' },
  homework: { title: 'Homework', subtitle: 'Assign work and review the class list', icon: 'book' },
  classwork: { title: 'Classwork', subtitle: 'In-class tasks and activity records', icon: 'edit-3' },
  noticeboard: { title: 'Noticeboard', subtitle: 'School and class notices', icon: 'bell' },
  complaint: { title: 'Complaint', subtitle: 'Raise or track staff complaints', icon: 'shield' },
  examination: { title: 'Examination', subtitle: 'Review exam scores by class and subject', icon: 'award' },
  gallery: { title: 'Gallery', subtitle: 'Approved school photos and events', icon: 'image' },
  'faculty-info': { title: 'Faculty Info', subtitle: 'School faculty directory', icon: 'users' },
  calendar: { title: 'School Calendar', subtitle: 'Events, holidays and school dates', icon: 'calendar' },
  library: { title: 'Library', subtitle: 'School books and digital resources', icon: 'book-open' },
  leave: { title: 'Leave', subtitle: 'Apply for and track leave requests', icon: 'calendar' },
  timetable: { title: 'Timetable', subtitle: 'Your class periods and weekly schedule', icon: 'clock' },
  'student-profiles': { title: 'Approval Center', subtitle: 'Review student profile changes', icon: 'check-circle' },
};

function istToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts();
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function getRows(data: TeacherModuleData | undefined): Item[] {
  return data?.items ?? data?.entries ?? [];
}

function ScopeLabel({ scope, selected, onPress }: { scope: TeacherScope; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress}
    style={[styles.scopeChip, selected && styles.scopeChipSelected]}>
    <Text style={[styles.scopeChipText, selected && styles.scopeChipTextSelected]}>
      {scope.className}{scope.section} · {scope.subject || 'Class'}
    </Text>
  </Pressable>;
}

function DarkInput({ label, value, onChangeText, multiline = false, keyboardType }: {
  label: string; value: string; onChangeText: (value: string) => void;
  multiline?: boolean; keyboardType?: React.ComponentProps<typeof TextInput>['keyboardType'];
}) {
  return <View style={styles.fieldWrap}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText}
      placeholder={label} placeholderTextColor={teacherColors.faint} keyboardType={keyboardType}
      multiline={multiline} textAlignVertical={multiline ? 'top' : 'center'}
      autoCorrect={false} style={[styles.input, multiline && styles.multiline]} />
  </View>;
}

function ActionButton({ label, icon, onPress, disabled = false, secondary = false }: {
  label: string; icon: React.ComponentProps<typeof Feather>['name']; onPress: () => void;
  disabled?: boolean; secondary?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.action, secondary && styles.actionSecondary,
      disabled && styles.actionDisabled, pressed && !disabled && styles.actionPressed]}>
    <Feather name={icon} size={17} color={teacherColors.white} />
    <Text style={styles.actionText}>{label}</Text>
  </Pressable>;
}

function EmptyCard({ title, detail }: { title: string; detail: string }) {
  return <View style={styles.card}>
    <View style={styles.emptyIcon}><Feather name="inbox" size={20} color={teacherColors.teal} /></View>
    <Text style={styles.cardTitle}>{title}</Text><Text style={styles.muted}>{detail}</Text>
  </View>;
}

function RecordCard({ item, index, onAction, actionLabel, actionIcon = 'check', actionDisabled = false }: {
  item: Item; index: number; onAction?: () => void; actionLabel?: string;
  actionIcon?: React.ComponentProps<typeof Feather>['name']; actionDisabled?: boolean;
}) {
  const title = String(item.title ?? item.name ?? item.studentName ?? item.fullName
    ?? item.subject ?? item.leaveType ?? item.ticketId ?? `${index + 1}`);
  const detail = [
    item.content, item.reason, item.designation, item.status,
    item.class && `Class ${item.class}${item.section ?? ''}`,
    item.className && `Class ${item.className}${item.section ?? ''}`,
    item.subject && item.subject !== title ? item.subject : null,
    item.marks != null && `${item.marks} / ${item.totalMarks ?? 100} marks${item.isAbsent ? ' · absent' : ''}`,
    item.approvalStatus && `Review: ${item.approvalStatus}`,
    item.dueDate && `Due ${formatSchoolDate(String(item.dueDate))}`,
    item.startDate && `${formatSchoolDate(String(item.startDate))} – ${formatSchoolDate(String(item.endDate ?? item.startDate))}`,
    item.createdAt && formatSchoolInstant(String(item.createdAt)),
    item.date && formatSchoolDate(String(item.date)),
    item.author,
  ].filter(Boolean).map(String);
  return <View style={styles.card}>
    {item.photoUrl || (item.imageUrl && !(typeof item.imageUrl === 'string' && item.imageUrl.startsWith('/api/mobile/teacher/modules/')))
      ? <Image source={{ uri: String(item.photoUrl ?? item.imageUrl) }} style={styles.recordImage} resizeMode="cover" />
      : null}
    <View style={styles.recordHeading}>
      <Text style={styles.cardTitle} numberOfLines={2}>{title}</Text>
      {item.dsid ? <Text style={styles.muted}>{String(item.dsid)}</Text> : null}
    </View>
    {detail.length > 0 ? <Text style={styles.muted} numberOfLines={8}>{detail.join('\n')}</Text> : null}
    {item.fileUrl ? <Text style={styles.linkText}>Attachment available</Text> : null}
    {onAction && actionLabel ? <ActionButton label={actionLabel} icon={actionIcon} onPress={onAction} disabled={actionDisabled} /> : null}
  </View>;
}

function NativeTeacherModule({ module, user }: { module: ModuleId; user: MobileUser }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { selectedId, sessions } = useAcademicSession();
  const { online } = useNetwork();
  const definition = definitions[module];
  const selectedSession = sessions.find((item) => item.id === selectedId);
  const [selectedScopeKey, setSelectedScopeKey] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [actionError, setActionError] = useState('');
  const [content, setContent] = useState('');
  const [subject, setSubject] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [noticeType, setNoticeType] = useState('Routine');
  const [noticeTarget, setNoticeTarget] = useState<'student' | 'whole_school'>('student');
  const [noticeEditingId, setNoticeEditingId] = useState<number | null>(null);
  const [noticeEditContent, setNoticeEditContent] = useState('');
  const [startDate, setStartDate] = useState(istToday());
  const [endDate, setEndDate] = useState(istToday());
  const [leaveType, setLeaveType] = useState('');
  const [leavePolicyId, setLeavePolicyId] = useState<number | undefined>();
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);
  const [complaintType, setComplaintType] = useState<'teacher-to-student' | 'teacher-to-admin'>('teacher-to-admin');
  const [reviewNote, setReviewNote] = useState('');
  const [complaintResolution, setComplaintResolution] = useState('');
  const [attendanceDate, setAttendanceDate] = useState(istToday());
  const [attendanceStatuses, setAttendanceStatuses] = useState<Record<number, string>>({});
  const [examSubject, setExamSubject] = useState('');
  const [examType, setExamType] = useState('');
  const [examTerm, setExamTerm] = useState('');
  const [examTotalMarks, setExamTotalMarks] = useState('');
  const [examMarks, setExamMarks] = useState<Record<number, string>>({});
  const [examAbsentees, setExamAbsentees] = useState<Record<number, boolean>>({});
  const [pickedFile, setPickedFile] = useState<{ uri: string; name: string; mimeType: string; size: number } | null>(null);
  const [pickedFiles, setPickedFiles] = useState<{ uri: string; name: string; mimeType: string; size: number }[]>([]);
  const [galleryTitle, setGalleryTitle] = useState('');
  const [galleryEvent, setGalleryEvent] = useState('');
  const [ebookTitle, setEbookTitle] = useState('');
  const [ebookAuthor, setEbookAuthor] = useState('');
  const [ebookTargetClass, setEbookTargetClass] = useState('');
  const [librarySearch, setLibrarySearch] = useState('');
  const [timetableDay, setTimetableDay] = useState('1');
  const [timetablePeriod, setTimetablePeriod] = useState('1');
  const [timetableRoom, setTimetableRoom] = useState('');
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [profileReviewId, setProfileReviewId] = useState<number | null>(null);
  const [profileEdits, setProfileEdits] = useState<Record<string, string>>({});
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxUri, setLightboxUri] = useState<string | null>(null);
  const [month, setMonth] = useState(istToday().slice(0, 7));
  const [calendarView, setCalendarView] = useState<'month' | 'week' | 'year'>('month');
  const [calendarCursor, setCalendarCursor] = useState(istToday());
  const [calendarDay, setCalendarDay] = useState<string | null>(null);

  const scopeParts = selectedScopeKey.split('\u0000');
  const queryClass = scopeParts[0] ?? '';
  const querySection = scopeParts[1] ?? '';
  const queryKey = ['mobile', 'teacher', user.schoolId, user.id, selectedId, module, selectedScopeKey,
    attendanceDate, examSubject, examType, examTerm, month, calendarView, calendarCursor] as const;
  const query = useQuery({
    queryKey,
    enabled: !!selectedId && !!selectedSession && user.role === 'teacher',
    staleTime: 0,
    queryFn: async ({ signal }) => {
      const scopeQuery = queryClass && querySection ? `?class=${encodeURIComponent(queryClass)}&section=${encodeURIComponent(querySection)}` : '';
      const extras = module === 'attendance'
        ? `${scopeQuery ? '&' : '?'}date=${encodeURIComponent(attendanceDate)}`
        : module === 'examination'
          ? `${scopeQuery ? '&' : '?'}subject=${encodeURIComponent(examSubject)}&examType=${encodeURIComponent(examType)}&term=${encodeURIComponent(examTerm)}`
          : module === 'calendar'
            ? (() => {
              const base = new Date(`${calendarCursor}T12:00:00Z`);
              if (calendarView === 'year') return `${scopeQuery ? '&' : '?'}year=${base.getUTCFullYear()}`;
              if (calendarView === 'week') {
                const day = base.getUTCDay(); const start = new Date(base); start.setUTCDate(base.getUTCDate() - day);
                const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
                return `${scopeQuery ? '&' : '?'}start=${start.toISOString().slice(0, 10)}&end=${end.toISOString().slice(0, 10)}`;
              }
              return `${scopeQuery ? '&' : '?'}month=${encodeURIComponent(month)}`;
            })()
            : '';
      const result = await apiGetForSession<TeacherModuleData>(
        `/mobile/teacher/modules/${module}${scopeQuery}${extras}`, selectedId!, { signal },
      );
      if (!result || typeof result !== 'object') throw new Error('The server returned invalid teacher module data.');
      return result;
    },
  });
  const data = query.data;
  const scopes = useMemo(() => data?.scopes ?? [], [data?.scopes]);
  const selectedScope = scopes.find((scope) => scope.className === queryClass && scope.section === querySection)
    ?? scopes[0] ?? null;
  const archived = selectedSession ? !selectedSession.isActive : true;
  const busy = !!busyAction;
  const canWrite = online && !archived && !busy;

  useEffect(() => {
    if (!selectedScopeKey && scopes.length) {
      setSelectedScopeKey(`${scopes[0].className}\u0000${scopes[0].section}`);
    }
  }, [selectedScopeKey, scopes]);
  useEffect(() => {
    setAttendanceStatuses({});
  }, [data?.entries]);
  useEffect(() => {
    setSubject(selectedScope?.subject ?? '');
  }, [selectedScopeKey, selectedScope?.subject]);
  useEffect(() => {
    if (module === 'examination') {
      if (!examSubject && data?.subjects?.length) setExamSubject(data.subjects[0]);
      if (!examType && data?.examTypes?.length) setExamType(data.examTypes[0]);
      if (!examTerm && data?.promotionTerms?.length) setExamTerm(data.promotionTerms[0]);
    }
  }, [module, data?.subjects, data?.examTypes, data?.promotionTerms, examSubject, examType, examTerm]);
  useEffect(() => {
    if (module !== 'examination') return;
    const scores = data?.items ?? [];
    const nextMarks: Record<number, string> = {};
    const nextAbsentees: Record<number, boolean> = {};
    for (const score of scores) {
      const studentId = Number(score.studentId);
      nextMarks[studentId] = String(score.marks ?? '');
      nextAbsentees[studentId] = !!score.isAbsent;
    }
    setExamMarks(nextMarks);
    setExamAbsentees(nextAbsentees);
    setExamTotalMarks(scores.length ? String(scores[0].totalMarks ?? '') : '');
  }, [module, data?.items]);

  const submit = async (action: string, body: Record<string, unknown>, success: string, clearForm = true) => {
    if (!selectedId || archived || !online || busy) return;
    setBusyAction(action);
    setActionError('');
    try {
      await apiPostForSession(`/mobile/teacher/modules/${module}/${action}`, selectedId, body);
      if (clearForm) {
        setContent('');
        setDueDate('');
      }
      await queryClient.invalidateQueries({ queryKey });
      setActionError('');
      Alert.alert(definition.title, success);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save changes.';
      setActionError(message);
      Alert.alert('Unable to save', message);
    } finally {
      setBusyAction('');
    }
  };

  const chooseAttachment = async (kind: 'document' | 'image' | 'ebook') => {
    try {
      const types = kind === 'image'
        ? ['image/jpeg', 'image/png', 'image/webp']
        : kind === 'ebook' ? ['application/pdf']
          : ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
      const result = await DocumentPicker.getDocumentAsync({ type: types, multiple: kind === 'image', copyToCacheDirectory: true });
      if (result.canceled) return;
      const assets = result.assets;
      const chosen = assets.map((asset) => ({
        uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? '', size: asset.size ?? 0,
      }));
      if (kind === 'image' && chosen.length > 10) { Alert.alert('Too many files', 'Choose up to 10 images.'); return; }
      if (kind === 'image') setPickedFiles(chosen);
      const asset = assets[0];
      const valid = assets.every((candidate) => {
        const extension = candidate.name.split('.').pop()?.toLowerCase() ?? '';
        return ['jpg', 'jpeg', 'png', 'webp', 'pdf'].includes(extension)
          && !(kind === 'image' && extension === 'pdf')
          && !(kind === 'ebook' && extension !== 'pdf')
          && (candidate.size == null || candidate.size <= 10 * 1024 * 1024);
      });
      if (!valid) {
        Alert.alert('Unsupported file', 'Choose a matching JPG, PNG, WebP, or PDF file up to 10 MiB.');
        return;
      }
      setPickedFile({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? '', size: asset.size ?? 0 });
    } catch (error) {
      Alert.alert('File picker unavailable', error instanceof Error ? error.message : 'Could not open the file picker.');
    }
  };

  const submitWithAttachment = async (
    action: string, fields: Record<string, string | number | boolean>, success: string, fileRequired: boolean,
  ) => {
    if (!selectedId || archived || !online || busy) return;
    if (fileRequired && !pickedFile) { Alert.alert('Choose a file', 'Select an attachment before continuing.'); return; }
    setBusyAction(action);
    setActionError('');
    try {
      const form = new FormData();
      Object.entries(fields).forEach(([key, value]) => form.append(key, String(value)));
      if (pickedFile) {
        form.append('file', { uri: pickedFile.uri, name: pickedFile.name, type: pickedFile.mimeType } as unknown as Blob);
      }
      if (module === 'gallery' && action === 'upload' && pickedFiles.length > 1) {
        for (const selected of pickedFiles) {
          const batchForm = new FormData();
          Object.entries(fields).forEach(([key, value]) => batchForm.append(key, String(value)));
          batchForm.append('file', { uri: selected.uri, name: selected.name, type: selected.mimeType } as unknown as Blob);
          await apiPostForSession(`/mobile/teacher/modules/${module}/${action}`, selectedId, batchForm);
        }
      } else {
        await apiPostForSession(`/mobile/teacher/modules/${module}/${action}`, selectedId, form);
      }
      setPickedFile(null);
      setPickedFiles([]);
      setContent('');
      setDueDate('');
      setGalleryTitle('');
      setGalleryEvent('');
      setEbookTitle('');
      setEbookAuthor('');
      setEbookTitle('');
      setEbookAuthor('');
      await queryClient.invalidateQueries({ queryKey });
      Alert.alert(definition.title, success);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to upload the attachment.';
      setActionError(message);
      Alert.alert('Upload failed', message);
    } finally {
      setBusyAction('');
    }
  };

  const openPrivateFile = async (raw: string, preview = false): Promise<string | null> => {
    const match = raw.match(/^\/api\/mobile\/teacher\/modules\/(homework|classwork|gallery|library|noticeboard|complaint)\/private-files\/([0-9a-f-]+\.(?:jpg|jpeg|png|webp|pdf))$/i);
    if (!match || Platform.OS === 'web') {
      Alert.alert('Private attachment', Platform.OS === 'web' ? 'Open private attachments in BENIUS Mobile on a device.' : 'This attachment address is invalid.');
      return null;
    }
    const fileModule = match[1];
    const filename = match[2];
    const apiPath = `/mobile/teacher/modules/${fileModule}/private-files/${filename}`;
    let before: Awaited<ReturnType<typeof authTransport.restore>>;
    try { before = await authTransport.restore(); }
    catch {
      Alert.alert('Unable to open attachment', 'Secure sign-in data is unavailable. Sign in again.');
      return null;
    }
    if (!before || before.user.id !== user.id || before.user.schoolId !== user.schoolId) {
      Alert.alert('Account changed', 'Sign in again before opening this private attachment.');
      return null;
    }
    try {
      await apiGetForSession(`${apiPath}?check=1`, selectedId!);
      let token = await authTransport.token();
      if (!token) throw new Error('Your authenticated session is unavailable. Sign in again.');
      let response = await fetch(`${API_BASE_URL}${apiPath}`, {
        headers: { Authorization: `Bearer ${token}`, 'x-view-session-id': String(selectedId) },
      });
      if (response.status === 401) {
        await apiGetForSession(`${apiPath}?check=1`, selectedId!);
        token = await authTransport.token();
        if (!token) throw new Error('Your authenticated session is unavailable. Sign in again.');
        response = await fetch(`${API_BASE_URL}${apiPath}`, {
          headers: { Authorization: `Bearer ${token}`, 'x-view-session-id': String(selectedId) },
        });
      }
      if (!response.ok) throw new Error(`Attachment download failed (${response.status}).`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('The attachment is empty or exceeds the 10 MiB download limit.');
      const after = await authTransport.restore();
      if (!after || after.user.id !== before.user.id || after.user.schoolId !== before.user.schoolId) throw new Error('Account changed during download.');
      const extension = filename.split('.').pop()!.toLowerCase();
      const directory = new Directory(Paths.cache, 'benius-teacher-private');
      directory.create({ idempotent: true, intermediates: true });
      const localFile = new File(directory, `attachment_${Date.now().toString(36)}.${extension}`);
      localFile.create();
      try {
        localFile.write(bytes);
        if (!await Sharing.isAvailableAsync()) throw new Error('No document viewer is available on this device.');
         if (!preview) await Sharing.shareAsync(localFile.uri, { dialogTitle: 'Open BENIUS attachment' });
         return localFile.uri;
      } finally {
         if (localFile.exists && !preview) localFile.delete();
      }
    } catch (error) {
      Alert.alert('Unable to open attachment', error instanceof Error ? error.message : 'Private attachment download failed.');
      return null;
    }
  };

  const openAttachment = async (raw: string) => {
    if (raw.startsWith('/api/mobile/teacher/modules/')) {
       await openPrivateFile(raw);
       return;
    }
    try {
      const origin = API_BASE_URL.replace(/\/api\/?$/, '');
      const url = new URL(raw, origin);
      const decodedPath = decodeURIComponent(url.pathname);
      if (!origin || url.origin !== new URL(origin).origin || url.username || url.password
        || !decodedPath.startsWith('/uploads/') || decodedPath.includes('..') || decodedPath.includes('\\')) {
        throw new Error('This public attachment address is not allowed.');
      }
      await Linking.openURL(url.toString());
    } catch (error) {
      Alert.alert('Unable to open attachment', error instanceof Error ? error.message : 'Attachment address is invalid.');
    }
  };

  const galleryItems = data?.items ?? [];
  const showGalleryItem = async (index: number) => {
    const item = galleryItems[index];
    if (!item || typeof item.imageUrl !== 'string') return;
    setLightboxIndex(index);
    setLightboxUri(null);
    const uri = await openPrivateFile(item.imageUrl, true);
    setLightboxUri(uri);
  };

  const exportResultsCsv = async () => {
    if (module !== 'examination' || !selectedScope || !examTerm) return;
    const rows = data?.promotionDecisions ?? [];
    const scoreRows = items;
    const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const studentName = (id: unknown) => String(data?.students?.find((student) => Number(student.studentId ?? student.id) === Number(id))?.name ?? '');
    const lines = [
      ['Class', selectedScope.className, 'Section', selectedScope.section, 'Term', examTerm, 'Subject', examSubject, 'Examination', examType],
      [],
      ['Student ID', 'Student', 'Marks', 'Total Marks', 'Absent', 'Published'],
      ...scoreRows.map((score) => [
        score.studentId, studentName(score.studentId), score.marks, score.totalMarks, score.isAbsent ? 'Yes' : 'No',
        score.published ? 'Yes' : 'No',
      ]),
      [],
      ['Promotion ledger'],
      ['Student ID', 'Student', 'Decision', 'Locked'],
      ...rows.map((entry) => [entry.studentId, studentName(entry.studentId), entry.decision ?? entry.status, entry.locked ? 'Yes' : 'No']),
    ];
    const csv = lines.map((line) => line.map(quote).join(',')).join('\r\n');
    try {
      const directory = new Directory(Paths.cache, 'benius-teacher-exports');
      directory.create({ idempotent: true, intermediates: true });
      const file = new File(directory, `results_${selectedScope.className}${selectedScope.section}_${examTerm.replace(/[^a-z0-9]+/gi, '-')}.csv`);
      file.create();
      file.write(csv);
      if (!await Sharing.isAvailableAsync()) throw new Error('No file sharing is available on this device.');
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Export Results CSV' });
      if (file.exists) file.delete();
    } catch (error) {
      Alert.alert('Export failed', error instanceof Error ? error.message : 'Unable to export the selected results.');
    }
  };

  const selfAttendanceAction = async (action: 'self-check-in' | 'self-check-out') => {
    if (!selectedId || !canWrite) return;
    const body: Record<string, unknown> = {};
    if (action === 'self-check-in') {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.granted) {
          const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          body.latitude = location.coords.latitude;
          body.longitude = location.coords.longitude;
        }
      } catch { /* Location is optional; server never trusts client verification. */ }
      body.locationVerified = false;
    }
    await submit(action, body, action === 'self-check-in' ? 'Checked in.' : 'Checked out.', false);
  };

  const setStudentStatus = (studentId: number, displayedStatus?: string) => {
    const order = ['present', 'absent', 'late', 'halfday'];
    setAttendanceStatuses((current) => {
      const prior = current[studentId] ?? displayedStatus;
      const nextIndex = prior ? (order.indexOf(prior) + 1) % order.length : 0;
      return { ...current, [studentId]: order[nextIndex] };
    });
  };
  const statusLabel = (value?: string) => value ? value.replace('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Not marked';
  const items = getRows(data);
  const calendarItems = module === 'calendar' && calendarDay
    ? items.filter((item) => String(item.date ?? '').slice(0, 10) === calendarDay) : items;
  const bottomInset = insets.bottom + 30;

  if (!selectedId || !selectedSession) {
    return <View style={styles.page}><StatusBar barStyle="light-content" backgroundColor={teacherColors.bg} />
      <View style={[styles.content, { paddingTop: insets.top + 24, paddingBottom: bottomInset }]}>
        <ActionButton label="Back to Teacher Home" icon="arrow-left" onPress={() => router.replace('/')} secondary />
        <EmptyCard title="Academic session unavailable" detail="Choose a school session before opening Teacher modules." />
      </View>
    </View>;
  }

  const onRefresh = () => { void query.refetch(); };

  return <View style={styles.page}>
    <StatusBar barStyle="light-content" backgroundColor={teacherColors.bg} />
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 18, paddingBottom: bottomInset }]}
      keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={onRefresh} tintColor={teacherColors.teal} />}>
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Teacher Home" onPress={() => router.replace('/')}
          style={styles.backButton}><Feather name="arrow-left" color={teacherColors.white} size={19} /></Pressable>
        <View style={styles.brand}><Text style={styles.brandText}>BENIUS</Text><Text style={styles.roleText}>Teacher Workspace</Text></View>
        <Feather name={definition.icon} size={22} color={teacherColors.teal} />
      </View>

      <View style={styles.titleBlock}>
        <Text style={styles.title}>{definition.title}</Text>
        <Text style={styles.subtitle}>{definition.subtitle}</Text>
        <View style={styles.sessionBadge}><Feather name="calendar" size={14} color={teacherColors.teal} />
          <Text style={styles.sessionText}>{selectedSession.sessionName}{archived ? ' · Archived · Read only' : ' · Active'}</Text></View>
      </View>

      {!online && <View style={styles.banner}><Feather name="wifi-off" size={16} color={teacherColors.amber} /><Text style={styles.bannerText}>Offline · Connect to refresh or save changes.</Text></View>}
      {archived && <View style={styles.banner}><Feather name="archive" size={16} color={teacherColors.amber} /><Text style={styles.bannerText}>This archived session is read-only.</Text></View>}

      {scopes.length > 1 && <View style={styles.scopeBlock}>
        <Text style={styles.sectionLabel}>Assigned classes</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {scopes.map((scope) => <ScopeLabel key={`${scope.className}-${scope.section}`} scope={scope}
            selected={selectedScope?.className === scope.className && selectedScope?.section === scope.section}
            onPress={() => { setSelectedScopeKey(`${scope.className}\u0000${scope.section}`); setSelectedStudentId(null); }} />)}
        </ScrollView>
      </View>}

      {module === 'attendance' && <>
        <DarkInput label="Attendance date (YYYY-MM-DD)" value={attendanceDate} onChangeText={setAttendanceDate} />
        <Text style={styles.muted}>{data?.className ?? selectedScope?.className}{data?.section ?? selectedScope?.section} · Select each student to cycle through attendance status.</Text>
      </>}
      {module === 'examination' && <>
        <Text style={styles.sectionLabel}>Subject</Text>
        <ChoiceRow options={data?.subjects ?? []} selected={examSubject} onSelect={setExamSubject} />
        <Text style={styles.sectionLabel}>Examination</Text>
        <ChoiceRow options={data?.examTypes ?? []} selected={examType} onSelect={setExamType} />
        <Text style={styles.sectionLabel}>Results term / promotion ledger</Text>
        <ChoiceRow options={data?.promotionTerms ?? []} selected={examTerm} onSelect={setExamTerm} />
      </>}
      {module === 'calendar' && <DarkInput label="Calendar month (YYYY-MM)" value={month} onChangeText={setMonth} />}
      {module === 'timetable' && <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>Edit your timetable</Text>
        <DarkInput label="Day (0 Sunday – 6 Saturday)" value={timetableDay} onChangeText={setTimetableDay} keyboardType="number-pad" />
        <DarkInput label="Period" value={timetablePeriod} onChangeText={setTimetablePeriod} keyboardType="number-pad" />
        <DarkInput label="Room (optional)" value={timetableRoom} onChangeText={setTimetableRoom} />
        <ActionButton label="Save timetable slot" icon="save" disabled={!canWrite || !selectedScope || !subject.trim()}
          onPress={() => { void submit('save', { dayOfWeek: Number(timetableDay), period: Number(timetablePeriod),
            className: selectedScope?.className, section: selectedScope?.section, subject: subject.trim(), room: timetableRoom.trim() || null,
          }, 'Timetable slot saved.', false); }} />
      </View>}

      {module === 'attendance' && <View style={styles.formCard}>
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Class register</Text>
          <Text style={styles.muted}>{data?.entries?.length ?? 0} students</Text></View>
        {data?.entries?.length
          ? data.entries.map((entry) => {
            const status = attendanceStatuses[Number(entry.studentId)] ?? (entry.status !== 'not-marked' ? String(entry.status ?? '') : '');
            const locked = Number(entry.editCount ?? 0) >= 3;
            return <Pressable key={entry.studentId} accessibilityRole="button" accessibilityState={{ disabled: locked }}
              accessibilityLabel={`${entry.name}, ${statusLabel(status)}${locked ? ', edit limit reached' : '; select next status'}`}
              disabled={locked} onPress={() => setStudentStatus(Number(entry.studentId), status)}
              style={styles.attendanceRow}>
              <View style={styles.studentAvatar}><Text style={styles.avatarLetter}>{String(entry.name ?? '?').slice(0, 1).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}><Text style={styles.rowTitle}>{String(entry.name)}</Text><Text style={styles.muted}>{String(entry.dsid ?? '')}</Text></View>
              <View style={styles.statusColumn}>
                <Text style={[styles.statusPill, status ? styles.statusMarked : styles.statusEmpty]}>{statusLabel(status)}</Text>
                <Text style={styles.attemptsText}>{Number(entry.editCount ?? 0)}/3 edits</Text>
              </View>
            </Pressable>;
          })
          : !query.isPending && <Text style={styles.muted}>No students are enrolled in this class for the selected session.</Text>}
        {!!data?.entries?.length && <ActionButton label={busyAction === 'submit' ? 'Saving…' : 'Save attendance'} icon="check-circle"
          disabled={!canWrite || busyAction === 'submit' || !Object.keys(attendanceStatuses).length}
          onPress={() => { void submit('submit', { className: selectedScope?.className, section: selectedScope?.section, date: attendanceDate, records: Object.entries(attendanceStatuses).map(([studentId, status]) => ({ studentId: Number(studentId), status })) }, 'Attendance saved.', false); }} />}
      </View>}
      {module === 'attendance' && data?.selfAttendance && <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>Your attendance today</Text>
        <Text style={styles.muted}>{data.selfAttendance.today?.status ?? 'Not checked in'} ·
          {data.selfAttendance.today?.checkInTime ? ` In ${formatSchoolInstant(String(data.selfAttendance.today.checkInTime))}` : ''}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><ActionButton label="Check in" icon="log-in" disabled={!canWrite || !!data.selfAttendance.today?.checkInTime}
            onPress={() => { void selfAttendanceAction('self-check-in'); }} /></View>
          <View style={{ flex: 1 }}><ActionButton label="Check out" icon="log-out" secondary disabled={!canWrite || !data.selfAttendance.today?.checkInTime || !!data.selfAttendance.today?.checkOutTime}
            onPress={() => { void selfAttendanceAction('self-check-out'); }} /></View>
        </View>
        <Text style={styles.muted}>Rate: {String(data.selfAttendance.rate?.attendanceRate ?? 0)}% · {String(data.selfAttendance.rate?.applicableDays ?? 0)} applicable days</Text>
        {(data.selfAttendance.history ?? []).slice(0, 10).map((entry: Item) => <Text key={entry.id} style={styles.muted}>
          {String(entry.attendanceDate)} · {String(entry.status)}
        </Text>)}
      </View>}

      {(module === 'homework' || module === 'classwork') && <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>{editingItemId ? 'Edit' : 'New'} {module === 'homework' ? 'homework' : 'classwork'}</Text>
        <DarkInput label="Subject" value={subject} onChangeText={setSubject} />
        {module === 'homework' && <DarkInput label="Due date (YYYY-MM-DD)" value={dueDate} onChangeText={setDueDate} />}
        <DarkInput label="Instructions" value={content} onChangeText={setContent} multiline />
        <ActionButton label={pickedFile ? `Attachment · ${pickedFile.name}` : 'Choose attachment (PDF or image)'} icon="paperclip" secondary
          disabled={!canWrite} onPress={() => { void chooseAttachment('document'); }} />
        <ActionButton label={busyAction ? 'Saving…' : editingItemId ? 'Save assignment changes' : module === 'homework' ? 'Assign homework' : 'Add classwork'}
          icon={editingItemId ? 'save' : 'plus-circle'} disabled={!canWrite || !content.trim() || !subject.trim()}
          onPress={() => {
            const fields: Record<string, string | number> = editingItemId
              ? { itemId: editingItemId, content: content.trim(), subject: subject.trim() }
              : { className: selectedScope?.className ?? '', section: selectedScope?.section ?? '', subject: subject.trim(), content: content.trim() };
            if (module === 'homework' && dueDate.trim()) fields.dueDate = dueDate.trim();
            void submitWithAttachment(editingItemId ? 'edit' : 'create', fields,
              `${definitions[module].title} ${editingItemId ? 'updated' : 'saved'}.`, false);
            setEditingItemId(null);
          }} />
        {editingItemId ? <ActionButton label="Cancel edit" icon="x" secondary onPress={() => {
          setEditingItemId(null); setContent(''); setPickedFile(null); setDueDate('');
        }} /> : null}
        {(items ?? []).map((item, index) => <View key={item.id ?? index} style={styles.studentLeaveCard}>
          <RecordCard item={item} index={index} />
          {typeof item.fileUrl === 'string'
            ? <ActionButton label="Open attachment" icon="download" secondary onPress={() => { void openAttachment(item.fileUrl); }} /> : null}
          {item.canEdit && <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><ActionButton label="Edit" icon="edit-2" secondary disabled={!canWrite} onPress={() => {
              setEditingItemId(Number(item.id)); setContent(String(item.content ?? '')); setSubject(String(item.subject ?? ''));
              setDueDate(String(item.dueDate ?? '')); setPickedFile(null);
            }} /></View>
            <View style={{ flex: 1 }}><ActionButton label="Delete" icon="trash-2" secondary disabled={!canWrite} onPress={() => Alert.alert(
              'Delete assignment?', 'This will remove the assignment for the selected session.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => { void submit('delete', { itemId: Number(item.id) }, 'Assignment deleted.', false); } },
              ],
            )} /></View>
          </View>}
        </View>)}
      </View>}

      {module === 'noticeboard' && <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>Post a notice</Text>
        <ChoiceRow options={['student', 'whole_school']} selected={noticeTarget} onSelect={(value) => setNoticeTarget(value as 'student' | 'whole_school')} />
        {noticeTarget === 'student' && selectedScope && <Text style={styles.muted}>Student audience · Class {selectedScope.className}{selectedScope.section}</Text>}
        <DarkInput label="Notice type" value={noticeType} onChangeText={setNoticeType} />
        <DarkInput label="Notice content" value={content} onChangeText={setContent} multiline />
        <ActionButton label={pickedFile ? `Attachment · ${pickedFile.name}` : 'Choose private attachment'} icon="paperclip" secondary
          disabled={!canWrite} onPress={() => { void chooseAttachment('document'); }} />
        <ActionButton label={busyAction ? 'Posting…' : 'Post notice'} icon="send" disabled={!canWrite || !content.trim()}
          onPress={() => { void submitWithAttachment('create', { content: content.trim(), targetType: noticeTarget,
            ...(noticeTarget === 'student' && selectedScope ? { className: selectedScope.className, section: selectedScope.section } : {}),
            noticeType: noticeType.trim() || 'Routine' }, 'Notice posted.', false); }} />
      </View>}

      {module === 'complaint' && <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>Raise a complaint</Text>
        <ChoiceRow options={['teacher-to-admin', 'teacher-to-student']} selected={complaintType} onSelect={(value) => setComplaintType(value as typeof complaintType)} />
        {complaintType === 'teacher-to-student' && <View style={{ gap: 7 }}>
          <Text style={styles.fieldLabel}>Assigned student</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>
            {(data?.students ?? []).filter((student) => !selectedScope
              || (student.className === selectedScope.className && student.section === selectedScope.section)).map((student) => <Pressable key={student.id}
              accessibilityRole="button" accessibilityState={{ selected: selectedStudentId === Number(student.id) }}
              onPress={() => setSelectedStudentId(Number(student.id))}
              style={[styles.scopeChip, selectedStudentId === Number(student.id) && styles.scopeChipSelected]}>
              <Text style={[styles.scopeChipText, selectedStudentId === Number(student.id) && styles.scopeChipTextSelected]}>{String(student.name)} · {String(student.dsid ?? '')}</Text>
            </Pressable>)}
          </ScrollView>
        </View>}
        <DarkInput label="Complaint details" value={content} onChangeText={setContent} multiline />
        <ActionButton label={pickedFile ? `Attachment · ${pickedFile.name}` : 'Choose private attachment'} icon="paperclip" secondary
          disabled={!canWrite} onPress={() => { void chooseAttachment('document'); }} />
        <ActionButton label={busyAction ? 'Submitting…' : 'Submit complaint'} icon="send"
          disabled={!canWrite || !content.trim() || (complaintType === 'teacher-to-student' && !selectedStudentId)}
          onPress={() => { void submitWithAttachment('create', { complaintType, content: content.trim(),
            ...(complaintType === 'teacher-to-student' && selectedStudentId ? {
              studentId: selectedStudentId, className: selectedScope?.className, section: selectedScope?.section,
            } : {}) }, 'Complaint submitted.', false); }} />
      </View>}

      {module === 'leave' && <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>Apply for leave</Text>
        {!(data?.policies?.length) && <Text style={styles.errorText}>No active leave policies are configured for teachers. Contact your administrator before applying.</Text>}
        <Text style={styles.fieldLabel}>Available leave policy</Text>
        <ChoiceRow options={(data?.policies ?? []).map((policy) => String(policy.name))}
          selected={data?.policies?.find((policy) => policy.id === leavePolicyId)?.name ?? leaveType}
          onSelect={(label) => {
            const policy = data?.policies?.find((candidate) => String(candidate.name) === label);
            setLeavePolicyId(policy?.id);
            setLeaveType(String(policy?.name ?? label.split(' · ')[0] ?? ''));
          }} />
        <DarkInput label="Leave type" value={leaveType} onChangeText={setLeaveType} />
        <DarkInput label="Start date (YYYY-MM-DD)" value={startDate} onChangeText={setStartDate} />
        <DarkInput label="End date (YYYY-MM-DD)" value={endDate} onChangeText={setEndDate} />
        <DarkInput label="Reason" value={content} onChangeText={setContent} multiline />
        <ActionButton label={busyAction ? 'Submitting…' : 'Submit leave request'} icon="send"
          disabled={!canWrite || !leavePolicyId || !leaveType.trim() || !content.trim() || !(data?.policies?.length)}
          onPress={() => { void submit('apply', { leaveType: leaveType.trim(), startDate, endDate, reason: content.trim(),
            ...(leavePolicyId ? { policyId: leavePolicyId } : {}) }, 'Leave request submitted.'); }} />
        {data?.balance && <Text style={styles.muted}>Leave balance · {Object.entries(data.balance).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')}</Text>}
      </View>}

      {module === 'leave' && <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>Student leave requests</Text>
        <Text style={styles.muted}>Review requests from students in your assigned classes. Approval syncs student attendance for the covered dates.</Text>
        <DarkInput label="Teacher review note (optional)" value={reviewNote} onChangeText={setReviewNote} multiline />
        {data?.studentItems?.length
          ? data.studentItems.map((item, index) => <View key={item.id ?? index} style={styles.studentLeaveCard}>
            <Text style={styles.cardTitle}>{String(item.studentName)} · Class {String(item.class)}{String(item.section)}</Text>
            <Text style={styles.muted}>{String(item.leaveType ?? 'Leave')} · {formatSchoolDate(String(item.startDate))} – {formatSchoolDate(String(item.endDate))}</Text>
            <Text style={styles.muted}>{String(item.reason ?? '')}</Text>
            <View style={{ gap: 8 }}>
              <ActionButton label={`Approve ${String(item.studentName)}`} icon="check-circle" disabled={!canWrite}
                onPress={() => { void submit('approve-student', { leaveId: Number(item.id), note: reviewNote.trim() || undefined }, 'Student leave approved and attendance updated.', false); }} />
              <ActionButton label="Forward to school administrator" icon="corner-up-right" secondary disabled={!canWrite}
                onPress={() => { void submit('forward-student', { leaveId: Number(item.id), note: reviewNote.trim() || undefined }, 'Student leave forwarded for final approval.', false); }} />
              <ActionButton label="Reject student leave" icon="x-circle" secondary disabled={!canWrite}
                onPress={() => { void submit('reject-student', { leaveId: Number(item.id), note: reviewNote.trim() || undefined }, 'Student leave rejected.', false); }} />
            </View>
          </View>)
          : !query.isPending && <Text style={styles.muted}>No student leave requests are awaiting your review in the selected session.</Text>}
        <Text style={styles.sectionLabel}>Your student-leave decisions</Text>
        {(data?.studentHistory ?? []).map((item, index) => <RecordCard key={item.id ?? index} item={item} index={index} />)}
      </View>}

      {module === 'student-profiles' && <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>Pending student profiles</Text>
        <DarkInput label="Review note (optional)" value={reviewNote} onChangeText={setReviewNote} />
        {data?.items?.length
          ? data.items.map((item, index) => <View key={item.studentId ?? index} style={styles.studentLeaveCard}>
            <RecordCard item={item} index={index} />
            {profileReviewId === Number(item.studentId) && <>
              <Text style={styles.sectionLabel}>Current vs requested</Text>
              {['fullName', 'rollNo', 'phone', 'class', 'section', 'presentAddress'].map((field) => <View key={field}>
                <Text style={styles.muted}>{field} · current: {String(item.currentVerifiedProfile ? (() => {
                  try { return JSON.parse(String(item.currentVerifiedProfile))[field]; } catch { return ''; }
                })() : '')}</Text>
                <DarkInput label={`Requested ${field}`} value={profileEdits[field] ?? String(item[field] ?? '')}
                  onChangeText={(value) => setProfileEdits((current) => ({ ...current, [field]: value }))} />
              </View>)}
              <Text style={styles.muted}>Photo status · current: {String(item.photoStatus ?? 'unknown')} · requested: {item.photoUrl ? 'pending' : 'none'}</Text>
            </>}
            <ActionButton label={profileReviewId === Number(item.studentId) ? 'Approve edited profile' : 'Review details'} icon={profileReviewId === Number(item.studentId) ? 'check' : 'eye'}
              disabled={!canWrite} onPress={() => {
                if (profileReviewId === Number(item.studentId)) {
                  void submit('approve', { studentId: Number(item.studentId), corrections: profileEdits }, 'Student profile approved.', false);
                  setProfileReviewId(null); setProfileEdits({});
                } else {
                  let current: Item = {};
                  try { current = item.currentVerifiedProfile ? JSON.parse(String(item.currentVerifiedProfile)) : {}; } catch { current = {}; }
                  const fields = ['fullName', 'rollNo', 'phone', 'class', 'section', 'presentAddress'];
                  setProfileReviewId(Number(item.studentId));
                  setProfileEdits(Object.fromEntries(fields.map((field) => [field, String(item[field] ?? current[field] ?? '')])));
                }
              }} />
          </View>)
          : <Text style={styles.muted}>No student profile changes are awaiting review for your assigned classes.</Text>}
        {data?.items?.length ? <View style={{ gap: 9 }}>{data.items.map((item, index) => <ActionButton key={`reject-${item.studentId ?? index}`}
          label={`Return profile ${String(item.studentName ?? index + 1)}`} icon="corner-up-left" secondary
          disabled={!canWrite} onPress={() => { void submit('reject', { studentId: Number(item.studentId), note: reviewNote.trim() || 'Returned for correction.' }, 'Student profile returned for correction.', false); }} />)}</View> : null}
        <Text style={styles.sectionLabel}>Recent approvals</Text>
        {(data?.history ?? []).map((item, index) => <RecordCard key={item.studentId ?? index} item={item} index={index} />)}
        {!!data?.items?.length && <ActionButton label="Approve all pending profiles" icon="check-circle" secondary
          disabled={!canWrite} onPress={() => { void submit('approve-all', {}, 'Pending student profiles approved.', false); }} />}
      </View>}

      {module === 'examination' && selectedScope && <View style={styles.card}>
        <Text style={styles.sectionTitle}>Enter scores · {selectedScope.className}{selectedScope.section}</Text>
        <Text style={styles.muted}>{examSubject || 'Choose a subject'} · {examType || 'Choose an exam type'}</Text>
        <DarkInput label="Total marks" value={examTotalMarks} onChangeText={setExamTotalMarks} keyboardType="numeric" />
        {(data?.students ?? []).map((student) => {
          const id = Number(student.studentId);
          return <View key={id} style={styles.attendanceRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{String(student.name)}</Text>
              <Text style={styles.muted}>{String(student.dsid ?? '')}</Text>
            </View>
            <TextInput accessibilityLabel={`Marks for ${String(student.name)}`}
              style={[styles.input, { minHeight: 42, width: 80, textAlign: 'center' }]}
              keyboardType="numeric" editable={canWrite && !examAbsentees[id]}
              value={examMarks[id] ?? ''} onChangeText={(value) => setExamMarks((current) => ({ ...current, [id]: value.replace(/[^0-9]/g, '') }))} />
            <Pressable accessibilityRole="button" accessibilityState={{ selected: !!examAbsentees[id] }}
              disabled={!canWrite} onPress={() => setExamAbsentees((current) => ({ ...current, [id]: !current[id] }))}
              style={[styles.scopeChip, examAbsentees[id] && styles.scopeChipSelected]}>
              <Text style={[styles.scopeChipText, examAbsentees[id] && styles.scopeChipTextSelected]}>Absent</Text>
            </Pressable>
          </View>;
        })}
        {!!data?.students?.length && <ActionButton label="Save scores" icon="save"
          disabled={!canWrite || !examSubject || !examType || !Number.isInteger(Number(examTotalMarks)) || Number(examTotalMarks) < 1
            || data.students.some((student) => !examAbsentees[Number(student.studentId)]
              && examMarks[Number(student.studentId)] !== undefined
              && Number(examMarks[Number(student.studentId)]) > Number(examTotalMarks))}
          onPress={() => {
            const scores = (data.students ?? []).filter((student) => examAbsentees[Number(student.studentId)]
              || (examMarks[Number(student.studentId)] !== undefined && examMarks[Number(student.studentId)] !== ''))
              .map((student) => ({ studentId: Number(student.studentId), marks: Number(examMarks[Number(student.studentId)] || 0), isAbsent: !!examAbsentees[Number(student.studentId)] }));
            if (!scores.length) { Alert.alert('Scores required', 'Enter at least one score or mark a student absent.'); return; }
            void submit('save-scores', { className: selectedScope.className, section: selectedScope.section,
              subject: examSubject, examType, totalMarks: Number(examTotalMarks), scores }, 'Examination scores saved.', false);
          }} />}
        {items.some((item) => item.published) && <Text style={styles.muted}>Results have been published for this examination.</Text>}
        {!!items.length && <ActionButton label="Publish results" icon="send" secondary disabled={!canWrite || items.every((item) => item.published)}
          onPress={() => Alert.alert('Publish examination results?', 'Published scores become visible to students and families.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Publish', onPress: () => { void submit('publish-scores', {
              className: selectedScope.className, section: selectedScope.section, examType,
            }, 'Examination results published.', false); } },
          ])} />}
        {!data?.students?.length && !query.isPending && <Text style={styles.muted}>No students are enrolled in this class for the selected session.</Text>}
      </View>}

      {module === 'examination' && selectedScope && <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>Promotion ledger · {examTerm || 'Select a configured term'}</Text>
        <Text style={styles.muted}>Lock status is read and updated only for this assigned class, section, configured term, and selected academic session.</Text>
        {(data?.promotionDecisions ?? []).length
          ? <>
            <Text style={styles.muted}>{(data?.promotionDecisions ?? []).length} saved promotion decision(s) ·
              {(data?.promotionDecisions ?? []).some((entry) => entry.locked) ? ' Locked' : ' Draft / unlocked'}</Text>
            <ActionButton
              label={(data?.promotionDecisions ?? []).some((entry) => entry.locked) ? 'Unlock saved promotion ledger' : 'Lock saved promotion ledger'}
              icon={(data?.promotionDecisions ?? []).some((entry) => entry.locked) ? 'unlock' : 'lock'}
              secondary={!((data?.promotionDecisions ?? []).some((entry) => entry.locked))}
              disabled={!canWrite || !examTerm}
              onPress={() => {
                const locked = !(data?.promotionDecisions ?? []).some((entry) => entry.locked);
                Alert.alert(locked ? 'Lock promotion ledger?' : 'Unlock promotion ledger?',
                  locked ? 'This freezes the saved decisions for the selected session.' : 'This makes the saved ledger editable again.',
                  [{ text: 'Cancel', style: 'cancel' }, { text: locked ? 'Lock' : 'Unlock', onPress: () => {
                    void submit('toggle-promotion-lock', {
                      className: selectedScope.className, section: selectedScope.section, term: examTerm, locked,
                    }, locked ? 'Promotion ledger locked.' : 'Promotion ledger unlocked.', false);
                  } }],
                );
              }} />
          </>
          : <Text style={styles.muted}>There are no saved promotion decisions for this term and session. Create the decisions in Results before locking or unlocking the ledger.</Text>}
        <ActionButton label="Export results CSV" icon="download" secondary
          disabled={!online || !examTerm || !(items.length || (data?.promotionDecisions ?? []).length)}
          onPress={() => { void exportResultsCsv(); }} />
      </View>}

      {module === 'calendar' && <View style={styles.card}>
        <Text style={styles.sectionTitle}>School events · {calendarView === 'year' ? calendarCursor.slice(0, 4) : calendarView}</Text>
        <ChoiceRow options={['month', 'week', 'year']} selected={calendarView} onSelect={(value) => {
          setCalendarView(value as typeof calendarView); setCalendarDay(null);
        }} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><ActionButton label="Previous" icon="chevron-left" secondary onPress={() => {
            const date = new Date(`${calendarCursor}T12:00:00Z`);
            date.setUTCDate(date.getUTCDate() - (calendarView === 'year' ? 365 : calendarView === 'week' ? 7 : 30));
            setCalendarCursor(date.toISOString().slice(0, 10)); setMonth(date.toISOString().slice(0, 7));
          }} /></View>
          <View style={{ flex: 1 }}><ActionButton label="Today" icon="calendar" secondary onPress={() => {
            const today = istToday(); setCalendarCursor(today); setMonth(today.slice(0, 7)); setCalendarDay(today);
          }} /></View>
          <View style={{ flex: 1 }}><ActionButton label="Next" icon="chevron-right" secondary onPress={() => {
            const date = new Date(`${calendarCursor}T12:00:00Z`);
            date.setUTCDate(date.getUTCDate() + (calendarView === 'year' ? 365 : calendarView === 'week' ? 7 : 30));
            setCalendarCursor(date.toISOString().slice(0, 10)); setMonth(date.toISOString().slice(0, 7));
          }} /></View>
        </View>
        <DarkInput label="Calendar month/date (YYYY-MM-DD)" value={calendarCursor} onChangeText={(value) => {
          setCalendarCursor(value); if (/^\d{4}-\d{2}-\d{2}$/.test(value)) setMonth(value.slice(0, 7));
        }} />
        {calendarDay && <Text style={styles.muted}>Day details · {calendarDay}</Text>}
        {calendarItems.length ? calendarItems.map((item, index) => <Pressable key={item.id ?? index} onPress={() => setCalendarDay(String(item.date).slice(0, 10))}>
          <RecordCard item={item} index={index} />
        </Pressable>)
          : <Text style={styles.muted}>No school calendar events are listed for this month.</Text>}
      </View>}

      {(module === 'noticeboard'
        || module === 'leave'
        || module === 'faculty-info' || module === 'timetable') && <View style={styles.listBlock}>
        <Text style={styles.sectionTitle}>{module === 'leave' ? 'Leave requests'
            : module === 'faculty-info' ? 'Faculty directory'
                : module === 'timetable' ? 'Your timetable'
                    : module === 'noticeboard' ? 'School notices'
                      : `Assigned ${module}`}</Text>
        {items.length ? items.map((item, index) => <View key={item.id ?? index}>
          <RecordCard item={item} index={index} />
          {module === 'timetable' && <ActionButton label="Delete slot" icon="trash-2" secondary disabled={!canWrite}
            onPress={() => Alert.alert('Delete timetable slot?', 'Remove this selected-session slot?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => { void submit('delete', {
                dayOfWeek: Number(item.dayOfWeek), period: Number(item.period),
                className: String(item.class), section: String(item.section),
              }, 'Timetable slot deleted.', false); } },
            ])} />}
          {module === 'noticeboard' && item.createdById === user.id && item.creatorRole === 'teacher' && <>
            {typeof item.fileUrl === 'string' && <ActionButton label="Open private attachment" icon="download" secondary
              onPress={() => { void openAttachment(item.fileUrl); }} />}
            {noticeEditingId === Number(item.id) && <DarkInput label="Edit notice content" value={noticeEditContent} onChangeText={setNoticeEditContent} multiline />}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><ActionButton label={noticeEditingId === Number(item.id) ? 'Save notice' : 'Edit notice'} icon={noticeEditingId === Number(item.id) ? 'save' : 'edit-2'} secondary
                disabled={!canWrite || (noticeEditingId === Number(item.id) && !noticeEditContent.trim())}
                onPress={() => {
                  if (noticeEditingId === Number(item.id)) {
                    void submit('edit', { noticeId: Number(item.id), content: noticeEditContent.trim() }, 'Notice updated.', false);
                    setNoticeEditingId(null);
                  } else {
                    setNoticeEditingId(Number(item.id)); setNoticeEditContent(String(item.content ?? ''));
                  }
                }} /></View>
              <View style={{ flex: 1 }}><ActionButton label="Delete notice" icon="trash-2" secondary disabled={!canWrite}
                onPress={() => Alert.alert('Delete notice?', 'This teacher-owned notice will be removed.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => { void submit('delete', { noticeId: Number(item.id) }, 'Notice deleted.', false); } },
                ])} /></View>
            </View>
          </>}
        </View>)
          : !query.isPending && <EmptyCard title={`No ${definition.title.toLowerCase()} records`} detail="There are no matching records in the selected Academic Session." />}
      </View>}

      {module === 'gallery' && <>
        <View style={styles.formCard}>
          <Text style={styles.sectionTitle}>Submit a school photo for approval</Text>
          <DarkInput label="Photo title" value={galleryTitle} onChangeText={setGalleryTitle} />
          <DarkInput label="Event name (optional)" value={galleryEvent} onChangeText={setGalleryEvent} />
          <DarkInput label="Description (optional)" value={content} onChangeText={setContent} multiline />
          <ActionButton label={pickedFile ? `Image · ${pickedFile.name}` : 'Choose photo (JPG, PNG, WebP)'} icon="image" secondary
            disabled={!canWrite} onPress={() => { void chooseAttachment('image'); }} />
          <ActionButton label={busyAction === 'upload' ? 'Uploading…' : 'Submit photo for approval'} icon="upload"
            disabled={!canWrite || !galleryTitle.trim() || !pickedFile} onPress={() => { void submitWithAttachment('upload', {
              title: galleryTitle.trim(), ...(galleryEvent.trim() ? { eventTag: galleryEvent.trim() } : {}),
              ...(content.trim() ? { description: content.trim() } : {}),
            }, 'Photo submitted for school approval.', true); }} />
        </View>
        <View style={styles.listBlock}>
          <Text style={styles.sectionTitle}>My gallery submissions</Text>
          {(data?.myUploads ?? []).length ? (data?.myUploads ?? []).map((item, index) => <View key={item.id ?? index} style={styles.studentLeaveCard}>
            <RecordCard item={item} index={index} />
            <Text style={styles.muted}>{item.approved ? 'Approved' : 'Awaiting approval'}</Text>
            {typeof item.imageUrl === 'string'
              ? <ActionButton label="Open photo" icon="download" secondary onPress={() => { void openAttachment(item.imageUrl); }} /> : null}
          </View>) : <Text style={styles.muted}>No gallery uploads yet.</Text>}
          <Text style={styles.sectionTitle}>Approved school gallery</Text>
          {(data?.items ?? []).length ? (data?.items ?? []).map((item, index) => <View key={item.id ?? index} style={styles.studentLeaveCard}>
            <RecordCard item={item} index={index} />
            {typeof item.imageUrl === 'string'
              ? <ActionButton label="View photo" icon="image" secondary onPress={() => { void showGalleryItem(index); }} /> : null}
          </View>) : <Text style={styles.muted}>No approved school photos are available.</Text>}
        </View>
      </>}

      <Modal visible={module === 'gallery' && lightboxIndex !== null} transparent animationType="fade"
        onRequestClose={() => { setLightboxIndex(null); setLightboxUri(null); }}>
        <View style={styles.lightboxBackdrop}>
          <View style={styles.lightboxPanel}>
            <View style={styles.lightboxHeader}>
              <Text style={styles.sectionTitle}>Gallery detail</Text>
              <Pressable accessibilityLabel="Close gallery detail" onPress={() => { setLightboxIndex(null); setLightboxUri(null); }}>
                <Feather name="x" size={24} color="#fff" />
              </Pressable>
            </View>
            {lightboxIndex !== null && galleryItems[lightboxIndex] && <>
              {lightboxUri ? <Image source={{ uri: lightboxUri }} style={styles.lightboxImage} resizeMode="contain" />
                : <View style={styles.lightboxLoading}><ActivityIndicator color="#fff" /><Text style={styles.muted}>Loading private photo…</Text></View>}
              <Text style={styles.cardTitle}>{String(galleryItems[lightboxIndex].title ?? 'School gallery')}</Text>
              <Text style={styles.muted}>{String(galleryItems[lightboxIndex].date ?? galleryItems[lightboxIndex].createdAt ?? '')}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}><ActionButton label="Previous" icon="chevron-left" secondary disabled={lightboxIndex <= 0}
                  onPress={() => { void showGalleryItem(lightboxIndex - 1); }} /></View>
                <View style={{ flex: 1 }}><ActionButton label="Next" icon="chevron-right" secondary disabled={lightboxIndex >= galleryItems.length - 1}
                  onPress={() => { void showGalleryItem(lightboxIndex + 1); }} /></View>
              </View>
            </>}
          </View>
        </View>
      </Modal>

      {module === 'complaint' && <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>Your complaints and discussion</Text>
        <DarkInput label="Complaint update / resolution note" value={reviewNote} onChangeText={setReviewNote} multiline />
        {(data?.items ?? []).length ? (data?.items ?? []).map((item, index) => <View key={item.id ?? index} style={styles.studentLeaveCard}>
          <RecordCard item={item} index={index} />
          {typeof item.fileUrl === 'string' && <ActionButton label="Open private attachment" icon="download" secondary
            onPress={() => { void openAttachment(item.fileUrl); }} />}
          {(item.notes ?? []).map((note: Item, noteIndex: number) => <Text key={note.id ?? noteIndex} style={styles.muted}>
            {String(note.authorName ?? 'Staff')} · {formatSchoolInstant(String(note.createdAt ?? ''))}: {String(note.content ?? '')}
          </Text>)}
          {item.status === 'Pending' && <ActionButton label="Add update" icon="message-circle" secondary
            disabled={!canWrite || !reviewNote.trim()} onPress={() => { void submit('add-note', {
              complaintId: Number(item.id), content: reviewNote.trim(),
            }, 'Complaint update added.', false); }} />}
          {item.status === 'Pending' && <ActionButton label="Delete pending complaint" icon="trash-2" secondary disabled={!canWrite}
            onPress={() => Alert.alert('Delete complaint?', 'This pending complaint will be removed from your active list.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => { void submit('delete', { complaintId: Number(item.id) }, 'Complaint deleted.', false); } },
            ])} />}
          {item.complaintType === 'teacher-to-student' && item.status !== 'Resolved' && <ActionButton label="Mark resolved" icon="check-circle"
            disabled={!canWrite} onPress={() => { void submit('self-resolve', { complaintId: Number(item.id) }, 'Complaint marked resolved.', false); }} />}
        </View>) : <Text style={styles.muted}>No complaints have been filed in this session.</Text>}
      </View>}

      {module === 'library' && <>
        <View style={styles.formCard}>
          <Text style={styles.sectionTitle}>Upload an e-book for approval</Text>
          <DarkInput label="Book title" value={ebookTitle} onChangeText={setEbookTitle} />
          <DarkInput label="Author" value={ebookAuthor} onChangeText={setEbookAuthor} />
          <Text style={styles.fieldLabel}>Optional class visibility</Text>
          <ChoiceRow options={['All assigned classes', ...scopes.map((scope) => scope.className)]}
            selected={ebookTargetClass || 'All assigned classes'} onSelect={(value) =>
              setEbookTargetClass(value === 'All assigned classes' ? '' : value)} />
          <ActionButton label={pickedFile ? `PDF · ${pickedFile.name}` : 'Choose PDF e-book'} icon="paperclip" secondary
            disabled={!canWrite} onPress={() => { void chooseAttachment('ebook'); }} />
          <ActionButton label={busyAction === 'upload-ebook' ? 'Uploading…' : 'Submit e-book for approval'} icon="upload"
            disabled={!canWrite || !ebookTitle.trim() || !ebookAuthor.trim() || !pickedFile}
            onPress={() => { void submitWithAttachment('upload-ebook', {
              title: ebookTitle.trim(), author: ebookAuthor.trim(),
              ...(ebookTargetClass ? { targetClass: ebookTargetClass } : {}),
            }, 'E-book submitted for school approval.', true); }} />
          <Text style={styles.muted}>Uploads are private until approved and available only to the uploader or eligible school readers.</Text>
        </View>
        <View style={styles.listBlock}>
          <Text style={styles.sectionTitle}>My e-book uploads</Text>
          {(data?.myEbooks ?? []).length ? (data?.myEbooks ?? []).map((book, index) => <View key={book.id ?? index} style={styles.studentLeaveCard}>
            <RecordCard item={book} index={index} />
            <Text style={styles.muted}>Review status · {String(book.verificationStatus ?? 'pending')}</Text>
            {typeof book.fileUrl === 'string'
              ? <ActionButton label="Open e-book" icon="download" secondary onPress={() => { void openAttachment(book.fileUrl); }} /> : null}
          </View>) : <Text style={styles.muted}>You have not uploaded an e-book.</Text>}
        </View>
        <View style={styles.formCard}>
          <Text style={styles.sectionTitle}>My borrowed books</Text>
          {(data?.myBooks ?? []).length ? (data?.myBooks ?? []).map((borrow, index) => <View key={borrow.id ?? index} style={styles.studentLeaveCard}>
            <Text style={styles.cardTitle}>{String(borrow.bookTitle ?? 'Library book')}</Text>
            <Text style={styles.muted}>{String(borrow.bookAuthor ?? '')}</Text>
            <ActionButton label="Return book" icon="corner-up-left" secondary disabled={!canWrite}
              onPress={() => { void submit('return', { borrowId: Number(borrow.id) }, 'Book returned.', false); }} />
          </View>) : <Text style={styles.muted}>You have no books checked out.</Text>}
        </View>
        <View style={styles.listBlock}>
          <Text style={styles.sectionTitle}>Approved library collection</Text>
          <DarkInput label="Search title, author, or category" value={librarySearch} onChangeText={setLibrarySearch} />
          {(data?.items ?? []).filter((book) => {
            const q = librarySearch.trim().toLocaleLowerCase();
            return !q || [book.title, book.author, book.category].some((value) => String(value ?? '').toLocaleLowerCase().includes(q));
          }).length ? (data?.items ?? []).filter((book) => {
            const q = librarySearch.trim().toLocaleLowerCase();
            return !q || [book.title, book.author, book.category].some((value) => String(value ?? '').toLocaleLowerCase().includes(q));
          }).map((book, index) => <View key={book.id ?? index} style={styles.studentLeaveCard}>
            <RecordCard item={book} index={index} />
            <Text style={styles.muted}>{Number(book.availableCopies ?? 0)} copies available</Text>
            {typeof book.fileUrl === 'string'
              ? <ActionButton label="Open e-book" icon="download" secondary onPress={() => { void openAttachment(book.fileUrl); }} /> : null}
            <ActionButton label="Borrow book" icon="book-open" disabled={!canWrite || Number(book.availableCopies ?? 0) < 1
              || (data?.myBooks ?? []).some((borrow) => Number(borrow.bookId) === Number(book.id))}
              onPress={() => { void submit('borrow', { bookId: Number(book.id) }, 'Book checked out.', false); }} />
          </View>) : !query.isPending && <EmptyCard title="No library books available" detail="There are no approved books matching the search and assigned-class visibility." />}
        </View>
      </>}

      {module === 'complaint' && <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>Assigned-class student reports</Text>
        <DarkInput label="Resolution remarks" value={complaintResolution} onChangeText={setComplaintResolution} multiline />
        {(data?.classFeed ?? []).length ? (data?.classFeed ?? []).map((item, index) => <View key={item.id ?? index} style={styles.studentLeaveCard}>
          <RecordCard item={item} index={index} />
          <ActionButton label="Resolve report" icon="check-circle" secondary
            disabled={!canWrite || item.status === 'Resolved' || !complaintResolution.trim()}
            onPress={() => { void submit('resolve-peer', { complaintId: Number(item.id), resolutionRemarks: complaintResolution.trim() }, 'Student report resolved.', false); }} />
        </View>) : <Text style={styles.muted}>No peer reports are listed for your assigned classes in this session.</Text>}
      </View>}

      {query.isPending && <View style={styles.state}><ActivityIndicator color={teacherColors.teal} /><Text style={styles.muted}>Loading {definition.title.toLowerCase()}…</Text></View>}
      {query.isError && <View style={styles.errorCard}><Feather name="alert-circle" size={22} color={teacherColors.coral} />
        <Text style={styles.cardTitle}>Unable to load {definition.title.toLowerCase()}</Text>
        <Text style={styles.muted}>{query.error instanceof Error ? query.error.message : 'Try again.'}</Text>
        <ActionButton label="Try again" icon="refresh-cw" onPress={() => { void query.refetch(); }} secondary />
      </View>}
      {!!actionError && <Pressable accessibilityRole="alert" onPress={() => setActionError('')} style={styles.errorCard}>
        <Text style={styles.errorText}>{actionError} · Dismiss</Text>
      </Pressable>}
      {busy && <View accessibilityRole="progressbar" style={styles.busyRow}><ActivityIndicator color={teacherColors.teal} /><Text style={styles.muted}>Saving changes…</Text></View>}
    </ScrollView>
  </View>;
}

function ChoiceRow({ options, selected, onSelect }: { options: string[]; selected: string; onSelect: (value: string) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
    {options.map((option) => <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected: selected === option }}
      onPress={() => onSelect(option)} style={[styles.scopeChip, selected === option && styles.scopeChipSelected]}>
      <Text style={[styles.scopeChipText, selected === option && styles.scopeChipTextSelected]}>{option.replace(/_/g, ' ')}</Text>
    </Pressable>)}
  </ScrollView>;
}

export default function TeacherModuleRoute() {
  const { module: moduleParam } = useLocalSearchParams<{ module: string | string[] }>();
  const { user } = useAuth();
  const module = Array.isArray(moduleParam) ? moduleParam[0] : moduleParam;
  if (!user || user.role !== 'teacher') return <AccessDenied />;
  if (!module || !Object.prototype.hasOwnProperty.call(definitions, module)) return <UnknownModule />;
  return <NativeTeacherModule module={module as ModuleId} user={user} />;
}

function AccessDenied() {
  const router = useRouter();
  return <View style={styles.center}><Text style={styles.title}>Teacher access required</Text>
    <ActionButton label="Return home" icon="arrow-left" onPress={() => router.replace('/')} /></View>;
}

function UnknownModule() {
  const router = useRouter();
  return <View style={styles.center}><Text style={styles.title}>Teacher module not found</Text>
    <ActionButton label="Return home" icon="arrow-left" onPress={() => router.replace('/')} /></View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: teacherColors.bg },
  content: { gap: 15, paddingHorizontal: 18 },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 48 },
  backButton: { height: 42, width: 42, borderRadius: 12, backgroundColor: teacherColors.surface, borderColor: teacherColors.edge, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  brand: { flex: 1 },
  brandText: { color: teacherColors.white, fontSize: 17, fontWeight: '800', letterSpacing: 0.5 },
  roleText: { color: teacherColors.faint, fontSize: 11, marginTop: 2 },
  titleBlock: { gap: 5, paddingTop: 3 },
  title: { color: teacherColors.white, fontSize: 25, fontWeight: '800' },
  subtitle: { color: teacherColors.faint, fontSize: 13 },
  sessionBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5, borderWidth: 1, borderColor: teacherColors.edge, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: teacherColors.surface },
  sessionText: { color: teacherColors.white, fontSize: 11, fontWeight: '600' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: '#332c24', borderRadius: 9 },
  bannerText: { color: teacherColors.amber, fontSize: 12, flex: 1 },
  scopeBlock: { gap: 8 },
  sectionLabel: { color: teacherColors.faint, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7 },
  scopeChip: { paddingHorizontal: 11, paddingVertical: 9, backgroundColor: teacherColors.surface, borderColor: teacherColors.edge, borderWidth: 1, borderRadius: 20 },
  scopeChipSelected: { backgroundColor: '#183d42', borderColor: teacherColors.teal },
  scopeChipText: { color: teacherColors.faint, fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  scopeChipTextSelected: { color: teacherColors.teal },
  card: { gap: 9, padding: 14, backgroundColor: teacherColors.surface, borderColor: teacherColors.edge, borderWidth: 1, borderRadius: 12 },
  lightboxBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', padding: 14 },
  lightboxPanel: { gap: 12, backgroundColor: teacherColors.surface, borderRadius: 14, padding: 14, maxHeight: '92%' },
  lightboxHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lightboxImage: { width: '100%', height: 420, backgroundColor: '#000' },
  lightboxLoading: { height: 420, alignItems: 'center', justifyContent: 'center', gap: 10 },
  formCard: { gap: 12, padding: 15, backgroundColor: teacherColors.surface, borderColor: teacherColors.edge, borderWidth: 1, borderRadius: 12 },
  listBlock: { gap: 10 },
  cardTitle: { color: teacherColors.white, fontSize: 15, fontWeight: '700', flex: 1 },
  sectionTitle: { color: teacherColors.white, fontSize: 16, fontWeight: '700' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  muted: { color: teacherColors.faint, fontSize: 12, lineHeight: 19 },
  fieldWrap: { gap: 6 },
  fieldLabel: { color: teacherColors.white, fontSize: 12, fontWeight: '600' },
  input: { minHeight: 46, borderWidth: 1, borderColor: teacherColors.edge, borderRadius: 8, backgroundColor: teacherColors.bg, paddingHorizontal: 12, color: teacherColors.white, fontSize: 14 },
  multiline: { minHeight: 92, paddingTop: 12, textAlignVertical: 'top' },
  action: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 9, paddingHorizontal: 12, backgroundColor: teacherColors.teal },
  actionSecondary: { backgroundColor: '#334156' },
  actionDisabled: { opacity: 0.45 },
  actionPressed: { opacity: 0.75 },
  actionText: { color: teacherColors.white, fontSize: 13, fontWeight: '700' },
  attendanceRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: teacherColors.edge },
  studentAvatar: { width: 38, height: 38, borderRadius: 20, backgroundColor: '#293a4d', alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { color: teacherColors.teal, fontSize: 15, fontWeight: '800' },
  rowTitle: { color: teacherColors.white, fontSize: 13, fontWeight: '600' },
  statusPill: { overflow: 'hidden', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, fontSize: 10, color: teacherColors.white, textTransform: 'capitalize' },
  statusMarked: { backgroundColor: '#1d5550' },
  statusEmpty: { backgroundColor: '#3b4553' },
  statusColumn: { alignItems: 'flex-end', gap: 3 },
  attemptsText: { color: teacherColors.faint, fontSize: 9 },
  recordHeading: { gap: 4 },
  studentLeaveCard: { gap: 9, padding: 12, borderRadius: 9, backgroundColor: teacherColors.bg, borderColor: teacherColors.edge, borderWidth: 1 },
  recordImage: { width: '100%', height: 150, borderRadius: 8, backgroundColor: teacherColors.bg },
  linkText: { color: teacherColors.teal, fontSize: 12 },
  emptyIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#183d42', alignItems: 'center', justifyContent: 'center' },
  state: { alignItems: 'center', gap: 8, paddingVertical: 28 },
  errorCard: { gap: 10, padding: 14, borderRadius: 10, borderColor: '#7a3444', borderWidth: 1, backgroundColor: '#332637' },
  errorText: { color: teacherColors.coral, fontSize: 13 },
  busyRow: { flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', padding: 10 },
  center: { flex: 1, backgroundColor: teacherColors.bg, padding: 22, alignItems: 'center', justifyContent: 'center', gap: 16 },
});