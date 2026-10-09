"use client";

import { useEffect, useState } from "react";

const KEY = "cc-username";

export function rememberUser(name: string) {
  try {
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
