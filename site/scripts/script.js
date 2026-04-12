// Globals
let SQLPromise = null;
let dbPromise = null;
let performanceChart = null;
let resultsData = [];

// v CHECK FOR SQL & DB LOAD THEM IF SO
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
      const SQL = await getSqlJsInstance();
      const response = await fetch("data/data.db");

      if (!response.ok) {
        throw new Error(`Could not load database: ${response.status} ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      return new SQL.Database(new Uint8Array(buffer));
    })();
  }
  return dbPromise;
}
// ^ CHECK FOR SQL & DB LOAD THEM IF SO

// v CSV LOADING FUNCTIONS
function parseCsvRow(row) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    const nextChar = row[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

async function loadResultsCsv() {
  const response = await fetch("data/results.csv");

  if (!response.ok) {
    throw new Error(`Could not load results.csv: ${response.status} ${response.statusText}`);
  }

  const csvText = await response.text();
  const lines = csvText.trim().split(/\r?\n/);

  if (lines.length < 2) {
    resultsData = [];
    window.resultsData = resultsData;
    return;
  }

  const headers = parseCsvRow(lines[0]);

  resultsData = lines.slice(1).map(line => {
    const values = parseCsvRow(line);
    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });

    return {
      StoreID: Number(row.StoreID),
      FiscalYearID: Number(row.FiscalYearID),
      CalendarID: Number(row.CalendarID),
      flags: row.flags && row.flags.trim() !== "" ? row.flags.trim() : "No Flag",
      is_at_risk: String(row.is_at_risk).toLowerCase() === "true",
      predicted_sales: Number(row.predicted_sales || 0),
      risk_label: Number(row.risk_label || 0),
      risk_probability: Number(row.risk_probability || 0)
    };
  });

  console.log("Loaded results.csv rows:", resultsData.length);
  window.resultsData = resultsData;
}
// ^ CSV LOADING FUNCTIONS

// v MONTH HELPERS
const MONTH_NAMES = {
  1: "January",
  2: "February",
  3: "March",
  4: "April",
  5: "May",
  6: "June",
  7: "July",
  8: "August",
  9: "September",
  10: "October",
  11: "November",
  12: "December"
};

function getMonthName(monthNumber) {
  return MONTH_NAMES[monthNumber] || `Month ${monthNumber}`;
}

function populateResultsFilters() {
  const resultsStoreSelect = document.getElementById("results_store_select");
  const resultsMonthSelect = document.getElementById("results_month_select");

  if (!resultsStoreSelect || !resultsMonthSelect) {
    console.error("Results filter dropdowns were not found in index.html");
    return;
  }

  resultsStoreSelect.innerHTML = `<option value="">All Stores</option>`;
  resultsMonthSelect.innerHTML = `<option value="">All Months</option>`;

  const uniqueStores = [...new Set(resultsData.map(row => row.StoreID))]
    .filter(storeId => !Number.isNaN(storeId))
    .sort((a, b) => a - b);

  const uniqueMonths = [...new Set(resultsData.map(row => row.CalendarID))]
    .filter(month => !Number.isNaN(month))
    .sort((a, b) => a - b);

  uniqueStores.forEach(storeId => {
    const option = document.createElement("option");
    option.value = storeId;
    option.textContent = storeId;
    resultsStoreSelect.appendChild(option);
  });

  uniqueMonths.forEach(month => {
    const option = document.createElement("option");
    option.value = month;
    option.textContent = getMonthName(month);
    resultsMonthSelect.appendChild(option);
  });
}
// ^ MONTH HELPERS

// v RESULTS HELPERS
function getFilteredResults(storeId, monthId) {
  return resultsData.filter(row => {
    const storeMatches = storeId === "" || row.StoreID === Number(storeId);
    const monthMatches = monthId === "" || row.CalendarID === Number(monthId);
    return storeMatches && monthMatches;
  });
}

function formatRiskLabel(value) {
  return Number(value) === 1 ? "At Risk" : "Normal";
}

function formatRiskStatus(value) {
  return value ? "At Risk" : "Not At Risk";
}

function formatCurrency(value) {
  return `$${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function getRiskTone(probability, isAtRisk) {
  if (isAtRisk || probability >= 0.75) return "high";
  if (probability >= 0.4) return "medium";
  return "low";
}

function getMode(values, fallback = "No Data") {
  if (!values.length) return fallback;

  const counts = {};
  let bestValue = fallback;
  let bestCount = 0;

  values.forEach(value => {
    const key = String(value);
    counts[key] = (counts[key] || 0) + 1;

    if (counts[key] > bestCount) {
      bestCount = counts[key];
      bestValue = value;
    }
  });

  return bestValue;
}

function average(numbers) {
  if (!numbers.length) return 0;
  return numbers.reduce((sum, value) => sum + Number(value || 0), 0) / numbers.length;
}

function summarizeFilteredRows(filteredRows, storeId, monthId) {
  if (!filteredRows.length) {
    return {
      storeText: storeId || "All Stores",
      monthText: monthId ? getMonthName(Number(monthId)) : "All Months",
      flagText: "No data",
      riskText: "No data",
      riskLabelText: "No data",
      predictedSalesText: "$0.00",
      rowsMatched: 0,
      probabilityPercent: 0,
      tone: "low",
      uniqueStoreCount: 0,
      atRiskCount: 0
    };
  }

  const isSingleStore = storeId !== "";
  const isSingleMonth = monthId !== "";

  const riskProbabilityAvg = average(filteredRows.map(row => row.risk_probability));
  const predictedSalesAvg = average(filteredRows.map(row => row.predicted_sales));
  const atRiskCount = filteredRows.filter(row => row.is_at_risk).length;
  const uniqueStoreCount = new Set(filteredRows.map(row => row.StoreID)).size;

  const flagMode = getMode(filteredRows.map(row => row.flags), "No Flag");
  const riskLabelModeRaw = getMode(filteredRows.map(row => row.risk_label), 0);
  const riskLabelMode = formatRiskLabel(riskLabelModeRaw);

  let riskText = "Not At Risk";
  if (atRiskCount > 0) {
    riskText = isSingleStore && isSingleMonth
      ? formatRiskStatus(filteredRows[0].is_at_risk)
      : `${atRiskCount} At-Risk Rows`;
  }

  const probabilityPercent = Math.max(0, Math.min(100, riskProbabilityAvg * 100));
  const tone = getRiskTone(riskProbabilityAvg, atRiskCount > 0);

  return {
    storeText: isSingleStore ? storeId : `All Stores (${uniqueStoreCount})`,
    monthText: isSingleMonth ? getMonthName(Number(monthId)) : "All Months",
    flagText: flagMode,
    riskText,
    riskLabelText: riskLabelMode,
    predictedSalesText: formatCurrency(predictedSalesAvg),
    rowsMatched: filteredRows.length,
    probabilityPercent,
    tone,
    uniqueStoreCount,
    atRiskCount
  };
}
// ^ RESULTS HELPERS

// v LOWER SUMMARY CARDS
function renderResultsSummaryCards(filteredRows, storeId, monthId) {
  const cardsContainer = document.getElementById("results_summary_cards");
  if (!cardsContainer) return;

  const summary = summarizeFilteredRows(filteredRows, storeId, monthId);

  cardsContainer.innerHTML = `
    <div class="summary-card">
      <strong>Store</strong>
      <span>${summary.storeText}</span>
    </div>

    <div class="summary-card">
      <strong>Month</strong>
      <span>${summary.monthText}</span>
    </div>

    <div class="summary-card">
      <strong>Flag</strong>
      <span>${summary.flagText}</span>
    </div>

    <div class="summary-card">
      <strong>Risk</strong>
      <span>${summary.riskText}</span>
    </div>

    <div class="summary-card">
      <strong>Risk Label</strong>
      <span>${summary.riskLabelText}</span>
    </div>
  `;
}
// ^ LOWER SUMMARY CARDS

// v SINGLE RISK INSIGHT PANEL
function renderRiskInsightPanel(filteredRows, storeId, monthId) {
  const panel = document.getElementById("risk_insight_panel");
  if (!panel) return;

  const summary = summarizeFilteredRows(filteredRows, storeId, monthId);

  if (!filteredRows.length) {
    panel.innerHTML = `
      <div class="insight-empty-state">
        <p>No rows found for this selection.</p>
        <p><strong>Store:</strong> ${summary.storeText}</p>
        <p><strong>Month:</strong> ${summary.monthText}</p>
      </div>
    `;
    return;
  }

  panel.innerHTML = `
    <div class="risk-insight-layout">
      <div class="risk-status-block">
        <div class="risk-status-pill risk-tone-${summary.tone}">
          ${summary.riskText}
        </div>

        <div class="risk-score-wrap">
          <div class="risk-score-label-row">
            <span>Average Risk Probability</span>
            <span>${summary.probabilityPercent.toFixed(2)}%</span>
          </div>

          <div class="risk-progress-track">
            <div class="risk-progress-fill risk-tone-${summary.tone}" style="width: ${summary.probabilityPercent}%;"></div>
          </div>
        </div>
      </div>

      <div class="risk-insight-grid">
        <div class="risk-insight-item">
          <strong>Store</strong>
          <span>${summary.storeText}</span>
        </div>

        <div class="risk-insight-item">
          <strong>Month</strong>
          <span>${summary.monthText}</span>
        </div>

        <div class="risk-insight-item">
          <strong>Most Common Flag</strong>
          <span>${summary.flagText}</span>
        </div>

        <div class="risk-insight-item">
          <strong>Most Common Risk Label</strong>
          <span>${summary.riskLabelText}</span>
        </div>

        <div class="risk-insight-item">
          <strong>Average Predicted Sales</strong>
          <span>${summary.predictedSalesText}</span>
        </div>

        <div class="risk-insight-item">
          <strong>Rows Matched</strong>
          <span>${summary.rowsMatched}</span>
        </div>
      </div>
    </div>
  `;
}
// ^ SINGLE RISK INSIGHT PANEL

// v HELPER FUNCTIONS FOR ALTERING TEXT CONTENT
function showMessage(message) {
  const el = document.getElementById("dashboard_message");
  if (el) {
    el.textContent = message;
  }
}

function showQuery(query) {
  const el = document.getElementById("query_preview");
  if (el) {
    el.textContent = "Code Executed:\n" + query.trim();
  }
}
// ^ HELPER FUNCTIONS FOR ALTERING TEXT CONTENT

// v TABLE FUNCTIONS
function clearTable() {
  const table = document.getElementById("dashboard");
  if (table) {
    table.innerHTML = "";
  }
}

function renderTable(result) {
  const table = document.getElementById("dashboard");
  if (!table) return;

  table.innerHTML = "";

  if (!result || result.length === 0 || !result[0].values.length) {
    return;
  }

  const columns = result[0].columns;
  const values = result[0].values;

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  for (let i = 0; i < columns.length; i++) {
    const th = document.createElement("th");
    th.textContent = columns[i];
    headerRow.appendChild(th);
  }

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  for (let i = 0; i < values.length; i++) {
    const tr = document.createElement("tr");

    for (let j = 0; j < values[i].length; j++) {
      const td = document.createElement("td");
      td.textContent = values[i][j] ?? "";
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
}
// ^ TABLE FUNCTIONS

// v TOP CHART FUNCTIONS
function destroyChart() {
  if (performanceChart) {
    performanceChart.destroy();
    performanceChart = null;
  }
}

function renderChart(rows, labelText, yAxisLabel) {
  const placeholder = document.getElementById("chart_placeholder");
  if (placeholder) {
    placeholder.style.display = "none";
  }

  const canvas = document.getElementById("performance_chart");
  if (!canvas) return;

  destroyChart();

  const labels = [];
  const values = [];

  for (let i = 0; i < rows.length; i++) {
    labels.push(String(rows[i][0]));
    values.push(Number(rows[i][1] ?? 0));
  }

  const ctx = canvas.getContext("2d");

  performanceChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: labelText,
          data: values,
          tension: 0.2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 500,
        easing: "easeOutQuart"
      },
      animations: {
        y: {
          from: 30,
          duration: 500,
          easing: "easeOutQuart"
        }
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "CalendarID"
          }
        },
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: yAxisLabel
          }
        }
      }
    }
  });
}
// ^ TOP CHART FUNCTIONS

