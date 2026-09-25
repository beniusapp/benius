import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Image, Linking, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Button, Card, Field, Screen, State } from '@/components/Foundation';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import { useAuth } from '@/contexts/AuthContext';
import { useAcademicSession } from '@/contexts/SessionContext';
import { apiGet, apiGetForSession, apiPostForSession, API_BASE_URL } from '@/lib/api';
import { formatSchoolDate, formatSchoolInstant } from '@/lib/date';
import { useColors } from '@/hooks/useColors';
import { StudentPaymentCheckout } from '@/components/StudentPaymentCheckout';

const LEAVE_CATEGORIES = [
  'Medical Leave',
  'Family Emergency',
  'Personal Reasons',
  'Academic Event',
  'Sports / Co-curricular',
  'Other',
] as const;

type Notice = {
  id: number; content: string; noticeType: string | null; creatorRole: string;
  creatorName: string | null; targetType: string; targetClass: string | null;
  targetSection: string | null; fileUrl: string | null; createdAt: string; isRead: boolean;
};
type CalendarEvent = {
  id: number; title: string; date: string; eventType: string; venue: string | null;
  description: string | null; colorCode: string | null; isRecurring: boolean;
};
type Faculty = {
  id: number; fullName: string; subject: string; phone: string; assignedClass: string;
  assignedSection: string; designation: string | null; qualifications: string | null;
  department: string | null; profileImageUrl: string | null; digitalTeacherId: string | null;
  mappings: { className: string; section: string; subject: string | null }[];
};
type GalleryItem = {
  id: number; title: string; description: string | null; eventTag: string | null;
  capturedDate: string | null; location: string | null; imageUrl: string;
};
type Book = {
  id: number; title: string; author: string; isbn: string | null; targetClass: string | null;
  category: string | null; fileUrl: string | null; fileType: string | null;
  availableCopies: number; totalCopies: number; uploaderName: string | null;
};
type Fee = {
  id: number; feeType: string; amount: number; dueDate: string; paidDate: string | null;
  status: string; receiptNumber: string | null; invoiceNumber: string | null;
  lateFeeAmount: number; notes: string | null; academicYear: string | null;
  breakdownSnapshot?: { name: string; purpose: string; amount: number }[];
};
type FeeSummary = {
  previousArrears: number; currentMonthCharges: number;
  totalOutstanding: number; totalPaid: number; currentMonth: string;
};
type PaymentAttempt = {
  id: number; outcome: string; feeRecordId: number | null; feeName: string | null;
  invoiceNumber: string | null; amount: number | null; currency: string | null;
  createdAt: string; razorpayPaymentId: string | null; paymentMethod: string | null;
  errorDescription: string | null; attemptNumber: number | null;
};
type FeeReminder = {
  id: number; feeRecordId: number | null; channel: string; stage: string;
  sentAt: string | null; status: string; recipient: string | null;
};
type FeeDocument = {
  documentType: 'invoice' | 'receipt';
  fee: Fee & { breakdown?: unknown };
  payment?: Record<string, unknown> | null;
  studentName: string;
  schoolName: string;
  sessionName: string;
};
type ExamScore = {
  id: number; subject: string; examType: string; marks: number; totalMarks: number;
  passMarks: number; isAbsent: boolean; published: boolean;
};
type ExamPolicy = {
  examWeights: string | null;
  passPercentage: number;
  gradingRules: { minPercent: number; maxPercent: number; gradeLabel: string; remarks: string | null }[];
};
type Leave = {
  id: number; startDate: string; endDate: string; reason: string; status: string;
  category: string | null; attachmentUrl: string | null; rejectionReason: string | null;
  createdAt: string;
};
type PickedLeaveAttachment = { uri: string; name: string; mimeType: string; size: number };
type PrivateLeaveAttachment = { fileName: string; mimeType: string; data: string };
type TimetableEntry = {
  id: number; dayOfWeek: number; period: number; subject: string; startTime: string | null;
  endTime: string | null; room: string | null; teacherName: string;
};
type Complaint = {
  id: number; ticketId: string; complaintType: string; content: string; status: string;
  createdAt: string; resolvedAt: string | null; teacherName: string | null; teacherId: number | null;
  reportedStudentName: string | null; incidentDate: string | null; resolutionRemarks: string | null;
  students?: { id: number; name: string; class: string | null; section: string | null }[];
  batchPeers?: { name: string; class: string | null; section: string | null }[];
};
type ComplaintTeacher = { id: number; name: string; subject: string };
type Peer = { id: number; name: string; digitalStudentId: string; class: string | null; section: string | null };
type ComplaintNote = { id: number; authorRole: string; authorName: string; content: string; createdAt: string };

function useIdentityKey(): readonly unknown[] {
  const { user } = useAuth();
  return [user?.schoolId, user?.id, user?.role];
}

function ModuleFrame({ title, subtitle, children }: {
  title: string; subtitle: string; children: React.ReactNode;
}) {
  const c = useColors();
  const router = useRouter();
  return <Screen>
    <Pressable testID={`student-${title.toLowerCase().replace(/\s+/g, '-')}-back`}
      accessibilityRole="button" accessibilityLabel="Back to Student dashboard"
      onPress={() => router.replace('/')} hitSlop={8}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
      <Feather name="arrow-left" size={21} color={c.foreground} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.foreground, fontSize: 23, fontFamily: 'ArchitectsDaughter_400Regular' }}>{title}</Text>
        <Text style={{ color: c.mutedForeground, marginTop: 2 }}>{subtitle}</Text>
      </View>
      <Text style={{ fontSize: 18, color: c.foreground, fontFamily: 'ArchitectsDaughter_400Regular' }}>BENIUS</Text>
    </Pressable>
    <View style={{ height: 1, backgroundColor: c.border, marginVertical: 12 }} />
    {children}
  </Screen>;
}

function CardTitle({ title, trailing }: { title: string; trailing?: string }) {
  const c = useColors();
  return <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
    <Text style={{ flex: 1, color: c.foreground, fontSize: 17, fontWeight: '600' }}>{title}</Text>
    {!!trailing && <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{trailing}</Text>}
  </View>;
}

function InlineTag({ text, color }: { text: string; color?: string }) {
  const c = useColors();
  return <View style={{ alignSelf: 'flex-start', backgroundColor: `${color ?? c.primary}18`, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 }}>
    <Text style={{ color: color ?? c.primary, fontSize: 12, fontWeight: '600' }}>{text}</Text>
  </View>;
}

function QueryState({ loading, error, empty, retry }: {
  loading: boolean; error: unknown; empty: boolean; retry: () => void;
}) {
  if (loading) return <State title="Loading" detail="Fetching current BENIUS records." loading />;
  if (error) return <State title="Could not load this information" detail={error instanceof Error ? error.message : 'The request failed.'} retry={retry} />;
  if (empty) return <State title="No records found" detail="There are no records for this view." />;
  return null;
}

const amount = (value: number) => `₹${Number.isFinite(value) ? value.toLocaleString('en-IN') : '0'}`;
const safeDate = (value: string | null | undefined) => value ? formatSchoolDate(value.slice(0, 10)) : '—';

export function StudentNoticeboardScreen() {
  const c = useColors();
  const { user } = useAuth();
  const { sessions, selectedId } = useAcademicSession();
  const queryClient = useQueryClient();
  const identity = useIdentityKey();
  const [selected, setSelected] = useState<Notice | null>(null);
  const session = sessions.find(item => item.id === selectedId);
  const query = useQuery({
    queryKey: ['mobile/student/notices', ...identity, selectedId],
    enabled: user?.role === 'student' && selectedId !== null,
    queryFn: ({ signal }) => apiGetForSession<Notice[]>('/mobile/student/notices', selectedId!, { signal }),
    staleTime: 30_000,
  });
  const markRead = useMutation({
    mutationFn: (noticeId: number) => apiPostForSession('/mobile/student/notices/mark-read', selectedId!, { noticeIds: [noticeId] }),
    onSuccess: (_result, noticeId) => {
      queryClient.setQueryData<Notice[]>(['mobile/student/notices', ...identity, selectedId],
        old => old?.map(item => item.id === noticeId ? { ...item, isRead: true } : item));
      queryClient.invalidateQueries({ queryKey: ['mobile/student/notices'] });
    },
  });
  const notices = query.data ?? [];
  return <ModuleFrame title="Noticeboard" subtitle={session?.sessionName ?? 'School notices'}>
    {selectedId === null && <State title="Academic session unavailable" detail="Choose an available academic session before loading Student notices." />}
    {selectedId !== null && <QueryState loading={query.isPending} error={query.error} empty={!query.isPending && !query.error && notices.length === 0} retry={() => { void query.refetch(); }} />}
    {notices.map(notice => <Pressable key={notice.id} accessibilityRole="button"
      accessibilityLabel={`${notice.noticeType ?? 'Routine'} notice. ${notice.isRead ? 'Read' : 'Unread'}`}
      onPress={() => {
        setSelected(notice);
        if (!notice.isRead && session?.isActive) markRead.mutate(notice.id);
      }} style={{ marginBottom: 12 }}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
          <InlineTag text={notice.noticeType ?? 'Routine'} color={notice.noticeType === 'Urgent' ? c.destructive : c.primary} />
          <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{notice.isRead ? 'Read' : 'Unread'}</Text>
        </View>
        <Text numberOfLines={3} style={{ color: c.foreground, lineHeight: 22 }}>{notice.content}</Text>
        <Text style={{ color: c.mutedForeground, fontSize: 12 }}>
          {notice.creatorRole === 'admin' ? 'From Principal' : notice.creatorName ? `From ${notice.creatorName}` : 'From school'} · {formatSchoolInstant(notice.createdAt)}
        </Text>
      </Card>
    </Pressable>)}
    {markRead.error && <State title="Notice status could not be updated" detail={markRead.error.message} retry={() => markRead.reset()} />}
    <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
      <Pressable onPress={() => setSelected(null)} style={{ flex: 1, justifyContent: 'center', backgroundColor: '#0008', padding: 20 }}>
        {selected && <Pressable onPress={() => undefined} style={{ backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: 14, padding: 20, gap: 14 }}>
          <CardTitle title={selected.noticeType ?? 'Routine notice'} trailing={selected.isRead ? 'Read' : 'Unread'} />
          <Text style={{ color: c.foreground, lineHeight: 23 }}>{selected.content}</Text>
          {!!selected.fileUrl && <Button label="Open attachment" icon="external-link" secondary onPress={() => openBackendFile(selected.fileUrl)} />}
          <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{formatSchoolInstant(selected.createdAt)}</Text>
          <Button label="Close" secondary onPress={() => setSelected(null)} />
        </Pressable>}
      </Pressable>
    </Modal>
  </ModuleFrame>;
}

