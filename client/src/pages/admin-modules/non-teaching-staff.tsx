import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { UserPlus, Pencil, Trash2, Loader2, X, Save, Search, Eye, EyeOff, ShieldCheck, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useSessionView } from "@/contexts/session-view-context";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ADMIN_TILE_DEFS, MODULE_SUB_MODULES, expandModulesWithSubs } from "@/lib/admin-tiles";
import type { NonTeachingStaff } from "@shared/schema";

interface Props { schoolId: number }

const DESIGNATIONS = ["Principal", "Vice Principal", "Admin", "Accountant", "Librarian", "Lab Assistant", "Peon", "Security", "Driver", "Clerk", "Counselor", "Other"];

const addSchema = z.object({
  fullName: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Valid email required"),
  phone: z.string().optional(),
  designation: z.string().min(1, "Designation required"),
  customDesignation: z.string().optional(),
  password: z.string().min(6, "Password must be at least 6 characters"),
  allowedModules: z.array(z.string()).default([]),
});

const editSchema = z.object({
  fullName: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Valid email required"),
  phone: z.string().optional(),
  designation: z.string().min(1, "Designation required"),
  customDesignation: z.string().optional(),
});

type AddForm = z.infer<typeof addSchema>;
type EditForm = z.infer<typeof editSchema>;

function SkeletonRow() {
  return (
    <tr className="border-b border-white/5">
      {Array.from({ length: 6 }).map((_, i) => (
        <td key={i} className="py-3 px-4">
          <div className="h-4 rounded bg-white/10 animate-pulse" style={{ width: `${45 + (i * 15) % 50}%` }} />
        </td>
      ))}
    </tr>
  );
}

