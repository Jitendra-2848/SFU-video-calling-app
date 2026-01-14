// src/lib/store.ts
import { create } from "zustand";

interface UserDetails {
  name: string;
  Email: string;
  Room: number;
}

interface Store {
  user: UserDetails | null;
  setUser: (user: UserDetails) => void;
  clearUser: () => void;
}

export const store = create<Store>((set) => ({
  user: null,
  setUser: (data: UserDetails) => {
    if (!data.name || !data.Email || !data.Room) {
      return;
    }
    set({ user: data });
  },
  clearUser: () => set({ user: null }),
}));