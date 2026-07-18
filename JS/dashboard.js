/***********************************
 * DASHBOARD
 ***********************************/

function dateDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function renderDashboard() {
  const allHistory = await dbGetAll("history");
  const history = allHistory.filter(inv => !inv.refunded); // refunded sales don't count as revenue anywhere on this page
  const inventory = await dbGetAll("inventory");
  const rejects = await dbGetAll("rejects");
  const services = await dbGetAll("services");
  const staff = await dbGetAll("staff");
  const customers = await dbGetAll("customers");
  const payroll = await dbGetAll("payroll");
  const adjustments = await dbGetAll("adjustments");

  const today = todayStr();
  const weekStart = dateDaysAgo(6);   // today + previous 6 days = 7 days
  const monthStart = today.slice(0, 7) + "-01";

  const todaysSales = history.filter(inv => (inv.date || "").slice(0, 10) === today);
  const weeksSales = history.filter(inv => (inv.date || "").slice(0, 10) >= weekStart);
  const monthsSales = history.filter(inv => (inv.date || "").slice(0, 10) >= monthStart);

  const todaysTotal = todaysSales.reduce((sum, inv) => sum + Number(inv.total || 0), 0);
  const weeksTotal = weeksSales.reduce((sum, inv) => sum + Number(inv.total || 0), 0);
  const monthsTotal = monthsSales.reduce((sum, inv) => sum + Number(inv.total || 0), 0);

  const outstandingBalance = history.reduce((sum, inv) => sum + Number(inv.balance || 0), 0);
  const lowStock = inventory.filter(inv => Number(inv.quantity) <= Number(inv.restockLevel || 0));
  const todaysRejects = rejects.filter(r => (r.date || "").slice(0, 10) === today);
  const todaysRejectCost = todaysRejects.reduce((sum, r) => sum + Number(r.cost || 0), 0);
  const inProduction = allHistory.filter(inv => inv.readyBy && !inv.pickedUp && !inv.refunded);

  const itemCount = services.reduce((sum, s) => sum + (s.items || []).length, 0);
  const activeStaff = staff.filter(s => s.active !== false);
  const payrollThisMonth = payroll.filter(p => (p.createdAt || "").slice(0, 7) === today.slice(0, 7))
    .reduce((sum, p) => sum + Number(p.netPay || 0), 0);
  const openAdjustments = adjustments.filter(a => a.status !== "Used");

  renderDashboardStats({ todaysTotal, todaysSales, outstandingBalance, lowStock, todaysRejects, todaysRejectCost });
  renderDashboardPeriodStats({ weeksTotal, weeksSales, monthsTotal, monthsSales });
  renderDashboardOverview({ services, itemCount, inventory, activeStaff, customers, payrollThisMonth, openAdjustments, rejects });
  renderDashboardTrend(history, weekStart);
  renderDashboardTopItems(weeksSales);
  renderDashboardRecentSales(history);
  renderDashboardProduction(inProduction);
  renderDashboardLowStock(lowStock);
}

function renderDashboardOverview({ services, itemCount, inventory, activeStaff, customers, payrollThisMonth, openAdjustments, rejects }) {
  const box = document.getElementById("dashboardOverview");
  if (!box) return;

  box.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Catalog</div>
      <div class="stat-value">${itemCount}</div>
      <div style="font-size:12px;color:var(--ink-soft);margin-top:2px;">item(s) across ${services.length} service(s)</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Inventory</div>
      <div class="stat-value">${inventory.length}</div>
      <div style="font-size:12px;color:var(--ink-soft);margin-top:2px;">material(s) tracked</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Active staff</div>
      <div class="stat-value">${activeStaff.length}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Customers</div>
      <div class="stat-value">${customers.length}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Payroll this month</div>
      <div class="stat-value money">${money(payrollThisMonth)}</div>
    </div>
    <div class="stat-card ${openAdjustments.length ? "warn" : ""}">
      <div class="stat-label">Open advances/deductions</div>
      <div class="stat-value">${openAdjustments.length}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Rejects logged (all time)</div>
      <div class="stat-value">${rejects.length}</div>
    </div>
  `;
}

function renderDashboardStats({ todaysTotal, todaysSales, outstandingBalance, lowStock, todaysRejects, todaysRejectCost }) {
  const stats = document.getElementById("dashboardStats");
  if (!stats) return;

  stats.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Today's sales</div>
      <div class="stat-value money">${money(todaysTotal)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Today's transactions</div>
      <div class="stat-value">${todaysSales.length}</div>
    </div>
    <div class="stat-card ${outstandingBalance > 0 ? "warn" : ""}">
      <div class="stat-label">Outstanding balances</div>
      <div class="stat-value money">${money(outstandingBalance)}</div>
    </div>
    <div class="stat-card ${lowStock.length ? "warn" : ""}">
      <div class="stat-label">Low stock materials</div>
      <div class="stat-value">${lowStock.length}</div>
    </div>
    <div class="stat-card ${todaysRejects.length ? "warn" : ""}">
      <div class="stat-label">Rejects today</div>
      <div class="stat-value">${todaysRejects.length} <span style="font-size:14px;color:var(--ink-soft);">(${money(todaysRejectCost)})</span></div>
    </div>
  `;
}

