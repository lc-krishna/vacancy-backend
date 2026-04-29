// api/ask.js — Vacancy Q&A backend
// Deploy to Vercel. Set these env vars in Vercel dashboard:
//   ANTHROPIC_API_KEY=your_key
//   GOOGLE_API_KEY=your_google_api_key
//   SHEET_ID=1NA66JY_Eg7s1Vy7yE2Pcp7ixfiahJ2cE4Ano_lRNNEE
//
// Requirements:
//   - Google Sheet must be shared: "Anyone with the link can view"
//   - Google Drive folder must be shared: "Anyone with the link can view"
//   - Google API key must have Sheets API + Drive API enabled in Google Cloud Console

import Anthropic from "@anthropic-ai/sdk";

const SHEET_ID = process.env.SHEET_ID;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const SHEET_TAB = "Sheet1";

// ── Sheet: fetch rows via REST ────────────────────────────────────────────────
async function getSheetRowsForDates(fromDate, toDate) {
  const range = encodeURIComponent(`${SHEET_TAB}!A:H`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?key=${GOOGLE_API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheets API error: ${res.status} ${await res.text()}`);

  const data = await res.json();
  const rows = data.values || [];
  if (rows.length < 2) return { rows: [], missing: [] };

  const dataRows = rows.slice(1); // skip header row

  // Build every date in range
  const allDates = [];
  for (let d = new Date(fromDate); d <= new Date(toDate); d.setDate(d.getDate() + 1)) {
    allDates.push(d.toISOString().split("T")[0]);
  }

  const matched = dataRows.filter((row) => row[0] >= fromDate && row[0] <= toDate);
  const presentDates = new Set(matched.map((r) => r[0]));
  const missing = allDates.filter((d) => !presentDates.has(d));

  return { rows: matched, missing };
}

// ── Drive: fetch PDF as base64 via REST ───────────────────────────────────────
async function fetchPdfAsBase64(fileId) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${GOOGLE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Drive API error: ${res.status}`);
  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

// ── Claude: answer from PDFs ──────────────────────────────────────────────────
async function askClaude(query, pdfDocs, missingDates, dateRange) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemPrompt = `You are a vacancy analyst for Lucky Communities, a mobile home park management company with 22 properties.

You answer questions strictly based on the vacancy report documents provided.

Rules you must follow without exception:
- Only answer from the documents given. Never invent or assume data.
- If a date is missing, explicitly state: "No report available for [date]."
- When comparing across dates, only use dates that have data.
- Lead with a summary, then break down by property where relevant.
- Use plain numbers and percentages where helpful.
- If dates are missing, list them clearly at the top of your response.
- Never say "based on my knowledge" — only "based on the reports provided."

Date range being analyzed: ${dateRange}
${missingDates.length > 0 ? `Missing reports (no data available): ${missingDates.join(", ")}` : "All dates in range have reports."}`;

  const userContent = [];

  for (const doc of pdfDocs) {
    userContent.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: doc.base64,
      },
      title: `Vacancy Report — ${doc.date}`,
    });
  }

  userContent.push({ type: "text", text: query });

  const response = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  return response.content[0].text;
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { query, fromDate, toDate } = req.body;
  if (!query || !fromDate || !toDate) {
    return res.status(400).json({ error: "query, fromDate, toDate are required" });
  }

  try {
    // 1. Get sheet rows
    const { rows, missing } = await getSheetRowsForDates(fromDate, toDate);

    if (rows.length === 0) {
      return res.json({
        answer: `No vacancy reports found between ${fromDate} and ${toDate}.${missing.length > 0 ? ` Missing dates: ${missing.join(", ")}` : ""}`,
        missingDates: missing,
        datesWithData: [],
      });
    }

    // 2. Fetch PDFs
    const pdfDocs = [];
    for (const row of rows) {
      const fileId = row[5]; // col F = file_id
      const date = row[0];
      if (!fileId) continue;
      try {
        const base64 = await fetchPdfAsBase64(fileId);
        pdfDocs.push({ date, base64 });
      } catch (e) {
        console.error(`PDF fetch failed for ${date}:`, e.message);
        missing.push(`${date} (fetch failed)`);
      }
    }

    // 3. Ask Claude
    const answer = await askClaude(query, pdfDocs, missing, `${fromDate} to ${toDate}`);

    return res.json({
      answer,
      missingDates: missing,
      datesWithData: rows.map((r) => r[0]),
    });
  } catch (err) {
    console.error("ask.js error:", err);
    return res.status(500).json({ error: err.message });
  }
}
