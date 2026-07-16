import { cn } from "@/lib/utils";

const PRIORITY_STYLES: Record<string, string> = {
  low: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  high: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  urgent: "bg-red-200 text-red-800 font-bold dark:bg-red-900/60 dark:text-red-300",
};

export default function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold uppercase", PRIORITY_STYLES[priority] ?? "bg-muted text-muted-foreground")}>
      {priority}
    </span>
  );
}