function istYearMonth(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return { year: Number(parts.find(part => part.type === 'year')?.value), month: Number(parts.find(part => part.type === 'month')?.value) - 1 };
}

export function StudentCalendarScreen() {
  const c = useColors();
  const [initial] = useState(istYearMonth);
  const [shown, setShown] = useState(initial);
  const identity = useIdentityKey();
  const query = useQuery({
    queryKey: ['mobile/student/calendar', ...identity, shown.year, shown.month],
    queryFn: ({ signal }) => apiGet<CalendarEvent[]>(`/mobile/student/calendar?month=${shown.month}&year=${shown.year}`, { signal }),
    staleTime: 60_000,
  });
  const monthLabel = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(shown.year, shown.month, 1)));
  const events = [...(query.data ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  function shift(delta: number) {
    const date = new Date(Date.UTC(shown.year, shown.month + delta, 1));
    setShown({ year: date.getUTCFullYear(), month: date.getUTCMonth() });
  }
  return <ModuleFrame title="School Calendar" subtitle="School-wide calendar events">
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
      <Pressable testID="calendar-previous-month" accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => shift(-1)} hitSlop={10}><Feather name="chevron-left" size={25} color={c.foreground} /></Pressable>
      <Text style={{ color: c.foreground, fontSize: 18, fontWeight: '600' }}>{monthLabel}</Text>
      <Pressable testID="calendar-next-month" accessibilityRole="button" accessibilityLabel="Next month" onPress={() => shift(1)} hitSlop={10}><Feather name="chevron-right" size={25} color={c.foreground} /></Pressable>
    </View>
    <QueryState loading={query.isPending} error={query.error} empty={!query.isPending && !query.error && events.length === 0} retry={() => { void query.refetch(); }} />
    {events.map(event => <Card key={event.id}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ width: 50, minHeight: 55, borderWidth: 1, borderColor: event.colorCode ?? c.primary, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: `${event.colorCode ?? c.primary}16` }}>
          <Text style={{ color: event.colorCode ?? c.primary, fontSize: 18, fontWeight: '700' }}>{Number(event.date.slice(8, 10))}</Text>
          <Text style={{ color: event.colorCode ?? c.primary, fontSize: 10 }}>{safeDate(event.date).split(' ')[1]}</Text>
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <CardTitle title={event.title} />
          <InlineTag text={event.eventType} color={event.colorCode ?? c.primary} />
          {!!event.venue && <Text style={{ color: c.mutedForeground }}>Venue: {event.venue}</Text>}
          {!!event.description && <Text style={{ color: c.foreground, lineHeight: 21 }}>{event.description}</Text>}
          {event.isRecurring && <Text style={{ color: c.mutedForeground, fontSize: 12 }}>Recurring event</Text>}
        </View>
      </View>
    </Card>)}
    {!!query.error && <Button label="Try again" onPress={() => { void query.refetch(); }} secondary />}
  </ModuleFrame>;
}

export function StudentFacultyScreen() {
  const c = useColors();
  const identity = useIdentityKey();
  const [search, setSearch] = useState('');
  const query = useQuery({
    queryKey: ['mobile/student/faculty', ...identity],
    queryFn: ({ signal }) => apiGet<Faculty[]>('/mobile/student/faculty', { signal }),
    staleTime: 60_000,
  });
  const teachers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (query.data ?? []).filter(teacher => !term
      || [teacher.fullName, teacher.subject, teacher.designation, teacher.department,
        ...teacher.mappings.map(m => `${m.className} ${m.section} ${m.subject ?? ''}`)]
        .some(value => value?.toLowerCase().includes(term)));
  }, [query.data, search]);
  return <ModuleFrame title="Faculty Info" subtitle="Teachers and school-wide subject mappings">
    <TextInput testID="faculty-search" accessibilityLabel="Search faculty" value={search} onChangeText={setSearch}
      placeholder="Search faculty" placeholderTextColor={c.mutedForeground}
      style={{ minHeight: 48, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: c.border, color: c.foreground, backgroundColor: c.card, marginBottom: 14 }} />
    <QueryState loading={query.isPending} error={query.error} empty={!query.isPending && !query.error && teachers.length === 0} retry={() => { void query.refetch(); }} />
    {teachers.map(teacher => <Card key={teacher.id}>
      <CardTitle title={teacher.fullName} trailing={teacher.digitalTeacherId ?? undefined} />
      <Text style={{ color: c.foreground }}>{teacher.designation || teacher.subject}</Text>
      {!!teacher.department && <Text style={{ color: c.mutedForeground }}>{teacher.department}</Text>}
      {!!teacher.qualifications && <Text style={{ color: c.mutedForeground }}>Qualification: {teacher.qualifications}</Text>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {teacher.mappings.map((mapping, index) => <InlineTag key={`${teacher.id}-${index}`} text={`${mapping.className} · ${mapping.section}${mapping.subject ? ` · ${mapping.subject}` : ''}`} />)}
      </View>
      {!!teacher.phone && <Button label={`Call ${teacher.fullName}`} icon="phone" secondary onPress={() => {
        void Linking.openURL(`tel:${teacher.phone.replace(/[^\d+]/g, '')}`).catch(() => Alert.alert('Call unavailable', 'This device cannot place a phone call.'));
      }} />}
    </Card>)}
  </ModuleFrame>;
}

function backendAsset(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const api = new URL(API_BASE_URL);
    const value = new URL(url, `${api.origin}/`);
    return value.protocol === 'https:' && value.origin === api.origin ? value.toString() : null;
  } catch { return null; }
}

function openBackendFile(path: string | null | undefined): void {
  const url = backendAsset(path);
  if (!url) {
    Alert.alert('Attachment unavailable', 'This attachment does not have a secure BENIUS address.');
    return;
  }
  void Linking.openURL(url).catch(() => Alert.alert('Attachment unavailable', 'The device could not open this attachment.'));
}

export function StudentGalleryScreen() {
  const c = useColors();
  const identity = useIdentityKey();
  const [tag, setTag] = useState<string | null>(null);
  const [selected, setSelected] = useState<GalleryItem | null>(null);
  const [saving, setSaving] = useState(false);
  const tags = useQuery({
    queryKey: ['mobile/student/gallery/tags', ...identity],
    queryFn: ({ signal }) => apiGet<string[]>('/mobile/student/gallery/tags', { signal }),
    staleTime: 60_000,
  });
  const query = useQuery({
    queryKey: ['mobile/student/gallery', ...identity, tag],
    queryFn: ({ signal }) => apiGet<GalleryItem[]>(`/mobile/student/gallery${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`, { signal }),
    staleTime: 30_000,
  });
  const items = query.data ?? [];
  return <ModuleFrame title="Gallery" subtitle="Approved school photos">
    {tags.error && <State title="Gallery categories unavailable" detail={tags.error.message} retry={() => { void tags.refetch(); }} />}
    <FlatList horizontal data={[null, ...(tags.data ?? [])]} keyExtractor={item => item ?? 'all'}
      showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}
      renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => setTag(item)}
        style={{ backgroundColor: tag === item ? c.primary : c.secondary, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 }}>
        <Text style={{ color: tag === item ? c.primaryForeground : c.secondaryForeground }}>{item ?? 'All'}</Text>
      </Pressable>} />
    <QueryState loading={query.isPending} error={query.error} empty={!query.isPending && !query.error && items.length === 0} retry={() => { void query.refetch(); }} />
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 }}>
      {items.map(item => <Pressable key={item.id} testID={`gallery-item-${item.id}`} accessibilityRole="button"
        onPress={() => setSelected(item)} style={{ width: '48%', marginBottom: 8 }}>
        <View style={{ borderRadius: 10, overflow: 'hidden', backgroundColor: c.secondary, minHeight: 130 }}>
          {backendAsset(item.imageUrl)
            ? <Image source={{ uri: backendAsset(item.imageUrl)! }} resizeMode="cover" style={{ width: '100%', height: 145 }} />
            : <View style={{ height: 145, alignItems: 'center', justifyContent: 'center' }}><Feather name="image" size={28} color={c.mutedForeground} /><Text style={{ color: c.mutedForeground, padding: 8 }}>Image unavailable</Text></View>}
        </View>
        <Text numberOfLines={2} style={{ color: c.foreground, fontWeight: '600', marginTop: 7 }}>{item.title}</Text>
        {!!item.eventTag && <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{item.eventTag}</Text>}
      </Pressable>)}
    </View>
    <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
      <Pressable onPress={() => setSelected(null)} style={{ flex: 1, justifyContent: 'center', backgroundColor: '#0008', padding: 16 }}>
        {selected && <Pressable onPress={() => undefined} style={{ backgroundColor: c.card, borderRadius: 12, padding: 16, gap: 10 }}>
          {backendAsset(selected.imageUrl) && <Image source={{ uri: backendAsset(selected.imageUrl)! }} resizeMode="contain" style={{ width: '100%', height: 360 }} />}
          <CardTitle title={selected.title} />
          {!!selected.description && <Text style={{ color: c.foreground }}>{selected.description}</Text>}
          {!!selected.location && <Text style={{ color: c.mutedForeground }}>{selected.location}</Text>}
          {!!selected.capturedDate && <Text style={{ color: c.mutedForeground }}>{safeDate(selected.capturedDate)}</Text>}
          {!!selected.imageUrl && <Button label={saving ? 'Preparing image…' : 'Save / share image'} icon="download" secondary
            disabled={saving} onPress={async () => {
              const url = backendAsset(selected.imageUrl);
              if (!url) { Alert.alert('Image unavailable', 'This image does not have a secure BENIUS address.'); return; }
              setSaving(true);
              let file: File | null = null;
              try {
                const folder = new Directory(Paths.cache, 'beni-gallery');
                folder.create({ idempotent: true, intermediates: true });
                const name = selected.title.replace(/[^a-z0-9_-]/gi, '_').slice(0, 48) || `gallery-${selected.id}`;
                file = await File.downloadFileAsync(url, new File(folder, `${name}.jpg`), { idempotent: true });
                if (!await Sharing.isAvailableAsync()) throw new Error('Secure file sharing is unavailable on this device.');
                await Sharing.shareAsync(file.uri, { mimeType: 'image/jpeg', dialogTitle: selected.title });
              } catch (error) {
                Alert.alert('Image unavailable', error instanceof Error ? error.message : 'Could not save this image.');
              } finally {
                if (file?.exists) file.delete();
                setSaving(false);
              }
            }} />}
          <Button label="Close" onPress={() => setSelected(null)} secondary />
        </Pressable>}
      </Pressable>
    </Modal>
  </ModuleFrame>;
}

