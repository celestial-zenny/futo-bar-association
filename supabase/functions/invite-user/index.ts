// Sends a Supabase Auth invite on behalf of an FBA administrator, so new
// barristers and admins can be added from the admin page (phone-friendly)
// instead of the Supabase dashboard.
//
// POST { email, role: "barrister" | "admin", full_name?, redirect_to }
//
// The caller must be signed in and listed in public.admins; that is checked
// with the caller's own token before the service key is used.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Use POST." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return reply({ error: "Sign in first." }, 401);

  // Verify the caller is an admin, using their own session.
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const check = await caller.rpc("is_admin");
  if (check.error || check.data !== true) return reply({ error: "Only administrators can send invites." }, 403);

  let body: { email?: string; role?: string; full_name?: string; redirect_to?: string };
  try {
    body = await req.json();
  } catch {
    return reply({ error: "Invalid request." }, 400);
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const role = body.role === "admin" ? "admin" : "barrister";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply({ error: "Enter a valid email address." }, 400);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Supabase only follows redirect URLs allowed in Auth settings; anything
  // else falls back to the project's Site URL.
  const invite = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: typeof body.redirect_to === "string" ? body.redirect_to : undefined,
  });

  let userId = invite.data?.user?.id ?? null;
  let alreadyRegistered = false;
  if (invite.error) {
    // An existing account can't be re-invited; for an admin grant, find it
    // so it can still be added to public.admins.
    if (!/already|registered|exists/i.test(invite.error.message)) {
      return reply({ error: invite.error.message }, 400);
    }
    alreadyRegistered = true;
    const lookup = await admin.from("barristers").select("user_id").eq("email", email).maybeSingle();
    userId = lookup.data?.user_id ?? null;
    if (!userId) {
      for (let page = 1; page <= 20 && !userId; page++) {
        const list = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (list.error || !list.data.users.length) break;
        userId = list.data.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
      }
    }
  }

  if (role === "admin") {
    if (!userId) return reply({ error: "Could not find or create that account." }, 400);
    const grant = await admin.from("admins").upsert(
      { user_id: userId, full_name: String(body.full_name ?? "").slice(0, 120) },
      { onConflict: "user_id" },
    );
    if (grant.error) return reply({ error: grant.error.message }, 400);
  }

  return reply({
    ok: true,
    already_registered: alreadyRegistered,
    message: alreadyRegistered
      ? "That email already has an account. They can sign in with their existing password" +
        (role === "admin" ? " and now have admin access." : ".")
      : "Invite sent. They should check their email (and spam folder) for the link.",
  });
});
