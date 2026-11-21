import { apiClient } from "@/services/api-client";
import { ENDPOINTS } from "@/services/endpoints";
import type { Session } from "@/types/api";

export const requestOtp = async (identifier: string) => {
  await apiClient.post(ENDPOINTS.auth.otpRequest, { identifier });
};

/** Never blocks sign-out: if the server is unreachable we still clear local state. */
export const logout = async () => {
  try {
    await apiClient.post(ENDPOINTS.auth.logout);
  } catch {
    /* already expired or offline */
  }
};

export const passwordLogin = async (identifier: string, password: string): Promise<Session> =>
  (await apiClient.post(ENDPOINTS.auth.passwordLogin, { identifier, password })).data;

/** Forgot password, step 2. Step 1 is requestOtp(): the same code that signs people in. */
export const resetPassword = async (identifier: string, code: string, newPassword: string) => {
  await apiClient.post(ENDPOINTS.auth.passwordReset, { identifier, code, newPassword });
};

/** Signed-in password change (Profile screen): no code, being signed in is the proof. */
export const changePassword = async (newPassword: string) => {
  await apiClient.post(ENDPOINTS.auth.passwordChange, { newPassword });
};
