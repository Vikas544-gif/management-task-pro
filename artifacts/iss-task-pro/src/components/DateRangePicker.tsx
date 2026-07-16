import { useState, useEffect } from "react";
import type { DateRange } from "react-day-picker";
import { Calendar as CalendarIcon, ChevronDown } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface AppliedRange {
  from: string;
  to: string;
}

const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromISO = (s: string): Date | undefined => {
  if (!s) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const dmy = (s: string) => {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
};

function buildPresets(): { label: string; range: DateRange | undefined }[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const mk = (offset: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    return d;
  };
  // Week starts Monday
  const dow = (today.getDay() + 6) % 7;
  const weekStart = mk(-dow);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const yearStart = new Date(today.getFullYear(), 0, 1);
  return [
    { label: "Today", range: { from: today, to: today } },
    { label: "Last 7 days", range: { from: mk(-6), to: today } },
    { label: "This week", range: { from: weekStart, to: today } },
    { label: "This month", range: { from: monthStart, to: today } },
    { label: "This year", range: { from: yearStart, to: today } },
    { label: "All time", range: undefined },
  ];
}

export function DateRangePicker({
  from,
  to,
  onApply,
  label = "Date range",
  className,
  disableFuture = false,
  openEnded = false,
}: {
  from: string;
  to: string;
  onApply: (r: AppliedRange) => void;
  label?: string;
  className?: string;
  disableFuture?: boolean;
  // When true, picking only a start day (no end day) means "from that day
  // onwards" — the end stays empty so the chosen day AND all future days match.
  // When false (default), a single-day pick collapses to just that one day.
  openEnded?: boolean;
}) {
  const maxDay = new Date();
  maxDay.setHours(0, 0, 0, 0);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(() => {
    const f = fromISO(from);
    return f ? { from: f, to: fromISO(to) } : undefined;
  });

  // Keep the draft in sync whenever the applied range changes from outside.
  useEffect(() => {
    const f = fromISO(from);
    setDraft(f ? { from: f, to: fromISO(to) } : undefined);
  }, [from, to]);

  const draftFrom = draft?.from ? toISO(draft.from) : "";
  const rawTo = draft?.to ? toISO(draft.to) : "";
  // openEnded: a single day — whether react-day-picker reports it as no end OR as
  // end === start — means "from that day onwards", so the end stays empty and all
  // future days keep matching. A genuine multi-day range (end after start) is kept.
  // Non-openEnded: a start-only pick collapses to that exact single day (end = start).
  const draftTo = openEnded
    ? rawTo && rawTo !== draftFrom
      ? rawTo
      : ""
    : rawTo || draftFrom;
  const text = draftFrom && draftTo ? `${dmy(draftFrom)} – ${dmy(draftTo)}` : draftFrom ? `${dmy(draftFrom)} – …` : "All dates";

  const apply = () => {
    onApply({ from: draftFrom, to: draftTo });
    setOpen(false);
  };

  const presets = buildPresets();

  return (
    <div className={cn("flex items-stretch gap-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="relative flex items-center gap-2 min-w-[230px] rounded-lg border border-border bg-card px-3 py-2 text-left transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <span className="absolute -top-2 left-2.5 px-1 bg-card text-[11px] font-medium text-muted-foreground">{label}</span>
            <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-sm text-foreground whitespace-nowrap">{text}</span>
            <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <div className="flex flex-col sm:flex-row">
            <div className="flex shrink-0 flex-row flex-wrap gap-1 border-b border-border p-2 sm:w-[140px] sm:flex-col sm:border-b-0 sm:border-r">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setDraft(p.range)}
                  className="rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-foreground transition hover:bg-muted"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="p-2">
              <Calendar
                mode="range"
                numberOfMonths={2}
                selected={draft}
                onSelect={setDraft}
                defaultMonth={draft?.from}
                disabled={disableFuture ? { after: maxDay } : undefined}
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <button
        type="button"
        onClick={apply}
        className="shrink-0 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Fetch
      </button>
    </div>
  );
}
