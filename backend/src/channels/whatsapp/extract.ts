// Regex-based entity extraction for WhatsApp messages.
// Runs at ingest time — cheap and fast, no LLM needed.

// Vehicle ID patterns (e.g. KA51JN6518, DL4SEA6114, MH12AB1234)
const VEHICLE_ID_REGEX = /\b([A-Z]{2}\d{1,2}[A-Z]{1,3}\d{3,4})\b/gi;

// Location keywords from EMO's known locations
const LOCATIONS = [
  "Delhi", "Bengaluru", "Bangalore", "Chennai", "Mumbai", "Kolkata",
  "Pune", "Mysore", "Hyderabad", "Kochi",
  // Common sector/hub references
  "Sector 62", "Sector 53", "Sector 57", "Sarjapur", "Mahindra", "Mahendra",
  "Mangampalya", "Taverkar", "Blinkit",
];

// Category classification via keyword matching
const CATEGORY_KEYWORDS: Record<string, RegExp> = {
  complaint: /\b(issue|problem|not working|broken|failed|error|fault|malfunction|damage|damaged|complaint|escalat|urgent|critical)\b/i,
  deployment: /\b(deploy|assigned?|delivered|handed over|rider assigned|allocation)\b/i,
  payment: /\b(payment|paid|rent|balance|overdue|pending payment|collection|amount|link)\b/i,
  query: /^\s*(what|why|when|where|how|is there|any update|status)\b/i,
  status: /\b(done|completed|resolved|fixed|working|ok|okay|✅)\b/i,
};

export interface ExtractedEntities {
  vehicleIds: string[];
  location: string | null;
  category: string | null;
}

export function extractEntities(text: string): ExtractedEntities {
  if (!text) return { vehicleIds: [], location: null, category: null };

  // Vehicle IDs
  const vehicleMatches = text.match(VEHICLE_ID_REGEX) || [];
  const vehicleIds = [...new Set(vehicleMatches.map((v) => v.toUpperCase()))];

  // Location — pick the first match (longest wins)
  let location: string | null = null;
  const textLower = text.toLowerCase();
  const sortedLocs = [...LOCATIONS].sort((a, b) => b.length - a.length);
  for (const loc of sortedLocs) {
    if (textLower.includes(loc.toLowerCase())) {
      // Normalize "Bangalore" → "Bengaluru", etc
      location = loc === "Bangalore" ? "Bengaluru" : loc === "Mahendra" ? "Mahindra" : loc;
      break;
    }
  }

  // Category — first match wins, priority order
  let category: string | null = null;
  for (const [cat, re] of Object.entries(CATEGORY_KEYWORDS)) {
    if (re.test(text)) { category = cat; break; }
  }

  return { vehicleIds, location, category };
}
