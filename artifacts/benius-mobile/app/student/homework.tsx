import React, { useEffect, useRef, useState } from 'react';
import { Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as DocumentPicker from 'expo-document-picker';
import * as WebBrowser from 'expo-web-browser';
import * as Sharing from 'expo-sharing';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { useAcademicSession } from '@/contexts/SessionContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { apiGetForSession, apiGetPrivateHomeworkFile, apiPostForSession } from '@/lib/api';
import { classifyHomeworkFile } from '@/lib/private-homework-download.mjs';
import { persistPrivateHomeworkFile, removePrivateHomeworkFile } from '@/lib/homework-private-files';
import { homeworkStatus, istToday, monthGrid, shiftMonth, validDate, validHomeworkFile, weekDates } from '@/lib/student-homework-pure.mjs';

const C = {
  canvas: '#F5F9FC', paper: '#FFFEFC', ink: '#263446', soft: '#7F8B9B', line: '#E5EAF0',
  mint: '#13A987', mintPale: '#E7F8F1', blue: '#3971AB', bluePale: '#E9F3FF',
  red: '#B64A55', redPale: '#FFF0EF', amber: '#A46B29', amberPale: '#FFF5DE',
  violet: '#7956A6', violetPale: '#F5EDFF', pink: '#BA4E80', pinkPale: '#FFF0F6',
};
type Submission = { id: number; homeworkId: number; studentId: number; status: string; fileUrl: string | null; textAnswer: string | null; submittedAt: string };
type Homework = { id: number; subject: string; content: string; fileUrl: string | null; dueDate: string | null; createdAt: string; teacherName: string; submission: Submission | null };
type Picked = { uri: string; name: string; mimeType: string; size: number };
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const subjectTones: Record<string, [string, string]> = {
  mathematics: [C.blue, C.bluePale], math: [C.blue, C.bluePale], science: [C.violet, C.violetPale],
  english: [C.pink, C.pinkPale], history: [C.amber, C.amberPale], geography: [C.mint, C.mintPale],
  physics: [C.violet, C.violetPale], chemistry: [C.amber, C.amberPale], biology: [C.mint, C.mintPale],
};
const tone = (subject: string) => subjectTones[subject.toLowerCase()] ?? [C.mint, C.mintPale];
const shortDate = (date: string) => validDate(date.slice(0, 10))
  ? new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—';
const fullDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
function parseHomework(value: unknown): Homework {
  if (!value || typeof value !== 'object') throw new Error('Invalid homework received.');
  const h = value as Homework;
  if (!Number.isSafeInteger(h.id) || h.id <= 0 || typeof h.subject !== 'string' || typeof h.content !== 'string'
    || typeof h.teacherName !== 'string' || typeof h.createdAt !== 'string'
    || (h.dueDate !== null && h.dueDate !== undefined && !validDate(h.dueDate))
    || (h.fileUrl !== null && h.fileUrl !== undefined && typeof h.fileUrl !== 'string')
    || (h.submission != null && (typeof h.submission !== 'object' || typeof h.submission.status !== 'string'))) throw new Error('Invalid homework received.');
  return h;
}
function Status({ submission }: { submission: Submission | null }) {
  const status = homeworkStatus(submission);
  const color = status === 'Completed' ? C.mint : status === 'Submitted' ? C.blue : C.red;
  const bg = status === 'Completed' ? C.mintPale : status === 'Submitted' ? C.bluePale : C.redPale;
  return <View style={[s.status, { backgroundColor: bg, borderColor: color + '40' }]}>
    <Feather name={status === 'Pending' ? 'clock' : 'check-circle'} size={10} color={color} />
    <Text style={[s.statusText, { color }]}>{status}</Text>
  </View>;
}
function Message({ title, detail, retry }: { title: string; detail: string; retry?: () => void }) {
  return <View style={s.message}><View style={s.messageIcon}><Feather name={retry ? 'wifi-off' : 'book-open'} size={28} color={C.mint} /></View>
    <Text style={s.messageTitle}>{title}</Text><Text style={s.messageBody}>{detail}</Text>
    {retry && <Pressable testID="homework-retry" onPress={retry} style={s.retry}><Feather name="refresh-cw" size={15} color={C.paper} /><Text style={s.retryText}>Try again</Text></Pressable>}
  </View>;
}
function Skeletons() {
  return <View style={s.grid}>{[0, 1, 2, 3].map(i => <View key={i} style={[s.card, { height: 200 }]}>
    <View style={[s.skeleton, { width: '70%', height: 18 }]} /><View style={[s.skeleton, { width: '95%', height: 12, marginTop: 20 }]} /><View style={[s.skeleton, { width: '80%', height: 12 }]} />
  </View>)}</View>;
}
function HomeworkCard({ item, today, onPress }: { item: Homework; today: string; onPress: () => void }) {
  const [color, bg] = tone(item.subject);
  const overdue = !!item.dueDate && item.dueDate < today && !item.submission;
  return <Pressable testID={`card-homework-${item.id}`} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.card, pressed && { opacity: .78 }]}>
    <View style={s.cardTags}><View style={[s.subject, { backgroundColor: bg, borderColor: color + '36' }]}><Text numberOfLines={1} style={[s.subjectText, { color }]}>{item.subject}</Text></View><Status submission={item.submission} /></View>
    <Text numberOfLines={3} style={s.cardContent}>{item.content}</Text>
    <View style={s.cardMeta}><Text numberOfLines={2} style={[s.metaSmall, { flex: 1 }]}>By {item.teacherName}</Text><View style={{ alignItems: 'flex-end', flex: 1.3 }}>
      <Text style={s.metaSmall}>Assigned: {shortDate(item.createdAt)}</Text>{item.dueDate && <Text style={[s.metaSmall, overdue && { color: C.red, fontWeight: '700' }]}>Due: {shortDate(item.dueDate)}</Text>}
    </View></View>
    {!!item.fileUrl && <View style={s.attachmentHint}><Feather name="file-text" size={11} color={C.mint} /><Text style={s.attachmentHintText}>Attachment available</Text></View>}
  </Pressable>;
}
function Calendar({ value, today, pending, pendingError, pendingLoading, month, setMonth, onClose, onSelect, retry }: {
  value: string; today: string; pending: string[]; pendingError: boolean; pendingLoading: boolean;
  month: string; setMonth: (month: string) => void; onClose: () => void; onSelect: (date: string) => void; retry: () => void;
}) {
  const days = monthGrid(month);
  const label = new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return <Modal transparent animationType="fade" visible onRequestClose={onClose}>
    <View style={s.modalOverlay}><Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close calendar" />
      <View style={s.calendar}>
        <View style={s.calendarHeader}>
          <Pressable testID="datepicker-prev-month" disabled={month <= '0001-01'} onPress={() => setMonth(shiftMonth(month, -1))} style={[s.calendarArrow, month <= '0001-01' && { opacity: .3 }]}><Feather name="chevron-left" size={21} color={C.ink} /></Pressable>
          <Text style={s.calendarTitle}>{label}</Text>
          <Pressable testID="datepicker-next-month" disabled={month >= today.slice(0, 7)} onPress={() => setMonth(shiftMonth(month, 1))} style={[s.calendarArrow, month >= today.slice(0, 7) && { opacity: .3 }]}><Feather name="chevron-right" size={21} color={C.ink} /></Pressable>
        </View>
        <View style={s.calendarGrid}>{['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => <Text key={day} style={s.calendarWeekday}>{day}</Text>)}
          {days.map((date, i) => date ? <Pressable key={date} testID={`datepicker-day-${date}`} disabled={date > today} onPress={() => onSelect(date)}
              style={[s.calendarDay, date === value && { backgroundColor: C.mint }, date === today && date !== value && { backgroundColor: C.mintPale }]}>
              <Text style={[s.calendarNumber, date > today && { color: '#CBD4DB' }, date === value && { color: C.paper }]}>{Number(date.slice(-2))}</Text>
              <View style={[s.calendarDot, pending.includes(date) && date <= today && { backgroundColor: date === value ? C.paper : C.red }]} />
            </Pressable> : <View key={`blank-${i}`} style={s.calendarDay} />)}
        </View>
        {pendingLoading && <Text style={s.calendarNote}>Loading pending dates…</Text>}
        {pendingError && <Pressable onPress={retry} style={s.calendarError}><Text style={s.calendarNote}>Pending indicators unavailable. Tap to retry.</Text></Pressable>}
        <Pressable testID="datepicker-close" onPress={onClose} style={s.calendarClose}><Text style={s.calendarNote}>Cancel</Text></Pressable>
      </View>
    </View>
  </Modal>;
}
function HomeworkDrawer({ item, sessionId, archive, online, identity, onClose, onSubmitted }: {
  item: Homework; sessionId: number; archive: boolean; online: boolean; identity: string;
  onClose: () => void; onSubmitted: (late: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [answer, setAnswer] = useState<string | null>(null);
  const [file, setFile] = useState<Picked | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [opening, setOpening] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const cachedFile = useRef<string | null>(null);
  const download = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      download.current?.abort();
      removePrivateHomeworkFile(cachedFile.current);
    };
  }, []);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const detail = useQuery({
    queryKey: ['mobile/student/homework/detail', identity, item.id],
    queryFn: async ({ signal }) => {
      const result = parseHomework(await apiGetForSession<unknown>(`/mobile/student/homework/${item.id}`, sessionId, { signal }));
      if (result.id !== item.id) throw new Error('Homework detail did not match the selected assignment.');
      return result;
    },
    enabled: online, staleTime: 0, refetchOnMount: 'always',
  });
  const hw = detail.data;
  const text = answer ?? hw?.submission?.textAnswer ?? '';
  const approved = hw?.submission?.status === 'approved';
  const canEdit = !!hw && !archive && !approved && online;
  const today = istToday();
  const pick = async () => {
    setError('');
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], multiple: false, copyToCacheDirectory: true });
      if (result.canceled) return;
      const asset = result.assets[0];
      const selected = { uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? '', size: asset.size ?? 0 };
      if (!validHomeworkFile(selected)) { setError('Choose a JPG, PNG, WebP or PDF file under 10 MiB.'); return; }
      setFile(selected);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not open files.'); }
  };
  const openFile = async (raw: string) => {
    if (opening) return;
    setError('');
    const fileAddress = classifyHomeworkFile(raw, process.env.EXPO_PUBLIC_DOMAIN);
    if (!fileAddress) { setError('This attachment has an invalid address.'); return; }
    if (fileAddress.kind === 'legacy') {
      // Public historic uploads retain their old read-only behavior. Never send a bearer here.
      if (['jpg', 'jpeg', 'png', 'webp'].includes(fileAddress.extension)) setPreview(fileAddress.url);
      else {
        try { await WebBrowser.openBrowserAsync(fileAddress.url); }
        catch { setError('Could not open the document in your browser.'); }
      }
      return;
    }
    if (Platform.OS === 'web') { setError('Private attachments can be opened in BENIUS Mobile on a device.'); return; }
    const controller = new AbortController();
    download.current = controller;
    setOpening(true);
    try {
      const { bytes, generation } = await apiGetPrivateHomeworkFile(fileAddress.path, sessionId, { signal: controller.signal });
      if (!mounted.current || controller.signal.aborted) return;
      const uri = persistPrivateHomeworkFile(bytes, fileAddress.extension, generation);
      if (!mounted.current || controller.signal.aborted) { removePrivateHomeworkFile(uri); return; }
      removePrivateHomeworkFile(cachedFile.current);
      cachedFile.current = uri;
      if (fileAddress.extension !== 'pdf') setPreview(uri);
      else {
        if (!await Sharing.isAvailableAsync()) throw new Error('No document viewer is available on this device.');
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Open homework document' });
        if (cachedFile.current === uri) cachedFile.current = null;
        removePrivateHomeworkFile(uri);
      }
    } catch (reason) {
      if (mounted.current && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not open attachment.');
    } finally {
      if (download.current === controller) download.current = null;
      if (mounted.current) setOpening(false);
    }
  };
  const closePreview = () => {
    setPreview(null);
    removePrivateHomeworkFile(cachedFile.current);
    cachedFile.current = null;
  };
  const sharePreview = async () => {
    if (!cachedFile.current) return;
    try {
      if (!await Sharing.isAvailableAsync()) throw new Error('Sharing is not available on this device.');
      await Sharing.shareAsync(cachedFile.current);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not share the image.'); }
  };
  const submit = async () => {
    if (!canEdit || sending || !hw || currentIdentity.current !== identity) return;
    if (!text.trim() && !file) { setError('Write an answer or select a file first.'); return; }
    if (text.length > 5000) { setError('The answer must be 5,000 characters or less.'); return; }
    setError(''); setSending(true);
    const form = new FormData();
    if (text.trim()) form.append('textAnswer', text.trim());
    if (file) form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
    try {
      const result = await apiPostForSession<{ isLate: boolean }>(`/mobile/student/homework/${hw.id}/submit`, sessionId, form);
      if (currentIdentity.current !== identity) return;
      onSubmitted(result.isLate === true);
    } catch (reason) {
      if (currentIdentity.current === identity) setError(reason instanceof Error ? reason.message : 'Could not submit homework.');
    } finally { if (currentIdentity.current === identity) setSending(false); }
  };
  return <Modal transparent visible animationType="slide" onRequestClose={onClose}>
    <View style={s.drawerOverlay}><Pressable accessibilityLabel="Close homework detail" onPress={onClose} style={StyleSheet.absoluteFill} />
      <View style={[s.drawer, { maxHeight: height * .9, paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={s.drawerHeader}>
          <View style={s.drawerTags}><View style={[s.subject, { backgroundColor: tone(item.subject)[1], borderColor: tone(item.subject)[0] + '36' }]}><Text style={[s.subjectText, { color: tone(item.subject)[0] }]}>{item.subject}</Text></View><Status submission={hw?.submission ?? item.submission} /></View>
          <Pressable testID="button-close-drawer" onPress={onClose} style={s.closeButton}><Feather name="x" size={19} color={C.ink} /></Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.drawerContent}>
          {!online && !hw ? <Message title="You're offline" detail="Reconnect to load this assignment." /> :
            detail.isError ? <Message title="Could not load assignment" detail={detail.error instanceof Error ? detail.error.message : 'Please try again.'} retry={() => { void detail.refetch(); }} /> :
            !hw ? <View style={s.detailLoading}><View style={[s.skeleton, { width: '50%', height: 16 }]} /><View style={[s.skeleton, { width: '100%', height: 80 }]} /></View> : <>
              <Text style={s.drawerEyebrow}>Assigned by {hw.teacherName}</Text>
              <Text style={s.drawerMeta}>Assigned {shortDate(hw.createdAt)}{hw.dueDate ? `   ·   Due ${shortDate(hw.dueDate)}` : ''}</Text>
              <View style={s.drawerSection}><Text style={s.sectionLabel}>Instructions</Text><Text style={s.instructions}>{hw.content}</Text></View>
              {hw.fileUrl && <View style={s.drawerSection}><Text style={s.sectionLabel}>Attached resource</Text>
                <Pressable testID="link-homework-attachment" disabled={opening} onPress={() => { void openFile(hw.fileUrl!); }} style={s.fileLink}><Feather name="file-text" size={17} color={C.soft} /><Text style={s.fileLinkText}>{opening ? 'Opening attachment…' : 'View attachment'}</Text><Feather name="external-link" size={14} color={C.mint} /></Pressable>
              </View>}
              {hw.submission && <View style={[s.previous, { backgroundColor: approved ? C.mintPale : hw.submission.status === 'rejected' ? C.amberPale : C.bluePale }]}>
                <Text style={s.sectionLabel}>{hw.submission.status === 'rejected' ? 'Returned for revision' : 'Current submission'}</Text>
                <Text style={s.drawerMeta}>Submitted {shortDate(hw.submission.submittedAt)}</Text>
                {!!hw.submission.textAnswer && <Text style={s.previousAnswer}>{hw.submission.textAnswer}</Text>}
                {!!hw.submission.fileUrl && <Pressable testID="link-submission-file" disabled={opening} onPress={() => { void openFile(hw.submission!.fileUrl!); }} style={s.previousLink}><Feather name="external-link" size={13} color={C.blue} /><Text style={{ color: C.blue, fontSize: 12, fontWeight: '700' }}>{opening ? 'Opening file…' : 'View submitted file'}</Text></Pressable>}
              </View>}
              {approved ? <View style={[s.notice, { backgroundColor: C.mintPale }]}><Feather name="lock" size={16} color={C.mint} /><Text style={[s.noticeText, { color: C.mint }]}>This homework has been approved.</Text></View>
                : archive ? <View testID="banner-archive-hw" style={s.notice}><Feather name="lock" size={16} color={C.amber} /><Text style={s.noticeText}>Archive mode is read only. Switch to the active session to submit.</Text></View>
                : !online ? <View style={s.notice}><Feather name="wifi-off" size={16} color={C.amber} /><Text style={s.noticeText}>Connect to submit or update your answer.</Text></View>
                : <View style={s.drawerSection}>
                  <Text style={s.sectionLabel}>{hw.submission?.status === 'rejected' ? 'Revise & resubmit' : hw.submission ? 'Update submission' : 'Submit homework'}</Text>
                  {!!hw.dueDate && hw.dueDate < today && <View style={[s.notice, { marginTop: 10 }]}><Feather name="alert-circle" size={16} color={C.amber} /><Text style={s.noticeText}>Past due date — late submission is still accepted.</Text></View>}
                  <Text style={s.fieldLabel}>Write answer</Text>
                  <TextInput testID="textarea-text-answer" multiline textAlignVertical="top" maxLength={5000} value={text} onChangeText={setAnswer}
                    placeholder="Type your answer, explanation, or solution here…" placeholderTextColor={C.soft} style={s.answerInput} />
                  <Text style={s.counter}>{text.length}/5000</Text>
                  <Text style={s.or}>and / or</Text>
                  <Text style={s.fieldLabel}>Upload file</Text>
                  <Pressable testID="dropzone-upload" onPress={() => { void pick(); }} style={s.upload}>
                    <Feather name={file ? 'file' : 'upload'} size={24} color={C.soft} />
                    <Text numberOfLines={2} style={s.uploadTitle}>{file?.name ?? 'Tap to select file'}</Text>
                    <Text style={s.uploadSub}>{file ? `${Math.ceil(file.size / 1024)} KB · ready to submit` : 'JPG, PNG, WebP or PDF · Max 10 MiB'}</Text>
                  </Pressable>
                  {file && <Pressable testID="button-remove-file" onPress={() => setFile(null)} style={s.remove}><Feather name="x" size={13} color={C.red} /><Text style={{ color: C.red, fontSize: 12 }}>Remove file</Text></Pressable>}
                </View>}
            </>}
          {!!error && <Text accessibilityRole="alert" style={s.errorText}>{error}</Text>}
        </ScrollView>
        {canEdit && <View style={s.drawerFooter}>
          <Pressable testID="button-submit-homework" accessibilityRole="button" disabled={sending || (!text.trim() && !file)} onPress={() => { void submit(); }}
            style={[s.submitButton, (sending || (!text.trim() && !file)) && { opacity: .5 }]}>
            <Feather name={hw?.submission ? 'refresh-cw' : 'send'} size={16} color={C.paper} /><Text style={s.submitText}>{sending ? 'Submitting…' : hw?.submission?.status === 'rejected' ? 'Resubmit homework' : hw?.submission ? 'Update submission' : 'Submit homework'}</Text>
          </Pressable>
          {!text.trim() && !file && <Text style={s.submitHint}>Write an answer or select a file to continue</Text>}
        </View>}
      </View>
    </View>
    <Modal visible={!!preview} transparent animationType="fade" onRequestClose={closePreview}>
      <View style={s.imageOverlay}><Pressable onPress={closePreview} style={s.previewClose}><Feather name="x" size={24} color={C.paper} /></Pressable>
        {!!cachedFile.current && <Pressable testID="share-private-homework-image" onPress={() => { void sharePreview(); }} style={s.previewShare}><Feather name="share" size={21} color={C.paper} /></Pressable>}
        {preview && <Image source={{ uri: preview }} resizeMode="contain" style={s.previewImage} />}</View>
    </Modal>
  </Modal>;
}
export default function StudentHomework() {
  const { user } = useAuth();
  const { sessions, selectedId, loading: sessionsLoading, error: sessionsError, refresh } = useAcademicSession();
  const { online } = useNetwork();
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const [today, setToday] = useState(() => istToday());
  const [date, setDate] = useState(() => istToday());
  const [calendar, setCalendar] = useState(false);
  const [month, setMonth] = useState(() => istToday().slice(0, 7));
  const [activeId, setActiveId] = useState<number | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const identity = `${user?.id ?? ''}:${user?.schoolId ?? ''}:${user?.role ?? ''}:${selectedId ?? ''}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  useEffect(() => { setActiveId(null); setCalendar(false); setConfirmation(''); }, [identity]);
  useEffect(() => {
    const timer = setInterval(() => {
      const current = istToday();
      setToday(current);
      setDate(previous => previous > current ? current : previous);
    }, 30000);
    return () => clearInterval(timer);
  }, []);
  const session = sessions.find(s => s.id === selectedId);
  const ready = user?.role === 'student' && !!session && !sessionsLoading && !sessionsError && online;
  const baseKey = ['mobile/student/homework', user?.id, user?.schoolId, user?.role, selectedId];
  const otherWeekMonth = weekDates(date).map(d => d.slice(0, 7)).find(m => m !== month) ?? null;
  const list = useQuery({
    queryKey: [...baseKey, date],
    queryFn: async ({ signal }) => {
      if (selectedId === null) throw new Error('Select a school year first.');
      const payload = await apiGetForSession<unknown>(`/mobile/student/homework?date=${encodeURIComponent(date)}`, selectedId, { signal });
      if (!Array.isArray(payload)) throw new Error('Invalid homework list received.');
      return payload.map(parseHomework);
    },
    enabled: !!ready && validDate(date), staleTime: 0, refetchOnMount: 'always',
  });
  const pending = useQuery({
    queryKey: [...baseKey, 'pending-dates', month],
    queryFn: async ({ signal }) => {
      if (selectedId === null) throw new Error('Select a school year first.');
      const payload = await apiGetForSession<unknown>(`/mobile/student/homework/pending-dates?month=${encodeURIComponent(month)}`, selectedId, { signal });
      if (!Array.isArray(payload) || !payload.every(validDate)) throw new Error('Invalid pending dates received.');
      return payload as string[];
    },
    enabled: !!ready && /^\d{4}-(0[1-9]|1[0-2])$/.test(month), staleTime: 60000,
  });
  const adjacentPending = useQuery({
    queryKey: [...baseKey, 'pending-dates', otherWeekMonth],
    queryFn: async ({ signal }) => {
      if (selectedId === null || !otherWeekMonth) throw new Error('Select a school year first.');
      const payload = await apiGetForSession<unknown>(`/mobile/student/homework/pending-dates?month=${encodeURIComponent(otherWeekMonth)}`, selectedId, { signal });
      if (!Array.isArray(payload) || !payload.every(validDate)) throw new Error('Invalid pending dates received.');
      return payload as string[];
    },
    enabled: !!ready && !!otherWeekMonth, staleTime: 60000,
  });
  if (!user || user.role !== 'student') return null;
  const items = session && !sessionsLoading && !sessionsError ? list.data : undefined;
  const select = (selected: string) => {
    if (selected > today || !validDate(selected)) return;
    setDate(selected); setMonth(selected.slice(0, 7)); setActiveId(null); setCalendar(false); setConfirmation('');
  };
  const active = items?.find(h => h.id === activeId);
  const onSubmitted = (late: boolean) => {
    if (identityRef.current !== identity) return;
    setActiveId(null);
    setConfirmation(late ? 'Submitted after the due date. Your teacher can review it now.' : 'Homework submitted. Your teacher can review it now.');
    void queryClient.invalidateQueries({ queryKey: baseKey });
  };
  return <View testID="student-homework" style={s.screen}>
    <View style={[s.header, { paddingTop: (Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top) + 8 }]}>
      <Pressable testID="button-back" accessibilityLabel="Back to dashboard" onPress={() => router.back()} style={s.back}><Feather name="arrow-left" size={20} color={C.ink} /></Pressable>
      <LinearGradient colors={['#E6A041', C.mint]} style={s.brandIcon}><Feather name="book-open" size={17} color={C.paper} /></LinearGradient>
      <View style={s.brandText}><Text style={s.headerTitle}>Homework</Text><Text numberOfLines={1} style={s.headerSubtitle}>{user.schoolName}</Text></View>
    </View>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[s.content, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'web' ? 34 : 16) + 35 }]}>
      {!online && <View style={s.offline}><Feather name="wifi-off" size={15} color={C.red} /><Text style={s.offlineText}>You're offline · Connect to refresh homework.</Text></View>}
      {!!session && !session.isActive && <View style={s.archive}><Feather name="lock" size={16} color={C.amber} /><Text style={s.archiveText}>Viewing {session.sessionName} archive · Read only</Text></View>}
      <View style={s.datePanel}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.dateStrip}>
          {weekDates(date).map(d => {
            const selected = date === d; const future = d > today;
            return <Pressable key={d} testID={`date-chip-${d}`} disabled={future} onPress={() => select(d)}
              style={[s.dateChip, selected && s.selectedChip]}>
              <Text style={[s.chipDay, selected && s.chipSelectedText, future && s.futureText]}>{WEEKDAYS[new Date(`${d}T12:00:00Z`).getUTCDay()]}</Text>
              <Text style={[s.chipNumber, selected && s.chipSelectedText, future && s.futureText]}>{Number(d.slice(-2))}</Text>
              <View style={[s.chipDot, (((pending.data?.includes(d) || adjacentPending.data?.includes(d)) && d <= today) || d === today) && { backgroundColor: selected ? C.paper : (pending.data?.includes(d) || adjacentPending.data?.includes(d)) ? C.red : C.mint }]} />
            </Pressable>;
          })}
          <Pressable testID="button-open-calendar" accessibilityLabel="Open date picker" onPress={() => { setMonth(date.slice(0, 7)); setCalendar(true); }} style={s.pickChip}><Feather name="calendar" size={19} color={C.soft} /><Text style={s.pickLabel}>Pick</Text></Pressable>
        </ScrollView>
        <Text style={s.dateCaption}>Showing homework for <Text style={{ color: C.ink, fontWeight: '700' }}>{fullDate(date)}</Text></Text>
      </View>
      {!!confirmation && <View style={s.success}><Feather name="check-circle" size={16} color={C.mint} /><Text style={s.successText}>{confirmation}</Text><Pressable onPress={() => setConfirmation('')} accessibilityLabel="Dismiss confirmation"><Feather name="x" size={16} color={C.mint} /></Pressable></View>}
      {sessionsLoading ? <Skeletons /> : sessionsError ? <Message title="Sessions unavailable" detail={sessionsError.message} retry={() => { void refresh(); }} /> :
        !session ? <Message title="No school year selected" detail="Choose an academic session to view homework." retry={() => router.push('/sessions')} /> :
        !online && !items ? <Message title="You're offline" detail="Connect to load your homework." /> :
        list.isError ? <Message title="Could not load homework" detail={list.error instanceof Error ? list.error.message : 'Please try again.'} retry={() => { void list.refetch(); void pending.refetch(); }} /> :
        !items ? <Skeletons /> :
        items.length === 0 ? <Message title="No homework for this date" detail="Try another day or check back later." /> :
        <View style={s.grid}>{items.map(item => <HomeworkCard key={item.id} item={item} today={today} onPress={() => setActiveId(item.id)} />)}</View>}
    </ScrollView>
    {calendar && <Calendar value={date} today={today} month={month} setMonth={setMonth} onClose={() => setCalendar(false)}
      onSelect={select} pending={pending.data ?? []} pendingError={pending.isError} pendingLoading={pending.isPending && online}
      retry={() => { void pending.refetch(); }} />}
    {active && selectedId !== null && <HomeworkDrawer key={`${identity}:${active.id}`} item={active} sessionId={selectedId} archive={!session?.isActive}
      online={online} identity={identity} onClose={() => setActiveId(null)} onSubmitted={onSubmitted} />}
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.canvas },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8, minHeight: 57, backgroundColor: C.paper, borderBottomColor: C.line, borderBottomWidth: 1 },
  back: { width: 40, height: 40, borderRadius: 11, backgroundColor: '#F2F3F5', borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  brandIcon: { width: 33, height: 33, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  brandText: { flex: 1 }, headerTitle: { color: C.ink, fontSize: 15, fontWeight: '800' }, headerSubtitle: { color: C.soft, fontSize: 11, marginTop: 2 },
  content: { paddingHorizontal: 16, paddingTop: 20 },
  datePanel: { borderRadius: 18, borderWidth: 1, borderColor: '#E9E9EF', backgroundColor: C.paper, paddingTop: 13, paddingBottom: 15, marginBottom: 19, shadowColor: '#6E8098', shadowOpacity: .06, shadowRadius: 12, elevation: 2 },
  dateStrip: { paddingHorizontal: 13, gap: 5, alignItems: 'center' },
  dateChip: { width: 54, height: 57, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  selectedChip: { backgroundColor: C.mint },
  chipDay: { color: '#627080', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' }, chipNumber: { color: C.ink, fontSize: 14, fontWeight: '800', marginTop: 3 }, chipSelectedText: { color: C.paper }, futureText: { color: '#C9D0D9' },
  chipDot: { height: 5, width: 5, borderRadius: 3, backgroundColor: 'transparent', marginTop: 3 },
  pickChip: { width: 49, height: 57, alignItems: 'center', justifyContent: 'center' }, pickLabel: { color: C.soft, fontSize: 10, marginTop: 3 },
  dateCaption: { textAlign: 'center', fontSize: 11, color: C.soft, marginTop: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  card: { width: '48.3%', minHeight: 219, borderRadius: 18, backgroundColor: C.paper, borderWidth: 1, borderColor: '#E8EAF0', paddingHorizontal: 12, paddingVertical: 16, shadowColor: '#7892A6', shadowOpacity: .055, shadowRadius: 8, elevation: 1 },
  cardTags: { flexDirection: 'row', gap: 5, alignItems: 'center', marginBottom: 12, marginHorizontal: -2 },
  subject: { borderRadius: 30, borderWidth: 1, paddingVertical: 3, paddingHorizontal: 7, flexShrink: 1 },
  subjectText: { fontSize: 10, fontWeight: '800' },
  status: { flexDirection: 'row', borderWidth: 1, borderRadius: 30, paddingHorizontal: 5, paddingVertical: 3, alignItems: 'center', gap: 3, flexShrink: 0 },
  statusText: { fontSize: 9, fontWeight: '800' },
  cardContent: { color: C.ink, fontSize: 14, lineHeight: 22, minHeight: 66 },
  cardMeta: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, flex: 1, marginTop: 14 },
  metaSmall: { color: C.soft, fontSize: 10, lineHeight: 16 },
  attachmentHint: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
  attachmentHintText: { color: '#428776', fontSize: 10 },
  message: { alignItems: 'center', paddingTop: 70, paddingHorizontal: 26 },
  messageIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: C.mintPale, marginBottom: 18 },
  messageTitle: { color: C.ink, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  messageBody: { color: C.soft, fontSize: 13, textAlign: 'center', lineHeight: 20, marginTop: 6 },
  retry: { backgroundColor: C.mint, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 19, paddingVertical: 11, marginTop: 18 },
  retryText: { color: C.paper, fontWeight: '800', fontSize: 13 },
  skeleton: { borderRadius: 8, backgroundColor: '#E9F0F3', marginBottom: 10 },
  offline: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.redPale, borderRadius: 11, padding: 11, marginBottom: 12 },
  offlineText: { color: C.red, fontSize: 11, fontWeight: '700', flex: 1 },
  archive: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.amberPale, borderRadius: 11, padding: 11, marginBottom: 12 },
  archiveText: { color: C.amber, fontSize: 11, fontWeight: '700', flex: 1 },
  success: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.mintPale, borderRadius: 11, padding: 11, marginBottom: 13 },
  successText: { color: C.mint, fontSize: 11, fontWeight: '700', flex: 1 },
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#26344680', padding: 22 },
  calendar: { width: '100%', maxWidth: 350, backgroundColor: C.paper, borderRadius: 19, padding: 17 },
  calendarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  calendarArrow: { width: 35, height: 35, justifyContent: 'center', alignItems: 'center' },
  calendarTitle: { fontSize: 14, fontWeight: '800', color: C.ink },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calendarWeekday: { width: '14.2857%', textAlign: 'center', fontSize: 10, fontWeight: '800', color: C.soft, paddingBottom: 7 },
  calendarDay: { width: '14.2857%', height: 38, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  calendarNumber: { color: C.ink, fontSize: 12, fontWeight: '700' },
  calendarDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'transparent', marginTop: 2 },
  calendarClose: { alignItems: 'center', padding: 10, marginTop: 6 },
  calendarNote: { color: C.soft, textAlign: 'center', fontSize: 11 },
  calendarError: { padding: 8 },
  drawerOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#26344675' },
  drawer: { backgroundColor: C.paper, borderTopLeftRadius: 25, borderTopRightRadius: 25, overflow: 'hidden' },
  drawerHeader: { paddingHorizontal: 19, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: C.line },
  drawerTags: { flexDirection: 'row', gap: 7, alignItems: 'center', flex: 1 },
  closeButton: { width: 35, height: 35, backgroundColor: '#F0F3F5', borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  drawerContent: { paddingHorizontal: 20, paddingVertical: 21, gap: 6 },
  drawerEyebrow: { color: C.soft, fontSize: 12 }, drawerMeta: { color: C.soft, fontSize: 11, marginTop: 3 },
  drawerSection: { marginTop: 20 }, sectionLabel: { color: C.ink, fontSize: 14, fontWeight: '800', marginBottom: 8 },
  instructions: { color: '#516072', fontSize: 14, lineHeight: 22 },
  fileLink: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, backgroundColor: C.canvas, borderColor: C.line, borderWidth: 1, padding: 12 },
  fileLinkText: { color: C.mint, fontWeight: '700', fontSize: 13, flex: 1 },
  previous: { borderRadius: 13, padding: 13, marginTop: 20 },
  previousAnswer: { color: C.ink, fontSize: 12, lineHeight: 19, backgroundColor: C.paper, borderRadius: 8, padding: 10, marginTop: 10 },
  previousLink: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 11 },
  notice: { flexDirection: 'row', gap: 9, padding: 12, borderRadius: 11, backgroundColor: C.amberPale, alignItems: 'center', marginTop: 15 },
  noticeText: { color: C.amber, fontSize: 12, fontWeight: '700', flex: 1, lineHeight: 18 },
  fieldLabel: { color: C.soft, fontWeight: '700', fontSize: 12, marginTop: 14, marginBottom: 8 },
  answerInput: { minHeight: 120, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.canvas, padding: 12, fontSize: 14, color: C.ink, lineHeight: 21 },
  counter: { color: C.soft, alignSelf: 'flex-end', fontSize: 10, marginTop: 4 },
  or: { textAlign: 'center', fontSize: 12, color: C.soft, marginTop: 12 },
  upload: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#C8D3DB', backgroundColor: C.canvas, padding: 18, borderRadius: 12, alignItems: 'center', gap: 5 },
  uploadTitle: { color: C.ink, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  uploadSub: { color: C.soft, fontSize: 11, textAlign: 'center' },
  remove: { flexDirection: 'row', gap: 5, alignItems: 'center', paddingTop: 10 },
  errorText: { color: C.red, fontSize: 12, backgroundColor: C.redPale, padding: 11, borderRadius: 9, marginTop: 12 },
  detailLoading: { padding: 15 },
  drawerFooter: { paddingHorizontal: 20, paddingTop: 13, borderTopWidth: 1, borderColor: C.line },
  submitButton: { borderRadius: 12, backgroundColor: C.mint, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  submitText: { color: C.paper, fontWeight: '800', fontSize: 14 },
  submitHint: { color: C.soft, textAlign: 'center', fontSize: 11, marginTop: 8 },
  imageOverlay: { flex: 1, backgroundColor: '#182637', justifyContent: 'center' },
  previewClose: { position: 'absolute', top: 55, right: 20, zIndex: 2, padding: 12 },
  previewShare: { position: 'absolute', top: 55, left: 20, zIndex: 2, padding: 12 },
  previewImage: { width: '100%', height: '85%' },
});