// v TOP DROPDOWN FILTERS
function fillSelect(selectId, rows, allLabel, valueIndex, textIndex) {
  const select = document.getElementById(selectId);
  if (!select) return;

  select.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = allLabel;
  select.appendChild(allOption);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const option = document.createElement("option");
    option.value = row[valueIndex];
    option.textContent = row[textIndex] != null ? row[textIndex] : row[valueIndex];
    select.appendChild(option);
  }
}

async function populateFilters() {
  try {
    const db = await getDatabase();

    const storeResult = db.exec(`
      SELECT StoreID, StoreName
      FROM Stores
      WHERE StoreID > 0
      ORDER BY StoreID
    `);

    const accountResult = db.exec(`
      SELECT AccountID, AccountName
      FROM Accounts
      WHERE AccountID NOT IN (40, 280, 370, 390, 400, 10080)
      ORDER BY AccountID
    `);

    const storeRows = storeResult.length ? storeResult[0].values : [];
    const accountRows = accountResult.length ? accountResult[0].values : [];

    fillSelect("store_select", storeRows, "All Stores", 0, 1);
    fillSelect("account_select", accountRows, "Select an Account", 0, 1);
  } catch (error) {
    showMessage(`Failed to load filters: ${error.message}`);
  }
}
// ^ TOP DROPDOWN FILTERS

