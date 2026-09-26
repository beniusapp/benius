import React, { useCallback, useEffect, useState } from 'react';
import { Alert, BackHandler, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import { useAuth } from '@/contexts/AuthContext';
import { useAcademicSession } from '@/contexts/SessionContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { apiGet, apiGetForSession, ApiError } from '@/lib/api';
import { MONTH_NAMES, DAY_LABELS, calendarWeekday, formatDateOnly, getDayCell, getMonthlySummary, getYearlyMonthPercentage, istToday } from '@/lib/student-attendance-pure.mjs';
import type { DisplayDay } from '@/lib/student-attendance-pure.mjs';

// Native rendering of the web destination: same information architecture and status semantics.
const C = {
  bg: '#f8fafc', paper: '#ffffff', ink: '#1e293b', text: '#334155', muted: '#94a3b8',
  label: '#64748b', line: '#e2e8f0', paleLine: '#f1f5f9', green: '#10b981',
  darkGreen: '#059669', paleGreen: '#ecfdf5', paleBorder: '#d1fae5', red: '#f87171',
  redText: '#ef4444', amber: '#f59e0b', paleAmber: '#fef3c7', amberText: '#92400e',
  sky: '#38bdf8', paleSky: '#e0f2fe', skyText: '#0369a1', closed: '#f1f5f9',
  archive: '#fffbeb', archiveBorder: '#fde68a', archiveText: '#92400e', tooltip: '#1e293b',
  blue: '#3b82f6',
} as const;
const HAND = 'OpenSans_400Regular';
type DayData = DisplayDay & { dayOfWeek: number; teacherId: number | null; markedBy: string | null };
type Monthly = { schoolId: number; studentId: number; year: number; month: number; days: DayData[] };
type MonthStat = { month: number; year: number; present: number; absent: number; halfDay: number; late: number; leave: number; holiday?: number; workingDays: number };
type Yearly = { months: MonthStat[] };
type Stats = { overallPercent: number; workingDays: number; daysPresent: number; totalPresent: number; totalAbsent: number; totalHalfDay: number; totalLate: number; totalLeave: number };
type Policy = { attendanceTarget: number; expectedArrivalTime: string; gracePeriodMinutes: number; halfDayCutoffTime: string; policyName?: string };
const numeric = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
function ensure<T>(value: unknown, check: (value: any) => boolean): T {
  if (!value || typeof value !== 'object' || !check(value)) throw new ApiError('The server returned incomplete attendance information.', 'server');
  return value as T;
}
function escapeHTML(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
function Info({ title, message, retry, testID }: { title: string; message: string; retry?: () => void; testID: string }) {
  return <View testID={testID} style={s.info}>
    <Feather name={retry ? 'alert-circle' : 'calendar'} color={C.green} size={24} />
    <Text style={s.infoTitle}>{title}</Text><Text style={s.infoText}>{message}</Text>
    {retry && <Pressable accessibilityRole="button" testID={`${testID}-retry`} onPress={retry} style={s.retry}><Feather name="refresh-cw" size={15} color={C.green} /><Text style={s.retryText}>Try again</Text></Pressable>}
  </View>;
}
function Skeleton({ height = 84 }: { height?: number }) { return <View style={[s.skeleton, { height }]} />; }
function Card({ children, style }: { children: React.ReactNode; style?: object }) { return <View style={[s.card, style]}>{children}</View>; }
function ToneDot({ tone, small = false }: { tone: string; small?: boolean }) {
  const palette = toneStyle(tone);
  return <View style={[s.legendDot, small && { width: 12, height: 12, borderRadius: 6 }, { backgroundColor: palette.bg, borderColor: palette.border, borderWidth: palette.border ? 1 : 0 }]} />;
}
function toneStyle(tone: string): { bg: string; text: string; border?: string } {
  switch (tone) {
    case 'present': return { bg: C.green, text: C.paper };
    case 'absent': return { bg: C.red, text: C.paper };
    case 'partial': return { bg: C.paleAmber, text: C.amberText };
    case 'leave': return { bg: C.paleSky, text: C.skyText, border: C.sky };
    case 'closed': case 'unknown': return { bg: C.closed, text: C.muted };
    default: return { bg: C.paper, text: C.muted, border: C.line };
  }
}
function MonthChart({ months }: { months: MonthStat[] }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} testID="yearly-chart" contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12 }}>
    <View style={s.chart}>
      <View style={s.axis}>{[100, 75, 50, 25, 0].map(n => <Text key={n} style={s.axisText}>{n}%</Text>)}</View>
      {months.map(m => <View key={`${m.year}-${m.month}`} style={s.chartGroup}>
        <View style={s.bars}>
          <View style={[s.bar, { backgroundColor: C.green, height: Math.max(2, Math.min(120, m.workingDays ? m.present / m.workingDays * 120 : 0)) }]} />
          <View style={[s.bar, { backgroundColor: C.red, height: Math.max(2, Math.min(120, m.workingDays ? m.absent / m.workingDays * 120 : 0)) }]} />
        </View>
        <Text style={s.chartMonth}>{MONTH_NAMES[m.month - 1]?.slice(0, 3)}</Text>
      </View>)}
    </View>
  </ScrollView>;
}

