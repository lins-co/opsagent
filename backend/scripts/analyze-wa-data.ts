import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = (sql: string, params: any[] = []) => pool.query(sql, params).then((r) => r.rows);

const LINE = "─".repeat(70);

async function main() {
  // ──────────────────────────────────────────────────────
  // 1. OVERALL STATS
  // ──────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(70));
  console.log("  WHATSAPP DATA ANALYSIS — EMO Energy");
  console.log("═".repeat(70));

  const [{ total_msgs }] = await q(`SELECT COUNT(*)::int as total_msgs FROM wa_messages`);
  const [{ total_media }] = await q(`SELECT COUNT(*)::int as total_media FROM wa_media_files`);
  const [{ total_insights }] = await q(`SELECT COUNT(*)::int as total_insights FROM wa_insights`);
  const [{ active_groups }] = await q(`SELECT COUNT(*)::int as active_groups FROM wa_monitored_groups WHERE is_active = true`);
  const [{ earliest, latest }] = await q(`SELECT MIN(timestamp) as earliest, MAX(timestamp) as latest FROM wa_messages`);

  console.log(`\n  Active groups:       ${active_groups}`);
  console.log(`  Messages stored:     ${total_msgs.toLocaleString()}`);
  console.log(`  Media files stored:  ${total_media.toLocaleString()}`);
  console.log(`  Insights extracted:  ${total_insights.toLocaleString()}`);
  console.log(`  Date range:          ${earliest?.toISOString?.().slice(0, 10) || "—"}  →  ${latest?.toISOString?.().slice(0, 10) || "—"}`);

  // ──────────────────────────────────────────────────────
  // 2. PER-GROUP BREAKDOWN
  // ──────────────────────────────────────────────────────
  console.log(`\n${LINE}`);
  console.log("  GROUPS — message volume and activity");
  console.log(LINE);

  const groups = await q(`
    SELECT g.chat_name,
           g.message_count,
           g.last_message_at,
           COUNT(m.id) as stored_count,
           COUNT(DISTINCT m.sender_name) as unique_senders,
           MIN(m.timestamp) as first_msg,
           MAX(m.timestamp) as last_msg
    FROM wa_monitored_groups g
    LEFT JOIN wa_messages m ON m.group_id = g.id
    WHERE g.is_active = true
    GROUP BY g.id
    ORDER BY COUNT(m.id) DESC
  `);

  for (const g of groups) {
    console.log(`\n  📱 ${g.chat_name}`);
    console.log(`     Stored: ${g.stored_count} msgs  ·  Senders: ${g.unique_senders}  ·  Running count: ${g.message_count}`);
    if (g.first_msg && g.last_msg) {
      console.log(`     Range:  ${new Date(g.first_msg).toISOString().slice(0, 10)} → ${new Date(g.last_msg).toISOString().slice(0, 10)}`);
    }
  }

  // ──────────────────────────────────────────────────────
  // 3. CATEGORY BREAKDOWN (regex-extracted at ingest)
  // ──────────────────────────────────────────────────────
  console.log(`\n${LINE}`);
  console.log("  MESSAGE CATEGORIES (from regex extraction at ingest)");
  console.log(LINE);

  const categories = await q(`
    SELECT COALESCE(category, 'uncategorized') as category,
           COUNT(*)::int as count
    FROM wa_messages
    GROUP BY category
    ORDER BY count DESC
  `);
  const totalCat = categories.reduce((s: number, r: any) => s + r.count, 0);
  for (const c of categories) {
    const pct = ((c.count / totalCat) * 100).toFixed(1);
    console.log(`  ${c.category.padEnd(16)}  ${String(c.count).padStart(6)}  (${pct}%)`);
  }

  // ──────────────────────────────────────────────────────
  // 4. CATEGORY × GROUP — where do different topics live?
  // ──────────────────────────────────────────────────────
  console.log(`\n${LINE}`);
  console.log("  CATEGORY × GROUP — where each topic is discussed");
  console.log(LINE);

  const catByGroup = await q(`
    SELECT g.chat_name,
           COALESCE(m.category, 'uncategorized') as category,
           COUNT(*)::int as count
    FROM wa_messages m
    JOIN wa_monitored_groups g ON g.id = m.group_id
    GROUP BY g.chat_name, m.category
    ORDER BY g.chat_name, count DESC
  `);
  const byGroup: Record<string, any[]> = {};
  for (const row of catByGroup) {
    if (!byGroup[row.chat_name]) byGroup[row.chat_name] = [];
    byGroup[row.chat_name].push(row);
  }
  for (const [name, rows] of Object.entries(byGroup)) {
    console.log(`\n  ${name}:`);
    const total = rows.reduce((s, r) => s + r.count, 0);
    for (const r of rows) {
      const pct = ((r.count / total) * 100).toFixed(0);
      console.log(`     ${r.category.padEnd(16)} ${String(r.count).padStart(5)}  (${pct}%)`);
    }
  }

  // ──────────────────────────────────────────────────────
  // 5. TOP SENDERS — who drives the conversations?
  // ──────────────────────────────────────────────────────
  console.log(`\n${LINE}`);
  console.log("  TOP 20 SENDERS (by message volume)");
  console.log(LINE);

  const senders = await q(`
    SELECT sender_name,
           COUNT(*)::int as count,
           COUNT(DISTINCT group_id)::int as groups_active_in,
           COUNT(*) FILTER (WHERE category = 'complaint')::int as complaints,
           COUNT(*) FILTER (WHERE category = 'deployment')::int as deployments,
           COUNT(*) FILTER (WHERE category = 'payment')::int as payments,
           COUNT(*) FILTER (WHERE category = 'query')::int as queries,
           COUNT(*) FILTER (WHERE category = 'status')::int as status_updates,
           MAX(timestamp) as last_seen
    FROM wa_messages
    WHERE sender_name NOT LIKE '%@%'
      AND sender_name NOT SIMILAR TO '\\d+'
    GROUP BY sender_name
    ORDER BY count DESC
    LIMIT 20
  `);

  console.log(`\n  ${"Sender".padEnd(24)} ${"Msgs".padStart(5)}  ${"Grps".padStart(4)}  ${"Cmpl".padStart(4)}  ${"Depl".padStart(4)}  ${"Pmt".padStart(4)}  ${"Q".padStart(3)}  ${"Sta".padStart(3)}`);
  for (const s of senders) {
    console.log(
      `  ${String(s.sender_name).slice(0, 24).padEnd(24)} ${String(s.count).padStart(5)}  ${String(s.groups_active_in).padStart(4)}  ${String(s.complaints).padStart(4)}  ${String(s.deployments).padStart(4)}  ${String(s.payments).padStart(4)}  ${String(s.queries).padStart(3)}  ${String(s.status_updates).padStart(3)}`
    );
  }

  // ──────────────────────────────────────────────────────
  // 6. VEHICLES — which IDs come up most
  // ──────────────────────────────────────────────────────
  console.log(`\n${LINE}`);
  console.log("  VEHICLES MENTIONED MOST (from extracted vehicle_ids)");
  console.log(LINE);

  const topVehicles = await q(`
    SELECT unnest(vehicle_ids) as vehicle_id,
           COUNT(*)::int as mentions
    FROM wa_messages
    WHERE array_length(vehicle_ids, 1) > 0
    GROUP BY vehicle_id
    ORDER BY mentions DESC
    LIMIT 15
  `);
  console.log(`\n  ${"Vehicle ID".padEnd(14)} ${"Mentions".padStart(8)}`);
  for (const v of topVehicles) {
    console.log(`  ${v.vehicle_id.padEnd(14)} ${String(v.mentions).padStart(8)}`);
  }

  // ──────────────────────────────────────────────────────
  // 7. LOCATIONS
  // ──────────────────────────────────────────────────────
  console.log(`\n${LINE}`);
  console.log("  TOP LOCATIONS MENTIONED");
  console.log(LINE);

  const locations = await q(`
    SELECT location, COUNT(*)::int as count
    FROM wa_messages
    WHERE location IS NOT NULL
    GROUP BY location
    ORDER BY count DESC
    LIMIT 15
  `);
  for (const l of locations) {
    console.log(`  ${l.location.padEnd(24)}  ${String(l.count).padStart(5)}`);
  }

  // ──────────────────────────────────────────────────────
  // 8. DAILY ACTIVITY TREND (last 30 days)
  // ──────────────────────────────────────────────────────
  console.log(`\n${LINE}`);
  console.log("  DAILY VOLUME — last 14 active days");
  console.log(LINE);

  const daily = await q(`
    SELECT DATE(timestamp) as day, COUNT(*)::int as count
    FROM wa_messages
    WHERE timestamp >= NOW() - INTERVAL '60 days'
    GROUP BY day
    ORDER BY day DESC
    LIMIT 14
  `);
  const maxDaily = Math.max(...daily.map((d: any) => d.count), 1);
  for (const d of daily.reverse()) {
    const barLen = Math.round((d.count / maxDaily) * 40);
    const bar = "█".repeat(barLen);
    console.log(`  ${new Date(d.day).toISOString().slice(0, 10)}  ${String(d.count).padStart(4)}  ${bar}`);
  }

  // ──────────────────────────────────────────────────────
  // 9. EXTRACTED INSIGHTS BY CATEGORY / SEVERITY
  // ──────────────────────────────────────────────────────
  console.log(`\n${LINE}`);
  console.log("  EXTRACTED INSIGHTS (LLM pattern analysis)");
  console.log(LINE);

  const insightStats = await q(`
    SELECT category, severity, status, COUNT(*)::int as count
    FROM wa_insights
    GROUP BY category, severity, status
    ORDER BY count DESC
  `);
  if (insightStats.length === 0) {
    console.log(`\n  (No insights extracted yet — trigger extraction manually or wait for cron)`);
  } else {
    console.log(`\n  ${"Category".padEnd(16)} ${"Severity".padEnd(10)} ${"Status".padEnd(12)} ${"Count".padStart(6)}`);
    for (const i of insightStats) {
      console.log(
        `  ${String(i.category || "—").padEnd(16)} ${String(i.severity).padEnd(10)} ${String(i.status).padEnd(12)} ${String(i.count).padStart(6)}`
      );
    }
  }

  const topInsights = await q(`
    SELECT title, category, severity, status, occurrence_count, group_name,
           array_length(vehicle_ids, 1) as n_vehicles,
           reporter_names
    FROM wa_insights
    ORDER BY occurrence_count DESC, last_seen DESC
    LIMIT 10
  `);
  if (topInsights.length > 0) {
    console.log(`\n  Top recurring insights:`);
    for (const i of topInsights) {
      const reporters = (i.reporter_names || []).slice(0, 3).join(", ");
      console.log(`\n    "${i.title}"`);
      console.log(`      ${i.category || "—"} · ${i.severity} · ${i.status} · ${i.occurrence_count}× · ${i.group_name}`);
      if (reporters) console.log(`      reporters: ${reporters}`);
    }
  }

  // ──────────────────────────────────────────────────────
  // 10. ORGANIZATIONAL SEGREGATION INFERENCE
  // ──────────────────────────────────────────────────────
  console.log(`\n${LINE}`);
  console.log("  ORGANIZATIONAL SEGREGATION (inferred from group names)");
  console.log(LINE);

  const segmentPatterns: [string, RegExp][] = [
    ["Plant / Factory", /plant|factory|production|assembly|manufacturing/i],
    ["Operations (Field)", /field|ops|operation|deploy|logistics|rental/i],
    ["Procurement", /procurement|vendor|supplier|purchase|order/i],
    ["App Testing / Tech", /app|rider.*app|tech|testing|qa|dev/i],
    ["Battery / Complaints", /battery|complaint|issue/i],
    ["Customer / Sense", /sense|customer|feedback|support/i],
  ];

  const allGroups = await q(`SELECT chat_name FROM wa_monitored_groups WHERE is_active = true`);
  const segMap: Record<string, string[]> = {};
  for (const [seg] of segmentPatterns) segMap[seg] = [];
  segMap["(uncategorized)"] = [];

  for (const g of allGroups) {
    let matched = false;
    for (const [seg, re] of segmentPatterns) {
      if (re.test(g.chat_name)) {
        segMap[seg].push(g.chat_name);
        matched = true;
        break;
      }
    }
    if (!matched) segMap["(uncategorized)"].push(g.chat_name);
  }

  for (const [seg, gs] of Object.entries(segMap)) {
    if (gs.length === 0) continue;
    console.log(`\n  ${seg}:`);
    for (const name of gs) console.log(`    · ${name}`);
  }

  console.log("\n" + "═".repeat(70));
  console.log("  Done. Run `pm2 logs ops-agent` to see live updates.");
  console.log("═".repeat(70) + "\n");

  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
