import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/** A search box. `className` sizes the wrapper and wins over the default width (merged, not appended). */
export const SearchInput = ({ value, onChange, placeholder = "Search", className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) => (
  <div className={cn("relative w-full sm:w-72", className)}>
    <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="h-10 w-full rounded-xl border border-slate-300/80 bg-white pl-10 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-brand focus:ring-4 focus:ring-brand/15"
    />
  </div>
);
