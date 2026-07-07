import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Package, Plus, Search, Filter, MoreVertical, Edit2, Trash2, FileText, X } from "lucide-react";
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
  createdAt: string;
  updatedAt: string;
}

const CATEGORIES = ["Furniture", "Electronics", "Lab Equipment", "Sports", "Library", "Other"];
const CONDITIONS = ["New", "Good", "Fair", "Poor", "Broken"];

const CONDITION_BADGE: Record<string, string> = {
  "New":    "text-emerald-300 bg-emerald-500/20 border border-emerald-500/30",
  "Good":   "text-blue-300 bg-blue-500/20 border border-blue-500/30",
  "Fair":   "text-orange-300 bg-orange-500/20 border border-orange-500/30",
  "Poor":   "text-rose-300 bg-rose-500/20 border border-rose-500/30",
  "Broken": "text-rose-400 bg-rose-600/20 border border-rose-500/30",
};


export default function AssetsInventory({ schoolId: _schoolId, allowedSubs }: Props) {
  const canAdd    = allowedSubs === undefined || allowedSubs.includes("add");
  const canEdit   = allowedSubs === undefined || allowedSubs.includes("edit");
  const canDelete = allowedSubs === undefined || allowedSubs.includes("delete");
  const { toast } = useToast();
  const { isArchiveMode } = useSessionView();

  const [search, setSearch] = useState("");
  const [filterCondition, setFilterCondition] = useState("all");
  const [filterLocation, setFilterLocation] = useState("all");
  const [showAddForm, setShowAddForm] = useState(false);

  const [editAsset, setEditAsset] = useState<Asset | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editCondition, setEditCondition] = useState("");
  const [editLocation, setEditLocation] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);

  const [addName, setAddName] = useState("");
  const [addCategory, setAddCategory] = useState("");
  const [addQty, setAddQty] = useState("");
  const [addCondition, setAddCondition] = useState("Good");
  const [addLocation, setAddLocation] = useState("");

  const { data: assets = [], isLoading } = useQuery<Asset[]>({
    queryKey: ["/api/admin/assets"],
  });

  const createMutation = useMutation({
    mutationFn: async (payload: { name: string; category: string; quantity: number; condition: string; location: string }) => {
      const res = await apiRequest("POST", "/api/admin/assets", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/assets"] });
      toast({ title: "Asset Added", description: `${addName} registered to inventory.` });
      setAddName(""); setAddCategory(""); setAddQty(""); setAddCondition("Good"); setAddLocation("");
      setShowAddForm(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { quantity?: number; condition?: string; location?: string } }) => {
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

  const uniqueLocations = useMemo(() => {
    const locs = Array.from(new Set(assets.map(a => a.location).filter(Boolean)));
    return locs.sort();
  }, [assets]);

  const filtered = useMemo(() => {
    return assets.filter(a => {
      if (filterCondition !== "all" && a.condition !== filterCondition) return false;
      if (filterLocation !== "all" && a.location !== filterLocation) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!a.name.toLowerCase().includes(q) && !a.category.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [assets, search, filterCondition, filterLocation]);

  const totalItems = filtered.reduce((s, a) => s + a.quantity, 0);

  function openEdit(asset: Asset) {
    setEditAsset(asset);
    setEditQty(String(asset.quantity));
    setEditCondition(asset.condition);
    setEditLocation(asset.location);
  }

  function handleSaveEdit() {
    if (!editAsset) return;
    updateMutation.mutate({
      id: editAsset.id,
      data: { quantity: parseInt(editQty), condition: editCondition, location: editLocation },
    });
  }

  function handleAdd() {
    if (!addName.trim() || !addCategory || !addQty) return;
    createMutation.mutate({
      name: addName.trim(),
      category: addCategory,
      quantity: parseInt(addQty),
      condition: addCondition,
      location: addLocation.trim() || "—",
    });
  }

  const hasFilters = search.trim() || filterCondition !== "all" || filterLocation !== "all";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Assets & Inventory</h2>
          <p className="text-white/50 text-sm">{filtered.length} asset type{filtered.length !== 1 ? "s" : ""} · {totalItems.toLocaleString()} total items</p>
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

      {showAddForm && (
        <div className="rounded-xl border border-[#10b981]/30 bg-[#1A2942] p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white">New Asset Entry</h3>
            <button onClick={() => setShowAddForm(false)} className="text-white/40 hover:text-white/80"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="col-span-2 md:col-span-1">
              <label className="block text-xs text-white/60 mb-1">Asset Name *</label>
              <Input
                value={addName}
                onChange={e => setAddName(e.target.value)}
                placeholder="e.g. Projector Epson X45"
                className="bg-[#0A1628] border-white/20 text-white"
                data-testid="input-asset-name"
              />
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1">Quantity *</label>
              <Input
                type="number"
                min="0"
                value={addQty}
                onChange={e => setAddQty(e.target.value)}
                className="bg-[#0A1628] border-white/20 text-white"
                data-testid="input-asset-qty"
              />
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1">Location</label>
              <Input
                value={addLocation}
                onChange={e => setAddLocation(e.target.value)}
                placeholder="e.g. A-Block"
                className="bg-[#0A1628] border-white/20 text-white"
                data-testid="input-asset-location"
              />
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1">Category *</label>
              <Select value={addCategory} onValueChange={setAddCategory}>
                <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-asset-category">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1">Condition</label>
              <Select value={addCondition} onValueChange={setAddCondition}>
                <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-asset-condition">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>{CONDITIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                disabled={isArchiveMode || !addName.trim() || !addCategory || !addQty || createMutation.isPending}
                onClick={handleAdd}
                className="w-full bg-[#10b981] hover:bg-[#059669] text-white font-semibold"
                data-testid="button-submit-asset"
              >
                {createMutation.isPending ? "Adding…" : "Add Asset"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or category…"
            className="pl-9 bg-[#1A2942] border-white/20 text-white"
            data-testid="input-search-assets"
          />
        </div>
        <div className="flex gap-2">
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
          <Select value={filterLocation} onValueChange={setFilterLocation}>
            <SelectTrigger className="bg-[#1A2942] border-white/20 text-white w-36" data-testid="select-filter-location">
              <SelectValue placeholder="Location" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Locations</SelectItem>
              {uniqueLocations.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button size="sm" variant="ghost" className="text-white/50 hover:text-white border border-white/10"
              onClick={() => { setSearch(""); setFilterCondition("all"); setFilterLocation("all"); }}
              data-testid="button-clear-filters">
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: "900px" }}>
            <thead className="bg-[#0F1E35]">
              <tr>
                {["Asset Name", "Category", "QR / ID", "Qty", "Condition", "Location", "Date Added", "Last Updated", ""].map((h, i) => (
                  <th
                    key={i}
                    className={`text-left py-3 px-4 text-white/60 font-medium text-xs uppercase whitespace-nowrap ${i === 0 ? "sticky left-0 z-10 bg-[#0F1E35]" : ""}`}
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
                    {Array.from({ length: 9 }).map((__, j) => (
                      <td key={j} className={`py-3 px-4 ${j === 0 ? "sticky left-0 bg-[#1A2942]" : ""}`}>
                        <div className="h-4 rounded bg-white/10 animate-pulse" style={{ width: j === 0 ? "140px" : "60px" }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-3 text-white/40">
                      <Package className="w-12 h-12 opacity-30" />
                      <p className="text-base font-semibold text-white/50">No assets found</p>
                      <p className="text-xs">
                        {hasFilters ? "Try adjusting your search or filters." : "Click 'Add Asset' to register your first item."}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map(a => (
                  <tr
                    key={a.id}
                    className="border-b border-white/5 hover:bg-white/[0.03] transition-colors"
                    data-testid={`row-asset-${a.id}`}
                  >
                    <td className="py-3 px-4 text-white font-medium whitespace-nowrap sticky left-0 bg-[#1A2942] z-10" style={{ maxWidth: "200px" }}>
                      <span className="block truncate" title={a.name}>{a.name}</span>
                    </td>
                    <td className="py-3 px-4 text-white/60 text-xs whitespace-nowrap">{a.category}</td>
                    <td className="py-3 px-4 font-mono text-[#D4AF37] text-xs whitespace-nowrap" data-testid={`text-assetcode-${a.id}`}>
                      {a.assetCode || `AST-${String(a.id).padStart(4, "0")}`}
                    </td>
                    <td className="py-3 px-4 text-[#D4AF37] font-bold whitespace-nowrap">{a.quantity.toLocaleString()}</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${CONDITION_BADGE[a.condition] ?? "text-white/60 bg-white/10"}`}>
                        {a.condition}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-white/50 text-xs whitespace-nowrap">{a.location}</td>
                    <td className="py-3 px-4 text-white/40 text-xs whitespace-nowrap">{fmtDate(a.createdAt)}</td>
                    <td className="py-3 px-4 text-white/40 text-xs whitespace-nowrap">{fmtDate(a.updatedAt)}</td>
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

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
                <p className="text-xs text-white/40 mb-1">Asset</p>
                <p className="text-white font-semibold">{editAsset.name}</p>
                <p className="text-xs text-[#D4AF37] font-mono">{editAsset.assetCode || `AST-${String(editAsset.id).padStart(4, "0")}`}</p>
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">Quantity</label>
                <Input
                  type="number"
                  min="0"
                  value={editQty}
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
              <div>
                <label className="block text-xs text-white/60 mb-1">Location</label>
                <Input
                  value={editLocation}
                  onChange={e => setEditLocation(e.target.value)}
                  className="bg-[#0A1628] border-white/20 text-white"
                  data-testid="input-edit-location"
                />
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

      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent className="bg-[#1A2942] border-white/10 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Delete Asset</AlertDialogTitle>
            <AlertDialogDescription className="text-white/60">
              Are you sure you want to delete <span className="text-white font-semibold">{deleteTarget?.name}</span>?
              This action cannot be undone and all records for this asset will be permanently removed.
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
