// ---------- state ----------
let items = [];          // {id, name, unit_type, price}
let currentSale = [];    // {itemId, name, unit_type, qty, weightGrams, price}
let dayTotal = 0;
let dayCount = 0;
let pendingWeightItem = null;
let pendingWeightGrams = 0;

// ---------- helpers ----------
function rupees(n) {
  return "₹" + (Math.round(n * 100) / 100).toFixed(2);
}

function todayLabel() {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });
}

function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 2500);
}

// Parses spoken item like "rice bag, sixty rupees" -> { name, price }
function parseSpokenItem(transcript) {
  let t = transcript.toLowerCase().trim();
  const match = t.match(/\$?\s*(\d+(\.\d+)?)\s*(rupees?|rs\.?|inr)?\s*$/);
  let price = null;
  let name = t;
  if (match && match[1]) {
    price = parseFloat(match[1]);
    name = t.slice(0, match.index).trim();
  }
  name = name
    .replace(/(at|for|price|priced|costs?|is)\s*$/i, "")
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/[.,]$/, "")
    .trim();
  if (name) name = name.charAt(0).toUpperCase() + name.slice(1);
  return { name, price };
}

// Parses spoken weight like "500 grams", "half a kilo", "1 kg" -> grams
function parseSpokenWeight(transcript) {
  const t = transcript.toLowerCase().trim();
  if (/half\s*(a\s*)?(kg|kilo|kilogram)/.test(t)) return 500;
  if (/quarter\s*(a\s*)?(kg|kilo|kilogram)/.test(t)) return 250;
  const kgMatch = t.match(/(\d+(\.\d+)?)\s*(kg|kilo|kilograms?)/);
  if (kgMatch) return Math.round(parseFloat(kgMatch[1]) * 1000);
  const gMatch = t.match(/(\d+(\.\d+)?)\s*(g|gram|grams)/);
  if (gMatch) return Math.round(parseFloat(gMatch[1]));
  const numOnly = t.match(/(\d+(\.\d+)?)/);
  if (numOnly) return Math.round(parseFloat(numOnly[1]));
  return null;
}

// ---------- API ----------
async function apiGet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("request failed");
  return res.json();
}
async function apiPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json()).error || "request failed");
  return res.json();
}
async function apiDelete(url) {
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error("request failed");
  return res.json();
}

async function loadItems() {
  try {
    items = await apiGet("/api/items");
  } catch (e) {
    showToast("Couldn't load today's items");
    items = [];
  }
  renderSellView();
  renderStockList();
}

async function loadSalesToday() {
  try {
    const data = await apiGet("/api/sales/today");
    dayTotal = data.total;
    dayCount = data.count;
  } catch (e) {
    dayTotal = 0;
    dayCount = 0;
  }
  renderHeaderTotals();
}

// ---------- rendering ----------
function renderHeaderTotals() {
  document.getElementById("day-total").textContent = rupees(dayTotal);
  document.getElementById("day-count").textContent =
    `${dayCount} sale${dayCount !== 1 ? "s" : ""}`;
}

function renderSellView() {
  const grid = document.getElementById("item-grid");
  const empty = document.getElementById("empty-shelf");
  grid.innerHTML = "";

  if (items.length === 0) {
    empty.classList.remove("hidden");
    grid.classList.add("hidden");
    return;
  }
  empty.classList.add("hidden");
  grid.classList.remove("hidden");

  items.forEach((item) => {
    const tile = document.createElement("button");
    tile.className = "item-tile";
    const priceLabel = item.unit_type === "weight"
      ? `${rupees(item.price)}<span class="item-tile-unit">/kg</span>`
      : rupees(item.price);
    tile.innerHTML = `
      <div class="item-tile-name">${escapeHtml(item.name)}</div>
      <div class="item-tile-price">${priceLabel}</div>
    `;
    tile.addEventListener("click", () => onTapItem(item));
    grid.appendChild(tile);
  });
}

function renderStockList() {
  const list = document.getElementById("stock-list");
  const empty = document.getElementById("stock-empty");
  document.getElementById("shelf-count").textContent = items.length;
  list.innerHTML = "";

  if (items.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "stock-row";
    const unitLabel = item.unit_type === "weight" ? "sold by weight" : "sold by piece";
    const priceLabel = item.unit_type === "weight" ? `${rupees(item.price)}/kg` : rupees(item.price);
    row.innerHTML = `
      <div>
        <div class="stock-row-name">${escapeHtml(item.name)}</div>
        <div class="stock-row-unit">${unitLabel}</div>
      </div>
      <div class="stock-row-right">
        <div class="stock-row-price">${priceLabel}</div>
        <button class="remove-btn">remove</button>
      </div>
    `;
    row.querySelector(".remove-btn").addEventListener("click", () => removeItem(item.id));
    list.appendChild(row);
  });
}

