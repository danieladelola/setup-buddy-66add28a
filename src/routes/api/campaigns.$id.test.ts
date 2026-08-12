import { createFileRoute } from "@tanstack/react-router";
import crypto from "node:crypto";
import { requireAuth, json } from "@/lib/server-auth";

export const Route = createFileRoute("/api/campaigns/$id/test")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await requireAuth(request);
        if (auth instanceof Response) return auth;
        const { db } = await import("@/lib/db.server");
        const { sendEmail } = await import("@/lib/ses.server");
        const { personalizeHtml } = await import("@/lib/tracking.server");
        const { isSuppressed } = await import("@/lib/suppression.server");
        const body = await request.json().catch(() => ({}));
        const { testSendSchema, zerr } = await import("@/lib/validation");
        const parsed = testSendSchema.safeParse(body);
        if (!parsed.success) return json(zerr(parsed.error), 400);
        const email = (parsed.data.email || parsed.data.to)!;

        if (await isSuppressed(email)) {
          return json({ error: "Recipient is suppressed" }, 400);
        }

        const sql = db();
        const rows = await sql<{ id: string; subject: string; html_body: string; text_body: string | null; from_email: string; from_name: string; reply_to: string | null }[]>`
          SELECT id, subject, html_body, text_body, from_email, from_name, reply_to FROM campaigns WHERE id = ${params.id}`;
        const c = rows[0];
        if (!c) return json({ error: "Campaign not found" }, 404);

        // Same personalization path as the queue worker — open pixel, click
        // rewrite, and unsubscribe footer all present even on test sends.
        const appUrl = (process.env.APP_URL || new URL(request.url).origin).replace(/\/$/, "");
        const queueId = crypto.randomUUID();
        const unsubToken = crypto.randomBytes(24).toString("hex");
        const html = personalizeHtml(c.html_body || "", {
          queueId,
          campaignId: c.id,
          appUrl,
          unsubToken,
        });

        try {
          const id = await sendEmail({
            to: email,
            fromEmail: c.from_email,
            fromName: c.from_name,
            replyTo: c.reply_to || (await import("@/lib/email-defaults")).DEFAULT_REPLY_TO,
            subject: `[TEST] ${c.subject}`,
            html,
            text: c.text_body,
          });
          return json({ ok: true, message_id: id });
        } catch (e: any) {
          console.error("SES test send failed", e);
          return json({ error: e?.message || "Send failed" }, 500);
        }
      },
    },
  },
});
