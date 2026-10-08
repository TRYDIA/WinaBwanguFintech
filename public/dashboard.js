const PIE_COLORS = ["#2563eb", "#0f766e", "#f97316", "#db2777", "#7c3aed", "#0891b2"];
const ANIMATION_DURATION = 1000;

window.addEventListener("DOMContentLoaded", loadDashboard);

async function loadDashboard() {
  try {
    const res = await fetch("/api/dashboard");
    if (res.status === 401) {
      window.location.href = "login.html";
      return;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load dashboard");
    renderDashboard(data);
  } catch (err) {
    console.error(err);
    alert("Could not load dashboard: " + err.message);
  }
}

function renderDashboard(data) {
  const totalRevenue = Number(data.summary.total_revenue || 0);
  const totalCapital = Number(data.summary.total_capital || 0);

  animateCurrencyValue(document.getElementById("totalCapital"), totalCapital);
  animateCurrencyValue(document.getElementById("totalIncome"), totalRevenue);
  renderFrequencyTable(data.booths, data.frequency);
  renderSummaryPie(totalRevenue, totalCapital);
  renderTaxBars(data.services);
  renderServiceBalances(data.services);
  renderBoothRevenue(data.booths);
}

function formatCurrency(value) {
  return `ZMW ${Number(value).toLocaleString("en-ZM", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function animateCurrencyValue(element, targetValue) {
  if (!element) return;
  const startTime = performance.now();
  element.textContent = formatCurrency(0);

  function updateValue(currentTime) {
    const progress = Math.min((currentTime - startTime) / ANIMATION_DURATION, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = formatCurrency(targetValue * eased);
    if (progress < 1) {
      requestAnimationFrame(updateValue);
    } else {
      element.textContent = formatCurrency(targetValue);
    }
  }
  requestAnimationFrame(updateValue);
}

// Item h: frequency of each service at each booth
function renderFrequencyTable(booths, frequency) {
  const content = document.getElementById("frequencyContent");
  if (!content) return;

  if (!frequency.length) {
    content.className = "empty-state";
    content.textContent = "No transactions recorded yet.";
    return;
  }

  const rows = booths.map(b => {
    const mine = frequency.filter(f => f.booth_id === b.booth_id);
    return {
      booth: b.booth_id,
      location: b.location,
      services: mine.map(f => `${f.service_name}: ${f.count}`).join(", ") || "No services recorded",
      total: Number(b.transactions)
    };
  });

  content.className = "table-wrapper";
  content.innerHTML = `
    <table class="frequency-table">
      <thead>
        <tr><th>Booth</th><th>Location</th><th>Services provided</th><th>Total</th></tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${r.booth}</td>
            <td>${r.location}</td>
            <td>${r.services}</td>
            <td>${r.total}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

// Item j: pie chart of the two totals (Total Revenue vs Total Capital)
function renderSummaryPie(revenue, capital) {
  const chart = document.getElementById("boothPieChart");
  const legend = document.getElementById("pieLegend");
  if (!chart || !legend) return;

  const items = [
    { label: "Total Revenue", value: revenue },
    { label: "Total Capital", value: capital }
  ];
  const total = items.reduce((sum, i) => sum + i.value, 0);

  if (total === 0) {
    chart.style.background = "#e2e8f0";
    legend.innerHTML = '<span class="empty-state">No data yet.</span>';
    return;
  }

  chart.setAttribute("aria-label", "Total revenue compared with total capital");
  legend.innerHTML = items.map((item, index) => `
    <div class="legend-item">
      <span class="legend-swatch" style="background: ${PIE_COLORS[index]}"></span>
      <span>${item.label}: ${formatCurrency(item.value)} (${((item.value / total) * 100).toFixed(1)}%)</span>
    </div>`).join("");

  animatePieChart(chart, items.map(i => i.value), total);
}

// Item d: tax obligation bars (tax_amount comes from the database)
function renderTaxBars(services) {
  const container = document.getElementById("taxBars");
  if (!container) return;

  const totals = services.map(s => ({ service: s.service_name, tax: Number(s.tax || 0) }));
  const highest = Math.max(...totals.map(t => t.tax), 0);

  if (highest === 0) {
    container.innerHTML = '<div class="empty-state">No tax estimates available yet.</div>';
    return;
  }

  container.innerHTML = totals.map(item => `
    <div>
      <div class="bar-meta"><span>${item.service}</span><strong>${formatCurrency(item.tax)}</strong></div>
      <div class="bar-track" role="progressbar" aria-valuemin="0" aria-valuemax="${highest}" aria-valuenow="${item.tax}">
        <div class="bar-fill" data-width="${(item.tax / highest) * 100}" style="width: 0%"></div>
      </div>
    </div>`).join("");

  requestAnimationFrame(() => {
    container.querySelectorAll(".bar-fill").forEach(bar => {
      bar.style.width = `${bar.dataset.width}%`;
    });
  });
}

// Item f: cumulative total and amount remaining from each service's monthly limit
function renderServiceBalances(services) {
  const container = document.getElementById("serviceBalances");
  if (!container) return;

  container.innerHTML = services.map(s => {
    const limit = Number(s.monthly_limit);
    const used = Number(s.used);
    const remaining = Number(s.remaining);
    const pct = limit ? Math.min((used / limit) * 100, 100) : 0;
    const low = remaining < limit * 0.1;
    return `
      <div>
        <div class="bar-meta">
          <span>${s.service_name}</span>
          <strong>${formatCurrency(remaining)} left${low ? " (low)" : ""}</strong>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width: ${pct}%${low ? "; background: #dc2626" : ""}"></div>
        </div>
        <small>Used ${formatCurrency(used)} of ${formatCurrency(limit)}</small>
      </div>`;
  }).join("");
}

// Item g: cumulative revenue per booth
function renderBoothRevenue(booths) {
  const container = document.getElementById("boothRevenue");
  if (!container) return;

  container.innerHTML = `
    <div class="table-wrapper">
      <table class="frequency-table">
        <thead>
          <tr><th>Booth</th><th>Location</th><th>Transactions</th><th>Revenue</th></tr>
        </thead>
        <tbody>
          ${booths.map(b => `
            <tr>
              <td>${b.booth_id}</td>
              <td>${b.location}</td>
              <td>${b.transactions}</td>
              <td>${formatCurrency(b.revenue)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function animatePieChart(chart, values, total) {
  const startTime = performance.now();

  function drawFrame(currentTime) {
    const progress = Math.min((currentTime - startTime) / ANIMATION_DURATION, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    let angle = 0;

    const segments = values.map((value, index) => {
      if (value === 0) return "";
      const next = angle + (value / total) * 360 * eased;
      const seg = `${PIE_COLORS[index]} ${angle}deg ${next}deg`;
      angle = next;
      return seg;
    }).filter(Boolean);

    chart.style.background = segments.length
      ? `conic-gradient(${segments.join(", ")}, #e2e8f0 ${angle}deg 360deg)`
      : "#e2e8f0";

    if (progress < 1) requestAnimationFrame(drawFrame);
  }
  requestAnimationFrame(drawFrame);
}