export function StudentLibraryScreen() {
  const c = useColors();
  const identity = useIdentityKey();
  const [search, setSearch] = useState('');
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const query = useQuery({
    queryKey: ['mobile/student/library', ...identity],
    queryFn: ({ signal }) => apiGet<Book[]>('/mobile/student/library', { signal }),
    staleTime: 60_000,
  });
  const books = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (query.data ?? []).filter(book => !term || [book.title, book.author, book.category, book.targetClass]
      .some(value => value?.toLowerCase().includes(term)));
  }, [query.data, search]);
  return <ModuleFrame title="E-Library" subtitle="Approved school library resources">
    <TextInput testID="library-search" accessibilityLabel="Search library" value={search} onChangeText={setSearch}
      placeholder="Search books" placeholderTextColor={c.mutedForeground}
      style={{ minHeight: 48, paddingHorizontal: 14, borderWidth: 1, borderColor: c.border, borderRadius: 8, color: c.foreground, backgroundColor: c.card }} />
    <QueryState loading={query.isPending} error={query.error} empty={!query.isPending && !query.error && books.length === 0} retry={() => { void query.refetch(); }} />
    {books.map(book => <Card key={book.id}>
      <CardTitle title={book.title} />
      <Text style={{ color: c.foreground }}>by {book.author}</Text>
      {!!book.category && <InlineTag text={book.category} />}
      {!!book.targetClass && <Text style={{ color: c.mutedForeground }}>For Class {book.targetClass}</Text>}
      <Text style={{ color: c.mutedForeground }}>{book.availableCopies} of {book.totalCopies} copies available</Text>
      {!!book.uploaderName && <Text style={{ color: c.mutedForeground }}>Added by {book.uploaderName}</Text>}
      {!!book.fileUrl && <Button label="Open resource" icon="external-link" onPress={() => {
        const url = backendAsset(book.fileUrl);
        if (!url) { Alert.alert('Resource unavailable', 'This resource does not have a secure BENIUS address.'); return; }
        void Linking.openURL(url).catch(() => Alert.alert('Resource unavailable', 'The device could not open this resource.'));
      }} />}
      {!!book.fileUrl && <Button label={downloadingId === book.id ? 'Preparing download…' : 'Download resource'}
        icon="download" secondary disabled={downloadingId !== null} onPress={async () => {
          const url = backendAsset(book.fileUrl);
          if (!url) { Alert.alert('Resource unavailable', 'This resource does not have a secure BENIUS address.'); return; }
          setDownloadingId(book.id);
          let downloaded: File | null = null;
          try {
            const extension = (book.fileType || url.split('?')[0].split('.').pop() || 'pdf')
              .toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'pdf';
            const directory = new Directory(Paths.cache, 'beni-library');
            directory.create({ idempotent: true, intermediates: true });
            const safeTitle = book.title.replace(/[^a-z0-9_-]/gi, '_').slice(0, 48) || 'resource';
            downloaded = await File.downloadFileAsync(url, new File(directory, `${book.id}-${safeTitle}.${extension}`), { idempotent: true });
            if (!await Sharing.isAvailableAsync()) throw new Error('Secure file sharing is unavailable on this device.');
            await Sharing.shareAsync(downloaded.uri, { dialogTitle: book.title });
          } catch (error) {
            Alert.alert('Resource download failed', error instanceof Error ? error.message : 'Could not download this resource.');
          } finally {
            if (downloaded?.exists) downloaded.delete();
            setDownloadingId(null);
          }
        }} />}
    </Card>)}
  </ModuleFrame>;
}

