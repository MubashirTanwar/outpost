"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

export function SignOut() {
  return (
    <button className="btn-secondary px-3 py-1.5" onClick={() => signOut({ callbackUrl: "/admin/login" })}>
      <LogOut size={14} /> Sign out
    </button>
  );
}
