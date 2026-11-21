"use client";
import { Mic, MicOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
};

type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean;
  start(): void; stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
};

/** Note box with voice-to-text where the browser supports it (Chrome / Android / Safari). */
export function VoiceTextarea({ label, value, onChange, placeholder, rows = 3 }: Props) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const base = useRef("");

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    setSupported(true);
    const r = new Ctor();
    r.lang = "en-IN";
    r.interimResults = true;
    r.continuous = true;
    r.onresult = (e) => {
      const text = Array.from(e.results).map((x) => x[0].transcript).join(" ");
      onChange(`${base.current}${base.current && !base.current.endsWith(" ") ? " " : ""}${text}`.trimStart());
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    return () => r.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle() {
    if (!rec.current) return;
    if (listening) return rec.current.stop();
    base.current = value;
    rec.current.start();
    setListening(true);
  }

  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="relative">
        <textarea
          rows={rows}
          value={value}
          placeholder={placeholder ?? "Write a note"}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-11 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        {supported && (
          <button
            type="button"
            onClick={toggle}
            aria-label={listening ? "Stop dictation" : "Dictate note"}
            className={cn("absolute right-2 top-2 rounded-full p-1.5", listening ? "bg-red-100 text-red-600" : "text-slate-500 hover:bg-slate-100")}
          >
            {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
        )}
      </div>
    </label>
  );
}
