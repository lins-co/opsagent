// Verifies the async sandbox can:
//  1) run plain sync code with result = ...
//  2) await fetchPayments() and compute totals
//  3) await aggregateMongo() with a real pipeline
//  4) handle errors gracefully
//  5) enforce the timeout
import { connectMongo, closeMongo, ensureIndexes, loadMongoData } from "../dist/db/connectors/mongodb.js";
import { runAnalysisTool } from "../dist/agents/tools/sandbox.js";

await connectMongo();
await ensureIndexes();
await loadMongoData();

async function run(label, code) {
  console.log(`\n── ${label} ──`);
  const t = Date.now();
  const out = await runAnalysisTool.invoke({ goal: label, code });
  console.log(`  ${Date.now() - t}ms`);
  console.log(out.split("\n").map((l) => "  " + l).join("\n"));
}

// 1) Pure sync using hot cache
await run("sync: count active rentals by location", `
  const active = rentals.filter(r => r.Status === "Active");
  result = topN(active, "Location", 5);
`);

// 2) Async live fetch from Gencash (indexed)
await run("async: payments collected today from hot rentals", `
  const start = new Date(today + "T00:00:00");
  const paid = await fetchPayments({ status: "SUCCESS", receivedAt: { $gte: start } }, 5000);
  result = {
    count: paid.length,
    total: sum(paid, "amount"),
    sources: topN(paid, "txnSource", 5),
  };
`);

// 3) Full aggregation pipeline
await run("async: total SUCCESS revenue by txnSource via pipeline", `
  const rows = await aggregateMongo("Gencash", [
    { $match: { status: "SUCCESS" } },
    { $group: {
      _id: { $toLower: "$txnSource" },
      total: { $sum: { $convert: { input: "$amount", to: "double", onError: 0, onNull: 0 } } },
      count: { $sum: 1 }
    } },
    { $sort: { total: -1 } },
    { $limit: 8 }
  ]);
  result = rows;
`);

// 4) Cross-collection join (payments ↔ rentals by phone)
await run("async: top 5 riders by total paid (joining payments to rentals)", `
  const paid = await fetchPayments({ status: "SUCCESS" }, 5000);
  const byPhone = {};
  for (const p of paid) {
    const k = String(p.customerDetails?.customerMobile || "");
    if (!k) continue;
    byPhone[k] = (byPhone[k] || 0) + (Number(p.amount) || 0);
  }
  const top = Object.entries(byPhone).sort((a, b) => b[1] - a[1]).slice(0, 5);
  result = top.map(([phone, total]) => {
    const rental = rentals.find(r => String(r["Rider Contact No"]) === phone);
    return { phone, rider: rental?.["Rider Name"] || "(unknown)", vehicle: rental?.["Vehicle ID"] || "—", total };
  });
`);

// 5) Error handling
await run("error: intentional bad filter", `
  const x = await fetchMongo("NotARealCollection", {});
  result = x;
`);

// 6) Timeout — infinite loop
await run("timeout: infinite loop should time out", `
  while (true) {}
`);

await closeMongo();
