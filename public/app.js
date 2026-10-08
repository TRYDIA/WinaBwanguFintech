let booths = [];
let boothServices = [];

document.addEventListener("DOMContentLoaded", () => {
  const boothSelect = document.getElementById("boothSelect");
  const serviceSelect = document.getElementById("serviceSelect");
  const amountInput = document.getElementById("transactionAmount");
  const form = document.getElementById("transactionForm");

  loadInitialData();

  boothSelect.addEventListener("change", () => handleBoothChange(boothSelect.value));
  serviceSelect.addEventListener("change", () => {
    handleServiceChange(serviceSelect.value);
    updateTaxPreview();
  });
  amountInput.addEventListener("input", updateTaxPreview);
  form.addEventListener("submit", submitTransaction);
});

async function loadInitialData() {
  try {
    const [boothRows] = await Promise.all([
      apiFetch("/api/booths"),
      refreshTransactionId()
    ]);

    booths = boothRows;
    populateBooths();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function apiFetch(url, options) {
  const response = await fetch(url, options);

  if (response.status === 401) {
    window.location.href = "login.html";
    return;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

function populateBooths() {
  const boothSelect = document.getElementById("boothSelect");
  boothSelect.innerHTML = '<option value="">-- Choose Mobile Booth --</option>';

  booths.forEach(booth => {
    const option = document.createElement("option");
    option.value = booth.booth_id;
    option.textContent = booth.booth_id;
    boothSelect.appendChild(option);
  });
}

async function handleBoothChange(boothId) {
  const locationInput = document.getElementById("locationInput");
  const serviceSelect = document.getElementById("serviceSelect");

  clearServiceDetails();
  serviceSelect.innerHTML = '<option value="">-- Choose Service --</option>';
  serviceSelect.disabled = true;

  if (!boothId) {
    locationInput.value = "";
    return;
  }

  const booth = booths.find(item => item.booth_id === boothId);
  locationInput.value = booth ? booth.location : "";

  try {
    boothServices = await apiFetch(`/api/booths/${encodeURIComponent(boothId)}/services`);

    boothServices.forEach(service => {
      const option = document.createElement("option");
      option.value = service.service_id;
      option.textContent = service.service_name;
      serviceSelect.appendChild(option);
    });

    serviceSelect.disabled = boothServices.length === 0;
    showToast(`Location set to ${locationInput.value}`, "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function handleServiceChange(serviceId) {
  const rateInput = document.getElementById("revenueRate");
  const remainingInput = document.getElementById("remainingCredit");
  const service = boothServices.find(item => String(item.service_id) === String(serviceId));

  if (!service) {
    clearServiceDetails();
    return;
  }

  rateInput.value = Number(service.revenue_rate).toFixed(3);
  remainingInput.value = formatCurrency(service.remaining);
}

function clearServiceDetails() {
  document.getElementById("revenueRate").value = "";
  document.getElementById("remainingCredit").value = "";
  document.getElementById("taxAmount").value = "";
  document.getElementById("amountAfterTax").value = "";
}

function updateTaxPreview() {
  const amount = Number(document.getElementById("transactionAmount").value);
  const taxInput = document.getElementById("taxAmount");
  const afterTaxInput = document.getElementById("amountAfterTax");

  if (!Number.isFinite(amount) || amount <= 0) {
    taxInput.value = "";
    afterTaxInput.value = "";
    return;
  }

  const tax = amount * 0.05;
  taxInput.value = formatCurrency(tax);
  afterTaxInput.value = formatCurrency(amount - tax);
}

async function refreshTransactionId() {
  const data = await apiFetch("/api/next-transaction-id");
  document.getElementById("transactionId").value = data.transaction_id;
  return data;
}

async function submitTransaction(event) {
  event.preventDefault();

  const boothId = document.getElementById("boothSelect").value;
  const serviceId = document.getElementById("serviceSelect").value;
  const amount = Number(document.getElementById("transactionAmount").value);

  try {
    const transaction = await apiFetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ booth_id: boothId, service_id: serviceId, amount })
    });

    showToast(`Transaction ${transaction.transaction_id} processed successfully!`, "success");
    document.getElementById("transactionForm").reset();
    document.getElementById("serviceSelect").disabled = true;
    document.getElementById("serviceSelect").innerHTML = '<option value="">-- Select Booth First --</option>';
    boothServices = [];
    clearServiceDetails();
    await refreshTransactionId();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function formatCurrency(value) {
  return `ZMW ${Number(value || 0).toLocaleString("en-ZM", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}
