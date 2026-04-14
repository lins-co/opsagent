import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;

console.log("Starting standalone WhatsApp listener test...");
console.log("This will connect using the saved session and log ALL events.\n");

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth" }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

// Log ALL possible events
const events = [
  "qr", "authenticated", "auth_failure", "ready", "disconnected",
  "message", "message_create", "message_ack", "message_revoke_everyone",
  "message_revoke_me", "message_reaction", "group_join", "group_leave",
  "group_update", "change_state", "loading_screen",
];

for (const event of events) {
  client.on(event as any, (...args: any[]) => {
    const now = new Date().toISOString().split("T")[1].slice(0, 8);
    if (event === "message" || event === "message_create") {
      const msg = args[0];
      console.log(`[${now}] EVENT: ${event}`);
      console.log(`  from: ${msg.from}`);
      console.log(`  fromMe: ${msg.fromMe}`);
      console.log(`  body: "${(msg.body || "").slice(0, 100)}"`);
      console.log(`  type: ${msg.type}`);
      console.log(`  id: ${msg.id?._serialized}`);
      console.log("");
    } else if (event === "ready") {
      console.log(`[${now}] EVENT: ready — WhatsApp connected!`);
      console.log("  Waiting for messages... Send a DM to this number.\n");
    } else if (event === "qr") {
      console.log(`[${now}] EVENT: qr — Need to scan QR code`);
    } else {
      console.log(`[${now}] EVENT: ${event}`, typeof args[0] === "string" ? args[0] : "");
    }
  });
}

console.log("Initializing client...\n");
client.initialize().catch((err) => {
  console.error("Init failed:", err.message);
});

// Keep alive
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await client.destroy();
  process.exit(0);
});