function ModulePermissionTree({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const isModuleChecked = (moduleId: string) => selected.includes(moduleId);
  const isSubChecked = (moduleId: string, subId: string) => selected.includes(`${moduleId}:${subId}`);

  const getSubKeys = (moduleId: string) =>
    (MODULE_SUB_MODULES[moduleId] ?? []).map(s => `${moduleId}:${s.id}`);

  const getSubState = (moduleId: string): "all" | "partial" | "none" => {
    const subs = MODULE_SUB_MODULES[moduleId] ?? [];
    if (!subs.length) return "all";
    const checked = subs.filter(s => selected.includes(`${moduleId}:${s.id}`)).length;
    if (checked === 0) return "none";
    if (checked === subs.length) return "all";
    return "partial";
  };

  const toggleModule = (moduleId: string) => {
    const currently = isModuleChecked(moduleId);
    const subKeys = getSubKeys(moduleId);
    if (currently) {
      onChange(selected.filter(s => s !== moduleId && !subKeys.includes(s)));
      setExpanded(prev => { const n = new Set(prev); n.delete(moduleId); return n; });
    } else {
      const without = selected.filter(s => !subKeys.includes(s) && s !== moduleId);
      onChange([...without, moduleId, ...subKeys]);
      setExpanded(prev => new Set([...prev, moduleId]));
    }
  };

  const toggleSub = (moduleId: string, subId: string) => {
    const key = `${moduleId}:${subId}`;
    const currently = selected.includes(key);
    if (currently) {
      const next = selected.filter(s => s !== key);
      const anySubLeft = (MODULE_SUB_MODULES[moduleId] ?? [])
        .map(s => `${moduleId}:${s.id}`)
        .some(k => k !== key && next.includes(k));
      onChange(anySubLeft ? next : next.filter(s => s !== moduleId));
    } else {
      const adds = [key];
      if (!selected.includes(moduleId)) adds.push(moduleId);
      onChange([...selected, ...adds]);
    }
  };

  const toggleExpand = (moduleId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(moduleId) ? n.delete(moduleId) : n.add(moduleId);
      return n;
    });
  };

  const allChecked = ADMIN_TILE_DEFS.every(m => isModuleChecked(m.id));

  const handleSelectAll = () => {
    if (allChecked) {
      onChange([]);
      setExpanded(new Set());
    } else {
      const all: string[] = [];
      ADMIN_TILE_DEFS.forEach(m => {
        all.push(m.id);
        (MODULE_SUB_MODULES[m.id] ?? []).forEach(s => all.push(`${m.id}:${s.id}`));
      });
      onChange(all);
      setExpanded(new Set(ADMIN_TILE_DEFS.map(m => m.id)));
    }
  };

  const modulesGranted = ADMIN_TILE_DEFS.filter(m => selected.includes(m.id)).length;
  const subGranted = selected.filter(s => s.includes(":")).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-white/70 text-xs font-semibold">Module Access Control</span>
        <button type="button" onClick={handleSelectAll} className="text-[10px] text-[#D4AF37] hover:underline">
          {allChecked ? "Deselect All" : "Select All"}
        </button>
      </div>

      <div className="space-y-1 max-h-56 overflow-y-auto pr-0.5 [scrollbar-width:thin] [scrollbar-color:#D4AF37_#0A1628]">
        {ADMIN_TILE_DEFS.map(mod => {
          const checked = isModuleChecked(mod.id);
          const subs = MODULE_SUB_MODULES[mod.id] ?? [];
          const isExp = expanded.has(mod.id);
          const subState = getSubState(mod.id);

          return (
            <div key={mod.id}>
              {/* Module row */}
              <div
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 cursor-pointer transition-all select-none"
                style={{
                  background: checked ? "rgba(212,175,55,0.10)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${checked ? "rgba(212,175,55,0.35)" : "rgba(255,255,255,0.08)"}`,
                }}
                onClick={() => toggleModule(mod.id)}
                data-testid={`checkbox-module-${mod.id}`}
              >
                {/* Checkbox indicator */}
                <div
                  className="w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0 transition-all"
                  style={{
                    background: checked && subState !== "partial" ? "#D4AF37" : "transparent",
                    border: `1.5px solid ${checked ? "#D4AF37" : "rgba(255,255,255,0.25)"}`,
                  }}
                >
                  {checked && subState === "all"     && <span className="text-[8px] text-[#0A1628] font-black leading-none">✓</span>}
                  {checked && subState === "partial"  && <span className="text-[9px] text-[#D4AF37] font-black leading-none">–</span>}
                </div>
                <span className="flex-1 text-[11px] text-white/85 leading-tight">{mod.emoji} {mod.label}</span>
                {subs.length > 0 && (
                  <button
                    type="button"
                    className="text-white/30 hover:text-white/70 transition-colors p-0.5 -mr-0.5"
                    onClick={e => toggleExpand(mod.id, e)}
                    data-testid={`expand-module-${mod.id}`}
                    title={isExp ? "Collapse sub-modules" : "Expand sub-modules"}
                  >
                    <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isExp ? "rotate-180" : ""}`} />
                  </button>
                )}
              </div>

              {/* Sub-modules */}
              {isExp && subs.length > 0 && (
                <div className="ml-5 mt-0.5 space-y-0.5 border-l-2 border-[#D4AF37]/20 pl-2">
                  {subs.map(sub => {
                    const subChecked = isSubChecked(mod.id, sub.id);
                    return (
                      <label
                        key={sub.id}
                        className="flex items-center gap-2 rounded-md px-2 py-1 cursor-pointer transition-all select-none"
                        style={{
                          background: subChecked ? "rgba(59,130,246,0.08)" : "rgba(255,255,255,0.02)",
                          border: `1px solid ${subChecked ? "rgba(59,130,246,0.30)" : "rgba(255,255,255,0.05)"}`,
                        }}
                        data-testid={`checkbox-submodule-${mod.id}-${sub.id}`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={subChecked}
                          onChange={() => toggleSub(mod.id, sub.id)}
                        />
                        <div
                          className="w-3 h-3 rounded flex items-center justify-center flex-shrink-0 transition-all"
                          style={{
                            background: subChecked ? "#3b82f6" : "transparent",
                            border: `1.5px solid ${subChecked ? "#3b82f6" : "rgba(255,255,255,0.20)"}`,
                          }}
                        >
                          {subChecked && <span className="text-[7px] text-white font-black leading-none">✓</span>}
                        </div>
                        <span className="text-[10px] text-white/65 leading-tight">{sub.label}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {modulesGranted > 0 && (
        <p className="text-[10px] text-[#D4AF37]/70">
          {modulesGranted} module{modulesGranted !== 1 ? "s" : ""}
          {subGranted > 0 && ` · ${subGranted} sub-module${subGranted !== 1 ? "s" : ""}`} granted
        </p>
      )}
    </div>
  );
}

export default function NonTeachingStaffModule({ schoolId }: Props) {
  const { toast } = useToast();
  const { isArchiveMode } = useSessionView();
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<NonTeachingStaff | null>(null);
  const [permTarget, setPermTarget] = useState<NonTeachingStaff | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NonTeachingStaff | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [permsSelected, setPermsSelected] = useState<string[]>([]);

  const { data: staff = [], isLoading } = useQuery<NonTeachingStaff[]>({
    queryKey: ["/api/admin/non-teaching-staff"],
    queryFn: async () => {
      const r = await fetch("/api/admin/non-teaching-staff", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const filtered = staff.filter(s =>
    s.fullName.toLowerCase().includes(searchQ.toLowerCase()) ||
    s.designation.toLowerCase().includes(searchQ.toLowerCase()) ||
    (s.email ?? "").toLowerCase().includes(searchQ.toLowerCase())
  );

  const addForm = useForm<AddForm>({
    resolver: zodResolver(addSchema),
    defaultValues: { fullName: "", email: "", phone: "", designation: "", customDesignation: "", password: "", allowedModules: [] },
  });

  const editForm = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    defaultValues: { fullName: "", email: "", phone: "", designation: "", customDesignation: "" },
  });

  const addMutation = useMutation({
    mutationFn: async (d: AddForm) => {
      const designation = (d.designation === "Other" && d.customDesignation) ? d.customDesignation : d.designation;
      const r = await apiRequest("POST", "/api/admin/non-teaching-staff", {
        fullName: d.fullName, email: d.email, phone: d.phone || "",
        designation, password: d.password, allowedModules: d.allowedModules,
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.message || "Failed"); }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Staff Registered", description: "Portal access credentials created." });
      addForm.reset(); setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/non-teaching-staff"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async (d: EditForm) => {
      const designation = (d.designation === "Other" && d.customDesignation) ? d.customDesignation : d.designation;
      const r = await apiRequest("PATCH", `/api/admin/non-teaching-staff/${editTarget!.id}`, {
        fullName: d.fullName, email: d.email, phone: d.phone || "", designation,
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.message || "Failed"); }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Staff Updated" });
      setEditTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/non-teaching-staff"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const permsMutation = useMutation({
    mutationFn: async (mods: string[]) => {
      const r = await apiRequest("PATCH", `/api/admin/non-teaching-staff/${permTarget!.id}`, {
        allowedModules: mods,
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.message || "Failed"); }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Permissions Updated", description: `${permTarget?.fullName}'s access has been saved.` });
      setPermTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/non-teaching-staff"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/admin/non-teaching-staff/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Staff Removed" });
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/non-teaching-staff"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const openPerms = (s: NonTeachingStaff) => {
    setPermsSelected(expandModulesWithSubs(s.allowedModules ?? []));
    setPermTarget(s);
  };

  const openEdit = (s: NonTeachingStaff) => {
    const isCustom = !DESIGNATIONS.includes(s.designation);
    editForm.reset({
      fullName: s.fullName,
      email: s.email || "",
      phone: s.phone || "",
      designation: isCustom ? "Other" : s.designation,
      customDesignation: isCustom ? s.designation : "",
    });
    setEditTarget(s);
  };

  const isOtherAdd = addForm.watch("designation") === "Other";
  const isOtherEdit = editForm.watch("designation") === "Other";

  const moduleCount = (s: NonTeachingStaff) =>
    (s.allowedModules ?? []).filter(m => !m.includes(":")).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Support Staff Registry</h2>
          <p className="text-white/50 text-sm">{staff.length} staff member{staff.length !== 1 ? "s" : ""} registered</p>
        </div>
        <Button
          size="sm"
          className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold"
          onClick={() => setShowForm(!showForm)}
          disabled={isArchiveMode}
          data-testid="button-add-nts-toggle"
        >
          <UserPlus className="w-4 h-4 mr-1" /> Add Staff
        </Button>
      </div>

      {/* ── Add Form ── */}
      {showForm && (
        <div className="rounded-xl border border-[#D4AF37]/30 bg-[#1A2942] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-[#D4AF37]" /> Register Support Staff
            </h3>
            <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white p-1 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <Form {...addForm}>
            <form onSubmit={addForm.handleSubmit(d => addMutation.mutate(d))} className="space-y-4">
              {/* Full Name */}
              <FormField control={addForm.control} name="fullName" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/70 text-xs">Full Name *</FormLabel>
                  <FormControl><Input {...field} className="bg-[#0A1628] border-white/20 text-white h-10" data-testid="input-nts-add-fullname" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Email + Phone */}
              <div className="grid grid-cols-2 gap-3">
                <FormField control={addForm.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/70 text-xs">Email *</FormLabel>
                    <FormControl><Input {...field} type="email" className="bg-[#0A1628] border-white/20 text-white h-10" data-testid="input-nts-add-email" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={addForm.control} name="phone" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/70 text-xs">Phone</FormLabel>
                    <FormControl><Input {...field} className="bg-[#0A1628] border-white/20 text-white h-10" data-testid="input-nts-add-phone" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* Designation */}
              <div className={`grid gap-3 ${isOtherAdd ? "grid-cols-2" : "grid-cols-1"}`}>
                <FormField control={addForm.control} name="designation" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/70 text-xs">Designation / Role *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger className="bg-[#0A1628] border-white/20 text-white h-10" data-testid="select-nts-add-designation">
                        <SelectValue placeholder="Select designation" />
                      </SelectTrigger>
                      <SelectContent>
                        {DESIGNATIONS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                {isOtherAdd && (
                  <FormField control={addForm.control} name="customDesignation" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white/70 text-xs">Custom Designation</FormLabel>
                      <FormControl><Input {...field} placeholder="e.g. Bus Driver, Nurse" className="bg-[#0A1628] border-white/20 text-white h-10" data-testid="input-nts-add-custom" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
              </div>

              {/* Password */}
              <FormField control={addForm.control} name="password" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/70 text-xs">
                    Password * <span className="text-white/30">(for portal login)</span>
                  </FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        {...field}
                        type={showPassword ? "text" : "password"}
                        className="bg-[#0A1628] border-white/20 text-white h-10 pr-10"
                        data-testid="input-nts-add-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
                        tabIndex={-1}
                        data-testid="button-toggle-password-add"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Module + Sub-module Access */}
              <div className="rounded-lg border border-white/10 bg-[#0A1628] p-3">
                <ModulePermissionTree
                  selected={addForm.watch("allowedModules") ?? []}
                  onChange={mods => addForm.setValue("allowedModules", mods)}
                />
              </div>

              <div className="flex gap-2 pt-1">
                <Button type="submit" disabled={isArchiveMode || addMutation.isPending}
                  className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold"
                  data-testid="button-submit-nts">
                  {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <UserPlus className="w-4 h-4 mr-1" />}
                  Register Staff
                </Button>
                <Button type="button" variant="outline" className="border-white/20 text-white hover:bg-white/10"
                  onClick={() => { setShowForm(false); addForm.reset(); }}>Cancel</Button>
              </div>
            </form>
          </Form>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
        <Input
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          placeholder="Search by name, designation, or email…"
          className="pl-9 bg-[#1A2942] border-white/20 text-white placeholder:text-white/30 h-10"
          data-testid="input-search-nts"
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden">
        <div className="max-h-[480px] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#D4AF37_#0A1628]">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="sticky top-0 z-10 bg-[#0F1E35]">
              <tr>
                {["Name", "Email", "Phone", "Designation", "Access", "Actions"].map(h => (
                  <th key={h} className="text-left py-3 px-4 text-white/60 font-medium text-xs uppercase tracking-wide border-b border-white/10">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                : !filtered.length
                  ? (
                    <tr><td colSpan={6} className="py-12 text-center text-white/40">
                      {searchQ ? `No staff match "${searchQ}"` : "No support staff registered yet"}
                    </td></tr>
                  )
                  : filtered.map(s => {
                    const mCount = moduleCount(s);
                    const subCount = (s.allowedModules ?? []).filter(m => m.includes(":")).length;
                    return (
                      <tr key={s.id} className="border-b border-white/5 hover:bg-white/5 transition-colors" data-testid={`row-nts-${s.id}`}>
                        <td className="py-3 px-4 text-white font-medium">{s.fullName}</td>
                        <td className="py-3 px-4 text-white/70 text-xs">{s.email || "—"}</td>
                        <td className="py-3 px-4 text-white/70 text-xs">{s.phone || "—"}</td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 text-xs border border-green-500/20">
                            {s.designation}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {mCount > 0 ? (
                            <div className="flex flex-col gap-0.5">
                              <span
                                className="px-2 py-0.5 rounded-full text-xs border inline-flex w-fit"
                                style={{ background: "rgba(212,175,55,0.10)", color: "#D4AF37", borderColor: "rgba(212,175,55,0.25)" }}
                                title={(s.allowedModules ?? []).filter(m => !m.includes(":")).map(id => ADMIN_TILE_DEFS.find(t => t.id === id)?.label ?? id).join(", ")}
                              >
                                {mCount} module{mCount !== 1 ? "s" : ""}
                              </span>
                              {subCount > 0 && (
                                <span className="text-[10px] text-blue-400/70">{subCount} sub-action{subCount !== 1 ? "s" : ""}</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-white/25 text-xs">None</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon"
                              className="text-[#D4AF37] hover:text-yellow-300 hover:bg-yellow-400/10 h-8 w-8"
                              onClick={() => openEdit(s)} disabled={isArchiveMode}
                              data-testid={`button-edit-nts-${s.id}`} title="Edit profile">
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon"
                              className="text-blue-400 hover:text-blue-300 hover:bg-blue-400/10 h-8 w-8"
                              onClick={() => openPerms(s)} disabled={isArchiveMode}
                              data-testid={`button-perms-nts-${s.id}`} title="Edit permissions">
                              <ShieldCheck className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon"
                              className="text-red-400 hover:text-red-300 hover:bg-red-400/10 h-8 w-8"
                              onClick={() => setDeleteTarget(s)} disabled={isArchiveMode}
                              data-testid={`button-delete-nts-${s.id}`} title="Remove">
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
              }
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Edit Profile Modal ── */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          data-testid="modal-edit-nts"
          onClick={e => { if (e.target === e.currentTarget) setEditTarget(null); }}>
          <div className="w-full max-w-lg rounded-2xl bg-[#1A2942] border border-white/10 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Pencil className="w-4 h-4 text-[#D4AF37]" /> Edit Staff Profile
              </h3>
              <button onClick={() => setEditTarget(null)}
                className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                data-testid="button-close-edit-nts">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5">
              <Form {...editForm}>
                <form onSubmit={editForm.handleSubmit(d => editMutation.mutate(d))} className="space-y-3">
                  <FormField control={editForm.control} name="fullName" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white/70 text-xs">Full Name *</FormLabel>
                      <FormControl><Input {...field} className="bg-[#0A1628] border-white/20 text-white h-10" data-testid="input-nts-edit-fullname" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={editForm.control} name="email" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white/70 text-xs">Email *</FormLabel>
                        <FormControl><Input {...field} type="email" className="bg-[#0A1628] border-white/20 text-white h-10" data-testid="input-nts-edit-email" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={editForm.control} name="phone" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white/70 text-xs">Phone</FormLabel>
                        <FormControl><Input {...field} className="bg-[#0A1628] border-white/20 text-white h-10" data-testid="input-nts-edit-phone" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <div className={`grid gap-3 ${isOtherEdit ? "grid-cols-2" : "grid-cols-1"}`}>
                    <FormField control={editForm.control} name="designation" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white/70 text-xs">Designation *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <SelectTrigger className="bg-[#0A1628] border-white/20 text-white h-10" data-testid="select-nts-edit-designation">
                            <SelectValue placeholder="Select designation" />
                          </SelectTrigger>
                          <SelectContent>
                            {DESIGNATIONS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    {isOtherEdit && (
                      <FormField control={editForm.control} name="customDesignation" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-white/70 text-xs">Custom Designation</FormLabel>
                          <FormControl><Input {...field} placeholder="e.g. Bus Driver" className="bg-[#0A1628] border-white/20 text-white h-10" data-testid="input-nts-edit-custom" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    )}
                  </div>
                  <p className="text-white/30 text-[10px] pt-0.5 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 text-blue-400" />
                    Use the blue permissions button to update module access.
                  </p>
                  <div className="flex gap-2 pt-1">
                    <Button type="submit" disabled={isArchiveMode || editMutation.isPending}
                      className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold flex-1"
                      data-testid="button-save-edit-nts">
                      {editMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                      Save Changes
                    </Button>
                    <Button type="button" variant="outline" className="border-white/20 text-white hover:bg-white/10"
                      onClick={() => setEditTarget(null)}>Cancel</Button>
                  </div>
                </form>
              </Form>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Permissions Modal ── */}
      {permTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          data-testid="modal-perms-nts"
          onClick={e => { if (e.target === e.currentTarget) setPermTarget(null); }}>
          <div className="w-full max-w-lg rounded-2xl bg-[#1A2942] border border-blue-400/25 shadow-2xl overflow-hidden">
            <div
              className="flex items-center justify-between px-5 py-4 border-b border-white/10"
              style={{ background: "linear-gradient(90deg, rgba(59,130,246,0.10) 0%, transparent 100%)" }}
            >
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-blue-400" /> Edit Permissions
                </h3>
                <p className="text-[11px] text-blue-300/70 mt-0.5">{permTarget.fullName} · {permTarget.designation}</p>
              </div>
              <button onClick={() => setPermTarget(null)}
                className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                data-testid="button-close-perms-nts">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-white/45 text-xs leading-relaxed">
                Check a module to grant access. Expand with <ChevronDown className="inline w-3 h-3" /> to set sub-module permissions. Unchecking a module removes all its sub-permissions.
              </p>
              <div className="rounded-lg border border-white/10 bg-[#0A1628] p-3">
                <ModulePermissionTree selected={permsSelected} onChange={setPermsSelected} />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => permsMutation.mutate(permsSelected)}
                  disabled={isArchiveMode || permsMutation.isPending}
                  className="flex-1 font-semibold text-white"
                  style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)" }}
                  data-testid="button-save-perms-nts">
                  {permsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ShieldCheck className="w-4 h-4 mr-1" />}
                  Save Permissions
                </Button>
                <Button variant="outline" className="border-white/20 text-white hover:bg-white/10"
                  onClick={() => setPermTarget(null)}>Cancel</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Modal ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          data-testid="modal-delete-nts"
          onClick={e => { if (e.target === e.currentTarget) setDeleteTarget(null); }}>
          <div className="w-full max-w-sm rounded-2xl bg-[#1A2942] border border-red-500/30 shadow-2xl p-6">
            <h3 className="text-white font-semibold mb-2">Remove Staff Member?</h3>
            <p className="text-white/60 text-sm mb-5">
              This will remove <span className="text-white font-medium">{deleteTarget.fullName}</span> ({deleteTarget.designation}) from the registry and revoke their portal access.
            </p>
            <div className="flex gap-2">
              <Button onClick={() => deleteMutation.mutate(deleteTarget.id)}
                disabled={isArchiveMode || deleteMutation.isPending}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold"
                data-testid="button-confirm-delete-nts">
                {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
                Remove
              </Button>
              <Button variant="outline" className="border-white/20 text-white hover:bg-white/10"
                onClick={() => setDeleteTarget(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