function renderDashboardPeriodStats({ weeksTotal, weeksSales, monthsTotal, monthsSales }) {
  const box = document.getElementById("dashboardPeriodStats");
  if (!box) return;

  box.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Last 7 days</div>
      <div class="stat-value money">${money(weeksTotal)}</div>
      <div style="font-size:12px;color:var(--ink-soft);margin-top:2px;">${weeksSales.length} sale(s)</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">This month</div>
      <div class="stat-value money">${money(monthsTotal)}</div>
      <div style="font-size:12px;color:var(--ink-soft);margin-top:2px;">${monthsSales.length} sale(s)</div>
    </div>
  `;
}

// Simple 7-bar trend, tallest bar sets the scale — no charting library needed.
function renderDashboardTrend(history, weekStart) {
  const box = document.getElementById("dashboardTrend");
  if (!box) return;

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const dateStr = dateDaysAgo(i);
    const total = history
      .filter(inv => (inv.date || "").slice(0, 10) === dateStr)
      .reduce((sum, inv) => sum + Number(inv.total || 0), 0);
    days.push({ dateStr, total });
  }

  const max = Math.max(1, ...days.map(d => d.total));

  box.innerHTML = `
    <div class="trend-chart">
      ${days.map(d => {
        const heightPct = Math.max(3, Math.round((d.total / max) * 100));
        const label = new Date(d.dateStr + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" });
        return `
          <div class="trend-bar-col">
            <div class="trend-bar-value">${d.total > 0 ? Math.round(d.total) : ""}</div>
            <div class="trend-bar" style="height:${heightPct}%;" title="${money(d.total)} on ${d.dateStr}"></div>
            <div class="trend-bar-label">${label}</div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderDashboardTopItems(recentSales) {
  const box = document.getElementById("dashboardTopItems");
  if (!box) return;

  const totals = {};
  recentSales.forEach(inv => {
    (inv.items || []).forEach(item => {
      totals[item.name] = totals[item.name] || { qty: 0, revenue: 0 };
      totals[item.name].qty += Number(item.qty || 0);
      totals[item.name].revenue += Number(item.qty || 0) * Number(item.price || 0);
    });
  });

  const ranked = Object.entries(totals).sort((a, b) => b[1].qty - a[1].qty).slice(0, 5);

  box.innerHTML = ranked.length
    ? ranked.map(([name, data], i) => `
        <div class="top-item-row">
          <span><span class="top-item-rank">${i + 1}</span>${escapeHtml(name)}</span>
          <span class="money">${data.qty} sold • ${money(data.revenue)}</span>
        </div>
      `).join("")
    : `<div class="empty-state">No sales in the last 7 days yet.</div>`;
}

function renderDashboardRecentSales(history) {
  const box = document.getElementById("dashboardRecentSales");
  if (!box) return;

  const recent = [...history].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
  const pillClass = { Paid: "pill-paid", Balance: "pill-balance", Unpaid: "pill-unpaid" };

  box.innerHTML = recent.length
    ? recent.map(inv => `
        <div class="recent-sale-row">
          <span>${escapeHtml(inv.client)} <small style="color:var(--ink-soft);">— ${escapeHtml(inv.staffName)} • ${new Date(inv.date).toLocaleString()}</small></span>
          <span>
            <span class="money">${money(inv.total)}</span>
            <span class="pill ${pillClass[inv.status] || ""}">${inv.status}</span>
          </span>
        </div>
      `).join("")
    : `<div class="empty-state">No sales yet.</div>`;
}

function renderDashboardProduction(inProduction) {
  const box = document.getElementById("dashboardProduction");
  if (!box) return;

  const sorted = [...inProduction].sort((a, b) => new Date(a.readyBy) - new Date(b.readyBy));

  box.innerHTML = sorted.length
    ? sorted.map(inv => {
        const overdue = new Date(inv.readyBy) < new Date();
        return `
          <div class="recent-sale-row">
            <span>${inv.invoiceNo} — ${escapeHtml(inv.client)} <small style="color:var(--ink-soft);">${escapeHtml(inv.staffName)}</small></span>
            <span class="pill ${overdue ? "pill-unpaid" : "pill-production"}">${overdue ? "Overdue" : "Ready by"} ${new Date(inv.readyBy).toLocaleString()}</span>
          </div>
        `;
      }).join("")
    : `<div class="empty-state">Nothing in production right now.</div>`;
}

function renderDashboardLowStock(lowStock) {
  const box = document.getElementById("dashboardLowStock");
  if (!box) return;

  box.innerHTML = lowStock.length
    ? lowStock.map(inv => `
        <div class="cart-totals-row">
          <span>${escapeHtml(inv.name)}</span>
          <span class="money">${inv.quantity} ${escapeHtml(inv.unit || "pcs")} left (restock at ${inv.restockLevel})</span>
        </div>
      `).join("")
    : `<div class="empty-state">Nothing low on stock right now.</div>`;
}
