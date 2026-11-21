import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { loadSession, saveSession } from "@/lib/session";
import type { Profile, Session } from "@/types/api";

type AuthState = { session: Session | null; ready: boolean };

const slice = createSlice({
  name: "auth",
  initialState: { session: null, ready: false } as AuthState,
  reducers: {
    restoreSession(state) {
      state.session = loadSession();
      state.ready = true;
    },
    setSession(state, action: PayloadAction<Session>) {
      state.session = action.payload;
      saveSession(action.payload);
    },
    /** Refresh the profile only (role, name, a fresh photo link) without touching the tokens. */
    setProfile(state, action: PayloadAction<Profile>) {
      if (!state.session) return;
      state.session = { ...state.session, profile: action.payload };
      saveSession(state.session);
    },
    clearSession(state) {
      state.session = null;
      saveSession(null);
    },
  },
});

export const { restoreSession, setSession, setProfile, clearSession } = slice.actions;
export default slice.reducer;
