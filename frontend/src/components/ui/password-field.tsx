"use client";
import { Eye, EyeOff } from "lucide-react";
import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { InputField } from "./input-field";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string; error?: string; required?: boolean };

export const PasswordField = forwardRef<HTMLInputElement, Props>((props, ref) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <InputField ref={ref} {...props} type={show ? "text" : "password"} className="pr-11" />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        className="pressable absolute right-2 top-[1.85rem] rounded-full p-1.5 text-slate-400 hover:text-slate-600"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
});
PasswordField.displayName = "PasswordField";
