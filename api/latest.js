// api/latest.js — returns most recent report date for the UI banner
// Env vars: GOOGLE_API_KEY, SHEET_ID

const SHEET_ID = process.env.SHEET_ID;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const SHEET_TAB = "Sheet1";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const range = encodeURIComponent(`${SHEET_TAB}!A:B`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?key=${GOOGLE_API_KEY}`;

    const res2 = await fetch(url);
    if (!res2.ok) throw new Error(`Sheets API error: ${res2.status}`);

    const data = await res2.json();
    const rows = data.values || [];

    if (rows.length < 2) {
      return res.json({ latestDate: null, latestLabel: "No reports yet" });
    }

    const last = rows[rows.length - 1];
    return res.json({
      latestDate: last[0],    // ISO e.g. 2026-04-28
      latestLabel: last[1],   // Human e.g. April 28, 2026
    });
  } catch (err) {
    console.error("latest.js error:", err);
    return res.status(500).json({ error: err.message });
  }
}