// v TOP SQL QUERIES
function buildMainDataQuery(storeId, accountId) {
  const whereParts = [];

  if (storeId !== "") {
    whereParts.push(`StoreID = ${Number(storeId)}`);
  }

  if (accountId !== "") {
    whereParts.push(`AccountID = ${Number(accountId)}`);
  } else {
    whereParts.push("INVALID!!");
  }

  let whereClause = "";
  if (whereParts.length > 0) {
    whereClause = `WHERE ${whereParts.join(" AND ")}`;
  }

  return `
    SELECT
      CalendarID,
      ROUND(SUM(Amount), 2) AS TotalAmount
    FROM FullMainData
    ${whereClause}
    GROUP BY CalendarID
    ORDER BY CalendarID
  `;
}

function buildChartLabel(storeId, accountId) {
  const parts = [];
  parts.push("MainData Amount");

  if (storeId) {
    parts.push(`Store ${storeId}`);
  } else {
    parts.push("All Stores");
  }

  if (accountId) {
    parts.push(`Account ${accountId}`);
  } else {
    parts.push("Select an Account");
  }

  return parts.join(" · ");
}
// ^ TOP SQL QUERIES

// v TOP DASHBOARD RUN
async function runDashboardQuery(event) {
  event.preventDefault();

  clearTable();
  showMessage("");

  const storeSelectEl = document.getElementById("store_select");
  const accountSelectEl = document.getElementById("account_select");

  if (!storeSelectEl || !accountSelectEl) {
    showMessage("Dashboard form elements are missing.");
    return;
  }

  const storeId = storeSelectEl.value;
  const accountId = accountSelectEl.value;

  const query = buildMainDataQuery(storeId, accountId);
  showQuery(query);

  try {
    const db = await getDatabase();
    const result = db.exec(query);

    if (!result.length || !result[0].values.length) {
      destroyChart();
      showMessage("No rows returned for that selection.");
      return;
    }

    renderTable(result);
    renderChart(result[0].values, buildChartLabel(storeId, accountId), "Amount $");
  } catch (error) {
    destroyChart();
    showMessage(`Error: ${error.message}`);
  }
}
// ^ TOP DASHBOARD RUN

