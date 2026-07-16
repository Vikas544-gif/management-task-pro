import { cn } from "@/lib/utils";

const DEPT_STYLES: Record<string, string> = {
  Management: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  Accounts: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  MIS: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  HR: "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300",
  IT: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
};

export default function DeptBadge({ dept }: { dept: string }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold", DEPT_STYLES[dept] ?? "bg-muted text-muted-foreground")}>
      {dept}
    </span>
  );
}