export function StudentFeesScreen() {
  const c = useColors();
  const { sessions, selectedId } = useAcademicSession();
  const identity = useIdentityKey();
  const session = sessions.find(item => item.id === selectedId);
  const [tab, setTab] = useState<'fees' | 'history' | 'reminders'>('fees');
  const [document, setDocument] = useState<FeeDocument | null>(null);
  const [documentLoading, setDocumentLoading] = useState<number | null>(null);
  const query = useQuery({
    queryKey: ['mobile/student/fees', ...identity, selectedId],
    enabled: selectedId !== null,
    queryFn: ({ signal }) => apiGetForSession<Fee[]>('/mobile/student/fees', selectedId!, { signal }),
    staleTime: 0,
    refetchOnReconnect: true,
  });
  const summary = useQuery({
    queryKey: ['mobile/student/fees/summary', ...identity, selectedId],
    enabled: selectedId !== null,
    queryFn: ({ signal }) => apiGetForSession<FeeSummary>('/mobile/student/fees/summary', selectedId!, { signal }),
    staleTime: 0,
    refetchOnReconnect: true,
  });
  const attempts = useQuery({
    queryKey: ['mobile/student/fees/payment-attempts', ...identity, selectedId],
    enabled: selectedId !== null && tab === 'history',
    queryFn: ({ signal }) => apiGetForSession<PaymentAttempt[]>('/mobile/student/fees/payment-attempts', selectedId!, { signal }),
    staleTime: 0,
  });
  const reminders = useQuery({
    queryKey: ['mobile/student/fees/notification-history', ...identity, selectedId],
    enabled: selectedId !== null && tab === 'reminders',
    queryFn: ({ signal }) => apiGetForSession<FeeReminder[]>('/mobile/student/fees/notification-history', selectedId!, { signal }),
    staleTime: 0,
  });
  const portal = useQuery({
    queryKey: ['mobile/student/fees/portal-info', ...identity, selectedId],
    enabled: selectedId !== null && session?.isActive === true,
    queryFn: ({ signal }) => apiGetForSession<{ isEnabled: boolean; gatewayUrl: string | null; bannerMessage: string | null; isRazorpayEnabled: boolean }>(
      '/mobile/student/fees/portal-info', selectedId!, { signal }),
    staleTime: 60_000,
  });
  const records = query.data ?? [];
  const outstanding = records.filter(record => record.status.toLowerCase() !== 'paid');
  const paidTotal = records.filter(record => record.status.toLowerCase() === 'paid').reduce((sum, record) => sum + record.amount, 0);
  const dueTotal = outstanding.reduce((sum, record) => sum + record.amount + (record.lateFeeAmount ?? 0), 0);
  const loadDocument = async (record: Fee, documentType: 'invoice' | 'receipt') => {
    if (selectedId === null || documentLoading !== null) return;
    setDocumentLoading(record.id);
    try {
      const result = await apiGetForSession<FeeDocument>(
        `/mobile/student/fees/${record.id}/${documentType}`, selectedId,
      );
      setDocument(result);
    } catch (error) {
      Alert.alert(`${documentType === 'receipt' ? 'Receipt' : 'Invoice'} unavailable`,
        error instanceof Error ? error.message : 'The document could not be loaded.');
    } finally {
      setDocumentLoading(null);
    }
  };
  return <ModuleFrame title="Fees & Payments" subtitle={session?.sessionName ?? 'Student fee records'}>
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <View style={{ flex: 1 }}><Card><Text style={{ color: c.mutedForeground }}>Total Due</Text><Text style={{ color: c.destructive, fontSize: 20, fontWeight: '700' }}>{amount(summary.data?.totalOutstanding ?? dueTotal)}</Text></Card></View>
      <View style={{ flex: 1 }}><Card><Text style={{ color: c.mutedForeground }}>Total Paid</Text><Text style={{ color: c.primary, fontSize: 20, fontWeight: '700' }}>{amount(summary.data?.totalPaid ?? paidTotal)}</Text></Card></View>
    </View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginVertical: 10 }}>
      {([{ id: 'fees', label: 'Invoices' }, { id: 'history', label: 'Payment history' }, { id: 'reminders', label: 'Reminders' }] as const).map(item =>
        <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: tab === item.id }}
          testID={`fees-tab-${item.id}`} onPress={() => setTab(item.id)}
          style={{ borderRadius: 17, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: tab === item.id ? c.primary : c.secondary }}>
          <Text style={{ color: tab === item.id ? c.primaryForeground : c.secondaryForeground }}>{item.label}</Text>
        </Pressable>)}
    </View>
    {tab === 'fees' && <>
      {session?.isActive && portal.data?.isEnabled && !!portal.data.gatewayUrl && <>
        {!!portal.data.bannerMessage && <Card><Text style={{ color: c.foreground }}>{portal.data.bannerMessage}</Text></Card>}
        <Button label="Open school payment portal" icon="external-link" onPress={() => {
          try {
            const target = new URL(portal.data!.gatewayUrl!);
            if (target.protocol !== 'https:') throw new Error('The school payment portal is not a secure HTTPS address.');
            void Linking.openURL(target.toString()).catch(() => Alert.alert('Payment portal unavailable', 'The device could not open the school payment portal.'));
          } catch (error) {
            Alert.alert('Payment portal unavailable', error instanceof Error ? error.message : 'The configured payment portal address is invalid.');
          }
        }} />
      </>}
      <QueryState loading={query.isPending} error={query.error} empty={!query.isPending && !query.error && records.length === 0} retry={() => { void query.refetch(); }} />
      {records.map(record => <Card key={record.id}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <CardTitle title={record.feeType} trailing={record.status} />
      </View>
      <Text style={{ color: c.foreground, fontSize: 18, fontWeight: '700' }}>{amount(record.amount + (record.lateFeeAmount ?? 0))}</Text>
      <Text style={{ color: c.mutedForeground }}>Due {safeDate(record.dueDate)}{record.paidDate ? ` · Paid ${safeDate(record.paidDate)}` : ''}</Text>
      {(record.breakdownSnapshot ?? []).map((item, index) => <Text key={`${record.id}-breakdown-${index}`} style={{ color: c.mutedForeground, fontSize: 12 }}>
        {item.name}{item.purpose ? ` · ${item.purpose}` : ''}: {amount(item.amount)}
      </Text>)}
      {!!record.invoiceNumber && <Text style={{ color: c.mutedForeground }}>Invoice {record.invoiceNumber}</Text>}
      {!!record.receiptNumber && <Text style={{ color: c.mutedForeground }}>Receipt {record.receiptNumber}</Text>}
      {!!record.notes && <Text style={{ color: c.mutedForeground }}>{record.notes}</Text>}
      {record.status.toLowerCase() === 'paid'
        ? <Button label={documentLoading === record.id ? 'Loading receipt…' : 'View receipt'} icon="file-text" secondary
            disabled={documentLoading !== null} onPress={() => { void loadDocument(record, 'receipt'); }} />
        : <Button label={documentLoading === record.id ? 'Loading invoice…' : 'View invoice'} icon="file-text" secondary
            disabled={documentLoading !== null} onPress={() => { void loadDocument(record, 'invoice'); }} />}
      {record.status.toLowerCase() !== 'paid' && session?.isActive && portal.data?.isRazorpayEnabled
        && <StudentPaymentCheckout feeRecordId={record.id} onPaid={receipt => {
          Alert.alert('Payment confirmed', `Your payment was verified. Receipt ${receipt}.`);
          void query.refetch(); void summary.refetch(); void attempts.refetch();
        }} />}
      {record.status.toLowerCase() !== 'paid' && !portal.data?.gatewayUrl && <Text style={{ color: c.destructive, fontSize: 12 }}>Please contact the school office for payment options.</Text>}
      </Card>)}
      {!!query.error && <Button label="Refresh fee status" onPress={() => { void query.refetch(); }} secondary />}
      {!!summary.error && <State title="Fee summary unavailable" detail={summary.error.message} retry={() => { void summary.refetch(); }} />}
    </>}
    {tab === 'history' && <>
      <QueryState loading={attempts.isPending} error={attempts.error} empty={!attempts.isPending && !attempts.error && (attempts.data?.length ?? 0) === 0} retry={() => { void attempts.refetch(); }} />
      {(attempts.data ?? []).map(attempt => <Card key={attempt.id}>
        <CardTitle title={attempt.feeName || 'Fee payment'} trailing={attempt.outcome.replaceAll('_', ' ')} />
        <Text style={{ color: c.foreground, fontWeight: '700' }}>{attempt.amount == null ? 'Amount unavailable' : amount(attempt.amount)}</Text>
        <Text style={{ color: c.mutedForeground }}>{formatSchoolInstant(attempt.createdAt)} · Attempt {attempt.attemptNumber ?? '—'}</Text>
        {!!attempt.invoiceNumber && <Text style={{ color: c.mutedForeground }}>Invoice {attempt.invoiceNumber}</Text>}
        {!!attempt.razorpayPaymentId && <Text style={{ color: c.mutedForeground }}>Payment reference {attempt.razorpayPaymentId}</Text>}
        {!!attempt.paymentMethod && <Text style={{ color: c.mutedForeground }}>Method {attempt.paymentMethod}</Text>}
        {!!attempt.errorDescription && <Text style={{ color: c.destructive }}>{attempt.errorDescription}</Text>}
      </Card>)}
    </>}
    {tab === 'reminders' && <>
      <QueryState loading={reminders.isPending} error={reminders.error} empty={!reminders.isPending && !reminders.error && (reminders.data?.length ?? 0) === 0} retry={() => { void reminders.refetch(); }} />
      {(reminders.data ?? []).map(reminder => <Card key={reminder.id}>
        <CardTitle title={`${reminder.channel} reminder`} trailing={reminder.status} />
        <Text style={{ color: c.foreground }}>{reminder.stage}</Text>
        <Text style={{ color: c.mutedForeground }}>{reminder.sentAt ? formatSchoolInstant(reminder.sentAt) : 'Not sent'}</Text>
        {!!reminder.recipient && <Text style={{ color: c.mutedForeground }}>{reminder.recipient}</Text>}
      </Card>)}
    </>}
    <Modal visible={!!document} transparent animationType="slide" onRequestClose={() => setDocument(null)}>
      <Pressable onPress={() => setDocument(null)} style={{ flex: 1, justifyContent: 'center', backgroundColor: '#0008', padding: 18 }}>
        {document && <Pressable onPress={() => undefined} style={{ backgroundColor: c.card, borderRadius: 14, padding: 18, gap: 9 }}>
          <CardTitle title={document.documentType === 'receipt' ? 'Payment receipt' : 'Fee invoice'}
            trailing={document.sessionName} />
          <Text style={{ color: c.foreground, fontSize: 18, fontWeight: '700' }}>{document.fee.feeType}</Text>
          <Text style={{ color: c.foreground }}>Amount: {amount(document.fee.amount + (document.fee.lateFeeAmount ?? 0))}</Text>
          <Text style={{ color: c.mutedForeground }}>Due: {safeDate(document.fee.dueDate)}</Text>
          {!!document.fee.invoiceNumber && <Text style={{ color: c.mutedForeground }}>Invoice: {document.fee.invoiceNumber}</Text>}
          {!!document.fee.receiptNumber && <Text style={{ color: c.mutedForeground }}>Receipt: {document.fee.receiptNumber}</Text>}
          {document.payment && Object.entries(document.payment).filter(([, value]) => value != null && value !== '').map(([key, value]) =>
            <Text key={key} style={{ color: c.mutedForeground }}>{key.replace(/[A-Z]/g, letter => ` ${letter}`).replace(/^./, letter => letter.toUpperCase())}: {String(value)}</Text>
          )}
          <Text style={{ color: c.mutedForeground, fontSize: 12 }}>
            This is the authoritative document data for the selected academic session. For a printable school-branded document, use the school portal.
          </Text>
          <Button label="Close" secondary onPress={() => setDocument(null)} />
        </Pressable>}
      </Pressable>
    </Modal>
  </ModuleFrame>;
}

