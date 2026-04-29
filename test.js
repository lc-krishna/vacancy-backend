// test.js — run locally to test the backend before deploying
// Usage:
//   1. Set env vars in a .env file or export them in your terminal
//   2. node test.js
//
// Requires: ANTHROPIC_API_KEY, GOOGLE_SERVICE_ACCOUNT_JSON, SHEET_ID

import "dotenv/config"; // npm install dotenv if needed for local testing

const BASE_URL = process.env.TEST_URL || "http://localhost:3000";

// ── Helpers ───────────────────────────────────────────────────────────────────
function pass(label) { console.log(`  ✓ ${label}`); }
function fail(label, detail) { console.error(`  ✗ ${label}`, detail); }

async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function get(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  return { status: res.status, data: await res.json() };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
async function testLatest() {
  console.log("\n[1] GET /api/latest");
  const { status, data } = await get("/api/latest");
  if (status === 200) {
    pass(`Status 200`);
    pass(`latestDate: ${data.latestDate}`);
    pass(`latestLabel: ${data.latestLabel}`);
  } else {
    fail("Expected 200", data);
  }
}

async function testMissingParams() {
  console.log("\n[2] POST /api/ask — missing params");
  const { status, data } = await post("/api/ask", { query: "test" });
  if (status === 400) {
    pass("Returns 400 for missing fromDate/toDate");
  } else {
    fail("Expected 400", { status, data });
  }
}

async function testDateRangeNoData() {
  console.log("\n[3] POST /api/ask — date range with no data (far future)");
  const { status, data } = await post("/api/ask", {
    query: "How many vacancies?",
    fromDate: "2030-01-01",
    toDate: "2030-01-05",
  });
  if (status === 200 && data.answer) {
    pass("Returns 200 with answer explaining no data");
    pass(`Answer preview: "${data.answer.slice(0, 80)}..."`);
    pass(`Missing dates count: ${data.missingDates?.length}`);
  } else {
    fail("Unexpected response", { status, data });
  }
}

async function testRealQuery() {
  console.log("\n[4] POST /api/ask — real query (last 3 days from today)");
  const today = new Date();
  const threeDaysAgo = new Date(today);
  threeDaysAgo.setDate(today.getDate() - 3);

  const fromDate = threeDaysAgo.toISOString().split("T")[0];
  const toDate = today.toISOString().split("T")[0];

  console.log(`     Date range: ${fromDate} → ${toDate}`);

  const { status, data } = await post("/api/ask", {
    query: "What is the current vacancy status across all properties?",
    fromDate,
    toDate,
  });

  if (status === 200 && data.answer) {
    pass("Returns 200 with answer");
    pass(`Dates with data: ${data.datesWithData?.join(", ") || "none"}`);
    pass(`Missing dates: ${data.missingDates?.join(", ") || "none"}`);
    console.log("\n  ── Answer preview ──────────────────────────────────");
    console.log(data.answer.slice(0, 400) + (data.answer.length > 400 ? "..." : ""));
    console.log("  ────────────────────────────────────────────────────");
  } else {
    fail("Unexpected response", { status, data });
  }
}

async function testComparisonQuery() {
  console.log("\n[5] POST /api/ask — comparison query");
  const { status, data } = await post("/api/ask", {
    query: "What changed in vacancies between the earliest and latest date you have?",
    fromDate: "2026-04-01",
    toDate: new Date().toISOString().split("T")[0],
  });

  if (status === 200 && data.answer) {
    pass("Returns 200");
    pass(`Dates with data: ${data.datesWithData?.length} reports`);
    console.log("\n  ── Answer preview ──────────────────────────────────");
    console.log(data.answer.slice(0, 400) + (data.answer.length > 400 ? "..." : ""));
    console.log("  ────────────────────────────────────────────────────");
  } else {
    fail("Unexpected", { status, data });
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────
console.log("=== Vacancy Backend Tests ===");
console.log(`Target: ${BASE_URL}`);

(async () => {
  try {
    await testLatest();
    await testMissingParams();
    await testDateRangeNoData();
    await testRealQuery();
    await testComparisonQuery();
    console.log("\n✓ All tests complete\n");
  } catch (err) {
    console.error("\n✗ Test runner crashed:", err.message);
  }
})();
