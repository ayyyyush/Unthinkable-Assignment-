import { create } from "zustand";

// The access token lives only in memory (never localStorage — XSS would
// otherwise be able to exfiltrate it directly). The refresh token is an
// httpOnly cookie the browser JS can't read at all. Losing the access
// token on a hard refresh is expected and handled by silently calling
// /api/auth/refresh on app load.
interface AuthUser {
  id: string;
  email: string;
  role: "PATIENT" | "DOCTOR" | "ADMIN";
  firstName: string;
}

interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  setAuth: (accessToken: string, user: AuthUser) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  setAuth: (accessToken, user) => set({ accessToken, user }),
  clearAuth: () => set({ accessToken: null, user: null }),
}));
