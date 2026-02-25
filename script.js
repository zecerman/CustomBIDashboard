// ---------- Demo Data ----------
function rand(seed){
  let t = seed >>> 0;
  return () => (t = (t * 1664525 + 1013904223) >>> 0) / 4294967296;
}
const r = rand(42);

const REGIONS = ["Midwest","Northeast","South","West"];
const PRODUCTS = ["Widget Pro","Widget Lite","Gizmo","Gizmo XL","Service Plan"];
const CUSTOMERS = ["Acme","Globex","Initech","Umbrella","Stark","Wayne","Wonka"];

function iso(d){
  return d.toISOString().split("T")[0];
}

function generateData(days=90){
  const out = [];
  const today = new Date();
  for(let i=0;i<days;i++){
    const d = new Date(today);
    d.setDate(today.getDate()-i);

    for(let j=0;j<5;j++){
      const revenue = Math.floor(200 + r()*800);
      const orders = Math.floor(1 + r()*5);
      const conv = 0.05 + r()*0.1;

      out.push({
        date: iso(d),
        customer: CUSTOMERS[Math.floor(r()*CUSTOMERS.length)],
        product: PRODUCTS[Math.floor(r()*PRODUCTS.length)],
        region: REGIONS[Math.floor(r()*REGIONS.length)],
        revenue,
        orders,
        conv
      });
    }
  }
  return out;
}

const DATA = generateData();

// ---------- Formatting ----------
const fmtUSD = n => n.toLocaleString(undefined,{style:"currency",currency:"USD",maximumFractionDigits:0});
const fmtPct = x => (x*100).toFixed(1)+"%";

// ---------- Render KPIs ----------
function renderKPIs(rows){
  const el = document.getElementById("kpis");
  const revenue = rows.reduce((s,x)=>s+x.revenue,0);
  const orders = rows.reduce((s,x)=>s+x.orders,0);
  const conv = rows.reduce((s,x)=>s+x.conv,0)/rows.length;
  const aov = revenue/orders;

  el.innerHTML = `
    <div class="card">
      <div>Revenue</div>
      <div class="kpi-value">${fmtUSD(revenue)}</div>
    </div>
    <div class="card">
      <div>Orders</div>
      <div class="kpi-value">${orders}</div>
    </div>
    <div class="card">
      <div>Conversion</div>
      <div class="kpi-value">${fmtPct(conv)}</div>
    </div>
    <div class="card">
      <div>AOV</div>
      <div class="kpi-value">${fmtUSD(aov)}</div>
    </div>
  `;
}

// ---------- Render Table ----------
function renderTable(rows){
  const tbody = document.getElementById("tbody");
  document.getElementById("rowCount").textContent = rows.length + " rows";

  tbody.innerHTML = rows.map(r=>`
    <tr>
      <td>${r.date}</td>
      <td>${r.customer}</td>
      <td>${r.product}</td>
      <td>${r.region}</td>
      <td class="right">${r.orders}</td>
      <td class="right">${fmtUSD(r.revenue)}</td>
      <td class="right">
        <span class="tag ${r.conv>0.1?"good":"bad"}">${fmtPct(r.conv)}</span>
      </td>
    </tr>
  `).join("");
}

// ---------- Simple Chart ----------
function drawRevenueChart(rows){
  const canvas = document.getElementById("revLine");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0,0,canvas.width,canvas.height);

  const byDay = {};
  rows.forEach(r=>{
    byDay[r.date] = (byDay[r.date]||0) + r.revenue;
  });

  const dates = Object.keys(byDay).sort();
  const values = dates.map(d=>byDay[d]);
  const max = Math.max(...values);

  ctx.beginPath();
  values.forEach((v,i)=>{
    const x = (i/(values.length-1))*canvas.width;
    const y = canvas.height - (v/max)*canvas.height;
    if(i===0) ctx.moveTo(x,y);
    else ctx.lineTo(x,y);
  });
  ctx.strokeStyle="#60a5fa";
  ctx.lineWidth=2;
  ctx.stroke();
}

// ---------- Filters ----------
function applyFilters(){
  const region = document.getElementById("region").value;
  const search = document.getElementById("search").value.toLowerCase();

  const rows = DATA.filter(r=>{
    if(region!=="All" && r.region!==region) return false;
    if(search && !(r.customer.toLowerCase().includes(search) || r.product.toLowerCase().includes(search))) return false;
    return true;
  });

  renderKPIs(rows);
  renderTable(rows);
  drawRevenueChart(rows);
}

// ---------- Events ----------
document.getElementById("apply").addEventListener("click", applyFilters);
document.getElementById("reset").addEventListener("click", ()=>{
  document.getElementById("region").value="All";
  document.getElementById("search").value="";
  applyFilters();
});

// ---------- Initial Render ----------
document.getElementById("asOf").textContent = "As of " + new Date().toLocaleString();
applyFilters();