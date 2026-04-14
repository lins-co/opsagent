import cron from "node-cron";
import { extractInsightsFromMessages } from "../../channels/whatsapp/insights.js";
import { getSetting, isEnabled } from "../../config/settings.js";

let currentJob: ReturnType<typeof cron.schedule> | null = null;
let isRunning = false;

// Run extraction once — used by cron AND by manual trigger
async function runExtraction(): Promise<void> {
  if (isRunning) {
    console.log("  [Insights Cron] Already running — skipping");
    return;
  }

  const enabled = await isEnabled("wa.extract_patterns");
  if (!enabled) return;

  isRunning = true;
  try {
    const hours = await getSetting("wa.extraction_interval_hours");
    // Extract from a slightly wider window than the interval to avoid gaps
    const extracted = await extractInsightsFromMessages((hours as number) + 1);
    if (extracted > 0) {
      console.log(`  [Insights Cron] Extracted ${extracted} insights`);
    }
  } catch (err: any) {
    console.error("  [Insights Cron] Error:", err?.message);
  } finally {
    isRunning = false;
  }
}

export async function startInsightsCron(): Promise<void> {
  if (currentJob) {
    currentJob.stop();
    currentJob = null;
  }

  const enabled = await isEnabled("wa.extract_patterns");
  if (!enabled) {
    console.log("  [Insights Cron] Disabled via settings");
    return;
  }

  const hours = await getSetting("wa.extraction_interval_hours");
  // Cron pattern: every N hours at :15 past
  const cronExpr = `15 */${hours} * * *`;

  currentJob = cron.schedule(cronExpr, () => { runExtraction(); }, { timezone: "Asia/Kolkata" });
  console.log(`  [Insights Cron] Scheduled every ${hours}h (${cronExpr})`);
}

export async function stopInsightsCron(): Promise<void> {
  if (currentJob) {
    currentJob.stop();
    currentJob = null;
    console.log("  [Insights Cron] Stopped");
  }
}

// Manual trigger — useful for API endpoint
export async function triggerExtractionNow(hours?: number): Promise<number> {
  const interval = hours || ((await getSetting("wa.extraction_interval_hours")) as number);
  return extractInsightsFromMessages(interval);
}