export function StudentExaminationScreen() {
  const c = useColors();
  const identity = useIdentityKey();
  const { sessions, selectedId } = useAcademicSession();
  const session = sessions.find(item => item.id === selectedId);
  const [examType, setExamType] = useState<string | null>(null);
  const [historyType, setHistoryType] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [term, setTerm] = useState<string | null>(null);
  const types = useQuery({
    queryKey: ['mobile/student/examination/types', ...identity, selectedId],
    enabled: selectedId !== null,
    queryFn: ({ signal }) => apiGetForSession<{ examTypes: string[] }>('/mobile/student/examination/types', selectedId!, { signal }),
    staleTime: 30_000,
  });
  const history = useQuery({
    queryKey: ['mobile/student/examination/all-scores', ...identity, selectedId],
    enabled: selectedId !== null,
    queryFn: ({ signal }) => apiGetForSession<{ scores: ExamScore[]; cls: string }>(
      '/mobile/student/examination/all-scores', selectedId!, { signal }),
    staleTime: 0,
    refetchInterval: 30_000,
  });
  const journey = useQuery({
    queryKey: ['mobile/student/examination/journey', ...identity, selectedId],
    enabled: selectedId !== null,
    queryFn: ({ signal }) => apiGetForSession<{ journey: { cls: string; examType: string; percentage: number }[] }>(
      '/mobile/student/examination/journey', selectedId!, { signal }),
    staleTime: 30_000,
  });
  const policy = useQuery({
    queryKey: ['mobile/student/examination/policy', ...identity, selectedId],
    enabled: selectedId !== null,
    queryFn: ({ signal }) => apiGetForSession<ExamPolicy>(
      '/mobile/student/examination/policy', selectedId!, { signal }),
    retry: false,
    staleTime: 60_000,
  });
  const scores = useQuery({
    queryKey: ['mobile/student/examination/scores', ...identity, selectedId, examType],
    enabled: selectedId !== null && !!examType,
    queryFn: ({ signal }) => apiGetForSession<{ scores: ExamScore[]; class: string; examType: string }>(
      `/mobile/student/examination/scores?examType=${encodeURIComponent(examType!)}`, selectedId!, { signal }),
    staleTime: 30_000,
  });
  const entries = scores.data?.scores ?? [];
  const obtained = entries.filter(score => !score.isAbsent).reduce((sum, score) => sum + score.marks, 0);
  const total = entries.reduce((sum, score) => sum + score.totalMarks, 0);
  const percentage = total > 0 ? `${Math.round((obtained / total) * 1000) / 10}%` : '—';
  const allScores = history.data?.scores ?? [];
  const historyTypes = [...new Set(allScores.map(score => score.examType))];
  const subjects = [...new Set(allScores.map(score => score.subject))].sort((a, b) => a.localeCompare(b));
  const visibleHistory = allScores.filter(score => (!historyType || score.examType === historyType)
    && (!subject || score.subject === subject));
  let configuredWeights: Record<string, { source_exam: string; weight: number }[]> = {};
  try { configuredWeights = JSON.parse(policy.data?.examWeights || '{}'); } catch { configuredWeights = {}; }
  const termNames = Object.keys(configuredWeights).map(value => value.trim());
  const activeTerm = termNames.includes(term ?? '') ? term! : termNames[0];
  const termResults = useMemo(() => {
    if (!activeTerm) return [];
    const components = configuredWeights[activeTerm] ?? [];
    const termSubjects = [...new Set(allScores.map(score => score.subject))].sort((a, b) => a.localeCompare(b));
    return termSubjects.map(subjectName => {
      const subjectScores = allScores.filter(score => score.subject === subjectName);
      let weightedSum = 0;
      let totalWeight = 0;
      let hasData = false;
      let absent = false;
      for (const component of components) {
        const score = subjectScores.find(entry => entry.examType === component.source_exam);
        if (!score) continue;
        hasData = true;
        if (score.isAbsent) { absent = true; continue; }
        const componentPercent = score.totalMarks > 0 ? (score.marks / score.totalMarks) * 100 : 0;
        weightedSum += componentPercent * (component.weight / 100);
        totalWeight += component.weight;
      }
      const percentage = absent ? 0 : hasData
        ? Math.round(((totalWeight > 0 ? weightedSum * 100 / totalWeight : 0)) * 10) / 10 : null;
      return {
        subject: subjectName,
        percentage,
        status: !hasData ? 'incomplete' as const : absent ? 'absent' as const : 'scored' as const,
        passed: percentage === null ? null : percentage >= (policy.data?.passPercentage ?? 0),
      };
    });
  }, [activeTerm, allScores, configuredWeights, policy.data?.passPercentage]);
  const scoredTermSubjects = termResults.filter(result => result.status === 'scored');
  const termAverage = scoredTermSubjects.length
    ? Math.round(scoredTermSubjects.reduce((sum, result) => sum + (result.percentage ?? 0), 0) / scoredTermSubjects.length * 10) / 10
    : null;
  const termGrade = termAverage === null ? null : policy.data?.gradingRules.find(rule =>
    termAverage >= rule.minPercent && termAverage <= rule.maxPercent,
  );
  return <ModuleFrame title="Examination" subtitle={session?.sessionName ?? 'Student examination results'}>
    {types.error && <State title="Examination list unavailable" detail={types.error.message} retry={() => { void types.refetch(); }} />}
    {types.isPending && <State title="Loading examinations" loading />}
    {!types.isPending && types.data?.examTypes.length === 0 && <State title="No examination results" detail="Results are not available for this academic session yet." />}
    <Text style={{ color: c.foreground, fontWeight: '600', marginBottom: 8 }}>Examination type</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {(types.data?.examTypes ?? []).map(type => <Pressable key={type} testID={`exam-type-${type}`} accessibilityRole="button"
        accessibilityState={{ selected: examType === type }} onPress={() => setExamType(type)}
        style={{ paddingHorizontal: 13, paddingVertical: 9, borderRadius: 18, backgroundColor: examType === type ? c.primary : c.secondary }}>
        <Text style={{ color: examType === type ? c.primaryForeground : c.secondaryForeground }}>{type}</Text>
      </Pressable>)}
    </View>
    {examType && <QueryState loading={scores.isPending} error={scores.error} empty={!scores.isPending && !scores.error && entries.length === 0} retry={() => { void scores.refetch(); }} />}
    {!!examType && entries.length > 0 && <>
      <Card>
        <CardTitle title={`${examType} results`} trailing={`Class ${scores.data?.class ?? ''}`} />
        <Text style={{ color: c.foreground, fontSize: 21, fontWeight: '700' }}>{obtained} / {total} · {percentage}</Text>
      </Card>
      {entries.map(score => <Card key={score.id}>
        <CardTitle title={score.subject} trailing={score.isAbsent ? 'Absent' : `${score.marks} / ${score.totalMarks}`} />
        <Text style={{ color: c.mutedForeground }}>Pass marks: {score.passMarks}{score.published ? ' · Published' : ''}</Text>
      </Card>)}
    </>}
    <View style={{ height: 1, backgroundColor: c.border, marginVertical: 10 }} />
    <Card>
      <CardTitle title="Examination journey" trailing={session?.sessionName ?? ''} />
      {journey.error && <State title="Journey unavailable" detail={journey.error.message} retry={() => { void journey.refetch(); }} />}
      {journey.isPending && <State title="Loading exam journey" loading />}
      {!journey.isPending && !journey.error && (journey.data?.journey.length ?? 0) === 0
        && <Text style={{ color: c.mutedForeground }}>No final-exam history is available for this session.</Text>}
      {(journey.data?.journey ?? []).map((item, index) => <View key={`${item.cls}-${item.examType}-${index}`}
        style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: c.border }}>
        <Text style={{ color: c.foreground }}>Class {item.cls} · {item.examType}</Text>
        <Text style={{ color: c.primary, fontWeight: '700' }}>{item.percentage}%</Text>
      </View>)}
    </Card>
    <Card>
      <CardTitle title="All scores" trailing={`${allScores.length} subject results`} />
      {history.error && <State title="Score history unavailable" detail={history.error.message} retry={() => { void history.refetch(); }} />}
      {history.isPending && <State title="Loading score history" loading />}
      {!history.isPending && !history.error && allScores.length === 0
        && <Text style={{ color: c.mutedForeground }}>No scores have been recorded for this session.</Text>}
      {!!historyTypes.length && <>
        <Text style={{ color: c.mutedForeground, marginTop: 10, marginBottom: 6 }}>Exam</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          {[null, ...historyTypes].map(type => <Pressable key={type ?? 'all-exams'} accessibilityRole="button"
            accessibilityState={{ selected: historyType === type }} onPress={() => setHistoryType(type)}
            style={{ backgroundColor: historyType === type ? c.primary : c.secondary, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16 }}>
            <Text style={{ color: historyType === type ? c.primaryForeground : c.secondaryForeground }}>{type ?? 'All'}</Text>
          </Pressable>)}
        </View>
      </>}
      {!!subjects.length && <>
        <Text style={{ color: c.mutedForeground, marginTop: 10, marginBottom: 6 }}>Subject</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          {[null, ...subjects].map(value => <Pressable key={value ?? 'all-subjects'} accessibilityRole="button"
            accessibilityState={{ selected: subject === value }} onPress={() => setSubject(value)}
            style={{ backgroundColor: subject === value ? c.primary : c.secondary, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16 }}>
            <Text style={{ color: subject === value ? c.primaryForeground : c.secondaryForeground }}>{value ?? 'All'}</Text>
          </Pressable>)}
        </View>
      </>}
      {visibleHistory.map(score => <View key={`history-${score.id}`}
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: c.border }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.foreground, fontWeight: '600' }}>{score.subject}</Text>
          <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{score.examType}{score.published ? ' · Published' : ''}</Text>
        </View>
        <Text style={{ color: score.isAbsent ? c.destructive : c.foreground, fontWeight: '700' }}>
          {score.isAbsent ? 'Absent' : `${score.marks} / ${score.totalMarks}`}
        </Text>
      </View>)}
    </Card>
    <Card>
      <CardTitle title="Term results" trailing={activeTerm ?? undefined} />
      {policy.isPending && <State title="Loading exam policy" loading />}
      {policy.error && <State title="Results policy unavailable" detail={policy.error.message} retry={() => { void policy.refetch(); }} />}
      {!policy.isPending && !policy.error && termNames.length === 0
        && <Text style={{ color: c.mutedForeground }}>No weighted term results are configured for this class.</Text>}
      {!!termNames.length && <>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 8 }}>
          {termNames.map(name => <Pressable key={name} accessibilityRole="button"
            accessibilityState={{ selected: activeTerm === name }} onPress={() => setTerm(name)}
            style={{ backgroundColor: activeTerm === name ? c.primary : c.secondary, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16 }}>
            <Text style={{ color: activeTerm === name ? c.primaryForeground : c.secondaryForeground }}>{name}</Text>
          </Pressable>)}
        </View>
        <Text style={{ color: c.mutedForeground, marginTop: 10 }}>
          {termAverage === null ? 'No scored subjects in this term.' : `Average ${termAverage}%${termGrade ? ` · Grade ${termGrade.gradeLabel}` : ''}`}
          {` · ${termResults.filter(result => result.passed === false).length} below pass mark`}
        </Text>
        {termResults.map(result => <View key={`${activeTerm}-${result.subject}`}
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: c.border }}>
          <Text style={{ flex: 1, color: c.foreground, fontWeight: '600' }}>{result.subject}</Text>
          <Text style={{ color: result.passed === false ? c.destructive : result.status === 'scored' ? c.primary : c.mutedForeground, fontWeight: '700' }}>
            {result.status === 'incomplete' ? 'Incomplete' : result.status === 'absent' ? 'Absent · 0%' : `${result.percentage}% · ${result.passed ? 'Pass' : 'Below pass mark'}`}
          </Text>
        </View>)}
      </>}
    </Card>
  </ModuleFrame>;
}

