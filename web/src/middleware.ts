import { withAuth } from "next-auth/middleware";

// Every /admin page needs the admin session, except the login page itself.
export default withAuth({ pages: { signIn: "/admin/login" } });

export const config = { matcher: ["/admin", "/admin/((?!login).*)"] };