export default function StudentAttendance() {
  const { user, loading: authLoading } = useAuth();
  const { sessions, selectedId, loading: sessionsLoading, error: sessionsError, refresh } = useAcademicSession();
  const { online } = useNetwork();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [today, setToday] = useState(() => istToday());
  const [period, setPeriod] = useState(() => { const t = istToday(); return { year: t.year, month: t.month }; });
  const [tab, setTab] = useState<'monthly' | 'yearly'>('monthly');
  const [picker, setPicker] = useState<'month' | 'year' | null>(null);
  const [tooltip, setTooltip] = useState<DayData | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState('');
  const home = useCallback(() => router.replace('/'), [router]);
  useFocusEffect(useCallback(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => { home(); return true; });
    const timer = setInterval(() => setToday(istToday()), 30_000);
    setToday(istToday());
    return () => { back.remove(); clearInterval(timer); };
  }, [home]));
  // An iOS edge swipe is a stack POP; make its destination Home even when
  // the screen was reached by a deep link or an unexpected previous route.
  useEffect(() => navigation.addListener('beforeRemove', event => {
    if (event.data.action.type === 'GO_BACK' || event.data.action.type === 'POP') {
      event.preventDefault();
      home();
    }
  }), [navigation, home]);
  useEffect(() => { if (!authLoading && user?.role !== 'student') router.replace('/'); }, [authLoading, user?.role, router]);
  const selected = sessions.find(x => x.id === selectedId && x.schoolId === user?.schoolId);
  const start = selected?.startDate ?? '';
  const end = selected?.endDate ?? '';
  const identity = [user?.schoolId, user?.id, user?.role];
  const ready = !authLoading && !sessionsLoading && !sessionsError && user?.role === 'student' && !!selected && !!start && !!end && online;
  const rangeParams = `startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`;
  const stats = useQuery({
    queryKey: ['mobile/student/attendance/stats', ...identity, selectedId, start, end],
    queryFn: async ({ signal }) => {
      const value = ensure<Stats & { schoolId: number; studentId: number; sessionId: number }>(await apiGetForSession<unknown>(`/mobile/student/attendance/stats?${rangeParams}`, selectedId!, { signal }),
        x => ['overallPercent','workingDays','daysPresent','totalPresent','totalAbsent','totalHalfDay','totalLate','totalLeave'].every(k => numeric(x[k]))
          && numeric(x.schoolId) && numeric(x.studentId) && numeric(x.sessionId));
      if (value.schoolId !== user?.schoolId || value.studentId !== user?.id || value.sessionId !== selectedId) throw new ApiError('Attendance totals do not match this student or session.', 'server');
      return value;
    },
    enabled: ready, staleTime: 0, refetchOnMount: 'always',
  });
  const policy = useQuery({
    queryKey: ['mobile/student/attendance/policy', ...identity],
    queryFn: async ({ signal }) => ensure<Policy>(await apiGet<unknown>('/mobile/student/attendance/policy', { signal }),
      x => numeric(x.attendanceTarget) && typeof x.expectedArrivalTime === 'string' && numeric(x.gracePeriodMinutes) && typeof x.halfDayCutoffTime === 'string'),
    enabled: !authLoading && user?.role === 'student' && online, staleTime: 300_000,
  });
  const monthly = useQuery({
    queryKey: ['mobile/student/attendance/monthly', ...identity, selectedId, period.year, period.month],
    queryFn: async ({ signal }) => {
      const value = ensure<Monthly>(await apiGetForSession<unknown>(`/mobile/student/attendance/monthly?year=${period.year}&month=${period.month}`, selectedId!, { signal }),
        x => numeric(x.studentId) && numeric(x.schoolId) && numeric(x.year) && numeric(x.month) && Array.isArray(x.days)
          && x.days.every((d: any) => typeof d.date === 'string' && typeof d.status === 'string' && ['isInSession','isFuture','isSunday','isHoliday','isApprovedLeave'].every(k => typeof d[k] === 'boolean')));
      if (value.studentId !== user?.id || value.schoolId !== user?.schoolId || value.year !== period.year || value.month !== period.month || ('sessionId' in value && value.sessionId !== selectedId)) throw new ApiError('The attendance report does not match this account or period.', 'server');
      return value;
    },
    enabled: ready && tab === 'monthly', staleTime: 0, refetchOnMount: 'always',
  });
  const yearly = useQuery({
    queryKey: ['mobile/student/attendance/yearly', ...identity, selectedId, start, end],
    queryFn: async ({ signal }) => {
      const value = ensure<Yearly & { schoolId: number; studentId: number; sessionId: number }>(await apiGetForSession<unknown>(`/mobile/student/attendance/yearly?${rangeParams}&sessionName=${encodeURIComponent(selected?.sessionName ?? '')}`, selectedId!, { signal }),
        x => numeric(x.schoolId) && numeric(x.studentId) && numeric(x.sessionId)
          && Array.isArray(x.months) && x.months.every((m: any) => ['year','month','present','absent','halfDay','late','leave','workingDays'].every(k => numeric(m[k])) && m.month >= 1 && m.month <= 12));
      if (value.schoolId !== user?.schoolId || value.studentId !== user?.id || value.sessionId !== selectedId) throw new ApiError('The yearly report does not match this student or session.', 'server');
      return value;
    },
    enabled: ready && tab === 'yearly', staleTime: 0, refetchOnMount: 'always',
  });
  const monthIndex = period.year * 12 + period.month - 1;
  const todayIndex = today.year * 12 + today.month - 1;
  const startYear = Number(start.slice(0, 4));
  const endYear = Number(end.slice(0, 4));
  const minYear = Number.isInteger(startYear) && startYear > 1900 ? startYear : today.year - 2;
  const maxYear = Math.min(today.year, Number.isInteger(endYear) && endYear >= minYear ? endYear : today.year);
  const years = Array.from({ length: Math.max(1, maxYear - minYear + 1) }, (_, i) => maxYear - i);
  const changeMonth = (offset: number) => {
    const value = monthIndex + offset;
    if (value > todayIndex || value < minYear * 12) return;
    setPeriod({ year: Math.floor(value / 12), month: value % 12 + 1 });
    setTooltip(null);
  };
  const days = monthly.data?.days ?? [];
  const summary = getMonthlySummary(days);
  const active = tab === 'monthly' ? monthly : yearly;
  const reportReady = !!stats.data && (tab === 'monthly' ? !!monthly.data : !!yearly.data);
  const print = async () => {
    if (!reportReady || !selected || !user || printing) return;
    setPrinting(true); setPrintError('');
    const heading = `<h1>BENIUS — Attendance Report</h1><p>${escapeHTML(user.name)} · ${escapeHTML(user.schoolName)} · ${escapeHTML(selected.sessionName)}</p><p>Generated ${escapeHTML(formatDateOnly(`${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`))} IST</p>`;
    const overall = `<p>Overall attendance: ${stats.data!.overallPercent}% · Working days: ${stats.data!.workingDays} · Days present: ${stats.data!.daysPresent} · Days absent: ${stats.data!.totalAbsent}</p>`;
    const content = tab === 'monthly'
      ? `<h2>${MONTH_NAMES[period.month - 1]} ${period.year}</h2><p>${Object.entries(summary).map(([k,v]) => `${escapeHTML(k)}: ${v}`).join(' · ')}</p><table><tr><th>Date</th><th>Attendance</th><th>Details</th></tr>${days.map(d => `<tr><td>${escapeHTML(formatDateOnly(d.date))}</td><td>${escapeHTML(getDayCell(d).label)}</td><td>${escapeHTML(d.holidayName || d.markedBy || '')}</td></tr>`).join('')}</table>`
      : `<h2>Monthly Attendance — ${escapeHTML(selected.sessionName)}</h2><table><tr><th>Month</th><th>Present</th><th>Absent</th><th>Half Day</th><th>Leave</th><th>Working</th><th>%</th></tr>${yearly.data!.months.map(m => `<tr><td>${MONTH_NAMES[m.month - 1]} ${m.year}</td><td>${m.present}</td><td>${m.absent}</td><td>${m.halfDay}</td><td>${m.leave}</td><td>${m.workingDays}</td><td>${getYearlyMonthPercentage(m).toFixed(1)}%</td></tr>`).join('')}</table>`;
    try {
      await Print.printAsync({ html: `<html><head><meta name="viewport" content="width=device-width"><style>body{font-family:system-ui;color:#334155;padding:24px}h1{color:#059669}table{border-collapse:collapse;width:100%;font-size:12px}td,th{text-align:left;border-bottom:1px solid #e2e8f0;padding:7px}</style></head><body>${heading}${overall}${content}</body></html>` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Printing could not be started.';
      if (!/cancel/i.test(message)) { setPrintError(message); Alert.alert('Could not print report', message); }
    } finally { setPrinting(false); }
  };
  if (authLoading || !user || user.role !== 'student') return null;
  return <View testID="student-attendance" style={s.screen}>
    <View style={[s.header, { paddingTop: (Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top) + 7 }]}>
      <Pressable testID="button-back" accessibilityRole="button" accessibilityLabel="Back to Home" onPress={home} style={s.back}><Feather name="arrow-left" size={21} color={C.label} /></Pressable>
      <LinearGradient colors={[C.green, C.blue]} style={s.brand}><MaterialCommunityIcons name="school-outline" size={18} color={C.paper} /></LinearGradient>
      <View style={{ flex: 1 }}><Text style={s.headerTitle}>Attendance</Text><Text numberOfLines={1} style={s.headerSub}>{user.schoolName}</Text></View>
    </View>
    <ScrollView contentContainerStyle={[s.content, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'web' ? 34 : 12) + 26 }]} showsVerticalScrollIndicator={false}>
      {!online && <Info title="You're offline" message="Connect to refresh attendance. Previously loaded reports remain visible." testID="attendance-offline" />}
      {sessionsLoading ? <Skeleton /> : sessionsError ? <Info title="Sessions unavailable" message={sessionsError.message} retry={() => { void refresh(); }} testID="attendance-session-error" />
        : !selected ? <Info title="No academic session" message="Choose a school session from Home to view attendance." retry={() => { void refresh(); }} testID="attendance-no-session" />
        : !start || !end ? <Info title="Session dates unavailable" message="This school session has no valid start and end dates. Try refreshing sessions." retry={() => { void refresh(); }} testID="attendance-session-dates" />
        : <>
          {!selected.isActive && <View testID="attendance-archive" style={s.archive}><Feather name="lock" size={16} color={C.archiveText} /><View style={{ flex: 1 }}><Text style={s.archiveTitle}>Viewing Archive Mode — Read Only</Text><Text style={s.archiveText}>Browsing {selected.sessionName}. Attendance cannot be changed.</Text></View></View>}
          {policy.isError && <Info title="Attendance policy unavailable" message={policy.error instanceof Error ? policy.error.message : 'Please try again.'} retry={() => { void policy.refetch(); }} testID="attendance-policy-error" />}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.statsScroll} contentContainerStyle={s.statsContent} testID="stats-bar">
            {!online && !stats.data ? <Info title="Stats need a connection" message="Connect to load attendance totals." testID="attendance-stats-offline" />
              : stats.isPending && !stats.data ? [0,1,2,3].map(i => <View key={i} style={s.statSkeleton}><Skeleton height={76} /></View>)
              : stats.data ? [
                { id: 'overall-percent', value: `${stats.data.overallPercent}%`, label: 'Overall Attendance', color: policy.data && stats.data.overallPercent < policy.data.attendanceTarget ? C.redText : C.green, sub: policy.data ? `Target: ${policy.data.attendanceTarget}%` : undefined },
                { id: 'working-days', value: stats.data.workingDays, label: 'Working Days', color: C.text },
                { id: 'present', value: stats.data.daysPresent, label: 'Days Present', color: C.darkGreen },
                { id: 'absent', value: stats.data.totalAbsent, label: 'Days Absent', color: C.redText },
              ].map(item => <View key={item.id} testID={`stat-${item.id}`} style={s.stat}><Text style={[s.statValue, { color: item.color }]}>{item.value}</Text><Text style={s.statLabel}>{item.label}</Text>{item.sub && <Text style={s.statSub}>{item.sub}</Text>}</View>)
              : <Info title="Stats unavailable" message={stats.error instanceof Error ? stats.error.message : 'Unable to load attendance totals.'} retry={() => { void stats.refetch(); }} testID="attendance-stats-error" />}
          </ScrollView>
          <View style={s.tabs}>
            {([['monthly', 'calendar', 'Monthly View'], ['yearly', 'bar-chart-2', 'Year View']] as const).map(([value, icon, label]) => <Pressable key={value} testID={`tab-${value}`} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} onPress={() => { setTab(value); setTooltip(null); }} style={[s.tab, tab === value && s.tabSelected]}><Feather name={icon} size={16} color={tab === value ? C.paper : C.text} /><Text style={[s.tabText, tab === value && { color: C.paper }]}>{label}</Text></Pressable>)}
          </View>
          {tab === 'monthly' ? <>
            <View style={s.navigator}>
              <Pressable testID="button-prev-month" accessibilityRole="button" accessibilityLabel="Previous month" disabled={monthIndex <= minYear * 12} onPress={() => changeMonth(-1)} style={[s.navArrow, monthIndex <= minYear * 12 && s.disabled]}><Feather name="chevron-left" size={20} color={C.label} /></Pressable>
              <Pressable testID="select-month" accessibilityRole="button" accessibilityLabel={`Select month, ${MONTH_NAMES[period.month - 1]}`} onPress={() => setPicker('month')} style={[s.selector, { flex: 1.3 }]}><Text style={s.selectorText} numberOfLines={1}>{MONTH_NAMES[period.month - 1]}</Text><Feather name="chevron-down" size={14} color={C.ink} /></Pressable>
              <Pressable testID="select-year" accessibilityRole="button" accessibilityLabel={`Select year, ${period.year}`} onPress={() => setPicker('year')} style={[s.selector, { flex: .75 }]}><Text style={s.selectorText}>{period.year}</Text><Feather name="chevron-down" size={14} color={C.ink} /></Pressable>
              <Pressable testID="button-next-month" accessibilityRole="button" accessibilityLabel="Next month" disabled={monthIndex >= todayIndex} onPress={() => changeMonth(1)} style={[s.navArrow, monthIndex >= todayIndex && s.disabled]}><Feather name="chevron-right" size={20} color={C.label} /></Pressable>
            </View>
            <Card style={{ padding: 0, overflow: 'hidden' }}><View testID="calendar-grid">
              <View style={s.week}>{DAY_LABELS.map((name, i) => <Text key={name} style={[s.weekday, i === 0 && { color: C.red }]}>{name.toUpperCase()}</Text>)}</View>
              {!online && !monthly.data ? <Info title="Calendar needs a connection" message="Connect to load this month." testID="attendance-month-offline" />
                : monthly.isPending && !monthly.data ? <View style={{ padding: 16, gap: 12 }}><Skeleton height={45} /><Skeleton height={45} /><Skeleton height={45} /><Skeleton height={45} /></View>
                : monthly.isError ? <Info title="Calendar unavailable" message={monthly.error instanceof Error ? monthly.error.message : 'Please try again.'} retry={() => { void monthly.refetch(); }} testID="attendance-month-error" />
                : !days.length ? <Info title="No dates for this month" message="This period has no calendar data." testID="attendance-month-empty" />
                : <View style={s.calendar}>
                  {Array.from({ length: calendarWeekday(days[0].date) ?? 0 }, (_, i) => <View key={`blank-${i}`} style={s.cell} />)}
                  {days.map(day => {
                    const visual = getDayCell(day);
                    const colors = toneStyle(visual.tone);
                    const markedSunday = day.isInSession && day.isSunday && day.status !== 'none' && !day.isFuture;
                    return <Pressable key={day.date} testID={`day-cell-${day.date}`} accessibilityRole="button" accessibilityLabel={`${Number(day.date.slice(8))} - ${markedSunday ? 'Sunday - ' : ''}${visual.label}`} disabled={!day.isInSession || day.isFuture} onPress={() => setTooltip(tooltip?.date === day.date ? null : day)} style={s.cell}>
                      <View style={[s.dayCircle, { backgroundColor: colors.bg, borderColor: colors.border ?? 'transparent', borderWidth: colors.border ? 1.5 : 0 }]}>
                        <Text style={[s.dayNumber, { color: colors.text }]}>{Number(day.date.slice(8))}</Text>
                        {markedSunday && <Text numberOfLines={1} style={[s.sundayMarked, { color: colors.text }]}>Sun · {visual.label}</Text>}
                        {visual.dot && <View style={s.dayDot} />}
                      </View>
                    </Pressable>;
                  })}
                </View>}
              {tooltip && <Pressable testID="tooltip-day" accessibilityRole="button" accessibilityLabel="Close day details" onPress={() => setTooltip(null)} style={s.tooltip}>
                <View style={{ flex: 1 }}><Text style={s.tooltipDate}>{formatDateOnly(tooltip.date)}</Text>
                  <Text style={s.tooltipText}>{getDayCell(tooltip).label || 'No attendance yet'}{tooltip.isSunday ? ' · Sunday' : ''}</Text>
                  {tooltip.isHoliday && <Text style={s.tooltipMuted}>{tooltip.holidayName || 'School Holiday'}</Text>}
                  {tooltip.markedBy && <Text style={s.tooltipMuted}>By: {tooltip.markedBy.split(' at ')[0]}</Text>}
                </View><Feather name="x" size={16} color={C.paper} />
              </Pressable>}
            </View></Card>
            <Card><View style={s.cardHeading}><Feather name="info" size={16} color={C.muted} /><Text style={s.legendTitle}>LEGEND</Text></View>
              <View style={s.legendGrid}>{[['present','Present'],['absent','Absent'],['partial','Half Day / Late'],['leave','Approved Leave'],['closed','Holiday / Sunday'],['unmarked','Not Marked Yet']].map(([tone, label]) => <View key={label} style={s.legendItem}><ToneDot tone={tone} /><Text style={s.legendText}>{label}</Text></View>)}</View>
            </Card>
            <Card style={{ padding: 0, overflow: 'hidden' }}><View style={s.sectionHeading}><Feather name="calendar" size={17} color={C.green} /><Text style={s.sectionTitle}>{MONTH_NAMES[period.month - 1]} {period.year} — Summary</Text></View>
              {!monthly.data ? <View style={{ padding: 15 }}><Skeleton height={65} /></View> : <View style={s.summaryGrid}>{([['present','check-circle',C.darkGreen],['absent','x-circle',C.redText],['halfDay','alert-circle',C.amber],['late','clock',C.amber],['leave','clock',C.sky],['holiday','sun',C.label]] as const).map(([key, icon, color]) => <View key={key} testID={`summary-${key}`} style={s.summaryItem}><Feather name={icon} size={15} color={color} /><Text style={[s.summaryValue, { color }]}>{summary[key]}</Text><Text style={s.summaryLabel}>{key === 'halfDay' ? 'Half Day' : key[0].toUpperCase() + key.slice(1)}</Text></View>)}</View>}
            </Card>
          </> : <>
            <View style={s.academicYear}><Text style={s.yearCaption}>Academic Year</Text><View style={s.yearChip}><Text style={s.selectorText}>{selected.sessionName}</Text></View></View>
            <Card style={{ padding: 0, overflow: 'hidden' }}><View style={s.sectionHeading}><Feather name="bar-chart-2" size={17} color={C.green} /><Text style={s.sectionTitle}>Monthly Attendance — {selected.sessionName}</Text></View>
              {!online && !yearly.data ? <Info title="Yearly report needs a connection" message="Connect to load this school session." testID="attendance-year-offline" />
                : yearly.isPending && !yearly.data ? <View style={{ padding: 16, gap: 10 }}><Skeleton height={180} /><Skeleton height={34} /></View>
                : yearly.isError ? <Info title="Yearly report unavailable" message={yearly.error instanceof Error ? yearly.error.message : 'Please try again.'} retry={() => { void yearly.refetch(); }} testID="attendance-year-error" />
                : !yearly.data?.months.length ? <Info title="No attendance data for this period" message="This school session does not have recorded attendance yet." testID="attendance-year-empty" />
                : <><MonthChart months={yearly.data.months} /><View style={s.chartLegend}><ToneDot tone="present" small /><Text style={s.legendText}>Present</Text><ToneDot tone="absent" small /><Text style={s.legendText}>Absent</Text></View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 15 }}>
                      <View><View style={s.tableRow}>{['Month','Present','Absent','Half Day','Leave','Working','%'].map(h => <Text key={h} style={[s.tableHead, h === 'Month' && { width: 88 }]}>{h}</Text>)}</View>
                        {yearly.data.months.map(m => <View key={`${m.year}-${m.month}`} style={s.tableRow}>{[`${MONTH_NAMES[m.month - 1].slice(0, 3)} ${m.year}`,m.present,m.absent,m.halfDay,m.leave,m.workingDays,`${getYearlyMonthPercentage(m).toFixed(1)}%`].map((v,i) => <Text key={i} style={[s.tableCell, i === 0 && { width: 88 }, i === 6 && { color: getYearlyMonthPercentage(m) >= 75 ? C.darkGreen : C.redText }]}>{v}</Text>)}</View>)}
                      </View>
                    </ScrollView></>}
            </Card>
          </>}
          {printError ? <Text accessibilityRole="alert" style={s.printError}>{printError}</Text> : null}
          <Pressable testID="button-download" accessibilityRole="button" accessibilityLabel="Print attendance report" accessibilityState={{ disabled: !reportReady || printing }} disabled={!reportReady || printing} onPress={() => { void print(); }} style={[s.download, (!reportReady || printing) && s.disabled]}><Feather name="download" size={17} color={C.paper} /><Text style={s.downloadText}>{printing ? 'Opening print dialog…' : 'Download Attendance Report'}</Text></Pressable>
          {!online && !active.data && <Info title="Report needs a connection" message="Connect to the internet, then try again." testID="attendance-offline-empty" />}
        </>}
    </ScrollView>
    <Modal visible={picker !== null} transparent animationType="fade" onRequestClose={() => setPicker(null)}><Pressable style={s.modalBackdrop} onPress={() => setPicker(null)}><View style={s.modalPanel}><Text style={s.modalTitle}>Select {picker}</Text><ScrollView style={{ maxHeight: 420 }}>{(picker === 'month' ? MONTH_NAMES.map((name, i) => ({ label: name, value: i + 1 })).filter(x => period.year !== today.year || x.value <= today.month) : years.map(y => ({ label: String(y), value: y }))).map(option => <Pressable key={option.value} accessibilityRole="button" testID={`option-${picker}-${option.value}`} onPress={() => { if (picker === 'month') setPeriod({ ...period, month: option.value }); else setPeriod({ year: option.value, month: option.value === today.year ? Math.min(period.month, today.month) : period.month }); setTooltip(null); setPicker(null); }} style={s.modalOption}><Text style={s.modalOptionText}>{option.label}</Text>{(picker === 'month' ? period.month : period.year) === option.value && <Feather name="check" size={18} color={C.green} />}</Pressable>)}</ScrollView></View></Pressable></Modal>
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.paper, paddingHorizontal: 16, paddingBottom: 9, borderBottomWidth: 1, borderBottomColor: C.paleLine, shadowColor: C.ink, shadowOpacity: .05, shadowRadius: 16, elevation: 2 },
  back: { height: 40, width: 40, borderRadius: 11, borderWidth: 1, borderColor: C.line, backgroundColor: C.closed, alignItems: 'center', justifyContent: 'center' },
  brand: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: HAND, color: C.ink, fontSize: 15, lineHeight: 20 },
  headerSub: { fontFamily: HAND, color: C.muted, fontSize: 11 },
  content: { paddingHorizontal: 16, paddingTop: 20, gap: 19 },
  card: { borderRadius: 17, padding: 16, backgroundColor: C.paper, borderWidth: 1, borderColor: C.paleLine, shadowColor: C.ink, shadowOpacity: .045, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  statsScroll: { marginHorizontal: -16 }, statsContent: { paddingHorizontal: 16, gap: 12, paddingBottom: 4 },
  stat: { width: 160, minHeight: 98, borderRadius: 16, backgroundColor: C.paper, borderWidth: 1, borderColor: C.paleLine, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9, shadowColor: C.ink, shadowOpacity: .06, shadowRadius: 5, elevation: 1 },
  statSkeleton: { width: 160, height: 98 }, statValue: { fontFamily: HAND, fontSize: 25, lineHeight: 35 }, statLabel: { fontFamily: HAND, fontSize: 11, color: C.label, textAlign: 'center' }, statSub: { fontFamily: HAND, fontSize: 9, color: C.muted },
  tabs: { flexDirection: 'row', gap: 9 }, tab: { flex: 1, height: 47, borderRadius: 11, borderWidth: 1, borderColor: C.paleBorder, backgroundColor: C.paper, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 }, tabSelected: { backgroundColor: C.green, borderColor: C.green }, tabText: { fontFamily: HAND, color: C.text, fontSize: 14 },
  navigator: { flexDirection: 'row', alignItems: 'center', gap: 9 }, navArrow: { width: 42, height: 44, borderRadius: 11, backgroundColor: C.paper, borderWidth: 1, borderColor: C.paleBorder, alignItems: 'center', justifyContent: 'center' }, disabled: { opacity: .4 },
  selector: { minWidth: 0, height: 44, borderRadius: 9, backgroundColor: C.paper, borderWidth: 1, borderColor: C.paleBorder, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 11, gap: 4 }, selectorText: { fontFamily: HAND, color: C.ink, fontSize: 14 },
  week: { height: 32, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: C.paleLine }, weekday: { flex: 1, textAlign: 'center', fontFamily: HAND, color: C.muted, fontSize: 10 },
  calendar: { flexDirection: 'row', flexWrap: 'wrap', padding: 7, backgroundColor: C.bg }, cell: { width: '14.2857%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }, dayCircle: { width: '96%', aspectRatio: 1, borderRadius: 100, alignItems: 'center', justifyContent: 'center' }, dayNumber: { fontFamily: HAND, fontSize: 12 }, sundayMarked: { fontFamily: HAND, fontSize: 7, textAlign: 'center' }, dayDot: { position: 'absolute', bottom: 5, width: 5, height: 5, backgroundColor: C.amber, borderRadius: 3 },
  tooltip: { margin: 12, padding: 12, borderRadius: 12, backgroundColor: C.tooltip, flexDirection: 'row', gap: 10 }, tooltipDate: { fontFamily: HAND, color: '#6ee7b7', fontSize: 13 }, tooltipText: { fontFamily: HAND, color: C.paper, fontSize: 12 }, tooltipMuted: { color: C.muted, fontFamily: HAND, fontSize: 10, marginTop: 3 },
  cardHeading: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10 }, legendTitle: { fontFamily: HAND, color: C.label, fontSize: 13 }, legendGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 6 }, legendItem: { width: '50%', flexDirection: 'row', gap: 7, alignItems: 'center' }, legendDot: { width: 16, height: 16, borderRadius: 8 }, legendText: { fontFamily: HAND, color: C.text, fontSize: 11 },
  sectionHeading: { minHeight: 45, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: C.paleLine, flexDirection: 'row', gap: 8, alignItems: 'center' }, sectionTitle: { fontFamily: HAND, fontSize: 14, color: C.text, flexShrink: 1 },
  summaryGrid: { flexDirection: 'row' }, summaryItem: { flex: 1, borderRightWidth: 1, borderRightColor: C.paleLine, minHeight: 75, alignItems: 'center', justifyContent: 'center', gap: 2 }, summaryValue: { fontSize: 18, fontFamily: HAND }, summaryLabel: { fontFamily: HAND, fontSize: 8, color: C.muted, textAlign: 'center' },
  academicYear: { flexDirection: 'row', alignItems: 'center', gap: 12 }, yearCaption: { fontFamily: HAND, fontSize: 13, color: C.label }, yearChip: { backgroundColor: C.paper, borderWidth: 1, borderColor: C.paleBorder, borderRadius: 8, padding: 10, flexShrink: 1 },
  chart: { height: 158, flexDirection: 'row', alignItems: 'flex-end' }, axis: { height: 135, justifyContent: 'space-between', marginRight: 8, paddingBottom: 11 }, axisText: { fontSize: 8, color: C.muted, fontFamily: HAND }, chartGroup: { width: 50, alignItems: 'center' }, bars: { flexDirection: 'row', height: 120, alignItems: 'flex-end', gap: 2 }, bar: { width: 17, borderTopLeftRadius: 3, borderTopRightRadius: 3 }, chartMonth: { fontFamily: HAND, color: C.label, fontSize: 10, marginTop: 5 }, chartLegend: { flexDirection: 'row', gap: 6, justifyContent: 'center', alignItems: 'center', paddingBottom: 13 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.paleLine, alignItems: 'center', minHeight: 31 }, tableHead: { width: 58, fontFamily: HAND, color: C.label, fontSize: 10, textAlign: 'center' }, tableCell: { width: 58, fontFamily: HAND, color: C.text, fontSize: 11, textAlign: 'center' },
  download: { alignSelf: 'center', borderRadius: 11, backgroundColor: C.green, minHeight: 46, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 1 }, downloadText: { color: C.paper, fontSize: 14, fontFamily: HAND }, printError: { color: C.redText, textAlign: 'center', fontSize: 12 },
  archive: { backgroundColor: C.archive, borderColor: C.archiveBorder, borderWidth: 1, borderRadius: 12, padding: 13, flexDirection: 'row', gap: 10 }, archiveTitle: { color: C.archiveText, fontSize: 13, fontWeight: '700' }, archiveText: { color: C.archiveText, fontSize: 11, marginTop: 3 },
  info: { alignItems: 'center', backgroundColor: C.paper, borderRadius: 15, padding: 22, gap: 7, borderWidth: 1, borderColor: C.paleLine }, infoTitle: { fontFamily: HAND, fontSize: 17, color: C.ink, textAlign: 'center' }, infoText: { fontFamily: HAND, fontSize: 12, color: C.label, textAlign: 'center' }, retry: { flexDirection: 'row', gap: 7, alignItems: 'center', padding: 8 }, retryText: { color: C.darkGreen, fontFamily: HAND, fontSize: 13 },
  skeleton: { backgroundColor: C.closed, borderRadius: 12 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(30,41,59,0.4)', justifyContent: 'center', padding: 24 }, modalPanel: { backgroundColor: C.paper, borderRadius: 18, padding: 18 }, modalTitle: { fontFamily: HAND, fontSize: 18, color: C.ink, marginBottom: 10 }, modalOption: { minHeight: 44, paddingHorizontal: 8, borderBottomColor: C.paleLine, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, modalOptionText: { fontFamily: HAND, color: C.text, fontSize: 14 },
});