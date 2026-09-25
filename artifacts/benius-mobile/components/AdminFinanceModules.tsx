import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiGetForSession, apiPost, apiPostForSession } from '@/lib/api';
import { useAcademicSession } from '@/contexts/SessionContext';

type ModuleId = 'fees-manager' | 'assets';
type FeatherName = React.ComponentProps<typeof Feather>['name'];

const palette = {
  background: '#101a2c', panel: '#1a2942', input: '#0f1e35', border: '#334155',
  ink: '#f5f7fa', subdued: '#a4aec0', faint: '#77859a', cyan: '#36bcd3',
  green: '#37c993', gold: '#d4af37', red: '#f0777c', purple: '#aaa0ff',
};

type Asset = {
  id: number; assetCode: string; name: string; category: string; quantity: number;
  condition: string; location: string; purchasedDate: string | null; warrantyExpiry: string | null;
  createdAt: string;
};
type FeeRecord = {
  id: number; studentId: number; feeType: string; feeName?: string | null; amount: number;
  dueDate: string; status: string; invoiceNumber: string | null; receiptNumber?: string | null;
  notes?: string | null; lateFeeAmount?: number; paidDate?: string | null;
};
type Student = { id: number; name: string; class: string; section: string; digitalStudentId: string };
type Structure = {
  id: number; name: string; feeType: string; amount: number; frequency: string;
  applicableClasses: string[]; dueDayOfMonth: number | null;
  breakdown: Array<{ name: string; purpose: string; amount: number }>;
};
type FinanceData = {
  session: { id: number; name: string; isActive: boolean };
  records: FeeRecord[];
  payments: Array<{ id: number; studentId: number; feeRecordId: number | null; amount: number; paymentMethod: string; receivedDate: string; receiptNumber: string | null; invoiceNumber?: string | null }>;
  structures: Structure[];
  summary: { totalRevenue: number; outstanding: number; collectionRate: number; offlinePaymentsCount: number };
  audit: Array<{ id: number; actionLabel: string; description: string; createdAt: string; amount: number | null; studentName: string | null }>;
  students: Student[];
  allowedSubs: string[];
};

