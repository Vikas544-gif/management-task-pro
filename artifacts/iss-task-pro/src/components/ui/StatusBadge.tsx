import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  inProgress: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  done: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  inProgress: "In Progress",
  done: "Done",
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold", STATUS_STYLES[status] ?? "bg-muted text-muted-foreground")}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
