"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const SIZES = { xs: "h-7 w-7 text-[10px]", sm: "h-9 w-9 text-xs", md: "h-11 w-11 text-sm", lg: "h-16 w-16 text-lg", xl: "h-24 w-24 text-2xl" };
const TONES = ["bg-violet-100 text-violet-700", "bg-sky-100 text-sky-700", "bg-emerald-100 text-emerald-700", "bg-amber-100 text-amber-800", "bg-rose-100 text-rose-700", "bg-indigo-100 text-indigo-700"];

const initials = (name?: string | null) =>
  (name ?? "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
const tone = (name?: string | null) => TONES[[...(name ?? "?")].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length];

type Props = { src?: string | null; name?: string | null; size?: keyof typeof SIZES; square?: boolean; className?: string };

/** A photo when there is one, otherwise coloured initials. An expired or broken image falls back to initials too. */
export function Avatar({ src, name, size = "md", square, className }: Props) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  const shape = square ? "rounded-xl" : "rounded-full";
  if (src && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name ? `${name}` : ""} onError={() => setBroken(true)} className={cn("shrink-0 object-cover", SIZES[size], shape, className)} />;
  }
  return (
    <span aria-hidden="true" className={cn("inline-flex shrink-0 items-center justify-center font-semibold", SIZES[size], shape, tone(name), className)}>
      {initials(name)}
    </span>
  );
}