function renderTicket() {
  const lines = document.getElementById("ticket-lines");
  lines.innerHTML = "";

  let total = 0;
  let count = 0;

  currentSale.forEach((line) => {
    total += line.price;
    count += line.unit_type === "weight" ? 1 : line.qty;

    const row = document.createElement("div");
    row.className = "ticket-line";

    if (line.unit_type === "weight") {
      row.innerHTML = `
        <div class="ticket-line-name">${escapeHtml(line.name)} · ${formatWeight(line.weightGrams)}</div>
        <div class="ticket-line-controls">
          <span class="ticket-line-price">${rupees(line.price)}</span>
        </div>
      `;
    } else {
      row.innerHTML = `
        <div class="ticket-line-name">${escapeHtml(line.name)}</div>
        <div class="ticket-line-controls">
          <button class="qty-btn" data-action="dec">−</button>
          <span class="mono">${line.qty}</span>
          <button class="qty-btn" data-action="inc">+</button>
          <span class="ticket-line-price">${rupees(line.price)}</span>
        </div>
      `;
      row.querySelector('[data-action="dec"]').addEventListener("click", () => changeQty(line.itemId, -1));
      row.querySelector('[data-action="inc"]').addEventListener("click", () => changeQty(line.itemId, 1));
    }
    lines.appendChild(row);
  });

  document.getElementById("ticket-count").textContent = `${count} item${count !== 1 ? "s" : ""}`;
  document.getElementById("ticket-total").textContent = rupees(total);
  document.getElementById("complete-sale-btn").disabled = currentSale.length === 0;

  document.getElementById("ticket-clear").style.display = currentSale.length ? "block" : "none";
}

function formatWeight(grams) {
  if (grams >= 1000) {
    const kg = grams / 1000;
    return `${kg % 1 === 0 ? kg : kg.toFixed(2)} kg`;
  }
  return `${grams} g`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- sell actions ----------
function onTapItem(item) {
  if (item.unit_type === "piece") {
    const existing = currentSale.find((l) => l.itemId === item.id && l.unit_type === "piece");
    if (existing) {
      existing.qty += 1;
      existing.price = existing.qty * item.price;
    } else {
      currentSale.push({ itemId: item.id, name: item.name, unit_type: "piece", qty: 1, price: item.price });
    }
    renderTicket();
    openTicket();
  } else {
    openWeightModal(item);
  }
}

function changeQty(itemId, delta) {
  const line = currentSale.find((l) => l.itemId === itemId && l.unit_type === "piece");
  if (!line) return;
  line.qty += delta;
  if (line.qty <= 0) {
    currentSale = currentSale.filter((l) => l !== line);
  } else {
    const item = items.find((i) => i.id === itemId);
    line.price = line.qty * item.price;
  }
  renderTicket();
}

function clearTicket() {
  currentSale = [];
  renderTicket();
}

async function completeSale() {
  if (currentSale.length === 0) return;
  const lines = currentSale.map((l) => ({
    name: l.name,
    unit_type: l.unit_type,
    qty: l.unit_type === "piece" ? l.qty : null,
    weight_grams: l.unit_type === "weight" ? l.weightGrams : null,
    price: l.price,
  }));
  try {
    await apiPost("/api/sales", { lines });
    currentSale = [];
    renderTicket();
    closeTicket();
    await loadSalesToday();
    showToast("Sale recorded ✓");
  } catch (e) {
    showToast("Couldn't record sale — try again");
  }
}

// ---------- weight modal ----------
function openWeightModal(item) {
  pendingWeightItem = item;
  pendingWeightGrams = 500;
  document.getElementById("weight-modal-item").textContent = `${item.name} — ${rupees(item.price)}/kg`;
  document.getElementById("weight-input").value = "500";
  document.getElementById("weight-voice-msg").textContent = "";
  updateWeightPreview();
  document.querySelectorAll(".weight-chip").forEach((c) => c.classList.toggle("active", c.dataset.grams === "500"));
  document.getElementById("weight-modal").classList.remove("hidden");
}

function closeWeightModal() {
  document.getElementById("weight-modal").classList.add("hidden");
  pendingWeightItem = null;
}

function updateWeightPreview() {
  if (!pendingWeightItem) return;
  const price = (pendingWeightItem.price * pendingWeightGrams) / 1000;
  document.getElementById("weight-preview").textContent = `${formatWeight(pendingWeightGrams)} · ${rupees(price)}`;
}

function addWeightToSale() {
  if (!pendingWeightItem || pendingWeightGrams <= 0) return;
  const price = (pendingWeightItem.price * pendingWeightGrams) / 1000;
  currentSale.push({
    itemId: pendingWeightItem.id + "-" + Date.now(),
    name: pendingWeightItem.name,
    unit_type: "weight",
    weightGrams: pendingWeightGrams,
    price,
  });
  renderTicket();
  closeWeightModal();
  openTicket();
}

// ---------- stock actions ----------
async function addStockItem() {
  const name = document.getElementById("item-name").value.trim();
  const priceRaw = document.getElementById("item-price").value;
  const unitType = document.querySelector(".unit-btn.active").dataset.unit;
  const price = parseFloat(priceRaw);

  if (!name || isNaN(price) || price < 0) {
    showToast("Enter a name and a valid price");
    return;
  }
  try {
    await apiPost("/api/items", { name, unit_type: unitType, price });
    document.getElementById("item-name").value = "";
    document.getElementById("item-price").value = "";
    await loadItems();
  } catch (e) {
    showToast("Couldn't add item — try again");
  }
}

async function removeItem(id) {
  try {
    await apiDelete(`/api/items/${id}`);
    await loadItems();
  } catch (e) {
    showToast("Couldn't remove item");
  }
}

// ---------- ticket drawer open/close ----------
function openTicket() {
  document.getElementById("ticket-panel").classList.remove("hidden");
}
function closeTicket() {
  document.getElementById("ticket-panel").classList.add("hidden");
}
function toggleTicket() {
  document.getElementById("ticket-panel").classList.toggle("hidden");
}

// ---------- tabs ----------
function switchView(view) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  document.getElementById("sell-view").classList.toggle("hidden", view !== "sell");
  document.getElementById("stock-view").classList.toggle("hidden", view !== "stock");
}

