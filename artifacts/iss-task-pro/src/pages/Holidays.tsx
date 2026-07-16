import { useState, useMemo } from "react";
import {
  useListHolidays,
  useCreateHoliday,
  useDeleteHoliday,
  getListHolidaysQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import type { Holiday } from "@workspace/api-client-react";

interface CurrentUser { id: number; name: string; role: string; department: string; }
interface HolidaysProps { currentUser: CurrentUser; }

const TYPE_LABELS: Record<string, string> = {
  full: "Full Day",
  half: "Half Day",
  weekend: "Weekend",
};

const TYPE_BADGE: Record<string, string> = {
  full: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  half: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  weekend: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function dayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()];
}

export default function Holidays({ currentUser }: HolidaysProps) {
  const qc = useQueryClient();
  const { data: holidays = [], isLoading } = useListHolidays();
  const createHoliday = useCreateHoliday();
  const deleteHoliday = useDeleteHoliday();

  const canManage =
    currentUser.role === "Boss" ||
    currentUser.department === "Management" ||
    currentUser.department === "MIS" ||
    currentUser.department === "Director";

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ date: "", name: "", type: "full" });
  const [error, setError] = useState("");

  const grouped = useMemo(() => {
    const sorted = [...holidays].sort((a, b) => a.date.localeCompare(b.date));
    const byMonth = new Map<string, Holiday[]>();
    for (const h of sorted) {
      const month = h.date.slice(0, 7);
      if (!byMonth.has(month)) byMonth.set(month, []);
      byMonth.get(month)!.push(h);
    }
    return Array.from(byMonth.entries());
  }, [holidays]);

  const monthLabel = (ym: string) => {
    const [year, m] = ym.split("-");
    return `${MONTHS[parseInt(m) - 1]} ${year}`;
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  };

  const handleAdd = () => {
    setError("");
    if (!form.date || !form.name.trim()) {
      setError("Please enter both a date and a holiday name.");
      return;
    }
    createHoliday.mutate(
      { data: { date: form.date, name: form.name.trim(), day: dayOfWeek(form.date), type: form.type } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListHolidaysQueryKey() });
          setForm({ date: "", name: "", type: "full" });
          setShowAdd(false);
        },
        onError: () => setError("This holiday could not be saved. It may already exist for that date."),
      }
    );
  };

  const handleDelete = (h: Holiday) => {
    if (!window.confirm(`Remove the "${h.name}" holiday?`)) return;
    deleteHoliday.mutate(
      { id: h.id },
      { onSuccess: () => qc.invalidateQueries({ queryKey: getListHolidaysQueryKey() }) }
    );
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-extrabold text-foreground flex items-center gap-2">🎉 Holiday List 2026</h1>
          <p className="text-sm text-muted-foreground mt-1">Head Office off days for the year.</p>
        </div>
        {canManage && (
          <button
            onClick={() => { setShowAdd((s) => !s); setError(""); }}
            className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 transition"
          >
            {showAdd ? "Cancel" : "+ Add Holiday"}
          </button>
        )}
      </div>

      {canManage && showAdd && (
        <div className="bg-card rounded-xl border border-border shadow-sm p-4 mb-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">Date</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="full">Full Day</option>
                <option value="half">Half Day</option>
                <option value="weekend">Weekend</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-muted-foreground mb-1">Holiday Name</label>
              <input
                type="text"
                value={form.name}
                placeholder="e.g. Republic Day"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
          {error && <div className="text-xs text-red-600 dark:text-red-300 font-medium mt-2">{error}</div>}
          <div className="mt-3">
            <button
              onClick={handleAdd}
              disabled={createHoliday.isPending}
              className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50 transition"
            >
              {createHoliday.isPending ? "Saving..." : "Save Holiday"}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-muted-foreground text-sm py-12 text-center">Loading holidays...</div>
      ) : holidays.length === 0 ? (
        <div className="text-muted-foreground text-sm py-12 text-center">No holidays added yet.</div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([month, items]) => (
            <div key={month} className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 bg-muted border-b border-border">
                <h2 className="font-bold text-foreground text-sm">{monthLabel(month)}</h2>
              </div>
              <div className="divide-y divide-border">
                {items.map((h) => (
                  <div key={h.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="w-14 text-center shrink-0">
                      <div className="text-lg font-black text-foreground leading-none">{h.date.slice(8, 10)}</div>
                      <div className="text-[10px] text-muted-foreground uppercase">{MONTHS[parseInt(h.date.slice(5, 7)) - 1].slice(0, 3)}</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-foreground truncate">{h.name}</div>
                      <div className="text-xs text-muted-foreground">{h.day} · {formatDate(h.date)}</div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold shrink-0 ${TYPE_BADGE[h.type] ?? "bg-muted text-muted-foreground"}`}>
                      {TYPE_LABELS[h.type] ?? h.type}
                    </span>
                    {canManage && (
                      <button
                        onClick={() => handleDelete(h)}
                        className="text-xs text-red-400 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 font-medium transition shrink-0"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
