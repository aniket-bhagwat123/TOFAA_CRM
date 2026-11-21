export const ENDPOINTS = {
  auth: {
    otpRequest: "/auth/otp/request",
    passwordLogin: "/auth/password/login",
    passwordReset: "/auth/password/reset",
    passwordChange: "/auth/password/change",
    logout: "/auth/logout",
    refresh: "/auth/refresh",
    me: "/auth/me",
  },
} as const;