export function StudentTimetableScreen() {
  const c = useColors();
  const identity = useIdentityKey();
  const { sessions, selectedId } = useAcademicSession();
  const session = sessions.find(item => item.id === selectedId);
  const query = useQuery({
    queryKey: ['mobile/student/timetable', ...identity, selectedId],
    enabled: selectedId !== null,
    queryFn: ({ signal }) => apiGetForSession<{ entries: TimetableEntry[]; class: string; section: string; sessionId: number }>(
      '/mobile/student/timetable', selectedId!, { signal }),
    staleTime: 30_000,
  });
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const entries = query.data?.entries ?? [];
  return <ModuleFrame title="Timetable" subtitle={`${session?.sessionName ?? 'Academic session'}${query.data ? ` · ${query.data.class} · ${query.data.section}` : ''}`}>
    <QueryState loading={query.isPending} error={query.error} empty={!query.isPending && !query.error && entries.length === 0} retry={() => { void query.refetch(); }} />
    {days.map((day, dayIndex) => {
      const dayEntries = entries.filter(entry => entry.dayOfWeek === dayIndex).sort((a, b) => a.period - b.period);
      if (!dayEntries.length) return null;
      return <View key={day}>
        <Text style={{ color: c.primary, fontWeight: '700', fontSize: 17, marginTop: 13, marginBottom: 8 }}>{day}</Text>
        {dayEntries.map(entry => <Card key={entry.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ color: c.mutedForeground }}>Period {entry.period}</Text>
            <Text style={{ color: c.mutedForeground }}>{entry.startTime ?? ''}{entry.endTime ? ` – ${entry.endTime}` : ''}</Text>
          </View>
          <CardTitle title={entry.subject} trailing={entry.room ?? undefined} />
          <Text style={{ color: c.mutedForeground }}>{entry.teacherName}</Text>
        </Card>)}
      </View>;
    })}
  </ModuleFrame>;
}

export function StudentLeaveScreen() {
  const c = useColors();
  const identity = useIdentityKey();
  const { sessions, selectedId } = useAcademicSession();
  const queryClient = useQueryClient();
  const session = sessions.find(item => item.id === selectedId);
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<PickedLeaveAttachment | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const query = useQuery({
    queryKey: ['mobile/student/leave', ...identity, selectedId],
    enabled: selectedId !== null,
    queryFn: ({ signal }) => apiGetForSession<Leave[]>('/mobile/student/leave', selectedId!, { signal }),
    staleTime: 0,
  });
  const key = ['mobile/student/leave', ...identity, selectedId] as const;
  const chooseAttachment = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const extension = asset.name.split('.').pop()?.toLowerCase();
      const mimeByExtension: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
        pdf: 'application/pdf', doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };
      if (!extension || !mimeByExtension[extension] || (asset.size ?? 0) > 10 * 1024 * 1024) {
        Alert.alert('Unsupported attachment', 'Choose a JPG, PNG, GIF, WebP, PDF, DOC, or DOCX file under 10 MiB.');
        return;
      }
      setAttachment({
        uri: asset.uri,
        name: asset.name,
        mimeType: mimeByExtension[extension],
        size: asset.size ?? 0,
      });
    } catch (error) {
      Alert.alert('Attachment unavailable', error instanceof Error ? error.message : 'Could not open the device files.');
    }
  };
  const openLeaveAttachment = async (url: string | null) => {
    if (!url || selectedId === null) return;
    const match = /^\/api\/mobile\/student\/leave-files\/([0-9a-f-]+\.(?:jpg|jpeg|png|gif|webp|pdf|doc|docx))$/i.exec(url);
    if (!match) {
      Alert.alert('Attachment unavailable', 'This leave attachment address is invalid.');
      return;
    }
    let cached: File | null = null;
    try {
      const result = await apiGetForSession<PrivateLeaveAttachment>(
        `/mobile/student/leave-files/${match[1]}`, selectedId,
      );
      if (!result || typeof result.data !== 'string' || typeof result.mimeType !== 'string'
        || result.data.length > Math.ceil((10 * 1024 * 1024 * 4) / 3) + 8) {
        throw new Error('The server returned an invalid attachment.');
      }
      const binary = atob(result.data);
      if (binary.length > 10 * 1024 * 1024) throw new Error('The attachment exceeds the device download limit.');
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      cached = new File(Paths.cache, `beni-${Date.now().toString(36)}-${match[1]}`);
      cached.create();
      cached.write(bytes);
      if (!await Sharing.isAvailableAsync()) throw new Error('Secure file sharing is unavailable on this device.');
      await Sharing.shareAsync(cached.uri, { mimeType: result.mimeType, dialogTitle: 'Open leave attachment' });
    } catch (error) {
      Alert.alert('Attachment unavailable', error instanceof Error ? error.message : 'Could not open the attachment.');
    } finally {
      if (cached?.exists) cached.delete();
    }
  };
  const submit = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('startDate', startDate);
      form.append('endDate', endDate);
      form.append('reason', reason);
      if (category) form.append('category', category);
      if (attachment) form.append('file', {
        uri: attachment.uri, name: attachment.name, type: attachment.mimeType,
      } as unknown as Blob);
      return apiPostForSession<Leave>('/mobile/student/leave', selectedId!, form);
    },
    onSuccess: async () => {
      setEditing(false); setCategory(null); setStartDate(''); setEndDate(''); setReason(''); setAttachment(null);
      await queryClient.invalidateQueries({ queryKey: key });
      Alert.alert('Leave Applied', 'Your request has been submitted to your class teacher.');
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => apiPostForSession('/mobile/student/leave/delete', selectedId!, { id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const leaves = query.data ?? [];
  const canSubmit = /^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate)
    && startDate <= endDate && !!reason.trim() && session?.isActive === true;
  return <ModuleFrame title="Leave" subtitle={session?.sessionName ?? 'Leave applications'}>
    {session?.isActive && <Button label={editing ? 'Cancel application' : 'Apply for leave'} icon={editing ? 'x' : 'plus-circle'} onPress={() => setEditing(value => !value)} />}
    {!session?.isActive && session && <State title="Archived academic session" detail="New leave applications are available only in the active academic session." />}
    {editing && <Card>
      <CardTitle title="Apply for leave" />
      <Text style={{ color: c.mutedForeground }}>Leave category</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        {LEAVE_CATEGORIES.map(value => <Pressable key={value} accessibilityRole="button" onPress={() => setCategory(value)}
          style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16, backgroundColor: category === value ? c.primary : c.secondary }}>
          <Text style={{ color: category === value ? c.primaryForeground : c.secondaryForeground }}>{value}</Text>
        </Pressable>)}
      </View>
      <Field label="Start date (YYYY-MM-DD)" value={startDate} onChangeText={setStartDate} />
      <Field label="End date (YYYY-MM-DD)" value={endDate} onChangeText={setEndDate} />
      <View style={{ gap: 6 }}><Text style={{ color: c.foreground }}>Reason</Text><TextInput testID="leave-reason" accessibilityLabel="Reason" value={reason} onChangeText={setReason} multiline maxLength={2000} textAlignVertical="top" placeholder="Reason for leave" placeholderTextColor={c.mutedForeground} style={{ minHeight: 100, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 12, color: c.foreground, backgroundColor: c.card }} /></View>
      <Button label={attachment ? `Attachment: ${attachment.name}` : 'Add optional attachment'}
        icon={attachment ? 'file-text' : 'paperclip'} secondary onPress={() => { void chooseAttachment(); }} />
      {attachment && <Button label="Remove attachment" icon="x" secondary onPress={() => setAttachment(null)} />}
      {submit.error && <State title="Leave application failed" detail={submit.error.message} />}
      <Button label="Submit to class teacher" icon="send" disabled={!canSubmit || submit.isPending} onPress={() => submit.mutate()} />
      <Text style={{ color: c.mutedForeground, fontSize: 12 }}>Optional: JPG, PNG, GIF, WebP, PDF, DOC, or DOCX · max 10 MiB. Attachments are private to your account.</Text>
    </Card>}
    <QueryState loading={query.isPending} error={query.error} empty={!query.isPending && !query.error && leaves.length === 0} retry={() => { void query.refetch(); }} />
    {leaves.map(leave => <Card key={leave.id}>
      <CardTitle title={leave.category || 'Leave application'} trailing={leave.status.replaceAll('_', ' ')} />
      <Text style={{ color: c.foreground }}>{safeDate(leave.startDate)}{leave.startDate !== leave.endDate ? ` – ${safeDate(leave.endDate)}` : ''}</Text>
      <Text style={{ color: c.foreground }}>{leave.reason}</Text>
      {!!leave.rejectionReason && <Text style={{ color: c.destructive }}>Reason: {leave.rejectionReason}</Text>}
      {!!leave.attachmentUrl && <Button label="Open attachment" icon="external-link" secondary onPress={() => { void openLeaveAttachment(leave.attachmentUrl); }} />}
      {leave.status === 'pending_teacher' && session?.isActive && <Button label="Delete application" icon="trash-2" secondary onPress={() => Alert.alert('Delete application?', 'Only pending leave applications can be deleted.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(leave.id) },
      ])} />}
    </Card>)}
    {(submit.error || remove.error) && <State title="Leave request could not be updated" detail={(submit.error ?? remove.error)?.message} retry={() => { submit.reset(); remove.reset(); }} />}
  </ModuleFrame>;
}

