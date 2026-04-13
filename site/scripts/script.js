// ================================================================
// GLOBALS — top dashboard (unchanged)
// ================================================================
let SQLPromise       = null;
let dbPromise        = null;
let performanceChart = null;
let resultsData      = [];

// ================================================================
// GLOBALS — risk section
// ================================================================
let ownerRankingsData    = [];
let ownerStoreMapData    = [];
let storeMonthlyRiskData = [];
let activeOwnerID        = null;
let activeStoreID        = null;
let comparisonStores     = [];   // [7] max 2 storeIDs
let heatmapVisible       = false;
let leaderboardCount     = 5;
let leaderboardPage      = 0;    // current pagination page (0-indexed)
let activeFlagFilter     = null; // flag name string or null

// ================================================================
// [3] FLAG GLOSSARY — plain-English definitions for every flag
// ================================================================
const FLAG_GLOSSARY = {
  'sales_decline':                      'Store revenue has dropped below expected or prior-period performance.',
  'low_cash_flow':                      'Store cash flow is below acceptable operational thresholds.',
  'high_labor_cost':                    'Labor expenses are disproportionately high relative to revenue.',
  'high_stat_labor_cost':               'Statistical labor cost metric exceeds benchmark thresholds set by the model.',
  'low_stat_profit':                    'Statistical profit metric falls below benchmark thresholds.',
  'low_controllable_profit':            'Controllable profit margin is below acceptable levels.',
  'rent_vs_profit':                     'Rent obligations are consuming too large a share of the store\'s profit.',
  'no_data':                            'No performance data was available for this reporting period.',
  'office outlier':                     'Office and administrative expenses are significantly above the peer-group average.',
  'travel outlier':                     'Travel expenses are significantly above the peer-group average.',
  'linen outlier':                      'Linen and laundry costs are significantly above the peer-group average.',
  'outside services outlier':           'Spending on contracted outside services exceeds expected levels.',
  'utilities outlier':                  'Utility costs are significantly above the peer-group average.',
  'maintenance & repair outlier':       'Maintenance and repair costs exceed peer-group norms.',
  'promotion outlier':                  'Promotional spending is outside the expected range for this store type.',
  'delivery fees/commissions outlier':  'Delivery and commission fees are above expected levels.',
  'operating supplies outlier':         'Operating supply costs are above the expected range.',
  'advertising outlier':                'Advertising spend falls outside the expected range.',
  'food outlier':                       'Food costs are significantly above the peer-group average.',
};

// ================================================================
// v TOP DASHBOARD — SQL / DB (unchanged)
// ================================================================
function getSqlJsInstance() {
  if (!SQLPromise) {
    SQLPromise = initSqlJs({
      locateFile: function (file) {
        return `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`;
      }
    });
  }
  return SQLPromise;
}

async function getDatabase() {
  if (!dbPromise) {
    dbPromise = (async function () {
      const SQL      = await getSqlJsInstance();
      const response = await fetch("data/data.db");
      if (!response.ok) throw new Error(`Could not load database: ${response.status} ${response.statusText}`);
      const buffer = await response.arrayBuffer();
      return new SQL.Database(new Uint8Array(buffer));
    })();
  }
  return dbPromise;
}
// ^ TOP DASHBOARD — SQL / DB

