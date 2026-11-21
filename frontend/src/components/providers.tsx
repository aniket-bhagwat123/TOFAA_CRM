"use client";
import { useEffect, type ReactNode } from "react";
import { Provider } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";
import { Toaster } from "sonner";
import { restoreSession } from "@/features/auth/auth.slice";
import { persistor, store } from "@/store";
import { PwaRegister } from "./pwa-register";

/**
 * Safety net for any plain number input: scrolling over it never changes the value, and a field whose
 * minimum is 0 or more cannot take a minus sign, a plus sign or an "e".
 */
function NumberInputGuard() {
  useEffect(() => {
    const onWheel = () => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement && el.type === "number") el.blur();
    };
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement) || el.type !== "number") return;
      const min = el.min === "" ? -Infinity : Number(el.min);
      if (["e", "E", "+"].includes(e.key) || (e.key === "-" && min >= 0)) e.preventDefault();
    };
    document.addEventListener("wheel", onWheel, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("wheel", onWheel); document.removeEventListener("keydown", onKey); };
  }, []);
  return null;
}

function SessionHandler() {
  useEffect(() => {
    store.dispatch(restoreSession());
  }, []);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <Provider store={store}>
      <PersistGate loading={null} persistor={persistor}>
        <SessionHandler />
        <NumberInputGuard />
        <PwaRegister />
        {children}
        <Toaster richColors position="top-right" />
      </PersistGate>
    </Provider>
  );
}