export function StudentComplaintsScreen() {
  const c = useColors();
  const identity = useIdentityKey();
  const { sessions, selectedId } = useAcademicSession();
  const queryClient = useQueryClient();
  const session = sessions.find(item => item.id === selectedId);
  const [tab, setTab] = useState<'inbox' | 'filed' | 'staff' | 'peer'>('inbox');
  const [selected, setSelected] = useState<Complaint | null>(null);
  const [teacherId, setTeacherId] = useState<number | null>(null);
  const [staffContent, setStaffContent] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [suggestions, setSuggestions] = useState('');
  const [peerQuery, setPeerQuery] = useState('');
  const [peer, setPeer] = useState<Peer | null>(null);
  const [reportedName, setReportedName] = useState('');
  const [incidentDate, setIncidentDate] = useState('');
  const [peerContent, setPeerContent] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const inbox = useQuery({
    queryKey: ['mobile/student/complaints/inbox', ...identity, selectedId],
    enabled: selectedId !== null,
    queryFn: ({ signal }) => apiGetForSession<Complaint[]>('/mobile/student/complaints/inbox', selectedId!, { signal }),
    staleTime: 20_000,
  });
  const filed = useQuery({
    queryKey: ['mobile/student/complaints/filed', ...identity, selectedId],
    enabled: selectedId !== null,
    queryFn: ({ signal }) => apiGetForSession<Complaint[]>('/mobile/student/complaints/filed', selectedId!, { signal }),
    staleTime: 20_000,
  });
  const teachers = useQuery({
    queryKey: ['mobile/student/complaints/teachers', ...identity],
    enabled: tab === 'staff',
    queryFn: ({ signal }) => apiGet<ComplaintTeacher[]>('/mobile/student/complaints/teachers', { signal }),
  });
  const peers = useQuery({
    queryKey: ['mobile/student/complaints/peers', ...identity, selectedId, peerQuery],
    enabled: selectedId !== null && peerQuery.trim().length >= 2 && tab === 'peer',
    queryFn: ({ signal }) => apiGetForSession<Peer[]>(`/mobile/student/complaints/peers?q=${encodeURIComponent(peerQuery.trim())}`, selectedId!, { signal }),
  });
  const notes = useQuery({
    queryKey: ['mobile/student/complaints/notes', ...identity, selectedId, selected?.id],
    enabled: selectedId !== null && selected !== null,
    queryFn: ({ signal }) => apiGetForSession<ComplaintNote[]>(`/mobile/student/complaints/${selected!.id}/notes`, selectedId!, { signal }),
  });
  const refreshComplaints = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['mobile/student/complaints/inbox'] }),
      queryClient.invalidateQueries({ queryKey: ['mobile/student/complaints/filed'] }),
    ]);
  };
  const submitStaff = useMutation({
    mutationFn: () => apiPostForSession<Complaint>('/mobile/student/complaints/staff-grievance', selectedId!, {
      teacherId, content: staffContent, contactNumber, suggestions,
    }),
    onSuccess: async () => {
      setStaffContent(''); setContactNumber(''); setSuggestions(''); setTeacherId(null);
      await refreshComplaints(); setTab('filed');
    },
  });
  const submitPeer = useMutation({
    mutationFn: () => apiPostForSession<Complaint>('/mobile/student/complaints/peer-report', selectedId!, {
      reportedStudentName: peer?.name ?? reportedName, reportedStudentId: peer?.id,
      incidentDate: incidentDate || null, content: peerContent,
    }),
    onSuccess: async () => {
      setPeer(null); setReportedName(''); setIncidentDate(''); setPeerQuery(''); setPeerContent('');
      await refreshComplaints(); setTab('filed');
    },
  });
  const sendNote = useMutation({
    mutationFn: () => apiPostForSession<ComplaintNote>(
      `/mobile/student/complaints/${selected!.id}/notes`, selectedId!, { content: noteContent },
    ),
    onSuccess: async () => {
      setNoteContent('');
      await Promise.all([notes.refetch(), refreshComplaints()]);
    },
  });
  const buttons: { id: typeof tab; label: string }[] = [
    { id: 'inbox', label: 'Inbox' }, { id: 'filed', label: 'Filed by me' },
    { id: 'staff', label: 'Staff grievance' }, { id: 'peer', label: 'Peer report' },
  ];
  const shown = tab === 'inbox' ? inbox.data ?? []
    : tab === 'filed' ? filed.data ?? []
      : (filed.data ?? []).filter(item => item.complaintType === (tab === 'staff' ? 'student-to-staff' : 'student-peer-report'));
  const listQuery = tab === 'inbox' ? inbox : filed;
  const writable = session?.isActive === true;
  return <ModuleFrame title="Complaints" subtitle={session?.sessionName ?? 'Complaint inbox and reports'}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 12 }}>
      {buttons.map(button => <Pressable key={button.id} accessibilityRole="button"
        accessibilityState={{ selected: tab === button.id }} onPress={() => setTab(button.id)}
        style={{ paddingHorizontal: 11, paddingVertical: 8, borderRadius: 18, backgroundColor: tab === button.id ? c.primary : c.secondary }}>
        <Text style={{ color: tab === button.id ? c.primaryForeground : c.secondaryForeground, fontSize: 13 }}>{button.label}</Text>
      </Pressable>)}
    </View>
    {!writable && <Text style={{ color: c.mutedForeground, marginBottom: 10 }}>Archived complaint records are read-only.</Text>}
    {(tab === 'inbox' || tab === 'filed' || tab === 'staff' || tab === 'peer') && (tab === 'inbox' || tab === 'filed')
      ? <QueryState loading={listQuery.isPending} error={listQuery.error} empty={!listQuery.isPending && !listQuery.error && shown.length === 0} retry={() => { void listQuery.refetch(); }} />
      : null}
    {(tab === 'staff' || tab === 'peer') && !writable && <State title="Archived academic session" detail="Reports cannot be created in an archived academic session." />}
    {(tab === 'staff' || tab === 'peer') && writable && <Card>
      <CardTitle title={tab === 'staff' ? 'Submit a staff grievance' : 'Report a peer incident'} />
      {tab === 'staff' ? <>
        <Text style={{ color: c.foreground }}>Choose staff member</Text>
        {teachers.isPending && <State title="Loading faculty" loading />}
        {!!teachers.error && <State title="Faculty unavailable" detail={teachers.error.message} retry={() => { void teachers.refetch(); }} />}
        <View style={{ gap: 7, maxHeight: 220 }}>
          {(teachers.data ?? []).map(person => <Pressable key={person.id} accessibilityRole="button"
            accessibilityState={{ selected: teacherId === person.id }} onPress={() => setTeacherId(person.id)}
            style={{ borderWidth: 1, borderColor: teacherId === person.id ? c.primary : c.border, padding: 10, borderRadius: 8 }}>
            <Text style={{ color: c.foreground, fontWeight: teacherId === person.id ? '700' : '400' }}>{person.name}{person.subject ? ` · ${person.subject}` : ''}</Text>
          </Pressable>)}
        </View>
        <TextInput testID="complaint-staff-content" accessibilityLabel="Complaint description" multiline value={staffContent} onChangeText={setStaffContent} placeholder="Describe your concern" placeholderTextColor={c.mutedForeground} style={{ minHeight: 90, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 12, color: c.foreground, backgroundColor: c.card }} />
        <Field label="Contact number (optional)" value={contactNumber} onChangeText={setContactNumber} keyboardType="phone-pad" />
        <TextInput accessibilityLabel="Suggestions (optional)" multiline value={suggestions} onChangeText={setSuggestions} placeholder="Suggestions (optional)" placeholderTextColor={c.mutedForeground} style={{ minHeight: 72, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 12, color: c.foreground, backgroundColor: c.card }} />
        {!!submitStaff.error && <State title="Grievance could not be submitted" detail={submitStaff.error.message} />}
        <Button label="Submit grievance" icon="send" disabled={!teacherId || !staffContent.trim() || submitStaff.isPending} onPress={() => submitStaff.mutate()} />
      </> : <>
        <TextInput testID="complaint-peer-search" accessibilityLabel="Search for a student" value={peerQuery} onChangeText={value => { setPeerQuery(value); setPeer(null); }}
          placeholder="Search another student (optional)" placeholderTextColor={c.mutedForeground}
          style={{ minHeight: 48, borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 12, color: c.foreground, backgroundColor: c.card }} />
        {peers.isFetching && <Text style={{ color: c.mutedForeground }}>Searching Students…</Text>}
        {(peers.data ?? []).map(person => <Pressable key={person.id} onPress={() => { setPeer(person); setReportedName(person.name); }}
          style={{ padding: 10, borderRadius: 8, borderWidth: 1, borderColor: peer?.id === person.id ? c.primary : c.border }}>
          <Text style={{ color: c.foreground }}>{person.name} · Class {person.class ?? '—'} {person.section ?? ''}</Text>
        </Pressable>)}
        <Field label="Reported Student name" value={peer ? peer.name : reportedName} onChangeText={value => { setReportedName(value); setPeer(null); }} disabled={!!peer} />
        <Field label="Incident date (YYYY-MM-DD, optional)" value={incidentDate} onChangeText={setIncidentDate} />
        <TextInput testID="complaint-peer-content" accessibilityLabel="Incident description" multiline value={peerContent} onChangeText={setPeerContent} placeholder="Describe the incident" placeholderTextColor={c.mutedForeground} style={{ minHeight: 90, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 12, color: c.foreground, backgroundColor: c.card }} />
        {!!submitPeer.error && <State title="Peer report could not be submitted" detail={submitPeer.error.message} />}
        <Button label="Submit peer report" icon="send" disabled={!reportedName.trim() || !peerContent.trim() || submitPeer.isPending} onPress={() => submitPeer.mutate()} />
      </>}
    </Card>}
    {(tab === 'inbox' || tab === 'filed') && shown.map(complaint => <Pressable key={complaint.id} accessibilityRole="button" onPress={() => { setSelected(complaint); setNoteContent(''); }}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <CardTitle title={`Ticket ${complaint.ticketId}`} trailing={complaint.status} />
        </View>
        <Text style={{ color: c.foreground }} numberOfLines={3}>{complaint.content}</Text>
        <Text style={{ color: c.mutedForeground, fontSize: 12 }}>
          {complaint.complaintType === 'teacher-to-student' ? `From ${complaint.teacherName ?? 'teacher'}` :
            complaint.complaintType === 'student-to-staff' ? `Staff: ${complaint.teacherName ?? 'School staff'}` :
              complaint.reportedStudentName ? `Reported: ${complaint.reportedStudentName}` : complaint.complaintType}
        </Text>
        <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{formatSchoolInstant(complaint.createdAt)} · Open conversation</Text>
      </Card>
    </Pressable>)}
    {selected && <Modal visible transparent animationType="slide" onRequestClose={() => setSelected(null)}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0008' }}>
        <View style={{ maxHeight: '90%', backgroundColor: c.background, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, gap: 12 }}>
          <CardTitle title={`Ticket ${selected.ticketId}`} trailing={selected.status} />
          <Text style={{ color: c.foreground }}>{selected.content}</Text>
          {!!selected.resolutionRemarks && <Text style={{ color: c.mutedForeground }}>Resolution: {selected.resolutionRemarks}</Text>}
          <Text style={{ color: c.foreground, fontWeight: '600' }}>Conversation</Text>
          {notes.isPending && <State title="Loading conversation" loading />}
          {!!notes.error && <State title="Conversation unavailable" detail={notes.error.message} retry={() => { void notes.refetch(); }} />}
          {(notes.data ?? []).map(note => <View key={note.id} style={{ backgroundColor: c.card, borderRadius: 8, borderWidth: 1, borderColor: c.border, padding: 11, gap: 5 }}>
            <Text style={{ color: c.foreground, fontWeight: '600' }}>{note.authorName} · {note.authorRole}</Text>
            <Text style={{ color: c.foreground }}>{note.content}</Text>
            <Text style={{ color: c.mutedForeground, fontSize: 11 }}>{formatSchoolInstant(note.createdAt)}</Text>
          </View>)}
          {writable && <TextInput accessibilityLabel="Reply to complaint" value={noteContent} onChangeText={setNoteContent} multiline placeholder="Write a reply" placeholderTextColor={c.mutedForeground} style={{ minHeight: 65, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 12, color: c.foreground, backgroundColor: c.card }} />}
          {!!sendNote.error && <State title="Reply not sent" detail={sendNote.error.message} />}
          {writable && <Button label="Send reply" icon="send" disabled={!noteContent.trim() || sendNote.isPending} onPress={() => sendNote.mutate()} />}
          <Button label="Close" secondary onPress={() => setSelected(null)} />
        </View>
      </View>
    </Modal>}
  </ModuleFrame>;
}