// ---------- voice recognition ----------
function setupVoice(buttonId, onResult) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = document.getElementById(buttonId);
  if (!SpeechRecognition) {
    btn.classList.add("hidden");
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = navigator.language || "en-IN";

  let listening = false;

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    onResult(transcript);
  };
  recognition.onerror = (event) => {
    listening = false;
    btn.classList.remove("listening");
    const msgId = buttonId === "mic-name-btn" ? "voice-msg" : "weight-voice-msg";
    const el = document.getElementById(msgId);
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      el.textContent = "Microphone access is blocked — check browser permissions";
    } else if (event.error === "no-speech") {
      el.textContent = "Didn't catch that — try again";
    } else {
      el.textContent = "Couldn't hear that — try again";
    }
  };
  recognition.onend = () => {
    listening = false;
    btn.classList.remove("listening");
  };

  btn.addEventListener("click", () => {
    if (listening) return;
    listening = true;
    btn.classList.add("listening");
    try {
      recognition.start();
    } catch (e) {
      listening = false;
      btn.classList.remove("listening");
    }
  });
}

// ---------- init ----------
function init() {
  document.getElementById("today-label").textContent = todayLabel();

  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => switchView(t.dataset.view))
  );
  document.getElementById("go-to-stock").addEventListener("click", () => switchView("stock"));

  document.querySelectorAll(".unit-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll(".unit-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("price-suffix").textContent =
        btn.dataset.unit === "weight" ? "/ kg" : "/ piece";
    })
  );

  document.getElementById("add-item-btn").addEventListener("click", addStockItem);
  document.getElementById("item-price").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addStockItem();
  });

  document.getElementById("ticket-summary").addEventListener("click", toggleTicket);
  document.getElementById("ticket-hide").addEventListener("click", closeTicket);
  document.getElementById("ticket-clear").addEventListener("click", clearTicket);
  document.getElementById("complete-sale-btn").addEventListener("click", completeSale);

  document.getElementById("weight-cancel").addEventListener("click", closeWeightModal);
  document.getElementById("weight-add").addEventListener("click", addWeightToSale);
  document.querySelectorAll(".weight-chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      pendingWeightGrams = parseInt(chip.dataset.grams, 10);
      document.getElementById("weight-input").value = pendingWeightGrams;
      document.querySelectorAll(".weight-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      updateWeightPreview();
    })
  );
  document.getElementById("weight-input").addEventListener("input", (e) => {
    const val = parseInt(e.target.value, 10);
    pendingWeightGrams = isNaN(val) ? 0 : val;
    document.querySelectorAll(".weight-chip").forEach((c) =>
      c.classList.toggle("active", c.dataset.grams === String(pendingWeightGrams))
    );
    updateWeightPreview();
  });

  setupVoice("mic-name-btn", (transcript) => {
    const { name, price } = parseSpokenItem(transcript);
    if (name) document.getElementById("item-name").value = name;
    const msg = document.getElementById("voice-msg");
    if (price !== null && !isNaN(price)) {
      document.getElementById("item-price").value = price;
      msg.textContent = `Heard "${transcript}" — review and add`;
    } else {
      msg.textContent = `Heard "${transcript}" — add a price`;
    }
  });

  setupVoice("mic-weight-btn", (transcript) => {
    const grams = parseSpokenWeight(transcript);
    const msg = document.getElementById("weight-voice-msg");
    if (grams !== null) {
      pendingWeightGrams = grams;
      document.getElementById("weight-input").value = grams;
      document.querySelectorAll(".weight-chip").forEach((c) =>
        c.classList.toggle("active", c.dataset.grams === String(grams))
      );
      updateWeightPreview();
      msg.textContent = `Heard "${transcript}"`;
    } else {
      msg.textContent = `Didn't catch a weight in "${transcript}"`;
    }
  });

  loadItems();
  loadSalesToday();
}

document.addEventListener("DOMContentLoaded", init);