function money(amount: number | null | undefined): string {
  return `₹${Number(amount ?? 0).toLocaleString('en-IN')}`;
}
function dateLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(date);
}
function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function Panel({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}
function SectionHeading({ title, detail }: { title: string; detail?: string }) {
  return <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{title}</Text>{detail ? <Text style={styles.detail}>{detail}</Text> : null}</View>;
}
function Field({ label, value, onChangeText, placeholder, keyboardType = 'default', multiline = false }: {
  label: string; value: string; onChangeText: (value: string) => void; placeholder?: string;
  keyboardType?: React.ComponentProps<typeof TextInput>['keyboardType']; multiline?: boolean;
}) {
  return <View style={styles.fieldGroup}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput
      accessibilityLabel={label}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder || label}
      placeholderTextColor={palette.faint}
      keyboardType={keyboardType}
      multiline={multiline}
      autoCapitalize="sentences"
      style={[styles.textInput, multiline && styles.multilineInput]}
    />
  </View>;
}
function Button({ label, onPress, icon, kind = 'primary', disabled = false }: {
  label: string; onPress: () => void; icon?: FeatherName; kind?: 'primary' | 'secondary' | 'danger'; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={[styles.button, kind === 'secondary' && styles.secondaryButton, kind === 'danger' && styles.dangerButton, disabled && styles.disabled]}>
    {icon ? <Feather name={icon} size={15} color={kind === 'primary' ? palette.background : kind === 'danger' ? palette.red : palette.subdued} /> : null}
    <Text style={[styles.buttonText, kind !== 'primary' && styles.secondaryButtonText, kind === 'danger' && { color: palette.red }]}>{label}</Text>
  </Pressable>;
}
function Choice({ values, value, onChange, disabled = false }: { values: string[]; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return <View style={styles.choiceRow}>{values.map((item) => <Pressable key={item} disabled={disabled} onPress={() => onChange(item)}
    style={[styles.choice, item === value && styles.choiceActive, disabled && styles.disabled]}>
    <Text style={[styles.choiceText, item === value && styles.choiceTextActive]}>{item}</Text>
  </Pressable>)}</View>;
}
function LoadingState({ label }: { label: string }) {
  return <View style={styles.centerState}><ActivityIndicator color={palette.cyan} /><Text style={styles.muted}>{label}</Text></View>;
}
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <Panel><View style={styles.inline}><Feather name="alert-circle" size={18} color={palette.red} /><Text style={[styles.body, { flex: 1 }]}>{message}</Text></View><Button label="Try again" icon="refresh-cw" kind="secondary" onPress={onRetry} /></Panel>;
}

export function AssetsInventoryMobile() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [condition, setCondition] = useState('All');
  const [form, setForm] = useState<'add' | 'edit' | null>(null);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [name, setName] = useState('');
  const [assetCode, setAssetCode] = useState('');
  const [category, setCategory] = useState('Furniture');
  const [quantity, setQuantity] = useState('');
  const [assetCondition, setAssetCondition] = useState('Good');
  const [location, setLocation] = useState('');
  const [purchasedDate, setPurchasedDate] = useState('');
  const [warrantyExpiry, setWarrantyExpiry] = useState('');

  const query = useQuery({
    queryKey: ['mobile/admin/assets'],
    queryFn: ({ signal }) => apiGet<{ assets: Asset[]; allowedSubs: string[] }>('/mobile/admin/modules/assets', { signal }),
  });
  const canAdd = query.data?.allowedSubs.includes('add') ?? false;
  const canEdit = query.data?.allowedSubs.includes('edit') ?? false;
  const canDelete = query.data?.allowedSubs.includes('delete') ?? false;
  const assets = query.data?.assets ?? [];
  const visibleAssets = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return assets.filter((item) => (condition === 'All' || item.condition === condition)
      && (!needle || [item.name, item.category, item.assetCode, item.location].some((value) => value?.toLocaleLowerCase().includes(needle))));
  }, [assets, search, condition]);
  const totalQuantity = visibleAssets.reduce((sum, item) => sum + item.quantity, 0);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['mobile/admin/assets'] });
  const addMutation = useMutation({
    mutationFn: (payload: object) => apiPost('/mobile/admin/modules/assets/create', payload),
    onSuccess: () => { void refresh(); setForm(null); },
    onError: (error) => Alert.alert('Asset not added', errorText(error, 'Try again.')),
  });
  const editMutation = useMutation({
    mutationFn: (payload: object) => apiPost('/mobile/admin/modules/assets/update', payload),
    onSuccess: () => { void refresh(); setForm(null); setEditing(null); },
    onError: (error) => Alert.alert('Changes not saved', errorText(error, 'Try again.')),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiPost('/mobile/admin/modules/assets/delete', { id }),
    onSuccess: () => { void refresh(); },
    onError: (error) => Alert.alert('Asset not deleted', errorText(error, 'Try again.')),
  });

  const openAdd = () => {
    setEditing(null); setName(''); setAssetCode(''); setCategory('Furniture'); setQuantity('');
    setAssetCondition('Good'); setLocation(''); setPurchasedDate(''); setWarrantyExpiry(''); setForm('add');
  };
  const openEdit = (asset: Asset) => {
    setEditing(asset); setQuantity(String(asset.quantity)); setAssetCondition(asset.condition);
    setLocation(asset.location); setPurchasedDate(asset.purchasedDate?.slice(0, 10) ?? '');
    setWarrantyExpiry(asset.warrantyExpiry?.slice(0, 10) ?? ''); setForm('edit');
  };
  const submit = () => {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 0 || !location.trim()) {
      Alert.alert('Check asset details', 'Enter a valid non-negative quantity and storage location.');
      return;
    }
    const datesValid = [purchasedDate, warrantyExpiry].every((value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value));
    if (!datesValid) { Alert.alert('Check dates', 'Use YYYY-MM-DD for purchase and warranty dates.'); return; }
    if (form === 'add') {
      if (!name.trim()) { Alert.alert('Asset name required', 'Enter the name of the item.'); return; }
      addMutation.mutate({
        name: name.trim(), assetCode: assetCode.trim() || undefined, category, quantity: qty,
        condition: assetCondition, location: location.trim(),
        purchasedDate: purchasedDate || null, warrantyExpiry: warrantyExpiry || null,
      });
    } else if (editing) {
      editMutation.mutate({
        id: editing.id, changes: {
          quantity: qty, condition: assetCondition, location: location.trim(),
          purchasedDate: purchasedDate || null, warrantyExpiry: warrantyExpiry || null,
        },
      });
    }
  };
  const confirmDelete = (asset: Asset) => Alert.alert('Delete asset?', `${asset.name} will be removed from this school's inventory.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate(asset.id) },
  ]);

  return <View style={styles.module}>
    <Panel style={styles.hero}>
      <View style={styles.heroIcon}><Feather name="package" size={22} color={palette.cyan} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Assets & Inventory</Text>
        <Text style={styles.muted}>School-wide asset register · independent of academic session</Text>
      </View>
    </Panel>
    {query.isPending ? <LoadingState label="Loading the school's inventory…" />
      : query.isError || !query.data ? <ErrorState message={errorText(query.error, 'Asset inventory could not be loaded.')} onRetry={() => void query.refetch()} />
        : <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <View style={styles.metrics}>
            <Panel style={styles.metric}><Text style={styles.metricValue}>{visibleAssets.length}</Text><Text style={styles.metricLabel}>Asset records</Text></Panel>
            <Panel style={styles.metric}><Text style={styles.metricValue}>{totalQuantity.toLocaleString('en-IN')}</Text><Text style={styles.metricLabel}>Items in view</Text></Panel>
          </View>
          <Panel>
            <SectionHeading title="Inventory" detail="Search by item, category, code or location." />
            <Field label="Search inventory" value={search} onChangeText={setSearch} placeholder="Search assets" />
            <Choice values={['All', 'New', 'Good', 'Fair', 'Poor', 'Broken']} value={condition} onChange={setCondition} />
            {canAdd ? <Button label="Add asset" icon="plus" onPress={openAdd} /> : null}
            {visibleAssets.length === 0 ? <Text style={styles.empty}>No assets match these filters.</Text> : visibleAssets.map((asset) =>
              <View key={asset.id} style={styles.record}>
                <View style={styles.recordTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.recordTitle}>{asset.name}</Text>
                    <Text style={styles.muted}>{asset.assetCode} · {asset.category}</Text>
                  </View>
                  <View style={[styles.statusBadge, asset.condition === 'Broken' || asset.condition === 'Poor' ? styles.statusDanger : styles.statusGood]}>
                    <Text style={styles.statusText}>{asset.condition}</Text>
                  </View>
                </View>
                <View style={styles.recordMeta}>
                  <Text style={styles.metaText}>Qty {asset.quantity}</Text>
                  <Text style={styles.metaText}>{asset.location}</Text>
                </View>
                <Text style={styles.faintText}>Purchased {dateLabel(asset.purchasedDate)} · Warranty {dateLabel(asset.warrantyExpiry)}</Text>
                {(canEdit || canDelete) && <View style={styles.actions}>
                  {canEdit ? <Button label="Edit" icon="edit-2" kind="secondary" onPress={() => openEdit(asset)} /> : null}
                  {canDelete ? <Button label="Delete" icon="trash-2" kind="danger" onPress={() => confirmDelete(asset)} disabled={deleteMutation.isPending} /> : null}
                </View>}
              </View>)}
          </Panel>
        </ScrollView>}
    {form ? <View style={styles.formPanel}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 12 }}>
        <View style={styles.inline}>
          <Text style={[styles.sectionTitle, { flex: 1 }]}>{form === 'add' ? 'Register an asset' : `Update ${editing?.name ?? 'asset'}`}</Text>
          <Pressable accessibilityLabel="Close asset form" onPress={() => setForm(null)}><Feather name="x" size={21} color={palette.subdued} /></Pressable>
        </View>
        {form === 'add' ? <>
          <Field label="Asset name" value={name} onChangeText={setName} />
          <Field label="Asset code / serial" value={assetCode} onChangeText={setAssetCode} />
          <Text style={styles.fieldLabel}>Category</Text>
          <Choice values={['Furniture', 'Electronics', 'Lab Equipment', 'Sports', 'Library', 'Other']} value={category} onChange={setCategory} />
        </> : null}
        <Field label="Quantity" value={quantity} onChangeText={setQuantity} keyboardType="number-pad" />
        <Text style={styles.fieldLabel}>Condition</Text>
        <Choice values={['New', 'Good', 'Fair', 'Poor', 'Broken']} value={assetCondition} onChange={setAssetCondition} />
        <Field label="Location" value={location} onChangeText={setLocation} />
        <Field label="Purchase date (YYYY-MM-DD)" value={purchasedDate} onChangeText={setPurchasedDate} />
        <Field label="Warranty expiry (YYYY-MM-DD)" value={warrantyExpiry} onChangeText={setWarrantyExpiry} />
        <View style={styles.actions}>
          <Button label="Cancel" kind="secondary" onPress={() => setForm(null)} />
          <Button label={form === 'add' ? 'Register asset' : 'Save changes'} icon="check" onPress={submit} disabled={addMutation.isPending || editMutation.isPending} />
        </View>
      </ScrollView>
    </View> : null}
  </View>;
}

function FeesPaymentsMobile() {
  const sessions = useAcademicSession();
  const sessionId = sessions.selectedId;
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'ledger' | 'structures' | 'analytics' | 'audit'>('ledger');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [studentSearch, setStudentSearch] = useState('');
  const [studentId, setStudentId] = useState<number | null>(null);
  const [feeName, setFeeName] = useState('');
  const [feeType, setFeeType] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [invoiceNotes, setInvoiceNotes] = useState('');
  const [paying, setPaying] = useState<FeeRecord | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('Cheque');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [cashCounts, setCashCounts] = useState('');
  const [structureForm, setStructureForm] = useState(false);
  const [editingStructure, setEditingStructure] = useState<Structure | null>(null);
  const [structureName, setStructureName] = useState('');
  const [structureType, setStructureType] = useState('');
  const [structureAmount, setStructureAmount] = useState('');
  const [structureFrequency, setStructureFrequency] = useState('annual');

  const query = useQuery({
    queryKey: ['mobile/admin/fees', sessionId],
    queryFn: ({ signal }) => apiGetForSession<FinanceData>('/mobile/admin/modules/fees', sessionId!, { signal }),
    enabled: !!sessionId,
    staleTime: 15_000,
  });
  const data = query.data;
  const canRecord = data?.allowedSubs.includes('record') ?? false;
  const canExport = data?.allowedSubs.includes('export') ?? false;
  const students = data?.students ?? [];
  const studentMap = useMemo(() => new Map(students.map((student) => [student.id, student])), [students]);
  const filteredRecords = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (data?.records ?? []).filter((record) => {
      const student = studentMap.get(record.studentId);
      return (status === 'All' || record.status === status)
        && (!needle || [student?.name, student?.digitalStudentId, record.feeName, record.feeType, record.invoiceNumber]
          .some((value) => value?.toLocaleLowerCase().includes(needle)));
    });
  }, [data?.records, search, status, studentMap]);
  const matchingStudents = useMemo(() => {
    const needle = studentSearch.trim().toLocaleLowerCase();
    return students.filter((student) => !needle || `${student.name} ${student.class} ${student.section} ${student.digitalStudentId}`.toLocaleLowerCase().includes(needle)).slice(0, 30);
  }, [students, studentSearch]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['mobile/admin/fees', sessionId] });
  const invoiceMutation = useMutation({
    mutationFn: (payload: object) => apiPostForSession('/mobile/admin/modules/fees/invoices', sessionId!, payload),
    onSuccess: () => { void refresh(); setInvoiceOpen(false); setStudentId(null); setFeeName(''); setFeeType(''); setAmount(''); setInvoiceNotes(''); },
    onError: (error) => Alert.alert('Invoice not created', errorText(error, 'Try again.')),
  });
  const paymentMutation = useMutation({
    mutationFn: (payload: object) => apiPostForSession<{ receiptNumber?: string }>('/mobile/admin/modules/fees/payments', sessionId!, payload),
    onSuccess: (result) => {
      void refresh(); setPaying(null); setPaymentReference(''); setCashCounts('');
      Alert.alert('Payment recorded', `Payment recorded successfully${result.receiptNumber ? ` · Receipt ${result.receiptNumber}` : ''}.`);
    },
    onError: (error) => Alert.alert('Payment not recorded', errorText(error, 'The invoice remains unchanged. Refresh and try again.')),
  });
  const structureMutation = useMutation({
    mutationFn: (payload: object) => apiPostForSession('/mobile/admin/modules/fees/structures', sessionId!, payload),
    onSuccess: () => { void refresh(); closeStructureForm(); },
    onError: (error) => Alert.alert('Fee structure not saved', errorText(error, 'Try again.')),
  });
  function closeStructureForm() {
    setStructureForm(false); setEditingStructure(null); setStructureName('');
    setStructureType(''); setStructureAmount(''); setStructureFrequency('annual');
  }
  function startStructureEdit(structure: Structure) {
    setEditingStructure(structure); setStructureName(structure.name); setStructureType(structure.feeType);
    setStructureAmount(String(structure.amount)); setStructureFrequency(structure.frequency); setStructureForm(true);
  }
  function submitInvoice() {
    const numericAmount = Number(amount);
    if (!studentId || !feeName.trim() || !feeType.trim() || !Number.isInteger(numericAmount) || numericAmount < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      Alert.alert('Complete invoice details', 'Choose a student, enter the fee name, fee type, a whole-rupee amount and a due date.');
      return;
    }
    invoiceMutation.mutate({ studentId, feeName: feeName.trim(), feeType: feeType.trim(), amount: numericAmount, dueDate, notes: invoiceNotes.trim() || null });
  }
  function submitPayment() {
    if (!paying) return;
    const student = studentMap.get(paying.studentId);
    const expectedAmount = paying.amount + Number(paying.lateFeeAmount ?? 0);
    const denominationBreakdown: Record<string, number> = {};
    if (paymentMethod === 'Cash') {
      const counts = cashCounts.split(/[,\s/]+/).filter(Boolean).map(Number);
      const denoms = [500, 200, 100, 50, 20, 10, 5, 2, 1];
      if (counts.length !== denoms.length || counts.some((count) => !Number.isInteger(count) || count < 0)
        || counts.reduce((sum, count, index) => sum + count * denoms[index], 0) !== expectedAmount) {
        Alert.alert('Cash count does not match', 'Enter nine non-negative counts in order: ₹500, ₹200, ₹100, ₹50, ₹20, ₹10, ₹5, ₹2, ₹1. Their total must match the invoice balance.');
        return;
      }
      denoms.forEach((denomination, index) => { denominationBreakdown[String(denomination)] = counts[index]; });
    }
    if (paymentMethod === 'UpiQr' && !paymentReference.trim()) {
      Alert.alert('Transaction reference required', 'Enter the UPI transaction ID / UTR.');
      return;
    }
    paymentMutation.mutate({
      feeRecordId: paying.id, studentId: paying.studentId, paymentMethod,
      amount: expectedAmount, receivedDate: paymentDate,
      referenceNumber: paymentReference.trim() || null,
      idempotencyKey: `mobile-${paying.id}-${Date.now()}`,
      denominationBreakdown: paymentMethod === 'Cash' ? denominationBreakdown : null,
    });
  }
  function submitStructure() {
    const numericAmount = Number(structureAmount);
    if (!structureName.trim() || !structureType.trim() || !Number.isInteger(numericAmount) || numericAmount < 1) {
      Alert.alert('Complete fee structure', 'Enter a name, fee type and positive whole-rupee amount.');
      return;
    }
    structureMutation.mutate({
      action: editingStructure ? 'update' : 'create', ...(editingStructure ? { id: editingStructure.id } : {}),
      structure: {
        name: structureName.trim(), feeType: structureType.trim(), amount: numericAmount,
        frequency: structureFrequency, applicableClasses: editingStructure?.applicableClasses ?? [],
        dueDayOfMonth: editingStructure?.dueDayOfMonth ?? null, breakdown: editingStructure?.breakdown ?? [],
      },
    });
  }
  function deleteStructure(structure: Structure) {
    Alert.alert('Delete fee structure?', `${structure.name} will be removed. Existing invoices remain unchanged.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => structureMutation.mutate({ action: 'delete', id: structure.id }) },
    ]);
  }
  const exportLedger = () => {
    if (!canExport) return;
    const lines = ['Invoice,Student,Fee,Amount,Status,Due date', ...(data?.records ?? []).map((item) => {
      const student = studentMap.get(item.studentId);
      return [item.invoiceNumber ?? '', student?.name ?? '', item.feeName || item.feeType, String(item.amount), item.status, item.dueDate]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',');
    })];
    void Share.share({
      title: `Fees ledger · ${data?.session.name ?? 'Academic session'}`,
      message: lines.join('\n'),
    }).catch((error: unknown) => Alert.alert('Export unavailable', errorText(error, 'The ledger could not be shared.')));
  };

  return <View style={styles.module}>
    <Panel style={styles.hero}>
      <View style={styles.heroIcon}><Feather name="credit-card" size={22} color={palette.cyan} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Fees & Payments</Text>
        <Text style={styles.muted}>{data?.session.name ?? 'Financial hub · ledger, structures and collections'}</Text>
      </View>
      {data?.session.isActive === false ? <View style={styles.archiveBadge}><Text style={styles.archiveText}>Archive · read-only</Text></View> : null}
    </Panel>
    {!sessionId ? <Panel><View style={styles.inline}><Feather name="calendar" size={19} color={palette.gold} /><Text style={[styles.body, { flex: 1 }]}>Select an academic session to view this financial ledger.</Text></View></Panel>
      : query.isPending ? <LoadingState label="Loading the selected session's fee ledger…" />
        : query.isError || !data ? <ErrorState message={errorText(query.error, 'Fees and payments could not be loaded.')} onRetry={() => void query.refetch()} />
          : <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabStrip}>
              {([
                ['ledger', 'Ledger', 'list'], ['structures', 'Structures', 'book-open'],
                ['analytics', 'Analytics', 'bar-chart-2'], ['audit', 'Audit log', 'shield'],
              ] as const).map(([id, label, icon]) => <Pressable key={id} onPress={() => setTab(id)} style={[styles.tab, tab === id && styles.tabActive]}>
                <Feather name={icon} size={14} color={tab === id ? palette.background : palette.subdued} />
                <Text style={[styles.tabText, tab === id && styles.tabTextActive]}>{label}</Text>
              </Pressable>)}
            </ScrollView>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
              {tab === 'ledger' ? <>
                <View style={styles.metrics}>
                  <Metric label="Revenue" value={money(data.summary.totalRevenue)} />
                  <Metric label="Outstanding" value={money(data.summary.outstanding)} />
                  <Metric label="Collection" value={`${data.summary.collectionRate}%`} />
                </View>
                <Panel>
                  <SectionHeading title="Ledger & transactions" detail={`${data.records.length} invoices · ${data.payments.length} payments`} />
                  <Field label="Search ledger" value={search} onChangeText={setSearch} placeholder="Student, invoice or fee" />
                  <Choice values={['All', 'Due', 'Overdue', 'Paid']} value={status} onChange={setStatus} />
                  <View style={styles.actions}>
                    {canRecord && data.session.isActive ? <Button label="Add invoice" icon="plus" onPress={() => setInvoiceOpen(!invoiceOpen)} /> : null}
                    {canExport ? <Button label="Share CSV" icon="share-2" kind="secondary" onPress={exportLedger} /> : null}
                  </View>
                  {invoiceOpen ? <View style={styles.subPanel}>
                    <SectionHeading title="New invoice" detail="The invoice will be assigned to the selected academic session." />
                    <Field label="Find student" value={studentSearch} onChangeText={(value) => { setStudentSearch(value); setStudentId(null); }} />
                    <View style={styles.studentChoices}>{matchingStudents.slice(0, 12).map((student) => <Pressable key={student.id}
                      onPress={() => { setStudentId(student.id); setStudentSearch(`${student.name} · ${student.class}-${student.section}`); }}
                      style={[styles.studentChoice, student.id === studentId && styles.choiceActive]}>
                      <Text style={[styles.choiceText, student.id === studentId && styles.choiceTextActive]}>{student.name} · {student.class}-{student.section}</Text>
                    </Pressable>)}</View>
                    <Field label="Fee name" value={feeName} onChangeText={setFeeName} />
                    <Field label="Fee type" value={feeType} onChangeText={setFeeType} />
                    <Field label="Amount (₹)" value={amount} onChangeText={setAmount} keyboardType="number-pad" />
                    <Field label="Due date (YYYY-MM-DD)" value={dueDate} onChangeText={setDueDate} />
                    <Field label="Notes" value={invoiceNotes} onChangeText={setInvoiceNotes} multiline />
                    <View style={styles.actions}>
                      <Button label="Cancel" kind="secondary" onPress={() => setInvoiceOpen(false)} />
                      <Button label="Create invoice" icon="check" onPress={submitInvoice} disabled={invoiceMutation.isPending} />
                    </View>
                  </View> : null}
                  {filteredRecords.length === 0 ? <Text style={styles.empty}>No fee records match this session and filter.</Text> : filteredRecords.map((record) => {
                    const student = studentMap.get(record.studentId);
                    const selectedForPayment = paying?.id === record.id;
                    return <View key={record.id} style={styles.record}>
                      <View style={styles.recordTop}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.recordTitle}>{student?.name ?? 'Student record'}</Text>
                          <Text style={styles.muted}>{record.invoiceNumber ?? `Invoice ${record.id}`} · {record.feeName || record.feeType}</Text>
                        </View>
                        <View style={[styles.statusBadge, record.status === 'Paid' ? styles.statusGood : styles.statusWarn]}>
                          <Text style={styles.statusText}>{record.status}</Text>
                        </View>
                      </View>
                      <View style={styles.recordMeta}><Text style={styles.amount}>{money(record.amount + Number(record.lateFeeAmount ?? 0))}</Text><Text style={styles.metaText}>Due {dateLabel(record.dueDate)}</Text></View>
                      {record.status !== 'Paid' && canRecord && data.session.isActive ? <Button
                        label={selectedForPayment ? 'Close payment form' : 'Record offline payment'}
                        icon={selectedForPayment ? 'x' : 'credit-card'} kind="secondary"
                        onPress={() => { setPaying(selectedForPayment ? null : record); setPaymentMethod('Cheque'); setPaymentReference(''); }}
                      /> : null}
                      {selectedForPayment ? <View style={styles.subPanel}>
                        <SectionHeading title="Record payment" detail={`Full invoice balance · ${money(record.amount + Number(record.lateFeeAmount ?? 0))}`} />
                        <Choice values={['Cash', 'Cheque', 'BankTransfer', 'DemandDraft', 'UpiQr']} value={paymentMethod} onChange={setPaymentMethod} />
                        <Field label="Received date (YYYY-MM-DD)" value={paymentDate} onChangeText={setPaymentDate} />
                        {paymentMethod !== 'Cash' ? <Field label={paymentMethod === 'UpiQr' ? 'UPI transaction ID / UTR' : 'Reference number'} value={paymentReference} onChangeText={setPaymentReference} /> : null}
                        {paymentMethod === 'Cash' ? <Field label="Cash denominations: counts for ₹500 / 200 / 100 / 50 / 20 / 10 / 5 / 2 / 1" value={cashCounts} onChangeText={setCashCounts} placeholder="e.g. 1,0,0,0,0,0,0,0,0" keyboardType="number-pad" /> : null}
                        <View style={styles.actions}>
                          <Button label="Cancel" kind="secondary" onPress={() => setPaying(null)} />
                          <Button label="Record full payment" icon="check" onPress={submitPayment} disabled={paymentMutation.isPending} />
                        </View>
                      </View> : null}
                    </View>;
                  })}
                </Panel>
              </> : null}
              {tab === 'structures' ? <Panel>
                <SectionHeading title="Fee structures" detail="Fee templates are school-wide; existing invoices keep their saved amounts." />
                {canRecord && data.session.isActive ? <Button label="Add fee structure" icon="plus" onPress={() => { closeStructureForm(); setStructureForm(true); }} /> : null}
                {structureForm ? <View style={styles.subPanel}>
                  <Field label="Structure name" value={structureName} onChangeText={setStructureName} />
                  <Field label="Fee type" value={structureType} onChangeText={setStructureType} />
                  <Field label="Amount (₹)" value={structureAmount} onChangeText={setStructureAmount} keyboardType="number-pad" />
                  <Text style={styles.fieldLabel}>Frequency</Text>
                  <Choice values={['monthly', 'quarterly', 'annual', 'one-time']} value={structureFrequency} onChange={setStructureFrequency} />
                  <View style={styles.actions}><Button label="Cancel" kind="secondary" onPress={closeStructureForm} /><Button label={editingStructure ? 'Save structure' : 'Create structure'} icon="check" onPress={submitStructure} disabled={structureMutation.isPending} /></View>
                </View> : null}
                {data.structures.length === 0 ? <Text style={styles.empty}>No fee structures have been created.</Text> : data.structures.map((structure) =>
                  <View key={structure.id} style={styles.record}>
                    <View style={styles.recordTop}><Text style={[styles.recordTitle, { flex: 1 }]}>{structure.name}</Text><Text style={styles.amount}>{money(structure.amount)}</Text></View>
                    <Text style={styles.muted}>{structure.feeType} · {structure.frequency}</Text>
                    {structure.applicableClasses?.length ? <Text style={styles.faintText}>Classes: {structure.applicableClasses.join(', ')}</Text> : null}
                    {canRecord && data.session.isActive ? <View style={styles.actions}>
                      <Button label="Edit" icon="edit-2" kind="secondary" onPress={() => startStructureEdit(structure)} />
                      <Button label="Delete" icon="trash-2" kind="danger" onPress={() => deleteStructure(structure)} disabled={structureMutation.isPending} />
                    </View> : null}
                  </View>)}
              </Panel> : null}
              {tab === 'analytics' ? <>
                <SectionHeading title="Financial analytics" detail={`${data.session.name} · live ledger totals`} />
                <View style={styles.metrics}>
                  <Metric label="Collected revenue" value={money(data.summary.totalRevenue)} icon="trending-up" />
                  <Metric label="Outstanding balance" value={money(data.summary.outstanding)} icon="clock" />
                  <Metric label="Collection rate" value={`${data.summary.collectionRate}%`} icon="bar-chart-2" />
                </View>
                <Panel>
                  <SectionHeading title="Payment methods" />
                  {Object.entries(data.payments.reduce<Record<string, number>>((counts, payment) => {
                    counts[payment.paymentMethod] = (counts[payment.paymentMethod] ?? 0) + payment.amount;
                    return counts;
                  }, {})).map(([method, total]) => <View key={method} style={styles.summaryLine}><Text style={styles.body}>{method}</Text><Text style={styles.amount}>{money(total)}</Text></View>)}
                  {!data.payments.length ? <Text style={styles.empty}>No payment records are available in this session.</Text> : null}
                </Panel>
              </> : null}
              {tab === 'audit' ? <Panel>
                <SectionHeading title="Audit log" detail="Fee and payment changes for the selected session." />
                {data.audit.length === 0 ? <Text style={styles.empty}>No fee activity has been recorded in this session.</Text> : data.audit.map((entry) =>
                  <View key={entry.id} style={styles.record}>
                    <View style={styles.recordTop}><Text style={styles.recordTitle}>{entry.actionLabel}</Text>{entry.amount != null ? <Text style={styles.amount}>{money(entry.amount)}</Text> : null}</View>
                    <Text style={styles.body}>{entry.description}</Text>
                    <Text style={styles.faintText}>{entry.studentName ? `${entry.studentName} · ` : ''}{dateLabel(entry.createdAt)}</Text>
                  </View>)}
              </Panel> : null}
            </ScrollView>
          </>}
  </View>;
}

