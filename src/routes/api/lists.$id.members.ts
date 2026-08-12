import { createFileRoute } from "@tanstack/react-router";
import { requireAuth, json } from "@/lib/server-auth";

export const Route = createFileRoute("/api/lists/$id/members")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await requireAuth(request);
        if (auth instanceof Response) return auth;
        const { db } = await import("@/lib/db.server");
        const sql = db();
        const rows = await sql`
          SELECT c.id, c.email, c.first_name, c.last_name, c.unsubscribed, m.added_at
          FROM contact_list_members m JOIN contacts c ON c.id = m.contact_id
          WHERE m.list_id = ${params.id} ORDER BY m.added_at DESC`;
        return json({ data: rows });
      },
    },
  },
});
