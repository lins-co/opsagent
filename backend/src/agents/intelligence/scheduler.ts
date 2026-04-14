import cron from "node-cron";
import { Resend } from "resend";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { getMongoData, getCollectionStats } from "../../db/connectors/mongodb.js";
import { exportToCSV } from "../../lib/csv-export.js";
import { readFileSync } from "fs";

const resend = new Resend(env.RESEND_API_KEY);

const llm = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  apiKey: env.ANTHROPIC_API_KEY,
  temperature: 0.3,
  maxTokens: 4096,
});

// Active cron jobs — keyed by schedule ID
const activeJobs = new Map<string, ReturnType<typeof cron.schedule>>();

/**
 * Execute a single scheduled report: run the prompt, optionally generate CSV, send email.
 */
export async function executeScheduledReport(schedule: any): Promise<{ emailId?: string; content: string }> {
  const dataScope = (schedule.dataScope as any) || {};
  const attachCsv = dataScope.attachCsv === true;

  // Build data context for the LLM
  const data = getMongoData();
  const stats = getCollectionStats();

  let dataContext = `DATA AVAILABLE:\n`;
  for (const [name, count] of Object.entries(stats)) {
    dataContext += `- ${name}: ${count} records\n`;
  }

  // Add summary stats
  if (data?.Vehicletracker?.length) {
    const statusCounts: Record<string, number> = {};
    const locationCounts: Record<string, number> = {};
    data.Vehicletracker.forEach((v: any) => {
      statusCounts[v["Status"] || "Unknown"] = (statusCounts[v["Status"] || "Unknown"] || 0) + 1;
      locationCounts[v["Location"] || "Unknown"] = (locationCounts[v["Location"] || "Unknown"] || 0) + 1;
    });
    dataContext += `\nFleet Status: ${Object.entries(statusCounts).map(([k, v]) => `${k}: ${v}`).join(", ")}`;
    dataContext += `\nFleet Locations: ${Object.entries(locationCounts).map(([k, v]) => `${k}: ${v}`).join(", ")}`;
  }

  if (data?.Newcomplaintresponses?.length) {
    dataContext += `\nVehicle Complaints: ${data.Newcomplaintresponses.length}`;
  }
  if (data?.Complaindatabase?.length) {
    dataContext += `\nBattery Complaints: ${data.Complaindatabase.length}`;
  }

  // Run the prompt through the LLM
  const response = await llm.invoke([
    new SystemMessage(`You are EMO's Report Intelligence Agent generating a scheduled report.
Today: ${new Date().toISOString().split("T")[0]}
${dataContext}

Generate a professional report based on the user's prompt. Use markdown formatting with headers, tables, and bold metrics. Be data-driven and specific.`),
    new HumanMessage(schedule.prompt),
  ]);

  const reportContent = response.content as string;

  // Generate CSV attachment if enabled
  let csvAttachment: { filename: string; content: Buffer } | null = null;

  if (attachCsv && data) {
    try {
      // Determine what data to attach based on the prompt
      const prompt = (schedule.prompt as string).toLowerCase();
      let records: Record<string, any>[] = [];
      let label = "report_data";

      if (prompt.includes("fleet") || prompt.includes("vehicle")) {
        records = data.Vehicletracker.map((v: any) => ({
          "Vehicle ID": v["Vehicle ID"],
          Status: v["Status"],
          Location: v["Location"],
          Model: v["Model"],
          Vendor: v["Vendor"],
          "Rider Name": v["Rider Name"] || "",
          "Battery ID": v["Battery ID"] || "",
          "Last Active": v["Last Active Date"] || "",
        }));
        label = "fleet_data";
      } else if (prompt.includes("complaint") && prompt.includes("battery")) {
        records = data.Complaindatabase.map((c: any) => ({
          "Ticket ID": c["Ticket ID"],
          Vehicle: c["Vehicle ID/Chasis No"],
          "Battery ID": c["Battery ID"],
          Issue: c["Issue"],
          "Resolved Type": c["Resolved Type"],
          Location: c["Location"],
          Technician: c["Technician Name"],
          Solution: c["Solution"],
        }));
        label = "battery_complaints";
      } else if (prompt.includes("complaint")) {
        records = data.Newcomplaintresponses.map((c: any) => ({
          Ticket: c["Ticket"],
          "Vehicle ID": c["Vehicle ID"],
          Purpose: c["Purpose of Form Fillup?"],
          Status: c["Complaint Status"],
          Location: c["Location"],
          Operator: c["Your Name"],
          Created: c["Created Time"],
        }));
        label = "vehicle_complaints";
      } else if (prompt.includes("rental") || prompt.includes("payment")) {
        records = data.Rentingdatabase.map((r: any) => ({
          "Vehicle ID": r["Vehicle ID"],
          "Rider Name": r["Rider Name"],
          Status: r["Status"],
          Location: r["Location"],
          "Balance Amount": r["Balance Amount"],
          "Rent Amount": r["Rent Amount"],
        }));
        label = "rental_data";
      } else {
        // Default: fleet data
        records = data.Vehicletracker.map((v: any) => ({
          "Vehicle ID": v["Vehicle ID"],
          Status: v["Status"],
          Location: v["Location"],
          Model: v["Model"],
        }));
        label = "report_data";
      }

      if (records.length > 0) {
        const exported = exportToCSV(records, label);
        csvAttachment = {
          filename: exported.fileName,
          content: Buffer.from(readFileSync(exported.filePath)),
        };
      }
    } catch (err) {
      console.warn("CSV attachment generation failed:", err);
    }
  }

  // Convert markdown to basic HTML for email
  const htmlContent = reportContent
    .replace(/^### (.+)$/gm, '<h3 style="font-size:15px;font-weight:600;margin:16px 0 8px;color:#fafafa;">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="font-size:17px;font-weight:600;margin:20px 0 8px;color:#fafafa;">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="font-size:20px;font-weight:600;margin:24px 0 10px;color:#fafafa;">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#fafafa;">$1</strong>')
    .replace(/^- (.+)$/gm, '<li style="margin-bottom:4px;">$1</li>')
    .replace(/\n\n/g, '</p><p style="margin:8px 0;color:#a1a1aa;">')
    .replace(/\n/g, '<br>');

  // Send email
  const emailPayload: any = {
    from: env.RESEND_FROM,
    to: [schedule.deliveryTarget],
    subject: `${schedule.name} — ${new Date().toISOString().split("T")[0]}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: 'Segoe UI', system-ui, sans-serif; background: #09090b; color: #fafafa; padding: 40px 20px;">
  <div style="max-width: 600px; margin: 0 auto;">
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #7c3aed; font-weight: 600;">EMO Intelligence · Scheduled Report</span>
    </div>
    <h1 style="font-size: 22px; font-weight: 600; margin: 0 0 4px; text-align: center;">${schedule.name}</h1>
    <p style="text-align: center; font-size: 13px; color: #71717a; margin: 0 0 24px;">${new Date().toISOString().split("T")[0]}</p>
    ${csvAttachment ? '<div style="background: rgba(124,58,237,0.08); border: 1px solid rgba(124,58,237,0.15); border-radius: 8px; padding: 12px; margin-bottom: 16px; text-align: center;"><span style="font-size: 13px; color: #c4b5fd;">📎 CSV data file attached</span></div>' : ''}
    <div style="background: #16161a; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 24px; font-size: 14px; line-height: 1.6; color: #a1a1aa;">
      <p style="margin:8px 0;color:#a1a1aa;">${htmlContent}</p>
    </div>
    <p style="text-align: center; font-size: 11px; color: #52525b; margin-top: 24px;">Generated by EMO Intelligence · Automated Report</p>
  </div>
</body>
</html>`,
  };

  if (csvAttachment) {
    emailPayload.attachments = [
      {
        filename: csvAttachment.filename,
        content: csvAttachment.content,
      },
    ];
  }

  const { data: emailResult, error } = await resend.emails.send(emailPayload);

  if (error) {
    console.error("Scheduled report email failed:", error);
    throw new Error(`Email failed: ${error.message}`);
  }

  // Update last run time
  await prisma.scheduledReport.update({
    where: { id: schedule.id },
    data: { lastRunAt: new Date() },
  });

  console.log(`Scheduled report "${schedule.name}" sent to ${schedule.deliveryTarget} (email: ${emailResult?.id})`);

  return { emailId: emailResult?.id, content: reportContent };
}

/**
 * Start all active cron jobs from the database.
 */
export async function startScheduler() {
  const schedules = await prisma.scheduledReport.findMany({
    where: { isActive: true },
  });

  console.log(`Starting scheduler: ${schedules.length} active schedules`);

  for (const schedule of schedules) {
    registerCronJob(schedule);
  }
}

/**
 * Register a single cron job for a schedule.
 */
export function registerCronJob(schedule: any) {
  // Stop existing job if any
  const existing = activeJobs.get(schedule.id);
  if (existing) existing.stop();

  if (!cron.validate(schedule.scheduleCron)) {
    console.warn(`Invalid cron for schedule "${schedule.name}": ${schedule.scheduleCron}`);
    return;
  }

  const job = cron.schedule(schedule.scheduleCron, async () => {
    console.log(`Running scheduled report: "${schedule.name}"`);
    try {
      await executeScheduledReport(schedule);
    } catch (err) {
      console.error(`Scheduled report "${schedule.name}" failed:`, err);
    }
  });

  activeJobs.set(schedule.id, job);
  console.log(`  Registered: "${schedule.name}" [${schedule.scheduleCron}] → ${schedule.deliveryTarget}`);
}

/**
 * Stop a cron job by schedule ID.
 */
export function stopCronJob(scheduleId: string) {
  const job = activeJobs.get(scheduleId);
  if (job) {
    job.stop();
    activeJobs.delete(scheduleId);
  }
}
