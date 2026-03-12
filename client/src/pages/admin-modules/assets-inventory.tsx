import { useState } from "react";
import { Package, Plus, Settings, Monitor, BookOpen, Grid3X3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface Props { schoolId: number }

const CATEGORIES = ["Furniture","Electronics","Lab Equipment","Sports","Library","Other"];
const SAMPLE_ASSETS = [
  { id: 1, name: "Projector - Epson EB-X41", category: "Electronics", quantity: 8, condition: "Good", location: "A-Block" },
  { id: 2, name: "Student Desks (Double)", category: "Furniture", quantity: 120, condition: "Good", location: "Classrooms" },
  { id: 3, name: "Science Lab Kit (Std 10)", category: "Lab Equipment", quantity: 30, condition: "Fair", location: "Lab-1" },
  { id: 4, name: "Cricket Set", category: "Sports", quantity: 5, condition: "Good", location: "Sports Room" },
  { id: 5, name: "Library Books (New Batch)", category: "Library", quantity: 450, condition: "New", location: "Library" },
];

const CONDITION_COLORS: Record<string, string> = {
  "New": "text-green-400 bg-green-500/20",
  "Good": "text-blue-400 bg-blue-500/20",
  "Fair": "text-yellow-400 bg-yellow-500/20",
  "Poor": "text-red-400 bg-red-500/20",
};

export default function AssetsInventory({ schoolId }: Props) {
  const { toast } = useToast();
  const [assets, setAssets] = useState(SAMPLE_ASSETS);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [quantity, setQuantity] = useState("");
  const [condition, setCondition] = useState("");
  const [location, setLocation] = useState("");

  const handleAdd = () => {
    if (!name || !category || !quantity) return;
    const newAsset = { id: Date.now(), name, category, quantity: parseInt(quantity), condition: condition || "Good", location: location || "—" };
    setAssets(prev => [newAsset, ...prev]);
    setName(""); setCategory(""); setQuantity(""); setCondition(""); setLocation("");
    setShowForm(false);
    toast({ title: "Asset Added", description: `${name} added to inventory.` });
  };

  const totalItems = assets.reduce((s, a) => s + a.quantity, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h2 className="text-xl font-bold text-white">Assets & Inventory</h2>
          <p className="text-white/50 text-sm">{assets.length} asset types · {totalItems.toLocaleString()} total items</p>
        </div>
        <Button size="sm" className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold"
          onClick={() => setShowForm(!showForm)} data-testid="button-add-asset">
          <Plus className="w-4 h-4 mr-1" /> Add Asset
        </Button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-[#D4AF37]/30 bg-[#1A2942] p-5">
          <h3 className="font-semibold text-white mb-3">New Asset Entry</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { label: "Asset Name *", val: name, set: setName, testid: "input-asset-name" },
              { label: "Quantity *", val: quantity, set: setQuantity, testid: "input-asset-qty" },
              { label: "Location", val: location, set: setLocation, testid: "input-asset-location" },
            ].map(f => (
              <div key={f.testid}>
                <label className="block text-xs text-white/60 mb-1">{f.label}</label>
                <Input value={f.val} onChange={e => f.set(e.target.value)}
                  className="bg-[#0A1628] border-white/20 text-white" data-testid={f.testid} />
              </div>
            ))}
            <div>
              <label className="block text-xs text-white/60 mb-1">Category *</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-asset-category">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1">Condition</label>
              <Select value={condition} onValueChange={setCondition}>
                <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-asset-condition">
                  <SelectValue placeholder="Condition" />
                </SelectTrigger>
                <SelectContent>{["New","Good","Fair","Poor"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button disabled={!name || !category || !quantity} onClick={handleAdd}
                className="w-full bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold" data-testid="button-submit-asset">
                Add Asset
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#0F1E35]">
            <tr>{["Asset","Category","Qty","Condition","Location"].map(h => (
              <th key={h} className="text-left py-3 px-4 text-white/60 font-medium text-xs uppercase">{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {assets.map(a => (
              <tr key={a.id} className="border-b border-white/5 hover:bg-white/5" data-testid={`row-asset-${a.id}`}>
                <td className="py-3 px-4 text-white font-medium">{a.name}</td>
                <td className="py-3 px-4 text-white/60 text-xs">{a.category}</td>
                <td className="py-3 px-4 text-[#D4AF37] font-bold">{a.quantity.toLocaleString()}</td>
                <td className="py-3 px-4">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${CONDITION_COLORS[a.condition] ?? "text-white/60 bg-white/10"}`}>{a.condition}</span>
                </td>
                <td className="py-3 px-4 text-white/50 text-xs">{a.location}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4">
        <p className="text-yellow-400 text-sm font-semibold">Phase 2 Features</p>
        <p className="text-white/40 text-xs mt-1">Depreciation tracking, maintenance schedules, QR-based asset tagging, and procurement requests are in the next phase.</p>
      </div>
    </div>
  );
}
