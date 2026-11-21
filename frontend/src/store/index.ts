import { combineReducers, configureStore } from "@reduxjs/toolkit";
import { FLUSH, PAUSE, PERSIST, persistReducer, persistStore, PURGE, REGISTER, REHYDRATE } from "redux-persist";
import storage from "redux-persist/lib/storage";
import authReducer from "@/features/auth/auth.slice";


const rootReducer = combineReducers({ auth: authReducer });

// Nothing is persisted by redux-persist yet (add slice names to whitelist); the session lives in `tofaa-session` (see lib/session.ts).
const persisted = persistReducer({ key: "tofaa-root", storage, whitelist: [] }, rootReducer);

export const store = configureStore({
  reducer: persisted,
  middleware: (gdm) =>
    gdm({ serializableCheck: { ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER] } }),
});

export const persistor = persistStore(store);
export type RootState = ReturnType<typeof rootReducer>;
export type AppDispatch = typeof store.dispatch;
