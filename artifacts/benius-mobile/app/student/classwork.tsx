import React, { useEffect, useState } from 'react';
import { Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { useAcademicSession } from '@/contexts/SessionContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { apiGetForSession } from '@/lib/api';
import { istToday, monthGrid, shiftMonth, validDate, weekDates } from '@/lib/student-homework-pure.mjs';
import { classworkDateAllowed, classworkResource, safeClassworkUrl } from '@/lib/student-classwork-pure.mjs';

// The classwork surface follows the web portal's pastel resource and subject badges.
const C = {
  canvas: '#f8fafc', paper: '#fffefd', ink: '#334155', muted: '#94a3b8',
  line: '#e6ebf0', green: '#10b981', greenPale: '#dff8ef', greenDark: '#047857',
  red: '#b91c1c', redPale: '#fef2f2', blue: '#2563eb', bluePale: '#eff6ff',
  violet: '#7c3aed', violetPale: '#f5f3ff', pink: '#be185d', pinkPale: '#fdf2f8',
  amber: '#92400e', amberPale: '#fffbeb',
};
type Item = { id: number; subject: string; content: string; fileUrl: string | null; createdAt: string; teacherName: string };
type Resource = NonNullable<ReturnType<typeof classworkResource>>;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const subjectPalette: Record<string, [string, string]> = {
  mathematics: [C.blue, C.bluePale], math: [C.blue, C.bluePale],
  science: [C.violet, C.violetPale], english: [C.pink, C.pinkPale],
  history: [C.amber, C.amberPale], geography: [C.greenDark, C.greenPale],
  physics: [C.violet, C.violetPale], chemistry: [C.amber, C.amberPale],
  biology: [C.greenDark, C.greenPale], hindi: [C.red, C.redPale],
};
const resourcePalette: Record<Resource, { label: string; icon: 'file-text' | 'play' | 'image' | 'book-open'; color: string; bg: string }> = {
  pdf: { label: '#Notes', icon: 'file-text', color: C.red, bg: C.redPale },
  video: { label: '#Video', icon: 'play', color: C.violet, bg: C.violetPale },
  image: { label: '#Reference_Material', icon: 'image', color: C.blue, bg: C.bluePale },
  file: { label: '#Reference_Material', icon: 'book-open', color: C.amber, bg: C.amberPale },
};
function parseItem(value: unknown): Item {
  if (!value || typeof value !== 'object') throw new Error('Invalid classwork received.');
  const item = value as Item;
  if (!Number.isSafeInteger(item.id) || item.id <= 0 || typeof item.subject !== 'string'
    || typeof item.content !== 'string' || typeof item.teacherName !== 'string'
    || typeof item.createdAt !== 'string' || !validDate(item.createdAt.slice(0, 10))
    || (item.fileUrl !== null && typeof item.fileUrl !== 'string')) throw new Error('Invalid classwork received.');
  return item;
}
function displayDate(date: string, full = false) {
  return new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB',
    { day: 'numeric', month: full ? 'long' : 'short', ...(full ? { weekday: 'long' as const } : {}), timeZone: 'UTC' });
}
function Badge({ subject, resource }: { subject?: string; resource?: Resource | null }) {
  if (subject !== undefined) {
    const [color, bg] = subjectPalette[subject.trim().toLowerCase()] ?? [C.greenDark, C.greenPale];
    return <View style={[s.badge, { backgroundColor: bg, borderColor: color + '33' }]}><Text numberOfLines={1} style={[s.badgeText, { color }]}>{subject}</Text></View>;
  }
  if (!resource) return null;
  const tag = resourcePalette[resource];
  return <View style={[s.badge, { backgroundColor: tag.bg, borderColor: tag.color + '33' }]}>
    <Feather name={tag.icon} size={11} color={tag.color} /><Text style={[s.badgeText, { color: tag.color }]}>{tag.label}</Text>
  </View>;
}
function Message({ title, description, retry }: { title: string; description: string; retry?: () => void }) {
  return <View style={s.message}>
    <View style={s.messageIcon}><Feather name={retry ? 'wifi-off' : 'edit-3'} color={C.green} size={31} /></View>
    <Text style={s.messageTitle}>{title}</Text><Text style={s.messageBody}>{description}</Text>
    {retry && <Pressable testID="classwork-retry" accessibilityRole="button" onPress={retry} style={s.retry}>
      <Feather name="refresh-cw" size={14} color={C.paper} /><Text style={s.retryText}>Try again</Text>
    </Pressable>}
  </View>;
}
function Skeleton() {
  return <View style={{ gap: 12 }}>{[0, 1, 2].map(i => <View key={i} style={[s.card, { height: 140 }]}>
    <View style={[s.skeleton, { width: '48%', height: 20 }]} /><View style={[s.skeleton, { width: '92%', height: 13, marginTop: 18 }]} />
    <View style={[s.skeleton, { width: '65%', height: 13 }]} />
  </View>)}</View>;
}
function Calendar({ date, today, month, setMonth, onSelect, onClose }: {
  date: string; today: string; month: string; setMonth: (value: string) => void; onSelect: (value: string) => void; onClose: () => void;
}) {
  const days = monthGrid(month);
  const title = new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return <Modal transparent visible animationType="fade" onRequestClose={onClose}>
    <View style={s.overlay}><Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close calendar" onPress={onClose} />
      <View testID="datepicker-modal" style={s.calendar}>
        <View style={s.calendarHead}>
          <Pressable testID="datepicker-prev-month" accessibilityLabel="Previous month" disabled={month <= '0001-01'}
            onPress={() => setMonth(shiftMonth(month, -1))} style={s.calendarArrow}><Feather name="chevron-left" size={21} color={C.ink} /></Pressable>
          <Text style={s.calendarTitle}>{title}</Text>
          <Pressable testID="datepicker-next-month" accessibilityLabel="Next month" disabled={month >= today.slice(0, 7)}
            onPress={() => setMonth(shiftMonth(month, 1))} style={[s.calendarArrow, month >= today.slice(0, 7) && { opacity: .3 }]}>
            <Feather name="chevron-right" size={21} color={C.ink} />
          </Pressable>
        </View>
        <View style={s.calendarGrid}>
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => <Text key={day} style={s.weekday}>{day}</Text>)}
          {days.map((value, i) => value
            ? <Pressable key={value} testID={`datepicker-day-${value}`} accessibilityLabel={value}
                disabled={!classworkDateAllowed(value, today)} onPress={() => onSelect(value)}
                style={[s.calendarDay, value === date && { backgroundColor: C.green }, value === today && value !== date && { backgroundColor: C.greenPale }]}>
                <Text style={[s.calendarNumber, value > today && { color: '#cbd5e1' }, value === date && { color: C.paper }]}>{Number(value.slice(-2))}</Text>
              </Pressable>
            : <View key={`blank-${i}`} style={s.calendarDay} />)}
        </View>
        <Pressable testID="datepicker-close" onPress={onClose} style={s.calendarCancel}><Text style={s.cancelText}>Cancel</Text></Pressable>
      </View>
    </View>
  </Modal>;
}
function InlineVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  return <VideoView testID="viewer-video" player={player} nativeControls style={s.media} contentFit="contain" />;
}
function Viewer({ item, onClose }: { item: Item; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [error, setError] = useState('');
  const [imageError, setImageError] = useState(false);
  const kind = classworkResource(item.fileUrl);
  const url = safeClassworkUrl(item.fileUrl, process.env.EXPO_PUBLIC_DOMAIN);
  const open = async () => {
    if (!url) { setError('This resource has an invalid address.'); return; }
    try { setError(''); await WebBrowser.openBrowserAsync(url); }
    catch { setError('Could not open this resource. Please try again.'); }
  };
  const inlineImage = kind === 'image' && url && !/\.svg$/i.test(new URL(url).pathname) && !imageError;
  const inlineVideo = kind === 'video' && url && !/\.(avi)$/i.test(new URL(url).pathname);
  return <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
    <View testID="classwork-viewer" style={s.viewer}>
      <View style={[s.viewerHeader, { paddingTop: (Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top) + 9 }]}>
        <Pressable testID="button-close-viewer" accessibilityLabel="Close classwork viewer" onPress={onClose} style={s.viewerClose}><Feather name="x" size={21} color={C.paper} /></Pressable>
        <View style={{ flex: 1 }}><Text numberOfLines={1} style={s.viewerTitle}>{item.subject}</Text><Text numberOfLines={1} style={s.viewerSubtitle}>{displayDate(item.createdAt)} · {item.teacherName}</Text></View>
        {!!item.fileUrl && <Pressable testID="link-open-external" accessibilityRole="button" accessibilityLabel="Open resource externally" onPress={() => { void open(); }} style={s.viewerOpen}>
          <Feather name="external-link" size={14} color={C.paper} /><Text style={s.viewerOpenText}>Open</Text>
        </Pressable>}
      </View>
      <ScrollView contentContainerStyle={[s.viewerContent, { paddingBottom: Math.max(insets.bottom, 20) + 24 }]}>
        <View style={s.badgeRow}><Badge subject={item.subject} /><Badge resource={kind} /></View>
        <View style={s.description}><Text style={s.descriptionLabel}>Instructions / Description</Text><Text style={s.descriptionText}>{item.content}</Text></View>
        {!!item.fileUrl && <View style={s.resourceBox}>
          {!url ? <View style={s.resourceFallback}><Feather name="alert-circle" size={34} color={C.amber} /><Text style={s.fallbackTitle}>Resource unavailable</Text><Text style={s.fallbackBody}>This attachment has an invalid address.</Text></View>
            : inlineImage ? <Image testID="viewer-image" source={{ uri: url }} resizeMode="contain" style={s.media} onError={() => setImageError(true)} />
            : inlineVideo ? <InlineVideo uri={url} />
            : <View style={s.resourceFallback}>
              <Feather name={kind === 'pdf' ? 'file-text' : 'book-open'} size={40} color={kind === 'pdf' ? C.red : C.amber} />
              <Text style={s.fallbackTitle}>{kind === 'pdf' ? 'PDF resource' : 'Attached resource'}</Text>
              <Text style={s.fallbackBody}>Open with your device’s viewer</Text>
              <Pressable testID="link-open-file" accessibilityRole="button" onPress={() => { void open(); }} style={s.fileButton}><Feather name="external-link" size={15} color={C.greenDark} /><Text style={s.fileButtonText}>Open file</Text></Pressable>
            </View>}
        </View>}
        {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      </ScrollView>
    </View>
  </Modal>;
}
export default function StudentClasswork() {
  const { user } = useAuth();
  const { sessions, selectedId, loading: sessionsLoading, error: sessionsError, refresh } = useAcademicSession();
  const { online } = useNetwork();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [today, setToday] = useState(() => istToday());
  const [date, setDate] = useState(() => istToday());
  const [month, setMonth] = useState(() => istToday().slice(0, 7));
  const [calendar, setCalendar] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const identity = `${user?.id ?? ''}:${user?.schoolId ?? ''}:${user?.role ?? ''}:${selectedId ?? ''}`;
  useEffect(() => { setCalendar(false); setActiveId(null); }, [identity]);
  useEffect(() => {
    const timer = setInterval(() => { const next = istToday(); setToday(next); setDate(current => current > next ? next : current); }, 30000);
    return () => clearInterval(timer);
  }, []);
  const session = sessions.find(value => value.id === selectedId);
  const ready = user?.role === 'student' && !!session && !sessionsLoading && !sessionsError && online && classworkDateAllowed(date, today);
  const list = useQuery({
    queryKey: ['mobile/student/classwork', user?.id, user?.schoolId, user?.role, selectedId, date],
    queryFn: async ({ signal }) => {
      if (selectedId === null || !user || user.role !== 'student') throw new Error('A student and school year are required.');
      const payload = await apiGetForSession<unknown>(`/mobile/student/classwork?date=${encodeURIComponent(date)}`, selectedId, { signal });
      if (!Array.isArray(payload)) throw new Error('Invalid classwork list received.');
      return payload.map(parseItem);
    },
    enabled: !!ready, staleTime: 0, refetchOnMount: 'always',
  });
  if (!user || user.role !== 'student') return null;
  const items = session && !sessionsLoading && !sessionsError ? list.data : undefined;
  const active = items?.find(item => item.id === activeId);
  const select = (value: string) => {
    if (!classworkDateAllowed(value, today)) return;
    setDate(value); setMonth(value.slice(0, 7)); setActiveId(null); setCalendar(false);
  };
  return <View testID="student-classwork" style={s.screen}>
    <View style={[s.header, { paddingTop: (Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top) + 8 }]}>
      <Pressable testID="button-back" accessibilityLabel="Back to dashboard" onPress={() => active ? setActiveId(null) : router.back()} style={s.back}><Feather name="arrow-left" size={20} color={C.ink} /></Pressable>
      <LinearGradient colors={['#8b5cf6', '#3b82f6']} style={s.brandIcon}><Feather name="edit-3" size={16} color={C.paper} /></LinearGradient>
      <View style={{ flex: 1 }}><Text style={s.headerTitle}>Classwork</Text><Text numberOfLines={1} style={s.headerSubtitle}>{user.schoolName}</Text></View>
    </View>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[s.content, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'web' ? 34 : 16) + 36 }]}>
      {!online && <View style={s.offline}><Feather name="wifi-off" size={15} color={C.red} /><Text style={s.offlineText}>You're offline · Connect to refresh classwork.</Text></View>}
      {!!session && !session.isActive && <View testID="banner-archive-classwork" style={s.archive}><Feather name="lock" size={16} color={C.amber} /><Text style={s.archiveText}>Viewing {session.sessionName} archive · Read only</Text></View>}
      <View style={s.datePanel}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.dateStrip}>
          {weekDates(date).map(value => {
            const selected = value === date; const future = value > today; const isToday = value === today;
            return <Pressable key={value} testID={`date-chip-${value}`} accessibilityLabel={value} disabled={future} onPress={() => select(value)}
              style={[s.dateChip, selected && s.selectedChip, isToday && !selected && { backgroundColor: C.greenPale }]}>
              <Text style={[s.chipDay, selected && s.selectedText, future && s.futureText]}>{DAYS[new Date(`${value}T12:00:00Z`).getUTCDay()]}</Text>
              <Text style={[s.chipNumber, selected && s.selectedText, future && s.futureText]}>{Number(value.slice(-2))}</Text>
              {isToday && !selected && <View style={s.todayDot} />}
            </Pressable>;
          })}
          <Pressable testID="button-open-calendar" accessibilityLabel="Open date picker" onPress={() => { setMonth(date.slice(0, 7)); setCalendar(true); }} style={s.pickChip}>
            <Feather name="calendar" size={19} color={C.muted} /><Text style={s.pickText}>Pick</Text>
          </Pressable>
        </ScrollView>
        <Text style={s.dateCaption}>Classwork for <Text style={s.dateStrong}>{displayDate(date, true)}</Text></Text>
      </View>
      {sessionsLoading ? <Skeleton /> : sessionsError ? <Message title="Sessions unavailable" description={sessionsError.message} retry={() => { void refresh(); }} />
        : !session ? <Message title="No school year selected" description="Choose an academic session to view classwork." retry={() => router.push('/sessions')} />
        : !online && !items ? <Message title="You're offline" description="Reconnect to see classwork for this date." />
        : list.isError ? <Message title="Could not load classwork" description={list.error instanceof Error ? list.error.message : 'Please try again.'} retry={() => { void list.refetch(); }} />
        : !items ? <Skeleton />
        : items.length === 0 ? <Message title="No classwork for this date" description="Try selecting another day or check back later." />
        : <View style={s.cards}>{items.map(item => <Pressable key={item.id} testID={`card-classwork-${item.id}`} accessibilityRole="button" onPress={() => setActiveId(item.id)}
            style={({ pressed }) => [s.card, pressed && { opacity: .76 }]}>
            <View style={s.cardTop}><View style={s.badgeRow}><Badge subject={item.subject} /><Badge resource={classworkResource(item.fileUrl)} /></View><Text style={s.cardDate}>{displayDate(item.createdAt)}</Text></View>
            <Text numberOfLines={2} style={s.cardContent}>{item.content}</Text>
            <View style={s.cardBottom}><Text numberOfLines={1} style={s.teacher}>By {item.teacherName}</Text>
              {!!item.fileUrl && <View style={s.resourceHint}><Feather name="file-text" size={12} color={C.greenDark} /><Text style={s.resourceHintText}>View resource</Text></View>}
            </View>
          </Pressable>)}</View>}
    </ScrollView>
    {calendar && <Calendar date={date} today={today} month={month} setMonth={setMonth} onSelect={select} onClose={() => setCalendar(false)} />}
    {active && <Viewer key={`${identity}:${active.id}`} item={active} onClose={() => setActiveId(null)} />}
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.canvas },
  header: { minHeight: 57, paddingHorizontal: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.paper, borderBottomWidth: 1, borderBottomColor: C.line },
  back: { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f2f3f5', borderWidth: 1, borderColor: C.line },
  brandIcon: { width: 33, height: 33, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: C.ink, fontSize: 15, fontWeight: '800' }, headerSubtitle: { color: C.muted, fontSize: 11, marginTop: 2 },
  content: { paddingHorizontal: 16, paddingTop: 20 },
  offline: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: C.redPale, borderRadius: 12, padding: 12, marginBottom: 12 },
  offlineText: { color: C.red, fontSize: 12, flex: 1 },
  archive: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: C.amberPale, borderColor: '#fde68a', borderWidth: 1, borderRadius: 13, padding: 12, marginBottom: 12 },
  archiveText: { color: C.amber, fontSize: 12, fontWeight: '600', flex: 1 },
  datePanel: { backgroundColor: C.paper, borderRadius: 17, borderWidth: 1, borderColor: C.line, paddingTop: 12, paddingBottom: 14, marginBottom: 19, shadowColor: '#8da1bd', shadowOpacity: .08, shadowRadius: 10, elevation: 1 },
  dateStrip: { alignItems: 'center', gap: 4, paddingHorizontal: 10 },
  dateChip: { width: 48, height: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, selectedChip: { backgroundColor: C.green },
  chipDay: { color: '#64748b', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' }, chipNumber: { color: C.ink, fontSize: 14, fontWeight: '800', marginTop: 3 },
  selectedText: { color: C.paper }, futureText: { color: '#cbd5e1' }, todayDot: { position: 'absolute', bottom: 4, width: 5, height: 5, borderRadius: 3, backgroundColor: C.green },
  pickChip: { width: 48, height: 56, justifyContent: 'center', alignItems: 'center' }, pickText: { fontSize: 9, color: C.muted, marginTop: 3 },
  dateCaption: { color: C.muted, textAlign: 'center', fontSize: 11, marginTop: 10 }, dateStrong: { color: C.ink, fontWeight: '700' },
  cards: { gap: 12 },
  card: { backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, borderRadius: 17, padding: 16, minHeight: 140, gap: 15, shadowColor: '#8da1bd', shadowOpacity: .07, shadowRadius: 10, elevation: 1 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 }, badgeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7, flexShrink: 1 },
  badge: { borderRadius: 20, borderWidth: 1, paddingVertical: 3, paddingHorizontal: 8, flexDirection: 'row', gap: 4, alignItems: 'center', maxWidth: '100%' },
  badgeText: { fontSize: 11, fontWeight: '800' }, cardDate: { color: C.muted, fontSize: 11, flexShrink: 0 },
  cardContent: { color: C.ink, fontSize: 14, lineHeight: 23 }, cardBottom: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginTop: 'auto' },
  teacher: { color: C.muted, fontSize: 11, flex: 1 }, resourceHint: { flexDirection: 'row', alignItems: 'center', gap: 4 }, resourceHintText: { color: C.greenDark, fontSize: 11, fontWeight: '600' },
  skeleton: { backgroundColor: '#e9f0f2', borderRadius: 6 },
  message: { alignItems: 'center', paddingTop: 58, paddingHorizontal: 18 }, messageIcon: { width: 78, height: 78, borderRadius: 39, backgroundColor: C.greenPale, alignItems: 'center', justifyContent: 'center', marginBottom: 17 },
  messageTitle: { color: C.ink, fontSize: 16, fontWeight: '700', textAlign: 'center' }, messageBody: { color: C.muted, fontSize: 13, textAlign: 'center', lineHeight: 20, marginTop: 6 },
  retry: { marginTop: 17, backgroundColor: C.green, borderRadius: 11, paddingHorizontal: 15, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 7 }, retryText: { color: C.paper, fontWeight: '700', fontSize: 12 },
  overlay: { flex: 1, backgroundColor: '#22304788', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 },
  calendar: { width: '100%', maxWidth: 340, backgroundColor: C.paper, borderRadius: 18, padding: 17 },
  calendarHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }, calendarTitle: { color: C.ink, fontSize: 14, fontWeight: '800' },
  calendarArrow: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' }, weekday: { width: '14.2857%', textAlign: 'center', fontSize: 10, fontWeight: '700', color: C.muted, paddingVertical: 8 },
  calendarDay: { width: '14.2857%', aspectRatio: 1, borderRadius: 40, alignItems: 'center', justifyContent: 'center' }, calendarNumber: { color: C.ink, fontSize: 12, fontWeight: '600' },
  calendarCancel: { alignItems: 'center', paddingTop: 15, paddingBottom: 4 }, cancelText: { fontSize: 12, color: C.muted },
  viewer: { flex: 1, backgroundColor: '#f0fdf4' }, viewerHeader: { backgroundColor: C.green, paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  viewerClose: { width: 40, height: 40, backgroundColor: '#ffffff30', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  viewerTitle: { color: C.paper, fontSize: 14, fontWeight: '800' }, viewerSubtitle: { color: '#d1fae5', fontSize: 11, marginTop: 3 },
  viewerOpen: { backgroundColor: '#ffffff30', borderRadius: 9, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 9 }, viewerOpenText: { color: C.paper, fontSize: 12, fontWeight: '700' },
  viewerContent: { padding: 16, gap: 15 }, description: { backgroundColor: C.paper, borderRadius: 16, padding: 16, borderColor: '#e2f4e9', borderWidth: 1 },
  descriptionLabel: { color: '#64748b', fontWeight: '700', fontSize: 13, marginBottom: 10 }, descriptionText: { color: C.ink, fontSize: 14, lineHeight: 23 },
  resourceBox: { borderRadius: 16, backgroundColor: C.paper, borderWidth: 1, borderColor: '#e2f4e9', overflow: 'hidden' },
  media: { width: '100%', height: 320, backgroundColor: '#eaf3ee' },
  resourceFallback: { alignItems: 'center', padding: 28, gap: 9 }, fallbackTitle: { color: C.ink, fontSize: 14, fontWeight: '700' }, fallbackBody: { color: C.muted, fontSize: 12 },
  fileButton: { marginTop: 8, flexDirection: 'row', gap: 7, alignItems: 'center', borderRadius: 11, backgroundColor: C.greenPale, borderWidth: 1, borderColor: '#a7f3d0', paddingHorizontal: 17, paddingVertical: 11 },
  fileButtonText: { color: C.greenDark, fontSize: 13, fontWeight: '700' }, error: { color: C.red, fontSize: 12, padding: 12, backgroundColor: C.redPale, borderRadius: 10 },
});