"use client";

import { useEffect, useState } from "react";

const KEY = "cc-username";

/**
 * Remember whose app this is. `explicit` (entering a name on the home page) switches account;
 * merely opening someone's /u/ page only fills it in when no one is remembered yet, so looking at
 * another player never moves your course progress onto their record.
 */
export function rememberUser(name: string, explicit = false) {
  try {
    const current = localStorage.getItem(KEY);
    if (current?.toLowerCase() === name.toLowerCase() || (current && !explicit)) return;
    localStorage.setItem(KEY, name);
    window.dispatchEvent(new Event("cc-user"));
  } catch {}
}

/** The last chess.com username entered on this device. */
export function useRememberedUser(): string | null {
  const [user, setUser] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      try {
        setUser(localStorage.getItem(KEY));
      } catch {}
    };
    read();
    window.addEventListener("cc-user", read);
    return () => window.removeEventListener("cc-user", read);
  }, []);
  return user;
}
