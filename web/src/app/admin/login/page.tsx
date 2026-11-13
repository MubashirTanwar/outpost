"use client";

import { Loader2, Lock } from "lucide-react";
import { signIn } from "next-auth/react";
import { useState } from "react";

export default function AdminLogin() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form
        className="card w-full max-w-sm p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const res = await signIn("credentials", { password, redirect: false });
          if (res?.ok) {
            // Back to the page that asked for the login: only ever a page of this site's admin.
            let next = "/admin";
            try {
              const u = new URL(new URLSearchParams(window.location.search).get("callbackUrl") ?? "", window.location.origin);
              if (u.origin === window.location.origin && u.pathname.startsWith("/admin") && !u.pathname.startsWith("/admin/login")) next = u.pathname + u.search;
            } catch {}
            window.location.href = next;
          } else {
            setError("Wrong password, or ADMIN_PASSWORD / NEXTAUTH_SECRET isn't set on the server.");
            setBusy(false);
          }
        }}
      >
        <div className="flex items-center gap-2 text-lg font-extrabold">
          <Lock size={18} /> Outpost admin
        </div>
        <label htmlFor="pw" className="mt-4 block text-sm font-bold text-soft">
          Password
        </label>
        <input id="pw" type="password" autoFocus autoComplete="current-password" className="input mt-1 w-full" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="mt-2 text-sm text-[#ff8a7a]">{error}</p>}
        <button className="btn-primary mt-4 w-full text-base" disabled={busy || !password}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : null} Sign in
        </button>
      </form>
    </div>
  );
}
