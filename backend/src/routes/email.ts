import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { sendEmail, sendReport, sendAlertEmail } from "../channels/email/resend.js";
import { prisma } from "../db/prisma.js";

const router = Router();

// POST /api/email/send — send a custom email (admin only)
router.post("/send", requireAuth, async (req, res) => {
  if (!req.user!.permissions.manage_users) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  try {
    const { to, subject, html, text } = req.body;
    if (!to || !subject || !html) {
      res.status(400).json({ error: "to, subject, and html are required" });
      return;
    }

    const result = await sendEmail({ to, subject, html, text });

    await prisma.auditLog.create({
      data: {
        userId: req.user!.userId,
        action: "email.send",
        resource: `email:${Array.isArray(to) ? to.join(",") : to}`,
        details: { subject, recipientCount: Array.isArray(to) ? to.length : 1 },
        channel: "email",
      },
    });

    res.json({ ok: true, emailId: result?.id });
  } catch (err: any) {
    console.error("Email send error:", err);
    res.status(500).json({ error: err.message || "Failed to send email" });
  }
});

// POST /api/email/report — send a report via email
router.post("/report", requireAuth, async (req, res) => {
  try {
    const { to, reportTitle, reportDate, markdownContent, summary } = req.body;
    if (!to || !reportTitle || !markdownContent) {
      res.status(400).json({ error: "to, reportTitle, and markdownContent are required" });
      return;
    }

    const result = await sendReport({
      to,
      reportTitle,
      reportDate: reportDate || new Date().toISOString().split("T")[0],
      markdownContent,
      summary: summary || markdownContent.slice(0, 200),
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user!.userId,
        action: "email.report",
        resource: `report:${reportTitle}`,
        details: { to, reportTitle, reportDate },
        channel: "email",
      },
    });

    res.json({ ok: true, emailId: result?.id });
  } catch (err: any) {
    console.error("Report email error:", err);
    res.status(500).json({ error: err.message || "Failed to send report" });
  }
});

// POST /api/email/alert — send an alert email
router.post("/alert", requireAuth, async (req, res) => {
  try {
    const { to, title, body, severity } = req.body;
    if (!to || !title || !body) {
      res.status(400).json({ error: "to, title, and body are required" });
      return;
    }

    const result = await sendAlertEmail(to, title, body, severity || "info");

    await prisma.auditLog.create({
      data: {
        userId: req.user!.userId,
        action: "email.alert",
        resource: `alert:${title}`,
        details: { to, severity, title },
        channel: "email",
      },
    });

    res.json({ ok: true, emailId: result?.id });
  } catch (err: any) {
    console.error("Alert email error:", err);
    res.status(500).json({ error: err.message || "Failed to send alert" });
  }
});

// POST /api/email/test — send a test email to yourself
router.post("/test", requireAuth, async (req, res) => {
  try {
    const result = await sendEmail({
      to: req.user!.email,
      subject: "EMO Intelligence — Test Email",
      html: `
<div style="font-family: system-ui, sans-serif; background: #09090b; color: #fafafa; padding: 40px 20px;">
  <div style="max-width: 400px; margin: 0 auto; text-align: center;">
    <div style="background: rgba(124,58,237,0.12); border: 1px solid rgba(124,58,237,0.2); border-radius: 12px; padding: 12px; display: inline-block; margin-bottom: 16px;">
      <span style="font-size: 24px;">⚡</span>
    </div>
    <h2 style="font-size: 18px; margin: 0 0 8px;">Email Integration Working</h2>
    <p style="color: #a1a1aa; font-size: 14px; margin: 0;">Resend is connected to emo-energy.com. Reports and alerts will be delivered to this address.</p>
  </div>
</div>`,
    });

    res.json({ ok: true, emailId: result?.id, sentTo: req.user!.email });
  } catch (err: any) {
    console.error("Test email error:", err);
    res.status(500).json({ error: err.message || "Test email failed" });
  }
});

export default router;
