import React, { useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL, apiGet, apiGetForSession, apiPost, apiPostForSession } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useColors } from '@/hooks/useColors';
import { Button, Card, State } from '@/components/Foundation';

export type AdminWorkflowModuleId =
  | 'complaint-hub' | 'noticeboard' | 'approval-center'
  | 'leave-requests' | 'teacher-registry' | 'non-teaching-staff';

type WorkflowProps = {
  moduleId: AdminWorkflowModuleId;
  schoolId: number;
  sessionId: number;
  archived?: boolean;
  allowedSubs?: string[];
  classes?: string[];
  sections?: string[];
  subjects?: string[];
};
type Row = Record<string, any>;
type Result = Record<string, any>;

const API = '/mobile/admin/workflow';
const subDefaults: Record<AdminWorkflowModuleId, string[]> = {
  'complaint-hub': ['private', 'grievances', 'escalated'],
  noticeboard: ['view', 'create', 'bulk-delete'],
  'approval-center': ['gallery-hub', 'ebook'],
  'leave-requests': ['teacher-leave', 'student-leave', 'leave-history'],
  'teacher-registry': ['view', 'add', 'edit', 'deactivate'],
  'non-teaching-staff': ['view', 'add', 'edit', 'permissions'],
};
const label: Record<AdminWorkflowModuleId, string> = {
  'complaint-hub': 'Complaint Hub', noticeboard: 'Noticeboard',
  'approval-center': 'Approval Center', 'leave-requests': 'Leave Requests',
  'teacher-registry': 'Teacher Registry', 'non-teaching-staff': 'Support Staff',
};
const ageOptions = [30, 60, 90, 180, 0];

function useWorkflow(moduleId: AdminWorkflowModuleId, sessionId: number, supportStaff: boolean) {
  const client = useQueryClient();
  const query = useQuery<Result>({
    queryKey: ['mobile-admin-workflow', moduleId, sessionId],
    queryFn: () => supportStaff ? apiGet<Result>(`${API}/${moduleId}`) : apiGetForSession<Result>(`${API}/${moduleId}`, sessionId),
    enabled: supportStaff || (Number.isSafeInteger(sessionId) && sessionId > 0),
  });
  const mutation = useMutation({
    mutationFn: (payload: Row | FormData) => supportStaff
      ? apiPost<Result>(`${API}/${moduleId}/actions`, payload)
      : apiPostForSession<Result>(`${API}/${moduleId}/actions`, sessionId, payload),
    onSuccess: () => client.invalidateQueries({ queryKey: ['mobile-admin-workflow', moduleId, sessionId] }),
  });
  return { ...query, mutation };
}

function Tabs({ values, selected, onSelect }: { values: { id: string; title: string; count?: number }[]; selected: string; onSelect: (id: string) => void }) {
  const c = useColors();
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 5 }}>
    {values.map(item => <Pressable key={item.id} onPress={() => onSelect(item.id)} accessibilityRole="tab" accessibilityState={{ selected: selected === item.id }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, paddingHorizontal: 13, paddingVertical: 9, backgroundColor: selected === item.id ? c.primary : c.secondary }}>
      <Text style={{ color: selected === item.id ? c.primaryForeground : c.secondaryForeground, fontWeight: '700', fontSize: 13 }}>{item.title}</Text>
      {item.count !== undefined && <Text style={{ color: selected === item.id ? c.primaryForeground : c.secondaryForeground, fontSize: 11 }}>{item.count}</Text>}
    </Pressable>)}
  </ScrollView>;
}

