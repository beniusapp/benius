import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Package, Plus, Search, Filter, MoreVertical, Edit2, Trash2,
  FileText, X, ChevronDown, Calendar, ShieldCheck, CalendarRange,
} from "lucide-react";
import { fmtDate } from "@/lib/dateUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useSessionView } from "@/contexts/session-view-context";

interface Props { schoolId: number; allowedSubs?: string[] }

interface Asset {
  id: number;
  schoolId: number;
  assetCode: string;
  name: string;
  category: string;
  quantity: number;
  condition: string;
  location: string;
  purchasedDate: string | null;
  warrantyExpiry: string | null;
  createdAt: string;
  updatedAt: string;
}

type DateFilterMode = "all" | "day" | "week" | "month" | "custom";
type DateFilterField = "purchasedDate" | "warrantyExpiry";

const CATEGORIES = ["Furniture", "Electronics", "Lab Equipment", "Sports", "Library", "Other"];
const CONDITIONS = ["New", "Good", "Fair", "Poor", "Broken"];

const CONDITION_BADGE: Record<string, string> = {
  "New":    "text-emerald-300 bg-emerald-500/20 border border-emerald-500/30",
  "Good":   "text-blue-300   bg-blue-500/20   border border-blue-500/30",
  "Fair":   "text-orange-300 bg-orange-500/20 border border-orange-500/30",
  "Poor":   "text-rose-300   bg-rose-500/20   border border-rose-500/30",
  "Broken": "text-rose-400   bg-rose-600/20   border border-rose-500/30",
};

const DATE_MODE_LABELS: Record<DateFilterMode, string> = {
  all: "All Time", day: "Today", week: "This Week", month: "This Month", custom: "Custom Range",
};

