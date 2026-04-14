import { Resend } from "resend";
import { env } from "../../config/env.js";

const resend = new Resend(env.RESEND_API_KEY);

interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

interface SendReportOptions {
  to: string | string[];
  reportTitle: string;
  reportDate: string;
  markdownContent: string;
  summary: string;
}

export async function sendEmail(options: SendEmailOptions) {
  const { data, error } = await resend.emails.send({
    from: env.RESEND_FROM,
    to: Array.isArray(options.to) ? options.to : [options.to],
    subject: options.subject,
    html: options.html,
    text: options.text,
    replyTo: options.replyTo,
  });

  if (error) {
    console.error("Resend email error:", error);
    throw new Error(`Email failed: ${error.message}`);
  }

  console.log(`Email sent: ${data?.id} → ${options.to}`);
  return data;
}

export async function sendReport(options: SendReportOptions) {
  const html = buildReportEmail(options.reportTitle, options.reportDate, options.markdownContent, options.summary);

  return sendEmail({
    to: options.to,
    subject: `${options.reportTitle} — ${options.reportDate}`,
    html,
    text: options.summary,
  });
}

export async function sendWelcomeEmail(to: string, name: string) {
  return sendEmail({
    to,
    subject: "Welcome to EMO Intelligence",
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: 'Segoe UI', system-ui, sans-serif; background: #09090b; color: #fafafa; padding: 40px 20px;">
  <div style="max-width: 500px; margin: 0 auto;">
    <div style="text-align: center; margin-bottom: 32px;">
      <div style="display: inline-block; background: rgba(124,58,237,0.12); border: 1px solid rgba(124,58,237,0.2); border-radius: 12px; padding: 12px; margin-bottom: 16px;">
        <span style="font-size: 24px;">⚡</span>
      </div>
      <h1 style="font-size: 22px; font-weight: 600; margin: 0;">EMO Intelligence</h1>
    </div>
    <div style="background: #16161a; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 24px;">
      <p style="margin: 0 0 12px;">Hi ${name},</p>
      <p style="margin: 0 0 12px; color: #a1a1aa;">Your account on the EMO Ops Intelligence platform is ready. You can now:</p>
      <ul style="color: #a1a1aa; padding-left: 20px; margin: 0 0 16px;">
        <li style="margin-bottom: 6px;">Chat with AI agents about fleet health, battery risks, and complaints</li>
        <li style="margin-bottom: 6px;">View operational dashboards</li>
        <li style="margin-bottom: 6px;">Schedule automated reports</li>
      </ul>
      <a href="${env.FRONTEND_URL}/login" style="display: inline-block; background: #7c3aed; color: white; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-size: 14px; font-weight: 500;">Sign in →</a>
    </div>
    <p style="text-align: center; font-size: 11px; color: #52525b; margin-top: 24px;">EMO Energy · Ops Intelligence Platform</p>
  </div>
</body>
</html>`,
  });
}

export async function sendAlertEmail(to: string, alertTitle: string, alertBody: string, severity: "info" | "warning" | "critical") {
  const colors = {
    info: { bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.2)", text: "#60a5fa", label: "INFO" },
    warning: { bg: "rgba(234,179,8,0.12)", border: "rgba(234,179,8,0.2)", text: "#facc15", label: "WARNING" },
    critical: { bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.2)", text: "#f87171", label: "CRITICAL" },
  };
  const c = colors[severity];

  return sendEmail({
    to,
    subject: `[${c.label}] ${alertTitle}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: 'Segoe UI', system-ui, sans-serif; background: #09090b; color: #fafafa; padding: 40px 20px;">
  <div style="max-width: 540px; margin: 0 auto;">
    <div style="background: ${c.bg}; border: 1px solid ${c.border}; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; display: inline-block;">
      <span style="font-size: 12px; font-weight: 600; color: ${c.text};">${c.label} ALERT</span>
    </div>
    <h2 style="font-size: 18px; font-weight: 600; margin: 0 0 12px;">${alertTitle}</h2>
    <div style="background: #16161a; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 20px; color: #a1a1aa; font-size: 14px; line-height: 1.6;">
      ${alertBody}
    </div>
    <p style="text-align: center; font-size: 11px; color: #52525b; margin-top: 24px;">EMO Intelligence · Automated Alert</p>
  </div>
</body>
</html>`,
  });
}

function buildReportEmail(title: string, date: string, content: string, summary: string): string {
  // Convert basic markdown to HTML for email
  const htmlContent = content
    .replace(/^### (.+)$/gm, '<h3 style="font-size:15px;font-weight:600;margin:16px 0 8px;color:#fafafa;">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="font-size:17px;font-weight:600;margin:20px 0 8px;color:#fafafa;">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="font-size:20px;font-weight:600;margin:24px 0 10px;color:#fafafa;">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#fafafa;">$1</strong>')
    .replace(/^- (.+)$/gm, '<li style="margin-bottom:4px;">$1</li>')
    .replace(/(<li.*<\/li>\n?)+/g, '<ul style="padding-left:20px;margin:8px 0;">$&</ul>')
    .replace(/\n\n/g, '</p><p style="margin:8px 0;color:#a1a1aa;">')
    .replace(/\n/g, '<br>');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: 'Segoe UI', system-ui, sans-serif; background: #09090b; color: #fafafa; padding: 40px 20px;">
  <div style="max-width: 600px; margin: 0 auto;">
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #7c3aed; font-weight: 600;">EMO Intelligence Report</span>
    </div>
    <h1 style="font-size: 22px; font-weight: 600; margin: 0 0 4px; text-align: center;">${title}</h1>
    <p style="text-align: center; font-size: 13px; color: #71717a; margin: 0 0 24px;">${date}</p>
    <div style="background: rgba(124,58,237,0.08); border: 1px solid rgba(124,58,237,0.15); border-radius: 8px; padding: 14px; margin-bottom: 24px;">
      <p style="margin: 0; font-size: 13px; color: #c4b5fd;"><strong>Summary:</strong> ${summary}</p>
    </div>
    <div style="background: #16161a; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 24px; font-size: 14px; line-height: 1.6; color: #a1a1aa;">
      <p style="margin:8px 0;color:#a1a1aa;">${htmlContent}</p>
    </div>
    <p style="text-align: center; font-size: 11px; color: #52525b; margin-top: 24px;">Generated by EMO Intelligence · ${new Date().toISOString().split("T")[0]}</p>
  </div>
</body>
</html>`;
}