function RowCard({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return <View style={{ padding: 15, backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: 12, gap: 9 }}>{children}</View>;
}
function Heading({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return <Text style={{ color: c.foreground, fontWeight: '800', fontSize: 16 }}>{children}</Text>;
}
function Body({ children, color }: { children: React.ReactNode; color?: string }) {
  const c = useColors();
  return <Text style={{ color: color ?? c.mutedForeground, lineHeight: 20, fontSize: 13 }}>{children}</Text>;
}
function Action({ title, icon, onPress, disabled = false, danger = false }: { title: string; icon: React.ComponentProps<typeof Feather>['name']; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  const c = useColors();
  return <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', minHeight: 40, borderRadius: 8, paddingHorizontal: 12, backgroundColor: danger ? c.destructive : c.secondary, opacity: disabled ? .45 : pressed ? .7 : 1 })}>
    <Feather name={icon} size={15} color={danger ? c.destructiveForeground : c.secondaryForeground} />
    <Text style={{ color: danger ? c.destructiveForeground : c.secondaryForeground, fontWeight: '700', fontSize: 12 }}>{title}</Text>
  </Pressable>;
}
function Input({ label: title, value, onChangeText, multiline = false, secure = false, keyboardType }: { label: string; value: string; onChangeText: (value: string) => void; multiline?: boolean; secure?: boolean; keyboardType?: React.ComponentProps<typeof TextInput>['keyboardType'] }) {
  const c = useColors();
  return <View style={{ gap: 5 }}>
    <Text style={{ color: c.mutedForeground, fontWeight: '600', fontSize: 12 }}>{title}</Text>
    <TextInput accessibilityLabel={title} value={value} onChangeText={onChangeText} multiline={multiline} secureTextEntry={secure} keyboardType={keyboardType}
      placeholder={title} placeholderTextColor={c.mutedForeground} autoCapitalize="sentences" autoCorrect={multiline}
      style={{ color: c.foreground, backgroundColor: c.background, borderColor: c.input, borderWidth: 1, borderRadius: 8, minHeight: multiline ? 100 : 46, paddingHorizontal: 12, paddingVertical: 10, textAlignVertical: multiline ? 'top' : 'center' }} />
  </View>;
}

export default function AdminWorkflowModules(props: WorkflowProps) {
  const c = useColors();
  const { user } = useAuth();
  const { moduleId, schoolId, sessionId, archived = false } = props;
  const allowed = props.allowedSubs ?? subDefaults[moduleId];
  const { data, isLoading, error, refetch, mutation } = useWorkflow(moduleId, sessionId, user?.role === 'support_staff');
  const [form, setForm] = useState<Row>({});
  const [complaintTab, setComplaintTab] = useState('private');
  const [complaintStatus, setComplaintStatus] = useState('all');
  const [noticeFilter, setNoticeFilter] = useState('all');
  const [approvalTab, setApprovalTab] = useState('gallery');
  const [ebookView, setEbookView] = useState('verification');
  const [ebookFile, setEbookFile] = useState<{ uri: string; name: string; type: string } | null>(null);
  const [leaveTab, setLeaveTab] = useState('teacher-leave');
  const [teacherView, setTeacherView] = useState('registry');
  const writable = !archived && !mutation.isPending;
  const set = (key: string, value: any) => setForm(current => ({ ...current, [key]: value }));
  const perform = (payload: Row, confirm?: string, onSuccess?: () => void) => {
    const send = () => mutation.mutate(payload, {
      onSuccess,
      onError: e => Alert.alert('Action failed', e.message),
    });
    if (confirm) Alert.alert('Confirm action', confirm, [{ text: 'Cancel', style: 'cancel' }, { text: 'Continue', style: 'destructive', onPress: send }]);
    else send();
  };
  const loadingState = isLoading ? <State title={`Loading ${label[moduleId].toLowerCase()}`} loading /> : error
    ? <State title="Unable to load this module" detail={error instanceof Error ? error.message : 'Check your connection and try again.'} retry={() => { void refetch(); }} />
    : null;
  const sectionGate = (sub: string) => allowed.includes(sub);
  const lists = (key: string): Row[] => Array.isArray(data?.[key]) ? data![key] as Row[] : [];
  const empty = (name: string) => <Body>No {name} to show.</Body>;
  const openFile = (fileUrl: string) => {
    const origin = API_BASE_URL.replace(/\/api\/?$/, '');
    const url = /^https?:\/\//i.test(fileUrl) ? fileUrl : `${origin}${fileUrl.startsWith('/') ? '' : '/'}${fileUrl}`;
    void Linking.openURL(url).catch(error => Alert.alert('Unable to open file', error instanceof Error ? error.message : 'Try opening the file again.'));
  };

  const complaintHub = () => {
    const tabs = [{ id: 'private', title: 'Private messages' }, { id: 'grievances', title: 'Grievances' }, { id: 'escalated', title: 'Escalated' }].filter(t => sectionGate(t.id));
    const selected = tabs.some(t => t.id === complaintTab) ? complaintTab : tabs[0]?.id ?? '';
    const all = lists('complaints');
    const matches = all.filter(row => selected === 'private' ? row.complaintType === 'teacher-to-admin'
      : selected === 'grievances' ? row.complaintType === 'student-to-staff'
        : row.complaintType === 'student-peer-report' && row.escalatedToPrincipal || row.complaintType === 'teacher-to-student' && row.notifyAdmin);
    const filtered = matches.filter(row => complaintStatus === 'all' || row.status === complaintStatus);
    return <>
      <Tabs values={tabs.map(t => ({ ...t, count: matches.filter(r => r.status !== 'Resolved').length }))} selected={selected} onSelect={setComplaintTab} />
      <Tabs values={['all', 'Pending', 'Investigating', 'Resolved', 'Escalated'].map(id => ({ id, title: id === 'all' ? 'All statuses' : id }))} selected={complaintStatus} onSelect={setComplaintStatus} />
      {loadingState ?? (filtered.length ? filtered.map(row => <RowCard key={row.id}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><Heading>{row.ticketId}</Heading><Body>{row.status}</Body></View>
        <Body>{row.complainantName ? `Filed by ${row.complainantName} · ` : ''}{row.teacherName ? `${row.teacherName} · ` : ''}{row.createdAt ? new Date(row.createdAt).toLocaleDateString() : ''}</Body>
        <Body color={c.foreground}>{row.content}</Body>
        {row.resolutionRemarks ? <Body>Principal’s remarks: {row.resolutionRemarks}</Body> : null}
        {row.status !== 'Resolved' && <View style={{ gap: 8 }}>
          {selected === 'escalated' && <Input label="Principal's remarks" value={form[`remarks-${row.id}`] ?? ''} onChangeText={v => set(`remarks-${row.id}`, v)} multiline />}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Action title="Investigating" icon="clock" disabled={!writable} onPress={() => perform({ action: 'complaint-status', id: row.id, status: 'Investigating' })} />
            <Action title={selected === 'escalated' && form[`remarks-${row.id}`]?.trim() ? 'Post & resolve' : 'Resolve'} icon="check-circle" disabled={!writable} onPress={() => perform({ action: 'complaint-status', id: row.id, status: 'Resolved', resolutionRemarks: form[`remarks-${row.id}`] })} />
          </View>
        </View>}
      </RowCard>) : empty('complaints'))}
      {sectionGate(selected) && <RowCard><Heading>Delete resolved complaints</Heading><Body>Permanently remove resolved reports older than the selected age from this academic session.</Body>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{ageOptions.map(days => <Action key={days} title={days ? `>${days} days` : 'Any age'} icon="trash-2" danger disabled={!writable} onPress={() => perform({ action: 'complaint-bulk-delete', olderThanDays: days, complaintTypes: selected === 'private' ? ['teacher-to-admin'] : selected === 'grievances' ? ['student-to-staff'] : ['student-peer-report', 'teacher-to-student'] }, days ? `Delete resolved complaints older than ${days} days?` : 'Delete all resolved complaints in this session?')} />)}</View>
      </RowCard>}
    </>;
  };

  const noticeboard = () => {
    const notices = lists('notices');
    const shown = notices.filter(n => noticeFilter === 'all' || n.creatorRole === noticeFilter);
    return <>
      {sectionGate('create') && <Card>
        <Heading>{form.editId ? 'Edit notice' : 'Post a notice'}</Heading>
        <Tabs values={[{ id: 'whole_school', title: 'Whole school' }, { id: 'teacher', title: 'Teachers' }, { id: 'student', title: 'Students' }, { id: 'class_only', title: 'Class' }, { id: 'class', title: 'Class + section' }]} selected={form.targetType ?? 'whole_school'} onSelect={v => set('targetType', v)} />
        {(form.targetType === 'class' || form.targetType === 'class_only') && <Input label="Class" value={form.targetClass ?? ''} onChangeText={v => set('targetClass', v)} />}
        {form.targetType === 'class' && <Input label="Section" value={form.targetSection ?? ''} onChangeText={v => set('targetSection', v)} />}
        <Tabs values={['Routine', 'Academic', 'Event', 'Urgent'].map(v => ({ id: v, title: v }))} selected={form.noticeType ?? 'Routine'} onSelect={v => set('noticeType', v)} />
        <Input label="Notice text" value={form.content ?? ''} onChangeText={v => set('content', v)} multiline />
        <Button label={form.editId ? 'Save changes' : 'Post notice'} disabled={!writable || !form.content?.trim() || ((form.targetType === 'class' || form.targetType === 'class_only') && !form.targetClass) || (form.targetType === 'class' && !form.targetSection)}
          onPress={() => perform({ action: form.editId ? 'notice-edit' : 'notice-create', ...form, targetType: form.targetType ?? 'whole_school', noticeType: form.noticeType ?? 'Routine', schoolId }, undefined, () => setForm({}))} />
      </Card>}
      <Tabs values={[{ id: 'all', title: 'All', count: notices.length }, { id: 'admin', title: 'Admin', count: notices.filter(n => n.creatorRole === 'admin').length }, { id: 'teacher', title: 'Teacher', count: notices.filter(n => n.creatorRole === 'teacher').length }]} selected={noticeFilter} onSelect={setNoticeFilter} />
      {loadingState ?? (shown.length ? shown.map(row => <RowCard key={row.id}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Heading>{row.noticeType ?? 'Routine'}</Heading><Body>{row.targetType === 'class' ? `Class ${row.targetClass ?? ''}${row.targetSection ? ` · ${row.targetSection}` : ''}` : row.targetType}</Body></View>
        <Body color={c.foreground}>{row.content}</Body><Body>{row.creatorName ?? (row.creatorRole === 'admin' ? 'Admin' : 'Teacher')} · {row.createdAt ? new Date(row.createdAt).toLocaleDateString() : ''}</Body>
        {row.fileUrl && <Action title="Open attachment" icon="paperclip" onPress={() => openFile(row.fileUrl)} />}
        {row.creatorRole === 'admin' && sectionGate('create') && <View style={{ flexDirection: 'row', gap: 8 }}>
          <Action title="Edit" icon="edit-2" disabled={!writable} onPress={() => { setForm({ editId: row.id, content: row.content, targetType: row.targetType }); }} />
          {sectionGate('bulk-delete') && <Action title="Delete" icon="trash-2" danger disabled={!writable} onPress={() => perform({ action: 'notice-delete', id: row.id }, 'Delete this notice?')} />}
        </View>}
      </RowCard>) : empty('notices'))}
      {sectionGate('bulk-delete') && <RowCard><Heading>Bulk delete notices</Heading><Body>Only notices in the selected academic session are affected.</Body>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{ageOptions.map(days => <Action key={days} title={days ? `>${days} days` : 'All notices'} icon="trash-2" danger disabled={!writable} onPress={() => perform({ action: 'notice-bulk-delete', olderThanDays: days }, days ? `Delete notices older than ${days} days?` : 'Delete all notices in this session?')} />)}</View>
      </RowCard>}
    </>;
  };

  const approvalCenter = () => {
    const canGallery = sectionGate('gallery-hub'); const canBooks = sectionGate('ebook');
    const tabs = [{ id: 'gallery', title: 'Gallery' }, { id: 'ebooks', title: 'E-books' }].filter(t => t.id === 'gallery' ? canGallery : canBooks);
    const current = tabs.some(t => t.id === approvalTab) ? approvalTab : tabs[0]?.id ?? '';
    const gallery = lists('gallery'); const books = lists('books');
    return <>
      <Tabs values={tabs} selected={current} onSelect={setApprovalTab} />
      {loadingState ?? (current === 'gallery'
        ? gallery.length ? gallery.map(row => <RowCard key={row.id}><Heading>{row.title ?? row.caption ?? 'Gallery item'}</Heading><Body>{row.teacherName ?? row.uploaderName ?? 'Teacher'} · {row.approved ? 'Approved' : 'Awaiting review'}</Body><Body>{row.description ?? ''}</Body>
          {row.imageUrl && <Action title="Open submission" icon="external-link" onPress={() => openFile(row.imageUrl)} />}
          {!row.approved && <View style={{ flexDirection: 'row', gap: 8 }}><Action title="Approve" icon="check" disabled={!writable} onPress={() => perform({ action: 'gallery-approve', id: row.id })} /><Action title="Reject" icon="trash-2" danger disabled={!writable} onPress={() => perform({ action: 'gallery-delete', ids: [row.id], reason: 'rejected' }, 'Permanently remove this gallery submission?')} /></View>}
        </RowCard>) : empty('gallery submissions')
        : <><Tabs values={[{ id: 'verification', title: 'Verification' }, { id: 'catalog', title: 'Catalog' }, { id: 'upload', title: 'Upload' }]} selected={ebookView} onSelect={setEbookView} />
          {ebookView === 'verification' ? (books.filter(b => b.verificationStatus === 'pending').length ? books.filter(b => b.verificationStatus === 'pending').map(row => <RowCard key={row.id}><Heading>{row.title}</Heading><Body>{row.author} · {row.targetClass ?? 'All classes'}</Body>{row.fileUrl && <Action title="Open e-book" icon="book-open" onPress={() => openFile(row.fileUrl)} />}<View style={{ flexDirection: 'row', gap: 8 }}><Action title="Approve" icon="check" disabled={!writable} onPress={() => perform({ action: 'ebook-verify', id: row.id, status: 'approved' })} /><Action title="Reject" icon="x" danger disabled={!writable} onPress={() => perform({ action: 'ebook-verify', id: row.id, status: 'rejected' })} /></View></RowCard>) : empty('e-books awaiting verification'))
            : ebookView === 'catalog' ? (books.filter(b => b.verificationStatus === 'approved').length ? books.filter(b => b.verificationStatus === 'approved').map(row => <RowCard key={row.id}><Heading>{row.title}</Heading><Body>{row.author} · {row.targetClass ?? 'All classes'} · {row.category ?? 'Other'}</Body>{row.fileUrl && <Action title="Open e-book" icon="book-open" onPress={() => openFile(row.fileUrl)} />}<Action title="Remove from catalog" icon="trash-2" danger disabled={!writable} onPress={() => perform({ action: 'ebook-delete', id: row.id }, 'Remove this e-book from the school catalog?')} /></RowCard>) : empty('approved e-books'))
              : <Card><Heading>Upload an e-book</Heading>
                <Input label="Title" value={form.ebookTitle ?? ''} onChangeText={v => set('ebookTitle', v)} />
                <Input label="Author" value={form.ebookAuthor ?? ''} onChangeText={v => set('ebookAuthor', v)} />
                <Input label="Target class (optional)" value={form.ebookClass ?? ''} onChangeText={v => set('ebookClass', v)} />
                <Input label="Category" value={form.ebookCategory ?? ''} onChangeText={v => set('ebookCategory', v)} />
                <Button label={ebookFile ? 'Change selected file' : 'Choose PDF or EPUB'} icon="paperclip" disabled={!writable} onPress={() => {
                  void DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'application/epub+zip'], copyToCacheDirectory: true }).then(result => {
                    if (!result.canceled && result.assets[0]) {
                      const asset = result.assets[0];
                      setEbookFile({ uri: asset.uri, name: asset.name, type: asset.mimeType ?? 'application/pdf' });
                    }
                  }).catch(error => Alert.alert('File selection failed', error instanceof Error ? error.message : 'Select the file again.'));
                }} />
                {ebookFile && <Body>{ebookFile.name}</Body>}
                <Button label="Upload e-book" disabled={!writable || !ebookFile || !form.ebookTitle?.trim() || !form.ebookAuthor?.trim()} onPress={() => {
                  if (!ebookFile) return;
                  const body = new FormData();
                  body.append('action', 'ebook-upload');
                  body.append('title', form.ebookTitle.trim());
                  body.append('author', form.ebookAuthor.trim());
                  body.append('targetClass', form.ebookClass ?? '');
                  body.append('category', form.ebookCategory ?? '');
                  body.append('file', { uri: ebookFile.uri, name: ebookFile.name, type: ebookFile.type } as any);
                  perform(body, undefined, () => { setEbookFile(null); setForm({}); setEbookView('catalog'); });
                }} />
              </Card>}
        </>)}
    </>;
  };

  const leaveRequests = () => {
    const tabs = [{ id: 'teacher-leave', title: 'Teacher leave' }, { id: 'student-leave', title: 'Student leave' }, { id: 'leave-history', title: 'History' }].filter(t => sectionGate(t.id));
    const current = tabs.some(t => t.id === leaveTab) ? leaveTab : tabs[0]?.id ?? '';
    const rows = current === 'teacher-leave' ? lists('teacherLeaves') : current === 'student-leave' ? lists('studentLeaves') : [...lists('teacherLeaveHistory'), ...lists('studentLeaveHistory')];
    return <>
      <Tabs values={tabs} selected={current} onSelect={setLeaveTab} />
      {loadingState ?? (rows.length ? rows.map(row => <RowCard key={`${current}-${row.id}`}>
        <Heading>{current.startsWith('teacher') ? row.teacherName : row.studentName}{row.dsid ? ` · ${row.dsid}` : ''}</Heading>
        <Body>{row.startDate} – {row.endDate} · {row.status}</Body>
        <Body color={c.foreground}>{row.reason}</Body>
        {row.teacherComment ? <Body>Teacher note: {row.teacherComment}</Body> : null}
        {current === 'student-leave' && <Input label="Administrator comment (optional)" value={form[`comment-${row.id}`] ?? ''} onChangeText={v => set(`comment-${row.id}`, v)} multiline />}
        {current !== 'leave-history' && <View style={{ flexDirection: 'row', gap: 8 }}>
          <Action title="Approve" icon="check" disabled={!writable || row.status !== (current === 'teacher-leave' ? 'pending' : 'forwarded_to_admin')} onPress={() => perform({ action: current === 'teacher-leave' ? 'teacher-leave-status' : 'student-leave-status', id: row.id, status: 'approved', comment: form[`comment-${row.id}`] })} />
          <Action title="Reject" icon="x" danger disabled={!writable || row.status !== (current === 'teacher-leave' ? 'pending' : 'forwarded_to_admin')} onPress={() => perform({ action: current === 'teacher-leave' ? 'teacher-leave-status' : 'student-leave-status', id: row.id, status: 'rejected', comment: form[`comment-${row.id}`] })} />
        </View>}
      </RowCard>) : empty(current === 'leave-history' ? 'leave history' : 'leave requests'))}
    </>;
  };

  const teacherRegistry = () => {
    const teachers = lists('teachers');
    const removedHistory = lists('removedHistory');
    const edit = form.teacherId ? teachers.find(t => t.id === form.teacherId) : null;
    const teacherFields = ['fullName', 'email', 'phone', 'designation', 'gender', 'dateOfBirth', 'govtIdType', 'govtIdNumber', 'address', 'joiningDate', 'qualifications'];
    return <>
      {user?.role === 'admin' && <Tabs values={[{ id: 'registry', title: 'Registry' }, { id: 'history', title: 'Removed history' }]} selected={teacherView} onSelect={setTeacherView} />}
      {teacherView === 'registry' && sectionGate('add') && <Button label="Add teacher" icon="user-plus" disabled={!writable} onPress={() => setForm({ teacherForm: true })} />}
      {teacherView === 'history' && user?.role === 'admin' ? (removedHistory.length
        ? removedHistory.map(row => <RowCard key={row.id}><Heading>{row.fullName}</Heading><Body>{row.email ?? ''} · {row.digitalTeacherId ?? ''}</Body><Body>{row.removalReason ?? ''} · {row.removedAt ? new Date(row.removedAt).toLocaleDateString() : ''}</Body></RowCard>)
        : empty('removed teachers')) : null}
      {teacherView === 'registry' && form.teacherForm && <Card>
        <Heading>{edit ? 'Edit teacher' : 'Add teacher'}</Heading>
        {teacherFields.map(key => <Input key={key} label={key} value={form[key] ?? edit?.[key] ?? ''} secure={key === 'password'} onChangeText={v => set(key, v)} />)}
        {!edit && <Input label="Password" value={form.password ?? ''} secure onChangeText={v => set('password', v)} />}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button label={edit ? 'Save teacher' : 'Create teacher'} disabled={!writable} onPress={() => perform({ action: edit ? 'teacher-edit' : 'teacher-create', id: edit?.id, ...form }, undefined, () => setForm({}))} />
          <Action title="Cancel" icon="x" onPress={() => setForm({})} />
        </View>
      </Card>}
      {teacherView === 'registry' && (loadingState ?? (teachers.length ? teachers.map(t => <RowCard key={t.id}>
        <Heading>{t.fullName}</Heading><Body>{t.email} · {t.phone}{t.digitalTeacherId ? ` · ${t.digitalTeacherId}` : ''}</Body><Body>{t.designation ?? 'Teacher'} · {t.isActive === false ? 'Inactive' : 'Active'}</Body>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {sectionGate('edit') && <Action title="Edit" icon="edit-2" disabled={!writable} onPress={() => setForm({ teacherId: t.id, teacherForm: true, ...t })} />}
          {sectionGate('deactivate') && <Action title="Remove" icon="user-x" danger disabled={!writable} onPress={() => Alert.alert('Remove teacher', 'Provide the removal reason and password in the confirmation fields.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Continue', onPress: () => setForm({ removeId: t.id }) }])} />}
        </View>
        {form.removeId === t.id && <><Input label="Removal reason (at least 5 characters)" value={form.reason ?? ''} onChangeText={v => set('reason', v)} multiline /><Input label="Admin password" value={form.adminPassword ?? ''} secure onChangeText={v => set('adminPassword', v)} /><Button label="Confirm removal" disabled={!writable || !form.reason?.trim() || !form.adminPassword} onPress={() => perform({ action: 'teacher-remove', id: t.id, reason: form.reason, adminPassword: form.adminPassword }, undefined, () => setForm({}))} /></>}
      </RowCard>) : empty('teachers')))}
    </>;
  };

  const staffManagement = () => {
    const staff = lists('staff');
    const permissionTree: Record<string, string[]> = {
      'complaint-hub': ['private', 'grievances', 'escalated'],
      noticeboard: ['view', 'create', 'bulk-delete'],
      'approval-center': ['gallery-hub', 'ebook'],
      'leave-requests': ['teacher-leave', 'student-leave', 'leave-history'],
      'teacher-registry': ['view', 'add', 'edit', 'deactivate'],
      'non-teaching-staff': ['view', 'add', 'edit', 'permissions'],
    };
    const toggleModule = (module: string, selected: string[]) => {
      const values = permissionTree[module].map(sub => `${module}:${sub}`);
      const enabled = selected.includes(module) || values.some(value => selected.includes(value));
      return enabled
        ? selected.filter(value => value !== module && !values.includes(value))
        : [...selected, module, ...values];
    };
    const toggleSub = (module: string, sub: string, selected: string[]) => {
      const subPermission = `${module}:${sub}`;
      const updated = selected.includes(subPermission)
        ? selected.filter(value => value !== subPermission)
        : [...selected, subPermission];
      const children = permissionTree[module].map(value => `${module}:${value}`);
      const anyEnabled = children.some(value => updated.includes(value));
      return anyEnabled
        ? updated.includes(module) ? updated : [...updated, module]
        : updated.filter(value => value !== module);
    };
    const uploadStaffPhoto = async (member: Row) => {
      try {
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
        if (result.canceled || !result.assets[0]) return;
        const asset = result.assets[0];
        const body = new FormData();
        body.append('action', 'staff-photo-upload');
        body.append('id', String(member.id));
        body.append('photo', { uri: asset.uri, name: asset.fileName ?? 'staff-photo.jpg', type: asset.mimeType ?? 'image/jpeg' } as any);
        perform(body);
      } catch (error) {
        Alert.alert('Photo selection failed', error instanceof Error ? error.message : 'Choose a photo again.');
      }
    };
    return <>
      {sectionGate('add') && <Button label="Add support staff" icon="user-plus" disabled={!writable} onPress={() => setForm({ staffForm: true, allowedModules: [] })} />}
      {form.staffForm && <Card><Heading>{form.staffId ? 'Edit support staff' : 'Create support staff account'}</Heading>
        {['fullName', 'email', 'phone', 'designation'].map(key => <Input key={key} label={key} value={form[key] ?? ''} onChangeText={v => set(key, v)} />)}
        {!form.staffId && <Input label="Password" value={form.password ?? ''} secure onChangeText={v => set('password', v)} />}
        {!form.staffId && <><Body>Choose permitted modules and workflow actions.</Body>{Object.entries(permissionTree).map(([module, subs]) => {
          const selected: string[] = form.allowedModules ?? [];
          return <View key={module} style={{ gap: 3 }}>
            <Pressable onPress={() => set('allowedModules', toggleModule(module, selected))} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
              <Feather name={selected.includes(module) || subs.some(sub => selected.includes(`${module}:${sub}`)) ? 'check-square' : 'square'} size={18} color={c.primary} />
              <Body>{label[module as AdminWorkflowModuleId]}</Body>
            </Pressable>
            {subs.map(sub => <Pressable key={sub} onPress={() => set('allowedModules', toggleSub(module, sub, selected))} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, paddingLeft: 28 }}>
              <Feather name={selected.includes(`${module}:${sub}`) ? 'check-square' : 'square'} size={16} color={c.primary} /><Body>{sub}</Body>
            </Pressable>)}
          </View>;
        })}</>}
        <View style={{ flexDirection: 'row', gap: 8 }}><Button label={form.staffId ? 'Save staff' : 'Create account'} disabled={!writable} onPress={() => perform({ action: form.staffId ? 'staff-edit' : 'staff-create', ...form }, undefined, () => setForm({}))} /><Action title="Cancel" icon="x" onPress={() => setForm({})} /></View>
      </Card>}
      {loadingState ?? (staff.length ? staff.map(member => <RowCard key={member.id}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {member.photoUrl && <Image source={{ uri: member.photoUrl.startsWith('http') ? member.photoUrl : `${API_BASE_URL.replace(/\/api\/?$/, '')}${member.photoUrl}` }} accessibilityLabel={`${member.fullName} profile photo`} style={{ width: 44, height: 44, borderRadius: 22 }} />}
          <View style={{ flex: 1 }}><Heading>{member.fullName}</Heading><Body>{member.email} · {member.phone} · {member.designation}</Body></View>
        </View><Body>{member.isActive === false ? 'Inactive' : 'Active'}</Body>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {sectionGate('edit') && <Action title="Edit" icon="edit-2" disabled={!writable} onPress={() => setForm({ staffForm: true, staffId: member.id, fullName: member.fullName, email: member.email, phone: member.phone, designation: member.designation })} />}
          {sectionGate('edit') && <Action title="Photo" icon="camera" disabled={!writable} onPress={() => { void uploadStaffPhoto(member); }} />}
          {sectionGate('permissions') && <Action title="Permissions" icon="shield" disabled={!writable} onPress={() => setForm({ permissionId: member.id, allowedModules: member.allowedModules ?? [] })} />}
          {sectionGate('permissions') && <Action title="Delete" icon="trash-2" danger disabled={!writable} onPress={() => perform({ action: 'staff-delete', id: member.id }, 'Permanently remove this support staff account?')} />}
        </View>
        {form.permissionId === member.id && <><Body>Granted permissions are scoped to the workflow modules below.</Body>{Object.entries(permissionTree).map(([module, subs]) => {
          const selected: string[] = form.allowedModules ?? member.allowedModules ?? [];
          return <View key={module} style={{ gap: 3 }}>
            <Pressable onPress={() => set('allowedModules', toggleModule(module, selected))} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
              <Feather name={selected.includes(module) || subs.some(sub => selected.includes(`${module}:${sub}`)) ? 'check-square' : 'square'} size={18} color={c.primary} />
              <Body>{label[module as AdminWorkflowModuleId]}</Body>
            </Pressable>
            {subs.map(sub => <Pressable key={sub} onPress={() => set('allowedModules', toggleSub(module, sub, selected))} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, paddingLeft: 28 }}>
              <Feather name={selected.includes(`${module}:${sub}`) ? 'check-square' : 'square'} size={16} color={c.primary} /><Body>{sub}</Body>
            </Pressable>)}
          </View>;
        })}<Button label="Save permissions" disabled={!writable} onPress={() => perform({ action: 'staff-permissions', id: member.id, allowedModules: form.allowedModules ?? member.allowedModules }, undefined, () => setForm({}))} /></>}
      </RowCard>) : empty('support staff'))}
    </>;
  };

  const renderer: Record<AdminWorkflowModuleId, () => React.ReactNode> = {
    'complaint-hub': complaintHub, noticeboard, 'approval-center': approvalCenter,
    'leave-requests': leaveRequests, 'teacher-registry': teacherRegistry, 'non-teaching-staff': staffManagement,
  };

  if (!schoolId || (!sessionId && user?.role !== 'support_staff')) return <State title="School session required" detail="Choose an academic session before loading this workflow." />;
  return <ScrollView contentContainerStyle={{ padding: 18, gap: 14, backgroundColor: c.background }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}><Feather name="layers" size={18} color={c.primaryForeground} /></View>
      <View style={{ flex: 1 }}><Text style={{ color: c.foreground, fontSize: 22, fontWeight: '800' }}>{label[moduleId]}</Text><Text style={{ color: c.mutedForeground, fontSize: 12 }}>{archived ? 'Archived session · Read only' : 'School workflow'}</Text></View>
      {mutation.isPending ? <ActivityIndicator color={c.primary} /> : null}
    </View>
    {archived && <Body color={c.destructive}>Changes are disabled for archived academic sessions.</Body>}
    {renderer[moduleId]()}
  </ScrollView>;
}