function Metric({ label, value, icon }: { label: string; value: string; icon?: FeatherName }) {
  return <Panel style={styles.metric}>
    {icon ? <Feather name={icon} size={14} color={palette.cyan} /> : null}
    <Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text>
  </Panel>;
}

export default function AdminFinanceModules({ moduleId }: { moduleId: ModuleId }) {
  return moduleId === 'assets' ? <AssetsInventoryMobile /> : <FeesPaymentsMobile />;
}

const styles = StyleSheet.create({
  module: { flex: 1, backgroundColor: palette.background, gap: 12 },
  content: { paddingBottom: 36, gap: 12 },
  panel: { backgroundColor: palette.panel, borderColor: palette.border, borderWidth: 1, borderRadius: 15, padding: 15, gap: 12 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroIcon: { width: 44, height: 44, borderRadius: 13, backgroundColor: '#123249', alignItems: 'center', justifyContent: 'center' },
  title: { color: palette.ink, fontSize: 19, fontWeight: '800' },
  muted: { color: palette.subdued, fontSize: 12, lineHeight: 18 },
  faintText: { color: palette.faint, fontSize: 11, lineHeight: 17 },
  body: { color: palette.ink, fontSize: 13, lineHeight: 19 },
  sectionHeading: { gap: 4, marginBottom: 3 },
  sectionTitle: { color: palette.ink, fontSize: 15, fontWeight: '800' },
  detail: { color: palette.subdued, fontSize: 11, lineHeight: 16 },
  fieldGroup: { gap: 6 },
  fieldLabel: { color: palette.subdued, fontSize: 11, fontWeight: '700' },
  textInput: { minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.input, color: palette.ink, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13 },
  multilineInput: { minHeight: 72, textAlignVertical: 'top' },
  button: { alignSelf: 'flex-start', minHeight: 39, paddingHorizontal: 12, borderRadius: 10, backgroundColor: palette.cyan, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  buttonText: { color: palette.background, fontSize: 12, fontWeight: '800' },
  secondaryButton: { backgroundColor: '#25354b', borderColor: palette.border, borderWidth: 1 },
  secondaryButtonText: { color: palette.ink },
  dangerButton: { backgroundColor: 'rgba(240,119,124,.1)', borderColor: 'rgba(240,119,124,.28)', borderWidth: 1 },
  disabled: { opacity: 0.5 },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  choice: { borderWidth: 1, borderColor: palette.border, backgroundColor: palette.input, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8 },
  choiceActive: { backgroundColor: palette.cyan, borderColor: palette.cyan },
  choiceText: { color: palette.subdued, fontSize: 11, fontWeight: '700' },
  choiceTextActive: { color: palette.background },
  metrics: { flexDirection: 'row', gap: 8 },
  metric: { flex: 1, minWidth: 0, alignItems: 'flex-start', padding: 12, gap: 5 },
  metricValue: { color: palette.ink, fontSize: 17, fontWeight: '800' },
  metricLabel: { color: palette.subdued, fontSize: 10, lineHeight: 14 },
  record: { paddingVertical: 13, borderTopWidth: 1, borderTopColor: 'rgba(164,174,192,.13)', gap: 9 },
  recordTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  recordTitle: { color: palette.ink, fontSize: 13, fontWeight: '800' },
  recordMeta: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  metaText: { color: palette.subdued, fontSize: 11 },
  amount: { color: palette.green, fontSize: 13, fontWeight: '800' },
  statusBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  statusGood: { backgroundColor: 'rgba(55,201,147,.14)' },
  statusWarn: { backgroundColor: 'rgba(212,175,55,.15)' },
  statusDanger: { backgroundColor: 'rgba(240,119,124,.15)' },
  statusText: { color: palette.ink, fontSize: 10, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  empty: { paddingVertical: 15, color: palette.faint, fontSize: 12, textAlign: 'center' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  centerState: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  archiveBadge: { backgroundColor: 'rgba(212,175,55,.15)', paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999 },
  archiveText: { color: palette.gold, fontWeight: '700', fontSize: 10 },
  tabStrip: { gap: 7, paddingBottom: 2 },
  tab: { minHeight: 39, borderWidth: 1, borderColor: palette.border, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabActive: { backgroundColor: palette.cyan, borderColor: palette.cyan },
  tabText: { color: palette.subdued, fontSize: 11, fontWeight: '700' },
  tabTextActive: { color: palette.background },
  subPanel: { padding: 12, gap: 11, backgroundColor: palette.input, borderRadius: 12, borderWidth: 1, borderColor: palette.border },
  studentChoices: { gap: 5, maxHeight: 190 },
  studentChoice: { borderRadius: 8, borderWidth: 1, borderColor: palette.border, padding: 9 },
  summaryLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: 'rgba(164,174,192,.13)' },
  formPanel: { position: 'absolute', zIndex: 4, left: 8, right: 8, bottom: 8, maxHeight: '82%', padding: 16, borderRadius: 18, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.panel, elevation: 12 },
});