// ================================================================
// v CSV PARSER (unchanged)
// ================================================================
function parseCsvRow(row) {
  const values = [];
  let current  = "";
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const char     = row[i];
    const nextChar = row[i + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (char === "," && !inQuotes) {
      values.push(current); current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}
// ^ CSV PARSER

// ================================================================
// v LEGACY results.csv loader (unchanged — kept for compatibility)
// ================================================================
async function loadResultsCsv() {
  const response = await fetch("data/results.csv");
  if (!response.ok) throw new Error(`Could not load results.csv: ${response.status} ${response.statusText}`);
  const csvText = await response.text();
  const lines   = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) { resultsData = []; window.resultsData = resultsData; return; }
  const headers = parseCsvRow(lines[0]);
  resultsData = lines.slice(1).map(line => {
    const values = parseCsvRow(line);
    const row    = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    return {
      StoreID:          Number(row.StoreID),
      FiscalYearID:     Number(row.FiscalYearID),
      CalendarID:       Number(row.CalendarID),
      flags:            row.flags && row.flags.trim() !== "" ? row.flags.trim() : "No Flag",
      is_at_risk:       String(row.is_at_risk).toLowerCase() === "true",
      predicted_sales:  Number(row.predicted_sales || 0),
      risk_label:       Number(row.risk_label || 0),
      risk_probability: Number(row.risk_probability || 0)
    };
  });
  console.log("Loaded results.csv rows:", resultsData.length);
  window.resultsData = resultsData;
}
// ^ LEGACY results.csv loader

// ================================================================
// v MONTH HELPERS (unchanged)
// ================================================================
const MONTH_NAMES = {
  1:"January",2:"February",3:"March",4:"April",5:"May",6:"June",
  7:"July",8:"August",9:"September",10:"October",11:"November",12:"December"
};
function getMonthName(n) { return MONTH_NAMES[n] || `Month ${n}`; }

function populateResultsFilters() {
  // kept for backward compatibility; not actively used in new layout
}
// ^ MONTH HELPERS

// ================================================================
// v LEGACY results helpers (unchanged — kept for compatibility)
// ================================================================
function getFilteredResults(storeId, monthId) {
  return resultsData.filter(row => {
    const storeMatches = storeId === "" || row.StoreID === Number(storeId);
    const monthMatches = monthId === "" || row.CalendarID === Number(monthId);
    return storeMatches && monthMatches;
  });
}
function formatRiskLabel(value)   { return Number(value) === 1 ? "At Risk" : "Normal"; }
function formatRiskStatus(value)  { return value ? "At Risk" : "Not At Risk"; }
function formatCurrency(value) {
  return `$${Number(value || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}
function getRiskTone(prob, isAtRisk) {
  if (isAtRisk || prob >= 0.75) return "high";
  if (prob >= 0.4) return "medium";
  return "low";
}
function getMode(values, fallback = "No Data") {
  if (!values.length) return fallback;
  const counts = {}; let bestValue = fallback, bestCount = 0;
  values.forEach(v => { const k = String(v); counts[k] = (counts[k]||0)+1; if(counts[k]>bestCount){bestCount=counts[k];bestValue=v;} });
  return bestValue;
}
function average(numbers) {
  if (!numbers.length) return 0;
  return numbers.reduce((s,v) => s + Number(v||0), 0) / numbers.length;
}
function summarizeFilteredRows(filteredRows, storeId, monthId) {
  if (!filteredRows.length) return { storeText:storeId||"All Stores", monthText:monthId?getMonthName(Number(monthId)):"All Months", flagText:"No data", riskText:"No data", riskLabelText:"No data", predictedSalesText:"$0.00", rowsMatched:0, probabilityPercent:0, tone:"low", uniqueStoreCount:0, atRiskCount:0 };
  const isSingleStore = storeId !== "", isSingleMonth = monthId !== "";
  const riskProbabilityAvg = average(filteredRows.map(r => r.risk_probability));
  const predictedSalesAvg  = average(filteredRows.map(r => r.predicted_sales));
  const atRiskCount        = filteredRows.filter(r => r.is_at_risk).length;
  const uniqueStoreCount   = new Set(filteredRows.map(r => r.StoreID)).size;
  const flagMode           = getMode(filteredRows.map(r => r.flags), "No Flag");
  const riskLabelMode      = formatRiskLabel(getMode(filteredRows.map(r => r.risk_label), 0));
  let riskText = "Not At Risk";
  if (atRiskCount > 0) riskText = isSingleStore && isSingleMonth ? formatRiskStatus(filteredRows[0].is_at_risk) : `${atRiskCount} At-Risk Rows`;
  const probabilityPercent = Math.max(0, Math.min(100, riskProbabilityAvg * 100));
  return { storeText:isSingleStore?storeId:`All Stores (${uniqueStoreCount})`, monthText:isSingleMonth?getMonthName(Number(monthId)):"All Months", flagText:flagMode, riskText, riskLabelText:riskLabelMode, predictedSalesText:formatCurrency(predictedSalesAvg), rowsMatched:filteredRows.length, probabilityPercent, tone:getRiskTone(riskProbabilityAvg,atRiskCount>0), uniqueStoreCount, atRiskCount };
}
function renderResultsSummaryCards() {}   // no-op in new layout
function renderRiskInsightPanel()    {}   // no-op in new layout
function runResultsFilter(event)     { if(event) event.preventDefault(); }
// ^ LEGACY results helpers

// ================================================================
// v HELPER — show/hide message and query (unchanged)
// ================================================================
function showMessage(message) { const el = document.getElementById("dashboard_message"); if(el) el.textContent = message; }
function showQuery(query)     { const el = document.getElementById("query_preview");    if(el) el.textContent = "Code Executed:\n" + query.trim(); }
// ^ HELPER

// ================================================================
// v TABLE FUNCTIONS (unchanged)
// ================================================================
function clearTable() { const t = document.getElementById("dashboard"); if(t) t.innerHTML = ""; }
function renderTable(result) {
  const table = document.getElementById("dashboard");
  if (!table) return;
  table.innerHTML = "";
  if (!result || !result.length || !result[0].values.length) return;
  const columns = result[0].columns, values = result[0].values;
  const thead = document.createElement("thead"), headerRow = document.createElement("tr");
  for(let i=0;i<columns.length;i++){const th=document.createElement("th");th.textContent=columns[i];headerRow.appendChild(th);}
  thead.appendChild(headerRow); table.appendChild(thead);
  const tbody = document.createElement("tbody");
  for(let i=0;i<values.length;i++){const tr=document.createElement("tr");for(let j=0;j<values[i].length;j++){const td=document.createElement("td");td.textContent=values[i][j]??"";tr.appendChild(td);}tbody.appendChild(tr);}
  table.appendChild(tbody);
}
// ^ TABLE FUNCTIONS

// ================================================================
// v TOP CHART FUNCTIONS (unchanged)
// ================================================================
function destroyChart() { if(performanceChart){performanceChart.destroy();performanceChart=null;} }
function renderChart(rows, labelText, yAxisLabel) {
  const placeholder = document.getElementById("chart_placeholder");
  if(placeholder) placeholder.style.display = "none";
  const canvas = document.getElementById("performance_chart");
  if(!canvas) return;
  destroyChart();
  const labels=[], values=[];
  for(let i=0;i<rows.length;i++){labels.push(String(rows[i][0]));values.push(Number(rows[i][1]??0));}
  const ctx = canvas.getContext("2d");
  performanceChart = new Chart(ctx, {
    type:"line", data:{labels,datasets:[{label:labelText,data:values,tension:0.2}]},
    options:{responsive:true,maintainAspectRatio:false,animation:{duration:500,easing:"easeOutQuart"},animations:{y:{from:30,duration:500,easing:"easeOutQuart"}},
      scales:{x:{title:{display:true,text:"CalendarID"}},y:{beginAtZero:true,title:{display:true,text:yAxisLabel}}}}
  });
}
// ^ TOP CHART FUNCTIONS

// ================================================================
// v TOP DROPDOWN FILTERS (unchanged)
// ================================================================
function fillSelect(selectId, rows, allLabel, valueIndex, textIndex) {
  const select = document.getElementById(selectId);
  if(!select) return;
  select.innerHTML = "";
  const allOpt = document.createElement("option"); allOpt.value=""; allOpt.textContent=allLabel; select.appendChild(allOpt);
  for(let i=0;i<rows.length;i++){const row=rows[i];const opt=document.createElement("option");opt.value=row[valueIndex];opt.textContent=row[textIndex]!=null?row[textIndex]:row[valueIndex];select.appendChild(opt);}
}
async function populateFilters() {
  try {
    const db = await getDatabase();
    const storeResult   = db.exec(`SELECT StoreID, StoreName FROM Stores WHERE StoreID > 0 AND StoreID NOT IN (
      100004, 100005, 100006, 100010, 100020, 100023, 100026, 100027,
      100030, 100031, 100032, 100033, 100040, 100059, 100070, 100080,
      100101, 100111, 100112, 100113, 100152, 100213, 100261, 100262,
      100264, 100265, 100267, 100299, 100308, 100351, 100381, 100382,
      100397, 100399, 100442, 100602, 100645, 100654, 100656, 100688,
      100691, 100708, 100760, 100804, 100828, 100901, 100913, 100962,
      100985, 101004, 101055, 101056, 101095, 101113, 101114, 101120,
      101167, 101206, 101263, 101294, 101295, 101321, 101360, 101416,
      101487, 101490, 101503, 101517, 101529, 101559, 101574, 101827,
      101862, 101997, 102126, 102199, 102338, 102345, 102390, 102479,
      102481, 102485, 102560, 102574, 102590, 102749, 102788, 102800,
      102812, 102845, 102857, 102862, 102867, 102869, 102870, 102913,
      102941, 102954, 102958, 102975, 102980, 102984, 102986, 103026,
      103053, 103106, 103116, 103118, 103123, 103124, 103127, 103133,
      103169, 103217, 103329, 103345, 103409, 103549, 103753, 103942,
      103957, 103965, 103996, 104022, 104030, 104034, 104077, 104088,
      104105, 104112, 104128, 104178, 104207, 104209, 104220, 104221,
      104223, 104224, 104240, 104255, 104263, 104271, 104300, 104350,
      104351, 104381, 104385, 104395, 104520, 104522, 104699, 104759,
      104787, 104822, 104828, 104829, 104831, 104832, 104833, 104834,
      104836, 104837, 104839, 104945, 104952, 104959, 104960, 104973,
      104985) ORDER BY StoreID`);
    const accountResult = db.exec(`SELECT AccountID, AccountName FROM Accounts WHERE AccountID NOT IN (40,100,280,370,390,400,10080) ORDER BY AccountID`);
    fillSelect("store_select",   storeResult.length   ? storeResult[0].values   : [], "All Stores",        0, 1);
    fillSelect("account_select", accountResult.length ? accountResult[0].values : [], "Select an Account", 0, 1);
  } catch(error) { showMessage(`Failed to load filters: ${error.message}`); }
}
// ^ TOP DROPDOWN FILTERS

// ================================================================
// v TOP SQL QUERIES (unchanged)
// ================================================================
function buildMainDataQuery(storeId, accountId) {
  const whereParts = [];
  if(storeId  !== "") whereParts.push(`StoreID = ${Number(storeId)}`);
  if(accountId !== "") whereParts.push(`AccountID = ${Number(accountId)}`);
  else                 whereParts.push("INVALID!!");
  const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
  return `SELECT CalendarID, ROUND(SUM(Amount), 2) AS TotalAmount FROM FullMainData ${whereClause} GROUP BY CalendarID ORDER BY CalendarID`;
}
function buildChartLabel(storeId, accountId) {
  const parts = ["MainData Amount"];
  parts.push(storeId   ? `Store ${storeId}`           : "All Stores");
  parts.push(accountId ? `Account ${accountId}`        : "Select an Account");
  return parts.join(" · ");
}
// ^ TOP SQL QUERIES

// ================================================================
// v TOP DASHBOARD RUN (unchanged)
// ================================================================
async function runDashboardQuery(event) {
  event.preventDefault();
  clearTable(); showMessage("");
  const storeSelectEl   = document.getElementById("store_select");
  const accountSelectEl = document.getElementById("account_select");
  if(!storeSelectEl || !accountSelectEl){ showMessage("Dashboard form elements are missing."); return; }
  const storeId = storeSelectEl.value, accountId = accountSelectEl.value;
  const query = buildMainDataQuery(storeId, accountId);
  showQuery(query);
  try {
    const db = await getDatabase();
    const result = db.exec(query);
    if(!result.length || !result[0].values.length){ destroyChart(); showMessage("No rows returned for that selection."); return; }
    renderTable(result);
    renderChart(result[0].values, buildChartLabel(storeId, accountId), "Amount $");
  } catch(error) { destroyChart(); showMessage(`Error: ${error.message}`); }
}
// ^ TOP DASHBOARD RUN


// ================================================================
// ================================================================
//   RISK SECTION — NEW IMPLEMENTATION
// ================================================================
// ================================================================

// ----------------------------------------------------------------
// v NEW CSV LOADERS
// ----------------------------------------------------------------
async function loadOwnerRankingsCsv() {
  const response = await fetch("data/owner_rankings.csv");
  if(!response.ok) throw new Error(`Could not load owner_rankings.csv: ${response.status}`);
  const lines = (await response.text()).trim().split(/\r?\n/);
  if(lines.length < 2){ ownerRankingsData = []; return; }
  const headers = parseCsvRow(lines[0]);
  ownerRankingsData = lines.slice(1).map(line => {
    const vals = parseCsvRow(line), row = {};
    headers.forEach((h,i) => { row[h] = vals[i]??""; });
    return { FranchiseeName:row.FranchiseeName.trim(), FranID:String(row.FranID).trim(), StoreCount:Number(row.StoreCount||0), TotalScore:Number(row.TotalScore||0), ScorePct:parseFloat(row.ScorePct||0) };
  }).filter(r => r.FranID && !isNaN(r.ScorePct));
  ownerRankingsData.sort((a,b) => b.ScorePct - a.ScorePct);
  console.log("Loaded owner_rankings.csv:", ownerRankingsData.length, "rows");
}

async function loadOwnerStoreMapCsv() {
  const response = await fetch("data/owner_store_map.csv");
  if(!response.ok) throw new Error(`Could not load owner_store_map.csv: ${response.status}`);
  const lines = (await response.text()).trim().split(/\r?\n/);
  if(lines.length < 2){ ownerStoreMapData = []; return; }
  const headers = parseCsvRow(lines[0]);
  ownerStoreMapData = lines.slice(1).map(line => {
    const vals = parseCsvRow(line), row = {};
    headers.forEach((h,i) => { row[h] = vals[i]??""; });
    return { FranchiseeName:row.FranchiseeName.trim(), FranchiseeID:String(row.FranchiseeID).trim(), StoreID:String(row.StoreID).trim(), StoreName:row.StoreName.trim() };
  }).filter(r => r.FranchiseeID && r.StoreID);
  console.log("Loaded owner_store_map.csv:", ownerStoreMapData.length, "rows");
}

async function loadStoreMonthlyRiskCsv() {
  const response = await fetch("data/store_monthly_risk.csv");
  if(!response.ok) throw new Error(`Could not load store_monthly_risk.csv: ${response.status}`);
  const lines = (await response.text()).trim().split(/\r?\n/);
  if(lines.length < 2){ storeMonthlyRiskData = []; return; }
  const headers = parseCsvRow(lines[0]);
  storeMonthlyRiskData = lines.slice(1).map(line => {
    const vals = parseCsvRow(line), row = {};
    headers.forEach((h,i) => { row[h] = vals[i]??""; });
    return { FranchiseeName:row.FranchiseeName.trim(), FranID:String(row.FranID).trim(), StoreID:String(row.StoreID).trim(), StoreName:row.StoreName.trim(), FiscalYearID:Number(row.FiscalYearID||0), CalendarID:Number(row.CalendarID||0), CheckNames:row.CheckNames.trim(), ScoreSumTotal:Number(row.ScoreSumTotal||0), ScorePct:parseFloat(row.ScorePct||0) };
  }).filter(r => r.StoreID);
  console.log("Loaded store_monthly_risk.csv:", storeMonthlyRiskData.length, "rows");
}
// ^ NEW CSV LOADERS

// ----------------------------------------------------------------
// v SHARED HELPERS
// ----------------------------------------------------------------

/** Classify ScorePct into a risk tier. Thresholds calibrated to dataset max ~22.6%. */
function classifyRisk(scorePct) {
  if(scorePct >= 0.15) return { label:"Critical",  tone:"high"   };
  if(scorePct >= 0.10) return { label:"Elevated",  tone:"medium" };
  if(scorePct >= 0.07) return { label:"Moderate",  tone:"low"    };
  return                      { label:"Low Risk",  tone:"low"    };
}

/** Split a semicolon-delimited CheckNames string into individual flags. */
function parseFlags(checkNames) {
  if(!checkNames || !checkNames.trim()) return [];
  return checkNames.split(";").map(f => f.trim()).filter(f => f);
}

/** Count individual flag occurrences across an array of monthly rows. */
function getFlagCounts(rows) {
  const counts = {};
  rows.forEach(r => parseFlags(r.CheckNames).forEach(f => { counts[f] = (counts[f]||0)+1; }));
  return counts;
}

/** Return the single most-frequent non-no_data flag. */
function getTopFlag(rows) {
  const counts = getFlagCounts(rows);
  let topFlag = "No Flag", topCount = 0;
  Object.entries(counts).forEach(([f,c]) => { if(f !== "no_data" && c > topCount){ topFlag=f; topCount=c; } });
  return topFlag;
}

/** Count high-risk stores (Elevated or Critical) for an owner. */
function computeHighRiskStores(ownerStores, ownerStoreRows) {
  return ownerStores.filter(store => {
    const rows = ownerStoreRows.filter(r => r.StoreID === store.StoreID);
    if(!rows.length) return false;
    const avg = rows.reduce((s,r) => s + r.ScorePct, 0) / rows.length;
    return avg >= 0.10;
  }).length;
}

/** Scale a ScorePct to 0-100 for a bar width, using the top owner as ceiling. */
function scaleToBar(scorePct) {
  const maxPct = ownerRankingsData.length ? ownerRankingsData[0].ScorePct : 0.25;
  return Math.min(100, (scorePct / maxPct) * 100);
}

/** Build a span with a CSS tooltip for a flag name. */
/** Build a span for a flag name with glossary tooltip. */
function flagWithTooltip(flag) {
  const definition  = FLAG_GLOSSARY[flag] || "";
  const isActive    = activeFlagFilter === flag;
  const activeClass = isActive ? " flag-active" : "";
  if(!definition) return `<span class="flag-name-plain${activeClass}">${flag}</span>`;
  return `<span class="flag-name-plain has-tooltip${activeClass}" data-tooltip="${definition}">${flag} <span class="flag-q">?</span></span>`;
}
// ^ SHARED HELPERS

// ----------------------------------------------------------------
// v [2] RISK TRAJECTORY
// ----------------------------------------------------------------

/**
 * Compare a store's early-year (months 1-3) vs late-year (months 10-12) avg ScorePct.
 * Returns { arrow, label, tone }.
 */
function computeTrajectory(storeRows) {
  const early = storeRows.filter(r => r.CalendarID <= 3).map(r => r.ScorePct);
  const late  = storeRows.filter(r => r.CalendarID >= 10).map(r => r.ScorePct);
  if(!early.length || !late.length) return { arrow:"—", label:"Insufficient data", tone:"neutral" };
  const avgEarly = early.reduce((s,v) => s+v, 0) / early.length;
  const avgLate  = late.reduce((s,v)  => s+v, 0) / late.length;
  const delta    = avgLate - avgEarly;
  if(delta >  0.01) return { arrow:"↑", label:"Worsening",  tone:"high"   };
  if(delta < -0.01) return { arrow:"↓", label:"Improving",  tone:"low"    };
  return               { arrow:"→", label:"Stable",      tone:"medium" };
}

/** Aggregate trajectory across all stores for an owner. */
function getOwnerTrajectory(ownerStoreRows) {
  return computeTrajectory(ownerStoreRows);
}
// ^ [2] RISK TRAJECTORY

// ----------------------------------------------------------------
// v FLAG FILTER — click any flag anywhere to filter the leaderboard
// ----------------------------------------------------------------

/** Returns true if the owner has at least one row containing this flag. */
function ownerHasFlag(franID, flag) {
  return storeMonthlyRiskData.some(r =>
    r.FranID === franID && parseFlags(r.CheckNames).includes(flag)
  );
}

/** Populate the flag filter dropdown.
 *  Uses FLAG_GLOSSARY keys immediately (no CSV needed),
 *  then merges with live counts from storeMonthlyRiskData if available. */
function populateFlagFilterDropdown() {
  const select = document.getElementById("flag_filter_select");
  if(!select) return;

  // Count flags from loaded data (may be empty on first call)
  const counts = {};
  storeMonthlyRiskData.forEach(r => {
    parseFlags(r.CheckNames).forEach(f => {
      if(f !== "no_data") counts[f] = (counts[f] || 0) + 1;
    });
  });

  // Known flags from glossary (always available)
  const glossaryFlags = Object.keys(FLAG_GLOSSARY).filter(f => f !== "no_data");

  // Merge glossary + any extra flags found in data, sort by count desc
  const allFlags = [...new Set([
    ...Object.keys(counts).filter(f => f !== "no_data"),
    ...glossaryFlags
  ])].sort((a, b) => (counts[b] || 0) - (counts[a] || 0));

  select.innerHTML = `<option value="">All Flags</option>` +
    allFlags.map(flag => {
      const c = counts[flag];
      return `<option value="${flag}">${flag}${c ? ` (${c.toLocaleString()})` : ""}</option>`;
    }).join("");

  console.log("Flag dropdown ready —", allFlags.length, "flags");
}

/** Set the active flag filter and refresh the leaderboard. */
function filterByFlag(flag) {
  activeFlagFilter = flag || null;
  leaderboardPage  = 0;
  updateFlagFilterBar();
  renderLeaderboard(leaderboardCount);
  // Refresh flag breakdown highlights if owner panel is open
  if(activeOwnerID) {
    const ownerStores    = ownerStoreMapData.filter(s => s.FranchiseeID === activeOwnerID);
    const ownerStoreIDs  = new Set(ownerStores.map(s => s.StoreID));
    const ownerStoreRows = storeMonthlyRiskData.filter(r => ownerStoreIDs.has(r.StoreID));
    renderFlagBreakdown(ownerStoreRows);
  }
}

/** Clear the active flag filter and reset the dropdown. */
function clearFlagFilter() {
  activeFlagFilter = null;
  leaderboardPage  = 0;
  const select = document.getElementById("flag_filter_select");
  if(select) select.value = "";
  updateFlagFilterBar();
  renderLeaderboard(leaderboardCount);
  if(activeOwnerID) {
    const ownerStores    = ownerStoreMapData.filter(s => s.FranchiseeID === activeOwnerID);
    const ownerStoreIDs  = new Set(ownerStores.map(s => s.StoreID));
    const ownerStoreRows = storeMonthlyRiskData.filter(r => ownerStoreIDs.has(r.StoreID));
    renderFlagBreakdown(ownerStoreRows);
  }
}

/** Show or hide the flag filter indicator bar above the leaderboard. */
function updateFlagFilterBar() {
  const bar        = document.getElementById("flag_filter_bar");
  const flagNameEl = document.getElementById("ffb_flag_name");
  const countEl    = document.getElementById("ffb_match_count");

  if(!bar) return;

  if(!activeFlagFilter) {
    bar.style.display = "none";
    return;
  }

  // Count how many owners match
  const matchCount = ownerRankingsData.filter(o => ownerHasFlag(o.FranID, activeFlagFilter)).length;

  bar.style.display       = "flex";
  if(flagNameEl) flagNameEl.textContent = activeFlagFilter;
  if(countEl)    countEl.textContent    = `${matchCount} owner${matchCount !== 1 ? "s" : ""} affected`;
}
// ^ FLAG FILTER

// ----------------------------------------------------------------
// v [1] SYSTEM-WIDE SUMMARY BAR
// ----------------------------------------------------------------
function renderSystemSummary() {
  const container = document.getElementById("system_summary_bar");
  if(!container) return;

  const totalOwners   = ownerRankingsData.length;
  const totalStores   = new Set(ownerStoreMapData.map(s => s.StoreID)).size;
  const criticalOwners = ownerRankingsData.filter(o => o.ScorePct >= 0.15).length;
  const networkAvg    = ownerRankingsData.length
    ? ownerRankingsData.reduce((s,o) => s + o.ScorePct, 0) / ownerRankingsData.length
    : 0;

  // Most common individual flag network-wide
  const allFlagCounts = getFlagCounts(storeMonthlyRiskData);
  const topNetworkFlag = Object.entries(allFlagCounts)
    .filter(([f]) => f !== "no_data")
    .sort(([,a],[,b]) => b - a)[0];
  const topFlagLabel = topNetworkFlag ? topNetworkFlag[0] : "—";

  const topOwner  = ownerRankingsData[0];
  const riskClass = classifyRisk(networkAvg);

  container.innerHTML = `
    <div class="ssb-card">
      <strong>Total Owners</strong>
      <span>${totalOwners.toLocaleString()}</span>
    </div>
    <div class="ssb-card">
      <strong>Total Stores</strong>
      <span>${totalStores.toLocaleString()}</span>
    </div>
    <div class="ssb-card ssb-card-alert">
      <strong>Critical Owners</strong>
      <span>${criticalOwners} <em>≥15% risk</em></span>
    </div>
    <div class="ssb-card">
      <strong>Network Avg Risk</strong>
      <span>${(networkAvg * 100).toFixed(2)}%
        <span class="risk-badge risk-tone-${riskClass.tone}" style="margin-left:6px;">${riskClass.label}</span>
      </span>
    </div>
    <div class="ssb-card">
      <strong>Top Flag (Network)</strong>
      <span>${topFlagLabel}</span>
    </div>
    <div class="ssb-card ssb-card-highlight" onclick="selectOwner('${topOwner?.FranID}')" style="cursor:pointer;" title="Click to inspect this owner">
      <strong>Highest-Risk Owner</strong>
      <span>${topOwner ? topOwner.FranchiseeName : "—"}
        <em>${topOwner ? (topOwner.ScorePct*100).toFixed(2)+"%" : ""}</em>
      </span>
    </div>
  `;
}
// ^ [1] SYSTEM-WIDE SUMMARY BAR

// ----------------------------------------------------------------
// v [2+8] LEADERBOARD — with trajectory + search filter
// ----------------------------------------------------------------
function renderLeaderboard(count) {
  const container  = document.getElementById("risk_leaderboard");
  if(!container) return;
  if(!ownerRankingsData.length){ container.innerHTML = `<p class="leaderboard-loading">No owner data available.</p>`; return; }

  const searchEl   = document.getElementById("lb_search");
  const searchTerm = searchEl ? searchEl.value.trim().toLowerCase() : "";

  // Apply search filter
  let filtered = ownerRankingsData.filter(o =>
    !searchTerm || o.FranchiseeName.toLowerCase().includes(searchTerm) || o.FranID.includes(searchTerm)
  );

  // Apply flag filter
  if(activeFlagFilter) {
    filtered = filtered.filter(o => ownerHasFlag(o.FranID, activeFlagFilter));
  }

  // Clamp page so it never exceeds available data
  const totalPages = Math.max(1, Math.ceil(filtered.length / count));
  if(leaderboardPage >= totalPages) leaderboardPage = totalPages - 1;

  // Slice the current page
  const startIdx  = leaderboardPage * count;
  const pageItems = filtered.slice(startIdx, startIdx + count);

  if(!pageItems.length){
    container.innerHTML = `<p class="leaderboard-loading">No owners match "<strong>${searchTerm}</strong>".</p>`;
    renderPagination(0, 0, count, 0);
    return;
  }

  const rows = pageItems.map((owner, i) => {
    const globalRank   = startIdx + i + 1;          // true rank across all pages
    const storeRows    = storeMonthlyRiskData.filter(r => r.FranID === owner.FranID);
    const topFlag      = getTopFlag(storeRows);
    const pct          = (owner.ScorePct * 100).toFixed(2);
    const risk         = classifyRisk(owner.ScorePct);
    const barWidth     = scaleToBar(owner.ScorePct).toFixed(1);
    const trajectory   = getOwnerTrajectory(storeRows);

    const rankClass = globalRank === 1 ? "lb-rank-gold"
                    : globalRank === 2 ? "lb-rank-silver"
                    : globalRank === 3 ? "lb-rank-bronze" : "";

    return `
      <div class="leaderboard-row" onclick="selectOwner('${owner.FranID}')">
        <div class="lb-rank ${rankClass}">${globalRank}</div>
        <div class="lb-name">
          <span class="lb-owner-name">${owner.FranchiseeName}</span>
          <span class="lb-owner-id">ID: ${owner.FranID}</span>
        </div>
        <div class="lb-stores">${owner.StoreCount} store${owner.StoreCount !== 1 ? "s" : ""}</div>
        <div class="lb-bar-wrap">
          <div class="lb-bar-track">
            <div class="lb-bar-fill risk-tone-${risk.tone}" style="width:${barWidth}%"></div>
          </div>
          <span class="lb-pct">${pct}%</span>
        </div>
        <div class="lb-trajectory has-tooltip" data-tooltip="Trend: ${trajectory.label} (early-year vs late-year avg)">
          <span class="traj-arrow traj-${trajectory.tone}">${trajectory.arrow}</span>
          <span class="traj-label">${trajectory.label}</span>
        </div>
        <div class="lb-flag">
          <span class="lb-flag-tag ${activeFlagFilter === topFlag ? "flag-active" : ""}">
            ${topFlag}
          </span>
        </div>
        <div class="lb-badge">
          <span class="risk-badge risk-tone-${risk.tone}">${risk.label}</span>
        </div>
        <button class="lb-inspect-btn" onclick="event.stopPropagation(); selectOwner('${owner.FranID}')">
          Inspect →
        </button>
      </div>
    `;
  });

  container.innerHTML = rows.join("");
  renderPagination(leaderboardPage, totalPages, count, filtered.length);
}

function renderPagination(page, totalPages, count, totalFiltered) {
  const container = document.getElementById("lb_pagination");
  if(!container) return;

  if(totalPages <= 1){ container.innerHTML = ""; return; }

  const start = page * count + 1;
  const end   = Math.min((page + 1) * count, totalFiltered);

  container.innerHTML = `
    <button class="lb-page-btn" onclick="goPrevPage()" ${page === 0 ? "disabled" : ""}>← Prev</button>
    <span class="lb-page-info">Showing <strong>${start}–${end}</strong> of ${totalFiltered}</span>
    <button class="lb-page-btn" onclick="goNextPage()" ${page >= totalPages - 1 ? "disabled" : ""}>Next →</button>
  `;
}

function goPrevPage() {
  if(leaderboardPage > 0){ leaderboardPage--; renderLeaderboard(leaderboardCount); }
}

function goNextPage() {
  leaderboardPage++;
  renderLeaderboard(leaderboardCount);
}
// ^ [2+8] LEADERBOARD

// ----------------------------------------------------------------
// v [3] OWNER INTELLIGENCE PANEL
// ----------------------------------------------------------------
function selectOwner(franID) {
  activeOwnerID = String(franID);
  activeStoreID = null;

  const sdp = document.getElementById("store_drilldown_panel");
  if(sdp) sdp.style.display = "none";

  const owner          = ownerRankingsData.find(o => o.FranID === activeOwnerID);
  if(!owner) return;

  const ownerStores    = ownerStoreMapData.filter(s => s.FranchiseeID === activeOwnerID);
  const ownerStoreIDs  = new Set(ownerStores.map(s => s.StoreID));
  const ownerStoreRows = storeMonthlyRiskData.filter(r => ownerStoreIDs.has(r.StoreID));

  renderOwnerPanel(owner, ownerStores, ownerStoreRows);

  const panel = document.getElementById("owner_intelligence_panel");
  if(panel){
    panel.style.display = "grid";
    panel.scrollIntoView({ behavior:"smooth", block:"start" });
  }
}

function renderOwnerPanel(owner, ownerStores, ownerStoreRows) {
  // Name badge
  const nameBadge = document.getElementById("oip_name_badge");
  if(nameBadge) nameBadge.textContent = owner.FranchiseeName;

  // Classification badge
  const risk       = classifyRisk(owner.ScorePct);
  const classBadge = document.getElementById("oip_class_badge");
  if(classBadge){ classBadge.textContent = risk.label + " Risk"; classBadge.className = `oip-class-badge risk-tone-${risk.tone}`; }

  // [2] Trajectory badge
  const trajectory    = getOwnerTrajectory(ownerStoreRows);
  const trajBadge     = document.getElementById("oip_trajectory_badge");
  if(trajBadge){
    trajBadge.textContent = `${trajectory.arrow} ${trajectory.label}`;
    trajBadge.className   = `oip-trajectory-badge traj-badge-${trajectory.tone}`;
    trajBadge.title       = "Compares owner's average risk in months 1–3 vs months 10–12";
  }

  // Stat cards
  const highRiskCount = computeHighRiskStores(ownerStores, ownerStoreRows);
  const networkRank   = ownerRankingsData.findIndex(o => o.FranID === owner.FranID) + 1;
  const statCards     = document.getElementById("oip_stat_cards");
  if(statCards){
    statCards.innerHTML = `
      <div class="oip-stat-card">
        <strong>Total Stores</strong><span>${owner.StoreCount}</span>
      </div>
      <div class="oip-stat-card oip-stat-card-alert">
        <strong>High-Risk Stores</strong><span>${highRiskCount}</span>
      </div>
      <div class="oip-stat-card">
        <strong>Network Rank</strong><span>#${networkRank}</span>
      </div>
      <div class="oip-stat-card">
        <strong>Owner ID</strong><span>${owner.FranID}</span>
      </div>
    `;
  }

  // Risk progress bar
  const pctLabel = document.getElementById("oip_risk_pct_label");
  const riskFill = document.getElementById("oip_risk_fill");
  if(pctLabel) pctLabel.textContent = (owner.ScorePct * 100).toFixed(2) + "%";
  if(riskFill){ riskFill.style.width = scaleToBar(owner.ScorePct).toFixed(1) + "%"; riskFill.className = `risk-progress-fill risk-tone-${risk.tone}`; }

  // [3] Flag frequency with glossary tooltips
  renderFlagBreakdown(ownerStoreRows);

  // [5] Store cards with outlier + trajectory badges
  renderOwnerStoreCards(ownerStores, ownerStoreRows);
}

// ----------------------------------------------------------------
// v [3] FLAG BREAKDOWN — with glossary tooltips
// ----------------------------------------------------------------
function renderFlagBreakdown(storeRows) {
  const container = document.getElementById("oip_flag_breakdown");
  if(!container) return;

  const counts = getFlagCounts(storeRows);
  const sorted = Object.entries(counts).filter(([f]) => f !== "no_data").sort(([,a],[,b]) => b - a).slice(0, 8);

  if(!sorted.length){ container.innerHTML = `<p class="flag-empty">No risk flags recorded for this owner.</p>`; return; }

  const maxCount = sorted[0][1];
  container.innerHTML = sorted.map(([flag, count]) => {
    const barWidth  = ((count / maxCount) * 100).toFixed(1);
    const isActive  = activeFlagFilter === flag;
    return `
      <div class="flag-bar-row ${isActive ? "flag-bar-row-active" : ""}">
        ${flagWithTooltip(flag)}
        <div class="flag-bar-track"><div class="flag-bar-fill ${isActive ? "flag-bar-fill-active" : ""}" style="width:${barWidth}%"></div></div>
        <span class="flag-bar-count">${count}</span>
      </div>
    `;
  }).join("");
}
// ^ [3] FLAG BREAKDOWN

// ----------------------------------------------------------------
// v [4] CO-OCCURRENCE PANEL
// ----------------------------------------------------------------
function renderCooccurrencePanel(storeRows) {
  const container = document.getElementById("oip_cooccurrence");
  if(!container) return;

  const pairCounts  = {};
  const flagTotals  = {};

  storeRows.forEach(row => {
    const flags = parseFlags(row.CheckNames).filter(f => f !== "no_data");
    flags.forEach(f => { flagTotals[f] = (flagTotals[f]||0) + 1; });
    for(let i = 0; i < flags.length; i++){
      for(let j = i + 1; j < flags.length; j++){
        const pair = [flags[i], flags[j]].sort().join(" + ");
        pairCounts[pair] = (pairCounts[pair]||0) + 1;
      }
    }
  });

  const topPairs = Object.entries(pairCounts)
    .sort(([,a],[,b]) => b - a)
    .slice(0, 5);

  if(!topPairs.length){ container.innerHTML = `<p class="flag-empty">Not enough data for co-occurrence analysis.</p>`; return; }

  container.innerHTML = topPairs.map(([pair, count]) => {
    const [f1, f2] = pair.split(" + ");
    const pct      = flagTotals[f1] ? Math.round((count / flagTotals[f1]) * 100) : 0;
    return `
      <div class="cooc-row">
        <div class="cooc-flags">
          ${flagWithTooltip(f1)}
          <span class="cooc-plus">+</span>
          ${flagWithTooltip(f2)}
        </div>
        <div class="cooc-meta">
          <span class="cooc-count">${count}×</span>
          <span class="cooc-pct">${pct}% co-occurrence</span>
        </div>
      </div>
    `;
  }).join("");
}
// ^ [4] CO-OCCURRENCE PANEL

// ----------------------------------------------------------------
// v [5] STORE CARDS — with outlier badge + trajectory + compare button
// ----------------------------------------------------------------
function renderOwnerStoreCards(ownerStores, ownerStoreRows) {
  const container = document.getElementById("oip_store_cards");
  if(!container) return;
  if(!ownerStores.length){ container.innerHTML = `<p class="store-cards-empty">No stores found for this owner.</p>`; return; }

  // Compute per-store stats and sort by avg risk desc
  const storeStats = ownerStores.map(store => {
    const rows   = ownerStoreRows.filter(r => r.StoreID === store.StoreID);
    const avgPct = rows.length ? rows.reduce((s,r) => s + r.ScorePct, 0) / rows.length : 0;
    const topFlag = getTopFlag(rows);
    const risk    = classifyRisk(avgPct);
    const traj    = computeTrajectory(rows);
    return { ...store, avgPct, topFlag, risk, traj, rows };
  }).sort((a,b) => b.avgPct - a.avgPct);

  // [5] Owner average for outlier detection
  const ownerAvg = storeStats.length
    ? storeStats.reduce((s,st) => s + st.avgPct, 0) / storeStats.length : 0;

  // Outlier = more than 1.5× the owner's own average
  const outlierNote = document.getElementById("oip_outlier_note");
  const outlierCount = storeStats.filter(s => s.avgPct >= ownerAvg * 1.5 && s.avgPct > 0).length;
  if(outlierNote) outlierNote.textContent = outlierCount
    ? `${outlierCount} outlier store${outlierCount>1?"s":""} detected`
    : "";

  container.innerHTML = storeStats.map(store => {
    const pct      = (store.avgPct * 100).toFixed(2);
    const isActive = store.StoreID === activeStoreID;
    const isComp   = comparisonStores.includes(store.StoreID);
    const isOutlier = store.avgPct >= ownerAvg * 1.5 && store.avgPct > 0;

    return `
      <div class="oip-store-card ${isActive ? "active" : ""}" onclick="selectStore('${store.StoreID}')">
        <div class="store-card-top-row">
          <span class="store-card-name">${store.StoreName || "Store " + store.StoreID}</span>
          <button class="store-compare-btn ${isComp ? "active-comp" : ""}"
            onclick="event.stopPropagation(); addToComparison('${store.StoreID}')"
            title="Add to comparison">
            ${isComp ? "✓" : "⊕"}
          </button>
        </div>
        <div class="store-card-meta">
          <span class="store-card-pct">Avg Risk: ${pct}%</span>
          <span class="risk-badge risk-tone-${store.risk.tone}">${store.risk.label}</span>
          ${isOutlier ? `<span class="outlier-badge has-tooltip" data-tooltip="This store's risk is 1.5× above the owner's average — investigate first">⚠ Outlier</span>` : ""}
        </div>
        <div class="store-card-bottom-row">
          <span class="store-card-flag">${store.topFlag}</span>
          <span class="traj-arrow traj-${store.traj.tone} has-tooltip" data-tooltip="Trend: ${store.traj.label}">${store.traj.arrow} ${store.traj.label}</span>
        </div>
      </div>
    `;
  }).join("");
}
// ^ [5] STORE CARDS

// ----------------------------------------------------------------
// v STORE DRILLDOWN
// ----------------------------------------------------------------
function selectStore(storeID) {
  activeStoreID = String(storeID);

  // Refresh store cards to update active highlight
  if(activeOwnerID){
    const ownerStores    = ownerStoreMapData.filter(s => s.FranchiseeID === activeOwnerID);
    const ownerStoreIDs  = new Set(ownerStores.map(s => s.StoreID));
    const ownerStoreRows = storeMonthlyRiskData.filter(r => ownerStoreIDs.has(r.StoreID));
    renderOwnerStoreCards(ownerStores, ownerStoreRows);
  }

  renderStoreDrilldown(storeID, "");

  const sdp = document.getElementById("store_drilldown_panel");
  if(sdp){ sdp.style.display = "block"; sdp.scrollIntoView({ behavior:"smooth", block:"start" }); }
}

function renderStoreDrilldown(storeID, monthID) {
  const storeRows = storeMonthlyRiskData.filter(r => r.StoreID === String(storeID));
  const storeInfo = ownerStoreMapData.find(s => s.StoreID === String(storeID));
  const storeName = storeInfo ? storeInfo.StoreName : `Store ${storeID}`;

  const titleEl = document.getElementById("sdp_store_title");
  if(titleEl) titleEl.textContent = storeName;

  // Populate month dropdown
  const monthSelect = document.getElementById("sdp_month_select");
  if(monthSelect){
    const months = [...new Set(storeRows.map(r => r.CalendarID))].sort((a,b) => a - b);
    monthSelect.innerHTML = `<option value="">All Months</option>` +
      months.map(m => `<option value="${m}" ${String(m)===String(monthID)?"selected":""}>${getMonthName(m)}</option>`).join("");
  }

  const filtered = monthID ? storeRows.filter(r => String(r.CalendarID) === String(monthID)) : storeRows;

  const avgPct   = filtered.length ? filtered.reduce((s,r) => s + r.ScorePct, 0) / filtered.length : 0;
  const topFlag  = getTopFlag(filtered);
  const risk     = classifyRisk(avgPct);
  const traj     = computeTrajectory(storeRows);
  const worstRow = filtered.reduce((best,r) => (!best || r.ScorePct > best.ScorePct) ? r : best, null);
  const worstMonth = worstRow ? getMonthName(worstRow.CalendarID) : "—";

  const summaryCards = document.getElementById("sdp_summary_cards");
  if(summaryCards){
    summaryCards.innerHTML = `
      <div class="sdp-stat-card"><strong>Store</strong><span>${storeName}</span></div>
      <div class="sdp-stat-card"><strong>Period</strong><span>${monthID ? getMonthName(Number(monthID)) : "Full Year"}</span></div>
      <div class="sdp-stat-card"><strong>Risk Level</strong><span><span class="risk-badge risk-tone-${risk.tone}">${risk.label}</span></span></div>
      <div class="sdp-stat-card"><strong>Avg Risk %</strong><span>${(avgPct*100).toFixed(2)}%</span></div>
      <div class="sdp-stat-card"><strong>Worst Month</strong><span>${worstMonth}</span></div>
      <div class="sdp-stat-card"><strong>Trend</strong><span class="traj-arrow traj-${traj.tone}">${traj.arrow} ${traj.label}</span></div>
      <div class="sdp-stat-card"><strong>Top Flag</strong><span>${topFlag}</span></div>
    `;
  }

  renderMonthlyBars(storeRows);
  renderFlagLog(filtered);
}

function renderMonthlyBars(storeRows) {
  const container = document.getElementById("sdp_monthly_bars");
  if(!container) return;
  const byMonth = {};
  storeRows.forEach(r => { if(!byMonth[r.CalendarID]) byMonth[r.CalendarID]=[]; byMonth[r.CalendarID].push(r.ScorePct); });
  const allPcts = Object.values(byMonth).flat();
  const maxPct  = allPcts.length ? Math.max(...allPcts) : 0.01;
  container.innerHTML = Array.from({length:12},(_,i)=>i+1).map(m => {
    const pcts    = byMonth[m];
    const hasData = pcts && pcts.length > 0;
    const avg     = hasData ? pcts.reduce((s,v) => s+v, 0) / pcts.length : null;
    const barH    = hasData ? ((avg / maxPct) * 100).toFixed(1) : "0";
    const risk    = hasData ? classifyRisk(avg) : { tone:"low" };
    const label   = hasData ? (avg * 100).toFixed(1) + "%" : "—";
    return `
      <div class="monthly-bar-col">
        <div class="monthly-bar-value">${label}</div>
        <div class="monthly-bar-track"><div class="monthly-bar-fill risk-tone-${risk.tone}" style="height:${barH}%"></div></div>
        <div class="monthly-bar-label">${getMonthName(m).slice(0,3)}</div>
      </div>
    `;
  }).join("");
}

function renderFlagLog(storeRows) {
  const container = document.getElementById("sdp_flag_log");
  if(!container) return;
  const byMonth = {};
  storeRows.forEach(r => { if(!byMonth[r.CalendarID]) byMonth[r.CalendarID]=[]; byMonth[r.CalendarID].push(r); });
  const months = Object.keys(byMonth).map(Number).sort((a,b) => a-b);
  if(!months.length){ container.innerHTML = `<p class="flag-empty">No data for this selection.</p>`; return; }
  container.innerHTML = `
    <table class="flag-log-table">
      <thead><tr><th>Month</th><th>Risk %</th><th>Flags</th></tr></thead>
      <tbody>
        ${months.map(m => {
          const monthRows = byMonth[m];
          const avgPct    = monthRows.reduce((s,r) => s + r.ScorePct, 0) / monthRows.length;
          const flags     = [...new Set(monthRows.flatMap(r => parseFlags(r.CheckNames)))].filter(f => f !== "no_data");
          const risk      = classifyRisk(avgPct);
          return `<tr>
            <td>${getMonthName(m)}</td>
            <td><span class="risk-badge risk-tone-${risk.tone}" style="font-size:.75rem">${(avgPct*100).toFixed(1)}%</span></td>
            <td class="flag-log-flags">${flags.join(", ") || "no_data"}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
}
// ^ STORE DRILLDOWN

// ----------------------------------------------------------------
// v [7] STORE COMPARISON
// ----------------------------------------------------------------
function addToComparison(storeID) {
  storeID = String(storeID);
  const idx = comparisonStores.indexOf(storeID);

  if(idx !== -1){
    // Toggle off if already selected
    comparisonStores.splice(idx, 1);
  } else if(comparisonStores.length < 2){
    comparisonStores.push(storeID);
  } else {
    // Replace oldest
    comparisonStores[0] = storeID;
  }

  // Refresh store cards
  if(activeOwnerID){
    const ownerStores    = ownerStoreMapData.filter(s => s.FranchiseeID === activeOwnerID);
    const ownerStoreIDs  = new Set(ownerStores.map(s => s.StoreID));
    const ownerStoreRows = storeMonthlyRiskData.filter(r => ownerStoreIDs.has(r.StoreID));
    renderOwnerStoreCards(ownerStores, ownerStoreRows);
  }

  // Show/hide + render comparison panel
  const panel = document.getElementById("store_comparison_panel");
  if(!panel) return;
  if(!comparisonStores.length){ panel.style.display = "none"; return; }
  panel.style.display = "block";
  renderComparisonPanel();
  if(comparisonStores.length === 1) panel.scrollIntoView({ behavior:"smooth", block:"start" });
}

function renderComparisonPanel() {
  const container = document.getElementById("scp_content");
  if(!container) return;

  // Render one or two columns
  const cols = comparisonStores.map(storeID => {
    const storeRows = storeMonthlyRiskData.filter(r => r.StoreID === storeID);
    const storeInfo = ownerStoreMapData.find(s => s.StoreID === storeID);
    const storeName = storeInfo ? storeInfo.StoreName : `Store ${storeID}`;
    const avgPct    = storeRows.length ? storeRows.reduce((s,r) => s + r.ScorePct, 0) / storeRows.length : 0;
    const risk      = classifyRisk(avgPct);
    const traj      = computeTrajectory(storeRows);
    const topFlag   = getTopFlag(storeRows);
    const flagCounts = getFlagCounts(storeRows);
    const topFlags   = Object.entries(flagCounts).filter(([f]) => f !== "no_data").sort(([,a],[,b]) => b-a).slice(0,4);

    // Mini monthly bars HTML
    const byMonth = {};
    storeRows.forEach(r => { if(!byMonth[r.CalendarID]) byMonth[r.CalendarID]=[]; byMonth[r.CalendarID].push(r.ScorePct); });
    const allPcts = Object.values(byMonth).flat();
    const maxPct  = allPcts.length ? Math.max(...allPcts) : 0.01;
    const miniBars = Array.from({length:12},(_,i)=>i+1).map(m => {
      const pcts  = byMonth[m], hasData = pcts && pcts.length > 0;
      const avg   = hasData ? pcts.reduce((s,v) => s+v,0)/pcts.length : null;
      const barH  = hasData ? ((avg/maxPct)*100).toFixed(1) : "0";
      const tone  = hasData ? classifyRisk(avg).tone : "low";
      return `<div class="monthly-bar-col">
        <div class="monthly-bar-track" style="height:80px"><div class="monthly-bar-fill risk-tone-${tone}" style="height:${barH}%"></div></div>
        <div class="monthly-bar-label">${getMonthName(m).slice(0,1)}</div>
      </div>`;
    }).join("");

    return `
      <div class="scp-col">
        <div class="scp-col-header">
          <span class="scp-store-name">${storeName}</span>
          <span class="risk-badge risk-tone-${risk.tone}">${risk.label}</span>
        </div>
        <div class="scp-stat-grid">
          <div class="scp-stat"><strong>Avg Risk</strong><span>${(avgPct*100).toFixed(2)}%</span></div>
          <div class="scp-stat"><strong>Trend</strong><span class="traj-arrow traj-${traj.tone}">${traj.arrow} ${traj.label}</span></div>
          <div class="scp-stat"><strong>Top Flag</strong><span>${topFlag}</span></div>
        </div>
        <div class="scp-mini-bars">${miniBars}</div>
        <div class="scp-top-flags">
          <strong>Most Common Flags</strong>
          ${topFlags.map(([f,c]) => `<div class="scp-flag-row"><span class="scp-flag-name">${f}</span><span class="scp-flag-c">${c}×</span></div>`).join("")}
        </div>
      </div>
    `;
  });

  // If only one store selected, show placeholder for second slot
  if(cols.length === 1){
    cols.push(`
      <div class="scp-col scp-col-empty">
        <p>Select a second store using the ⊕ button on any store card</p>
      </div>
    `);
  }

  container.innerHTML = `<div class="scp-cols">${cols.join("")}</div>`;
}

function clearComparison() {
  comparisonStores = [];
  const panel = document.getElementById("store_comparison_panel");
  if(panel) panel.style.display = "none";

  // Refresh store cards to remove compare button highlights
  if(activeOwnerID){
    const ownerStores    = ownerStoreMapData.filter(s => s.FranchiseeID === activeOwnerID);
    const ownerStoreIDs  = new Set(ownerStores.map(s => s.StoreID));
    const ownerStoreRows = storeMonthlyRiskData.filter(r => ownerStoreIDs.has(r.StoreID));
    renderOwnerStoreCards(ownerStores, ownerStoreRows);
  }
}
// ^ [7] STORE COMPARISON

// ----------------------------------------------------------------
// v [6] NETWORK FLAG HEATMAP
// ----------------------------------------------------------------
function renderNetworkHeatmap() {
  const container = document.getElementById("network_heatmap");
  if(!container) return;

  // Top 12 individual flags by total count
  const flagCounts = {};
  storeMonthlyRiskData.forEach(r => {
    parseFlags(r.CheckNames).forEach(f => {
      if(f !== "no_data") flagCounts[f] = (flagCounts[f]||0) + 1;
    });
  });

  const top12 = Object.entries(flagCounts)
    .sort(([,a],[,b]) => b - a)
    .slice(0, 12)
    .map(([f]) => f);

  // Build flag × month matrix
  const matrix = {};
  top12.forEach(flag => {
    matrix[flag] = {};
    for(let m=1;m<=12;m++) matrix[flag][m] = 0;
  });

  storeMonthlyRiskData.forEach(r => {
    parseFlags(r.CheckNames).forEach(f => {
      if(matrix[f]) matrix[f][r.CalendarID]++;
    });
  });

  // Render table — intensity is per-row (relative to each flag's own max)
  const monthHeaders = Array.from({length:12},(_,i)=>i+1)
    .map(m => `<th>${getMonthName(m).slice(0,3)}</th>`).join("");

  const tableRows = top12.map(flag => {
    const rowCounts = Array.from({length:12},(_,i) => matrix[flag][i+1] || 0);
    const rowMax    = Math.max(...rowCounts, 1);
    const cells     = rowCounts.map((count, i) => {
      const intensity = count / rowMax;                 // 0-1 per-row scale
      const alpha     = (0.08 + intensity * 0.82).toFixed(2);
      const textColor = intensity > 0.5 ? "#ffffff" : "#9fb3c8";
      return `<td class="heatmap-cell has-tooltip" data-tooltip="${count} occurrences in ${getMonthName(i+1)}" style="background:rgba(249,115,22,${alpha});color:${textColor};">${count}</td>`;
    }).join("");
    const glossary = FLAG_GLOSSARY[flag] || "";
    const flagHtml = glossary
      ? `<span class="has-tooltip" data-tooltip="${glossary}">${flag}</span>`
      : flag;
    return `<tr><td class="heatmap-flag-label">${flagHtml}</td>${cells}</tr>`;
  }).join("");

  container.innerHTML = `
    <div class="heatmap-legend">
      <span>Low frequency</span>
      <div class="heatmap-legend-bar"></div>
      <span>High frequency</span>
      <em>— scaled per row so each flag's seasonal pattern is visible independently</em>
    </div>
    <div class="heatmap-scroll">
      <table class="heatmap-table">
        <thead><tr><th>Flag</th>${monthHeaders}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;
}

function toggleHeatmap() {
  const heatmapEl = document.getElementById("network_heatmap");
  const btn       = document.getElementById("heatmap_toggle_btn");
  if(!heatmapEl || !btn) return;

  heatmapVisible = !heatmapVisible;

  if(heatmapVisible){
    heatmapEl.style.display = "block";
    btn.textContent = "Hide Heatmap";
    if(!heatmapEl.dataset.rendered){
      renderNetworkHeatmap();
      heatmapEl.dataset.rendered = "1";
    }
  } else {
    heatmapEl.style.display = "none";
    btn.textContent = "Show Heatmap";
  }
}
// ^ [6] NETWORK FLAG HEATMAP

// ================================================================
// v EVENT LISTENERS & INIT
// ================================================================
function attachEventListeners() {
  // Top dashboard (unchanged)
  const dashboardForm = document.getElementById("dashboard_form");
  if(dashboardForm) dashboardForm.addEventListener("submit", runDashboardQuery);

  // [2] Leaderboard count — reset to page 0 on change
  const lbCount = document.getElementById("leaderboard_count");
  if(lbCount) lbCount.addEventListener("change", () => {
    leaderboardCount = Number(lbCount.value);
    leaderboardPage  = 0;
    renderLeaderboard(leaderboardCount);
  });

  // [8] Live search filter — reset to page 0 on new search
  const lbSearch = document.getElementById("lb_search");
  if(lbSearch) lbSearch.addEventListener("input", () => {
    leaderboardPage = 0;
    renderLeaderboard(leaderboardCount);
  });

  // Flag filter dropdown
  const flagSelect = document.getElementById("flag_filter_select");
  if(flagSelect) flagSelect.addEventListener("change", () => {
    filterByFlag(flagSelect.value);
  });

  // Store drilldown Apply
  const sdpApply = document.getElementById("sdp_apply_btn");
  if(sdpApply) sdpApply.addEventListener("click", () => {
    if(!activeStoreID) return;
    const monthSelect = document.getElementById("sdp_month_select");
    renderStoreDrilldown(activeStoreID, monthSelect ? monthSelect.value : "");
  });

  // [7] Clear comparison
  const scpClear = document.getElementById("scp_clear_btn");
  if(scpClear) scpClear.addEventListener("click", clearComparison);

  // [6] Heatmap toggle
  const heatmapToggle = document.getElementById("heatmap_toggle_btn");
  if(heatmapToggle) heatmapToggle.addEventListener("click", toggleHeatmap);
}

async function initDashboard() {
  attachEventListeners();

  // Populate flag dropdown immediately from FLAG_GLOSSARY
  // so it's never empty while CSVs are loading
  populateFlagFilterDropdown();

  // Top dashboard SQL (unchanged)
  await populateFilters();

  // Risk section — load all three CSVs in parallel
  try {
    await Promise.all([
      loadOwnerRankingsCsv(),
      loadOwnerStoreMapCsv(),
      loadStoreMonthlyRiskCsv()
    ]);

    // [1] System summary
    renderSystemSummary();

    // Re-populate flag dropdown now with live counts from CSV data
    populateFlagFilterDropdown();

    // [2] Leaderboard (with trajectory baked in)
    renderLeaderboard(leaderboardCount);

  } catch(error) {
    console.error("Failed to load risk CSV data:", error);
    const lb = document.getElementById("risk_leaderboard");
    if(lb) lb.innerHTML = `<p class="leaderboard-loading" style="color:#f97316;">Error loading risk data: ${error.message}</p>`;
    const ssb = document.getElementById("system_summary_bar");
    if(ssb) ssb.innerHTML = `<p class="system-summary-loading" style="color:#f97316;">Error loading network stats.</p>`;
  }
}

initDashboard();
// ^ EVENT LISTENERS & INIT