// ── Date helpers ───────────────────────────────────────────────────────────────
function startOfDay(d: Date)   { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function endOfDay(d: Date)     { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfWeek(d: Date)  {
  const day = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return startOfDay(mon);
}
function inRange(dateStr: string | null, from: Date, to: Date): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d >= from && d <= to;
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Label component for date fields ────────────────────────────────────────────
function DateLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">
      {icon}{text}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function AssetsInventory({ schoolId: _schoolId, allowedSubs }: Props) {
  const canAdd    = allowedSubs === undefined || allowedSubs.includes("add");
  const canEdit   = allowedSubs === undefined || allowedSubs.includes("edit");
  const canDelete = allowedSubs === undefined || allowedSubs.includes("delete");
  const { toast } = useToast();
  const { isArchiveMode } = useSessionView();

  // ── Search / condition / location filters ────────────────────────────────────
  const [search, setSearch]               = useState("");
  const [filterCondition, setFilterCondition] = useState("all");
  const [filterLocation, setFilterLocation]   = useState("all");

  // ── Date-range filter state ──────────────────────────────────────────────────
  const [showDateDrop, setShowDateDrop]       = useState(false);
  const [dateMode, setDateMode]               = useState<DateFilterMode>("all");
  const [dateField, setDateField]             = useState<DateFilterField>("purchasedDate");
  const [customFrom, setCustomFrom]           = useState(todayStr());
  const [customTo, setCustomTo]               = useState(todayStr());
  const dateDropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (dateDropRef.current && !dateDropRef.current.contains(e.target as Node))
        setShowDateDrop(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  // ── Add-form state ───────────────────────────────────────────────────────────
  const [showAddForm, setShowAddForm]     = useState(false);
  const [addName, setAddName]             = useState("");
  const [addSerial, setAddSerial]         = useState("");
  const [addCategory, setAddCategory]     = useState("");
  const [addQty, setAddQty]               = useState("");
  const [addCondition, setAddCondition]   = useState("Good");
  const [addLocation, setAddLocation]     = useState("");
  const [addPurchased, setAddPurchased]   = useState("");
  const [addWarranty, setAddWarranty]     = useState("");

  // ── Edit-dialog state ────────────────────────────────────────────────────────
  const [editAsset, setEditAsset]         = useState<Asset | null>(null);
  const [editQty, setEditQty]             = useState("");
  const [editCondition, setEditCondition] = useState("");
  const [editLocation, setEditLocation]   = useState("");
  const [editPurchased, setEditPurchased] = useState("");
  const [editWarranty, setEditWarranty]   = useState("");

  const [deleteTarget, setDeleteTarget]   = useState<Asset | null>(null);

  // ── Query ────────────────────────────────────────────────────────────────────
  const { data: assets = [], isLoading } = useQuery<Asset[]>({
    queryKey: ["/api/admin/assets"],
  });

  // ── Mutations ────────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async (payload: object) => {
      const res = await apiRequest("POST", "/api/admin/assets", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/assets"] });
      toast({ title: "Asset Added", description: `${addName} registered to inventory.` });
      setAddName(""); setAddSerial(""); setAddCategory(""); setAddQty("");
      setAddCondition("Good"); setAddLocation(""); setAddPurchased(""); setAddWarranty("");
      setShowAddForm(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: object }) => {
      const res = await apiRequest("PATCH", `/api/admin/assets/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/assets"] });
      toast({ title: "Asset Updated", description: "Changes saved successfully." });
      setEditAsset(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/assets/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/assets"] });
      toast({ title: "Asset Deleted", description: "Asset removed from inventory." });
      setDeleteTarget(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Unique locations ─────────────────────────────────────────────────────────
  const uniqueLocations = useMemo(() =>
    Array.from(new Set(assets.map(a => a.location).filter(Boolean))).sort()
  , [assets]);

  // ── Date range resolution ────────────────────────────────────────────────────
  const now = new Date();
  const dateRange = useMemo((): [Date, Date] | null => {
    if (dateMode === "all") return null;
    if (dateMode === "day")   return [startOfDay(now), endOfDay(now)];
    if (dateMode === "week")  return [startOfWeek(now), endOfDay(now)];
    if (dateMode === "month") return [startOfMonth(now), endOfDay(now)];
    if (dateMode === "custom" && customFrom && customTo) {
      const f = customFrom <= customTo ? customFrom : customTo;
      const t = customFrom <= customTo ? customTo   : customFrom;
      return [startOfDay(new Date(f)), endOfDay(new Date(t))];
    }
    return null;
  }, [dateMode, customFrom, customTo]);

  // ── Master filter ────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return assets.filter(a => {
      if (filterCondition !== "all" && a.condition !== filterCondition) return false;
      if (filterLocation  !== "all" && a.location  !== filterLocation)  return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const hit = a.name.toLowerCase().includes(q)
          || a.category.toLowerCase().includes(q)
          || (a.assetCode || "").toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (dateRange) {
        const fieldVal = dateField === "purchasedDate" ? a.purchasedDate : a.warrantyExpiry;
        if (!inRange(fieldVal, dateRange[0], dateRange[1])) return false;
      }
      return true;
    });
  }, [assets, search, filterCondition, filterLocation, dateRange, dateField]);

  const totalItems = filtered.reduce((s, a) => s + a.quantity, 0);
  const hasFilters = !!(search.trim() || filterCondition !== "all" || filterLocation !== "all" || dateMode !== "all");

  // ── Handlers ─────────────────────────────────────────────────────────────────
  function handleAdd() {
    if (!addName.trim() || !addCategory || !addQty) return;
    createMutation.mutate({
      name: addName.trim(),
      assetCode: addSerial.trim() || undefined,
      category: addCategory,
      quantity: parseInt(addQty),
      condition: addCondition,
      location: addLocation.trim() || "—",
      purchasedDate: addPurchased || null,
      warrantyExpiry: addWarranty || null,
    });
  }

  function openEdit(a: Asset) {
    setEditAsset(a);
    setEditQty(String(a.quantity));
    setEditCondition(a.condition);
    setEditLocation(a.location);
    setEditPurchased(a.purchasedDate ?? "");
    setEditWarranty(a.warrantyExpiry ?? "");
  }

  function handleSaveEdit() {
    if (!editAsset) return;
    updateMutation.mutate({
      id: editAsset.id,
      data: {
        quantity:      parseInt(editQty),
        condition:     editCondition,
        location:      editLocation,
        purchasedDate: editPurchased || null,
        warrantyExpiry: editWarranty || null,
      },
    });
  }

  function clearAllFilters() {
    setSearch(""); setFilterCondition("all"); setFilterLocation("all");
    setDateMode("all");
  }

  // ── Date filter label for badge ───────────────────────────────────────────────
  const dateFilterBadge = dateMode !== "all"
    ? `${DATE_MODE_LABELS[dateMode]} · ${dateField === "purchasedDate" ? "Purchase Date" : "Warranty Expiry"}`
    : null;

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Assets & Inventory</h2>
          <p className="text-white/50 text-sm">
            {filtered.length} asset type{filtered.length !== 1 ? "s" : ""} · {totalItems.toLocaleString()} total items
          </p>
        </div>
        {canAdd && (
          <Button
            size="sm"
            className="bg-[#10b981] hover:bg-[#059669] text-white font-semibold"
            onClick={() => setShowAddForm(v => !v)}
            disabled={isArchiveMode}
            data-testid="button-add-asset"
          >
            <Plus className="w-4 h-4 mr-1" /> Add Asset
          </Button>
        )}
      </div>

      {/* ── Add-Asset Form ── */}
      {showAddForm && (
        <div className="rounded-xl border border-[#10b981]/30 bg-[#1A2942] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white">New Asset Entry</h3>
            <button onClick={() => setShowAddForm(false)} className="text-white/40 hover:text-white/80">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Row 1: Name (full) */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-white/60 mb-1 font-medium">Asset Name *</label>
              <Input
                value={addName}
                onChange={e => setAddName(e.target.value)}
                placeholder="e.g. Projector Epson X45"
                className="bg-[#0A1628] border-white/20 text-white placeholder:text-white/20 focus:border-[#10b981]/60"
                data-testid="input-asset-name"
              />
            </div>

            {/* Row 2: Serial | Category */}
            <div>
              <label className="block text-xs text-white/60 mb-1 font-medium">Asset Code / Serial No.</label>
              <Input
                value={addSerial}
                onChange={e => setAddSerial(e.target.value)}
                placeholder="Auto-generated if blank"
                className="bg-[#0A1628] border-white/20 text-white placeholder:text-white/20 focus:border-[#10b981]/60 font-mono text-sm"
                data-testid="input-asset-serial"
              />
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1 font-medium">Category *</label>
              <Select value={addCategory} onValueChange={setAddCategory}>
                <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-asset-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {/* Row 3: Qty | Condition */}
            <div>
              <label className="block text-xs text-white/60 mb-1 font-medium">Quantity *</label>
              <Input
                type="number" min="0" value={addQty}
                onChange={e => setAddQty(e.target.value)}
                className="bg-[#0A1628] border-white/20 text-white focus:border-[#10b981]/60"
                data-testid="input-asset-qty"
              />
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1 font-medium">Condition</label>
              <Select value={addCondition} onValueChange={setAddCondition}>
                <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-asset-condition">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>{CONDITIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {/* Row 4: Location (full) */}
            <div className="col-span-2">
              <label className="block text-xs text-white/60 mb-1 font-medium">Location</label>
              <Input
                value={addLocation}
                onChange={e => setAddLocation(e.target.value)}
                placeholder="e.g. A-Block / Library"
                className="bg-[#0A1628] border-white/20 text-white placeholder:text-white/20 focus:border-[#10b981]/60"
                data-testid="input-asset-location"
              />
            </div>

            {/* Row 5: Purchased Date | Warranty Expiry */}
            <div>
              <label className="block text-xs text-white/60 mb-1 font-medium flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Purchased Date
              </label>
              <input
                type="date"
                value={addPurchased}
                onChange={e => setAddPurchased(e.target.value)}
                data-testid="input-asset-purchased"
                className="w-full rounded-lg bg-[#0A1628] border border-white/20 text-white text-sm px-3 py-2 focus:outline-none focus:border-[#10b981]/60"
              />
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1 font-medium flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" /> Warranty Expiry
              </label>
              <input
                type="date"
                value={addWarranty}
                onChange={e => setAddWarranty(e.target.value)}
                data-testid="input-asset-warranty"
                className="w-full rounded-lg bg-[#0A1628] border border-white/20 text-white text-sm px-3 py-2 focus:outline-none focus:border-[#10b981]/60"
              />
            </div>

            {/* Submit */}
            <div className="col-span-2">
              <Button
                disabled={isArchiveMode || !addName.trim() || !addCategory || !addQty || createMutation.isPending}
                onClick={handleAdd}
                className="w-full bg-[#10b981] hover:bg-[#059669] text-white font-semibold disabled:opacity-40"
                data-testid="button-submit-asset"
              >
                {createMutation.isPending ? "Adding…" : "Add Asset"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Search + Filters bar ── */}
      <div className="flex flex-col sm:flex-row gap-2">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, category, or code…"
            className="pl-9 bg-[#1A2942] border-white/20 text-white placeholder:text-white/30"
            data-testid="input-search-assets"
          />
        </div>

        <div className="flex gap-2 flex-wrap">
          {/* Condition */}
          <Select value={filterCondition} onValueChange={setFilterCondition}>
            <SelectTrigger className="bg-[#1A2942] border-white/20 text-white w-36" data-testid="select-filter-condition">
              <Filter className="w-3 h-3 mr-1 text-white/40" />
              <SelectValue placeholder="Condition" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Conditions</SelectItem>
              {CONDITIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>

          {/* Location */}
          <Select value={filterLocation} onValueChange={setFilterLocation}>
            <SelectTrigger className="bg-[#1A2942] border-white/20 text-white w-36" data-testid="select-filter-location">
              <SelectValue placeholder="Location" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Locations</SelectItem>
              {uniqueLocations.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
            </SelectContent>
          </Select>

          {/* Date-range filter dropdown */}
          <div className="relative" ref={dateDropRef}>
            <button
              data-testid="button-date-filter"
              onClick={() => setShowDateDrop(v => !v)}
              className={`
                inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-all duration-200
                ${dateMode !== "all"
                  ? "bg-[#10b981]/10 border-[#10b981]/40 text-[#10b981]"
                  : "bg-[#1A2942] border-white/20 text-white/70 hover:border-[#10b981]/40 hover:text-white"}
              `}
            >
              <CalendarRange className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">
                {dateMode === "all" ? "Date Filter" : DATE_MODE_LABELS[dateMode]}
              </span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showDateDrop ? "rotate-180" : ""}`} />
            </button>

            {showDateDrop && (
              <div className="
                absolute left-0 top-full mt-1.5 z-50 w-64
                rounded-xl border border-white/15 bg-[#0F1E35]/95 backdrop-blur-xl
                shadow-2xl shadow-black/60 overflow-hidden max-h-[80vh] overflow-y-auto
              ">
                {/* Field toggle */}
                <div className="px-3 pt-3 pb-2 border-b border-white/10">
                  <p className="text-[10px] text-white/40 uppercase tracking-widest mb-2 font-semibold">Filter by</p>
                  <div className="flex rounded-lg overflow-hidden border border-white/10">
                    {(["purchasedDate", "warrantyExpiry"] as DateFilterField[]).map(f => (
                      <button
                        key={f}
                        data-testid={`date-field-${f}`}
                        onClick={() => setDateField(f)}
                        className={`flex-1 py-1.5 text-xs font-semibold transition-colors ${
                          dateField === f
                            ? "bg-[#10b981] text-white"
                            : "text-white/50 hover:text-white hover:bg-white/5"
                        }`}
                      >
                        {f === "purchasedDate" ? "Purchase Date" : "Warranty Expiry"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Period options */}
                {(["all", "day", "week", "month", "custom"] as DateFilterMode[]).map(mode => (
                  <button
                    key={mode}
                    data-testid={`date-mode-${mode}`}
                    onClick={() => { setDateMode(mode); if (mode !== "custom") setShowDateDrop(false); }}
                    className={`
                      w-full text-left px-4 py-2.5 text-sm transition-colors duration-150
                      ${dateMode === mode
                        ? "text-[#10b981] bg-[#10b981]/10 font-semibold"
                        : "text-white/65 hover:text-white hover:bg-white/5"}
                    `}
                  >
                    {DATE_MODE_LABELS[mode]}
                  </button>
                ))}

                {/* Custom range pickers */}
                {dateMode === "custom" && (
                  <div className="px-3 pb-3 pt-1 border-t border-white/10 space-y-2">
                    <div>
                      <label className="block text-[10px] text-white/40 uppercase tracking-wider mb-1">From</label>
                      <input
                        type="date" value={customFrom} max={customTo}
                        onChange={e => setCustomFrom(e.target.value)}
                        data-testid="date-custom-from"
                        className="w-full rounded-lg bg-[#1A2942] border border-white/15 text-white text-xs px-2.5 py-1.5 focus:outline-none focus:border-[#10b981]/50"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-white/40 uppercase tracking-wider mb-1">To</label>
                      <input
                        type="date" value={customTo} min={customFrom}
                        onChange={e => setCustomTo(e.target.value)}
                        data-testid="date-custom-to"
                        className="w-full rounded-lg bg-[#1A2942] border border-white/15 text-white text-xs px-2.5 py-1.5 focus:outline-none focus:border-[#10b981]/50"
                      />
                    </div>
                    <button
                      onClick={() => setShowDateDrop(false)}
                      className="w-full px-3 py-1.5 rounded-lg bg-[#10b981] text-white text-xs font-semibold hover:bg-[#059669] transition-colors"
                    >
                      Apply Range
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Clear all filters */}
          {hasFilters && (
            <Button
              size="sm" variant="ghost"
              className="text-white/50 hover:text-white border border-white/10"
              onClick={clearAllFilters}
              data-testid="button-clear-filters"
            >
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Active date-filter badge */}
      {dateFilterBadge && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#10b981]/15 border border-[#10b981]/25 text-[#10b981] text-xs font-semibold">
            <CalendarRange className="w-3 h-3" />
            {dateFilterBadge}
            <button onClick={() => setDateMode("all")} className="ml-1 opacity-60 hover:opacity-100">
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
          <span className="text-white/30 text-xs">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
        </div>
      )}

      {/* ── Inventory Table ── */}
      <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: "860px" }}>
            <thead className="bg-[#0F1E35]">
              <tr>
                {[
                  "Asset Name", "Category", "Code / Serial", "Qty",
                  "Location", "Condition", "Purchase Date", "",
                ].map((h, i) => (
                  <th
                    key={i}
                    className={`
                      text-left py-3 px-4 text-white/55 font-semibold text-[11px] uppercase tracking-wider whitespace-nowrap
                      ${i === 0 ? "sticky left-0 z-10 bg-[#0F1E35]" : ""}
                    `}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-white/5">
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j} className={`py-3 px-4 ${j === 0 ? "sticky left-0 bg-[#1A2942]" : ""}`}>
                        <div className="h-4 rounded bg-white/10 animate-pulse" style={{ width: j === 0 ? "140px" : "60px" }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-3 text-white/40">
                      <Package className="w-12 h-12 opacity-30" />
                      <p className="text-base font-semibold text-white/50">No assets found</p>
                      <p className="text-xs">
                        {hasFilters
                          ? "Try adjusting your search or filters."
                          : "Click 'Add Asset' to register your first item."}
                      </p>
                      {hasFilters && (
                        <button
                          onClick={clearAllFilters}
                          className="text-[#10b981]/70 text-xs hover:text-[#10b981] transition-colors underline underline-offset-2"
                        >
                          Clear all filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map(a => {
                  const isExpired = a.warrantyExpiry
                    ? new Date(a.warrantyExpiry) < now
                    : false;
                  const expiresSOon = !isExpired && a.warrantyExpiry
                    ? (new Date(a.warrantyExpiry).getTime() - now.getTime()) < 30 * 24 * 60 * 60 * 1000
                    : false;

                  return (
                    <tr
                      key={a.id}
                      className="border-b border-white/5 hover:bg-white/[0.03] transition-colors"
                      data-testid={`row-asset-${a.id}`}
                    >
                      {/* Asset Name — sticky */}
                      <td className="py-3 px-4 sticky left-0 bg-[#1A2942] z-10" style={{ maxWidth: "200px" }}>
                        <span className="block font-semibold text-white text-sm truncate" title={a.name}>{a.name}</span>
                        {a.warrantyExpiry && (
                          <span className={`text-[10px] flex items-center gap-1 mt-0.5 ${
                            isExpired ? "text-rose-400/70" : expiresSOon ? "text-amber-400/70" : "text-white/30"
                          }`}>
                            <ShieldCheck className="w-2.5 h-2.5" />
                            {isExpired ? "Warranty expired" : expiresSOon ? "Expiring soon" : `Warranty: ${fmtDate(a.warrantyExpiry)}`}
                          </span>
                        )}
                      </td>

                      {/* Category */}
                      <td className="py-3 px-4 text-white/60 text-xs whitespace-nowrap">{a.category}</td>

                      {/* Code / Serial */}
                      <td className="py-3 px-4 font-mono text-[#10b981] text-xs whitespace-nowrap" data-testid={`text-assetcode-${a.id}`}>
                        {a.assetCode || `AST-${String(a.id).padStart(4, "0")}`}
                      </td>

                      {/* Qty */}
                      <td className="py-3 px-4 text-white font-bold whitespace-nowrap tabular-nums">
                        {a.quantity.toLocaleString()}
                      </td>

                      {/* Location */}
                      <td className="py-3 px-4 text-white/55 text-xs whitespace-nowrap">{a.location}</td>

                      {/* Condition badge */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${CONDITION_BADGE[a.condition] ?? "text-white/60 bg-white/10"}`}>
                          {a.condition}
                        </span>
                      </td>

                      {/* Purchase Date */}
                      <td className="py-3 px-4 text-white/45 text-xs whitespace-nowrap">
                        {a.purchasedDate ? fmtDate(a.purchasedDate) : <span className="text-white/20">—</span>}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className="p-1.5 rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                              data-testid={`button-menu-asset-${a.id}`}
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="bg-[#1A2942] border-white/10">
                            {canEdit && (
                              <DropdownMenuItem
                                className="text-white/80 hover:text-white cursor-pointer"
                                onClick={() => openEdit(a)}
                                data-testid={`menu-edit-${a.id}`}
                              >
                                <Edit2 className="w-3.5 h-3.5 mr-2 text-[#10b981]" /> Edit Details
                              </DropdownMenuItem>
                            )}
                            {canDelete && (
                              <DropdownMenuItem
                                className="text-rose-400 hover:text-rose-300 cursor-pointer"
                                onClick={() => setDeleteTarget(a)}
                                data-testid={`menu-delete-${a.id}`}
                              >
                                <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete Asset
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-white/60 hover:text-white cursor-pointer"
                              onClick={() => toast({ title: "Coming Soon", description: "Report generation will be available in Phase 2." })}
                              data-testid={`menu-report-${a.id}`}
                            >
                              <FileText className="w-3.5 h-3.5 mr-2 text-[#D4AF37]" /> Generate Report
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Edit Dialog ── */}
      <Dialog open={!!editAsset} onOpenChange={open => { if (!open) setEditAsset(null); }}>
        <DialogContent className="bg-[#1A2942] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Edit2 className="w-4 h-4 text-[#10b981]" /> Edit Asset Details
            </DialogTitle>
          </DialogHeader>
          {editAsset && (
            <div className="space-y-4 py-2">
              <div>
                <p className="text-xs text-white/40 mb-0.5">Asset</p>
                <p className="text-white font-semibold">{editAsset.name}</p>
                <p className="text-xs text-[#10b981] font-mono">{editAsset.assetCode || `AST-${String(editAsset.id).padStart(4, "0")}`}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-white/60 mb-1">Quantity</label>
                  <Input
                    type="number" min="0" value={editQty}
                    onChange={e => setEditQty(e.target.value)}
                    className="bg-[#0A1628] border-white/20 text-white"
                    data-testid="input-edit-qty"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">Condition</label>
                  <Select value={editCondition} onValueChange={setEditCondition}>
                    <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-edit-condition">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>{CONDITIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-white/60 mb-1">Location</label>
                  <Input
                    value={editLocation}
                    onChange={e => setEditLocation(e.target.value)}
                    className="bg-[#0A1628] border-white/20 text-white"
                    data-testid="input-edit-location"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1 flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Purchased Date
                  </label>
                  <input
                    type="date" value={editPurchased}
                    onChange={e => setEditPurchased(e.target.value)}
                    data-testid="input-edit-purchased"
                    className="w-full rounded-lg bg-[#0A1628] border border-white/20 text-white text-sm px-3 py-2 focus:outline-none focus:border-[#10b981]/60"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> Warranty Expiry
                  </label>
                  <input
                    type="date" value={editWarranty}
                    onChange={e => setEditWarranty(e.target.value)}
                    data-testid="input-edit-warranty"
                    className="w-full rounded-lg bg-[#0A1628] border border-white/20 text-white text-sm px-3 py-2 focus:outline-none focus:border-[#10b981]/60"
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditAsset(null)} className="text-white/60" data-testid="button-cancel-edit">
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={isArchiveMode || updateMutation.isPending}
              className="bg-[#10b981] hover:bg-[#059669] text-white"
              data-testid="button-save-edit"
            >
              {updateMutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent className="bg-[#1A2942] border-white/10 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Delete Asset</AlertDialogTitle>
            <AlertDialogDescription className="text-white/60">
              Are you sure you want to delete{" "}
              <span className="text-white font-semibold">{deleteTarget?.name}</span>?{" "}
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/10 border-white/20 text-white hover:bg-white/20" data-testid="button-cancel-delete">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={isArchiveMode || deleteMutation.isPending}
              className="bg-rose-600 hover:bg-rose-700 text-white"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete Asset"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
