import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";

/** One admin, one password: ADMIN_PASSWORD (plus NEXTAUTH_SECRET to sign the session). */
function passwordMatches(given: string): boolean {
  const want = process.env.ADMIN_PASSWORD;
  if (!want) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt", maxAge: 7 * 24 * 3600 },
  pages: { signIn: "/admin/login" },
  providers: [
    Credentials({
      name: "Admin",
      credentials: { password: { label: "Password", type: "password" } },
      async authorize(credentials) {
        return credentials?.password && passwordMatches(credentials.password) ? { id: "admin", name: "Admin" } : null;
      },
    }),
  ],
};

export async function isAdmin(): Promise<boolean> {
  if (!process.env.ADMIN_PASSWORD || !process.env.NEXTAUTH_SECRET) return false;
  const session = await getServerSession(authOptions);
  return session?.user?.name === "Admin";
}