// v LOWER RESULTS RUN
function runResultsFilter(event) {
  event.preventDefault();

  const resultsStoreSelect = document.getElementById("results_store_select");
  const resultsMonthSelect = document.getElementById("results_month_select");

  if (!resultsStoreSelect || !resultsMonthSelect) {
    console.error("Results form elements are missing.");
    return;
  }

  const storeId = resultsStoreSelect.value;
  const monthId = resultsMonthSelect.value;
  const filteredRows = getFilteredResults(storeId, monthId);

  renderResultsSummaryCards(filteredRows, storeId, monthId);
  renderRiskInsightPanel(filteredRows, storeId, monthId);
}
// ^ LOWER RESULTS RUN

function attachEventListeners() {
  const dashboardForm = document.getElementById("dashboard_form");
  if (dashboardForm) {
    dashboardForm.addEventListener("submit", runDashboardQuery);
  }

  const resultsForm = document.getElementById("results_form");
  if (resultsForm) {
    resultsForm.addEventListener("submit", runResultsFilter);
  }
}

async function initDashboard() {
  attachEventListeners();
  await populateFilters();

  try {
    await loadResultsCsv();
    populateResultsFilters();
    renderResultsSummaryCards(resultsData, "", "");
    renderRiskInsightPanel(resultsData, "", "");
  } catch (error) {
    console.error("Failed to load results.csv:", error);
    showMessage(`Failed to load results.csv: ${error.message}`);
  }
}

initDashboard();