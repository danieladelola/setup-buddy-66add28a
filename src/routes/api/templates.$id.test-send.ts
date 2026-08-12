import { createFileRoute } from "@tanstack/react-router";
import crypto from "node:crypto";
import { requireAuth, json } from "@/lib/server-auth";

export const Route = createFileRoute("/api/templates/$id/test-send")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await requireAuth(request);
        if (auth instanceof Response) return auth;
        const body = await request.json().catch(() => ({}));
        const { testSendSchema, zerr } = await import("@/lib/validation");
        const parsed = testSendSchema.safeParse(body);
        if (!parsed.success) return json(zerr(parsed.error), 400);
        const to = (parsed.data.to || parsed.data.email)!;


        const { db } = await import("@/lib/db.server");
        const sql = db();
        const rows = await sql`SELECT * FROM email_templates WHERE id = ${params.id}`;
        const tpl = rows[0];
        if (!tpl) return json({ error: "Template not found" }, 404);

        const { sendEmail } = await import("@/lib/ses.server");
        const fromEmail = process.env.DEFAULT_FROM_EMAIL || "";
        const fromName = tpl.from_name || process.env.DEFAULT_FROM_NAME || "HSENations";
        if (!fromEmail) return json({ error: "DEFAULT_FROM_EMAIL is not configured" }, 500);

        // Sample merge tag substitution so test renders look real.
        const { buildMergeTags, applyMergeTags } = await import("@/lib/merge-tags");
        const tags = buildMergeTags(
          { name: "Friend", email: to, phone: "+234 000 000 0000", company: "Acme Co." },
          { campaign_name: tpl.name },
        );
        const apply = (s: string) => applyMergeTags(s, tags);

        // Run through the same personalization path as real sends so test
        // renders include the open pixel, click rewrites, and unsubscribe footer.
        const { personalizeHtml } = await import("@/lib/tracking.server");
        const appUrl = (process.env.APP_URL || new URL(request.url).origin).replace(/\/$/, "");
        const html = personalizeHtml(apply(tpl.html_body || ""), {
          queueId: crypto.randomUUID(),
          campaignId: tpl.id,
          appUrl,
          unsubToken: crypto.randomBytes(24).toString("hex"),
        });

        try {
          const messageId = await sendEmail({
            to,
            fromEmail,
            fromName,
            replyTo: (await import("@/lib/email-defaults")).DEFAULT_REPLY_TO,
            subject: `[TEST] ${apply(tpl.subject || tpl.name)}`,
            html,
            text: tpl.text_body ? apply(tpl.text_body) : null,
          });
          return json({ ok: true, messageId });
        } catch (e: any) {
          return json({ error: e?.message || "SES send failed" }, 500);
        }
      },
    },
  },
});