type ArchiveAttendance = {
  overallPercent: number; workingDays: number; daysPresent: number; totalPresent: number;
  totalAbsent: number; totalHalfDay: number; totalLate: number; totalLeave: number;
};

export function StudentArchivesScreen() {
  const c = useColors();
  const identity = useIdentityKey();
  const { sessions, selectedId, select } = useAcademicSession();
  const [tab, setTab] = useState<'reports' | 'fees' | 'attendance'>('reports');
  const [examType, setExamType] = useState<string | null>(null);
  const selected = sessions.find(item => item.id === selectedId);
  const archives = sessions.filter(item => !item.isActive).sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''));
  const types = useQuery({
    queryKey: ['mobile/student/archive/examination/types', ...identity, selectedId],
    enabled: selectedId !== null && selected?.isActive === false,
    queryFn: ({ signal }) => apiGetForSession<{ examTypes: string[] }>('/mobile/student/examination/types', selectedId!, { signal }),
  });
  const scores = useQuery({
    queryKey: ['mobile/student/archive/examination/scores', ...identity, selectedId, examType],
    enabled: selectedId !== null && selected?.isActive === false && !!examType,
    queryFn: ({ signal }) => apiGetForSession<{ scores: ExamScore[]; class: string; examType: string }>(
      `/mobile/student/examination/scores?examType=${encodeURIComponent(examType!)}`, selectedId!, { signal }),
  });
  const journey = useQuery({
    queryKey: ['mobile/student/archive/examination/journey', ...identity, selectedId],
    enabled: selectedId !== null && selected?.isActive === false,
    queryFn: ({ signal }) => apiGetForSession<{ journey: { cls: string; examType: string; percentage: number }[] }>(
      '/mobile/student/examination/journey', selectedId!, { signal }),
  });
  const fees = useQuery({
    queryKey: ['mobile/student/archive/fees', ...identity, selectedId],
    enabled: selectedId !== null && selected?.isActive === false && tab === 'fees',
    queryFn: ({ signal }) => apiGetForSession<Fee[]>('/mobile/student/fees', selectedId!, { signal }),
  });
  const attendance = useQuery({
    queryKey: ['mobile/student/archive/attendance', ...identity, selectedId, selected?.startDate, selected?.endDate],
    enabled: selectedId !== null && selected?.isActive === false && tab === 'attendance' && !!selected?.startDate && !!selected.endDate,
    queryFn: ({ signal }) => apiGetForSession<ArchiveAttendance>(
      `/mobile/student/attendance/stats?startDate=${encodeURIComponent(selected!.startDate!)}&endDate=${encodeURIComponent(selected!.endDate!)}`,
      selectedId!, { signal }),
  });
  const scoreRows = scores.data?.scores ?? [];
  const scoreTotal = scoreRows.reduce((sum, item) => sum + item.totalMarks, 0);
  const obtained = scoreRows.filter(item => !item.isAbsent).reduce((sum, item) => sum + item.marks, 0);
  async function openArchive(sessionId: number) {
    setExamType(null);
    try { await select(sessionId); }
    catch (error) { Alert.alert('Archive unavailable', error instanceof Error ? error.message : 'Unable to open the selected archive.'); }
  }
  return <ModuleFrame title="Student Archives" subtitle="Past session report cards, fee ledger and attendance">
    {archives.length === 0 ? <State title="No academic archives" detail="Past academic sessions are not available for this Student account." /> : <>
      <Text style={{ color: c.foreground, fontWeight: '600', marginBottom: 7 }}>Academic year</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {archives.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: selectedId === item.id }}
          testID={`archive-session-${item.id}`} onPress={() => { void openArchive(item.id); }}
          style={{ paddingHorizontal: 12, paddingVertical: 9, borderRadius: 18, backgroundColor: selectedId === item.id ? c.primary : c.secondary }}>
          <Text style={{ color: selectedId === item.id ? c.primaryForeground : c.secondaryForeground }}>{item.sessionName}</Text>
        </Pressable>)}
      </View>
      {selected?.isActive !== false
        ? <State title="Choose an archived session" detail="Select a past academic year to view its records." />
        : <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 12 }}>
            {([{ id: 'reports', label: 'Report cards' }, { id: 'fees', label: 'Fee ledger' }, { id: 'attendance', label: 'Attendance' }] as const)
              .map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: tab === item.id }} onPress={() => setTab(item.id)}
                style={{ borderRadius: 17, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: tab === item.id ? c.primary : c.secondary }}>
                <Text style={{ color: tab === item.id ? c.primaryForeground : c.secondaryForeground }}>{item.label}</Text>
              </Pressable>)}
          </View>
          {tab === 'reports' && <>
            {!!types.error && <State title="Archived examinations unavailable" detail={types.error.message} retry={() => { void types.refetch(); }} />}
            {types.isPending && <State title="Loading archived examinations" loading />}
            <Card>
              <CardTitle title="Session examination journey" trailing={selected.sessionName} />
              {journey.error && <State title="Journey unavailable" detail={journey.error.message} retry={() => { void journey.refetch(); }} />}
              {journey.isPending && <State title="Loading exam journey" loading />}
              {!journey.isPending && !journey.error && (journey.data?.journey.length ?? 0) === 0
                && <Text style={{ color: c.mutedForeground }}>No final-exam history is available for this archived session.</Text>}
              {(journey.data?.journey ?? []).map((item, index) => <View key={`${item.cls}-${item.examType}-${index}`}
                style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: c.border }}>
                <Text style={{ color: c.foreground }}>Class {item.cls} · {item.examType}</Text>
                <Text style={{ color: c.primary, fontWeight: '700' }}>{item.percentage}%</Text>
              </View>)}
            </Card>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
              {(types.data?.examTypes ?? []).map(type => <Pressable key={type} accessibilityRole="button" onPress={() => setExamType(type)}
                style={{ borderRadius: 16, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: examType === type ? c.primary : c.secondary }}>
                <Text style={{ color: examType === type ? c.primaryForeground : c.secondaryForeground }}>{type}</Text>
              </Pressable>)}
            </View>
            {examType && <QueryState loading={scores.isPending} error={scores.error} empty={!scores.isPending && !scores.error && scoreRows.length === 0} retry={() => { void scores.refetch(); }} />}
            {examType && scoreRows.length > 0 && <>
              <Card><CardTitle title={`${examType} · Class ${scores.data?.class ?? ''}`} /><Text style={{ color: c.foreground, fontSize: 20, fontWeight: '700' }}>{obtained} / {scoreTotal}{scoreTotal ? ` · ${Math.round(obtained / scoreTotal * 1000) / 10}%` : ''}</Text></Card>
              {scoreRows.map(score => <Card key={score.id}><CardTitle title={score.subject} trailing={score.isAbsent ? 'Absent' : `${score.marks} / ${score.totalMarks}`} /><Text style={{ color: c.mutedForeground }}>Pass marks: {score.passMarks}</Text></Card>)}
            </>}
          </>}
          {tab === 'fees' && <>
            <QueryState loading={fees.isPending} error={fees.error} empty={!fees.isPending && !fees.error && (fees.data?.length ?? 0) === 0} retry={() => { void fees.refetch(); }} />
            {(fees.data ?? []).map(record => <Card key={record.id}><CardTitle title={record.feeType} trailing={record.status} /><Text style={{ color: c.foreground, fontWeight: '700' }}>{amount(record.amount + (record.lateFeeAmount ?? 0))}</Text><Text style={{ color: c.mutedForeground }}>Due {safeDate(record.dueDate)}{record.paidDate ? ` · Paid ${safeDate(record.paidDate)}` : ''}</Text>{!!record.academicYear && <Text style={{ color: c.mutedForeground }}>{record.academicYear}</Text>}</Card>)}
          </>}
          {tab === 'attendance' && <>
            <QueryState loading={attendance.isPending} error={attendance.error} empty={false} retry={() => { void attendance.refetch(); }} />
            {attendance.data && <Card>
              <CardTitle title="Session attendance" trailing={`${attendance.data.overallPercent}%`} />
              {[
                ['Working days', attendance.data.workingDays], ['Present', attendance.data.totalPresent],
                ['Absent', attendance.data.totalAbsent], ['Half day', attendance.data.totalHalfDay],
                ['Late', attendance.data.totalLate], ['Leave', attendance.data.totalLeave],
              ].map(([label, value]) => <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: c.mutedForeground }}>{label}</Text><Text style={{ color: c.foreground }}>{value}</Text></View>)}
            </Card>}
          </>}
        </>}
    </>}
  </ModuleFrame>;
}
