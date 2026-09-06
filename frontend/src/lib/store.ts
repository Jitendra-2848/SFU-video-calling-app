// src/lib/store.ts
import { create } from "zustand";

export interface UserDetails {
  name: string;
  Email: string;
  Room: number;
}

interface Store {
  user: UserDetails | null;
  setUser: (user: UserDetails) => void;
  clearUser: () => void;
}

const getStoredUser = (): UserDetails | null => {
  try {
    const saved = sessionStorage.getItem("sfu_user");
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
};

export const store = create<Store>((set) => ({
  user: getStoredUser(),
  setUser: (data: UserDetails) => {
    if (!data.name || !data.Email || !data.Room) {
      return;
    }
    try {
      sessionStorage.setItem("sfu_user", JSON.stringify(data));
    } catch {}
    set({ user: data });
  },
  clearUser: () => {
    try {
      sessionStorage.removeItem("sfu_user");
    } catch {}
    set({ user: null });
  },
}));