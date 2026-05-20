"use strict";

const DB_NAME = "srkr_company_suite";
const DB_VERSION = 1;
const STORES = ["profile", "invoices", "mis", "bills"];
let db;
let deferredInstall;
let state = { profile: {}, invoices: [], mis: [], bills: [] };

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const defaults = {
  companyName: "SRI RADHE KRISHNA ROADLINES",
  tagline: "Transport Contractor",
  owner: "SRI RADHE KRISHNA ROADLINES",
  mobile: "9939269234, 6207178839",
  email: "srkrroadlines9792@gmail.com",
  gstin: "",
  address: "Lowk, Near Vir Kuwar Singh Park, Ranchi 834001",
  bank: ""
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  db = await openDb();
  await loadAll();
  bindUi();
  setTodayDefaults();
  renderAll();
  registerServiceWorker();
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("profile")) database.createObjectStore("profile", { keyPath: "id" });
      ["invoices", "mis", "bills"].forEach((store) => {
        if (!database.objectStoreNames.contains(store)) {
          database.createObjectStore(store, { keyPath: "id", autoIncrement: true });
        }
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(store, mode = "readonly") {
  return db.transaction(store, mode).objectStore(store);
}

function getAll(store) {
  return new Promise((resolve, reject) => {
    const request = tx(store).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function put(store, value) {
  return new Promise((resolve, reject) => {
    const request = tx(store, "readwrite").put(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function clearStore(store) {
  return new Promise((resolve, reject) => {
    const request = tx(store, "readwrite").clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function loadAll() {
  const profileRows = await getAll("profile");
  state.profile = { ...defaults, ...(profileRows.find((row) => row.id === "main") || {}) };
  state.invoices = (await getAll("invoices")).sort((a, b) => b.invoiceNo - a.invoiceNo);
  state.mis = (await getAll("mis")).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  state.bills = (await getAll("bills")).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function bindUi() {
  $$(".tab").forEach((button) => button.addEventListener("click", () => showTab(button.dataset.tab)));
  $("#profileForm").addEventListener("submit", saveProfile);
  $("#invoiceForm").addEventListener("submit", saveInvoice);
  $("#misForm").addEventListener("submit", saveMis);
  $("#billForm").addEventListener("submit", saveBill);
  $("#newInvoiceBtn").addEventListener("click", resetInvoiceForm);
  $("#invoiceSearch").addEventListener("input", renderInvoices);
  $("#exportBtn").addEventListener("click", exportBackup);
  $("#importBtn").addEventListener("click", importBackup);
  $$("[data-preview]").forEach((button) => button.addEventListener("click", () => previewDocument(button.dataset.preview)));
  $$("[data-pdf]").forEach((button) => button.addEventListener("click", () => downloadDocumentPdf(button.dataset.pdf)));
  $("#previewPrintBtn").addEventListener("click", printPreview);
  $("#previewDownloadBtn").addEventListener("click", () => downloadDocumentPdf($("#previewDialog").dataset.type));
  $("#previewCloseBtn").addEventListener("click", () => $("#previewDialog").close());
  $("#invoiceForm").elements.amount.addEventListener("input", updateWords);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstall = event;
    $("#installBtn").hidden = false;
  });
  $("#installBtn").addEventListener("click", async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    deferredInstall = null;
    $("#installBtn").hidden = true;
  });
}

function showTab(id) {
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === id));
  $$(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === id));
}

function setTodayDefaults() {
  const today = new Date().toISOString().slice(0, 10);
  ["invoiceForm", "misForm", "billForm"].forEach((formId) => {
    const form = $(`#${formId}`);
    const input = form.elements.date || form.elements.invoiceDate;
    if (input && !input.value) input.value = today;
  });
  resetInvoiceForm();
}

function fillForm(form, data) {
  Object.keys(data).forEach((key) => {
    if (form.elements[key]) form.elements[key].value = data[key] || "";
  });
}

function readForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function saveProfile(event) {
  event.preventDefault();
  const data = { ...readForm(event.currentTarget), id: "main" };
  await put("profile", data);
  await loadAll();
  renderAll();
  toast("Branding saved");
}

async function saveInvoice(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = {
    invoiceNo: Number(form.elements.invoiceNo.value),
    invoiceDate: form.elements.invoiceDate.value,
    description: form.elements.description.value.trim(),
    monthFrom: form.elements.monthFrom.value,
    monthTo: form.elements.monthTo.value,
    amount: Number(form.elements.amount.value),
    createdAt: new Date().toISOString()
  };
  if (!data.description || !data.invoiceDate || !data.monthFrom || !data.monthTo || !data.amount) return toast("Invoice fields blank nahi rahenge");
  const old = state.invoices.find((invoice) => invoice.invoiceNo === data.invoiceNo);
  await put("invoices", old ? { ...old, ...data } : data);
  await loadAll();
  renderAll();
  resetInvoiceForm();
  toast("Invoice saved");
}

async function saveMis(event) {
  event.preventDefault();
  const data = { ...readForm(event.currentTarget), amount: Number(event.currentTarget.elements.amount.value), createdAt: new Date().toISOString() };
  await put("mis", data);
  event.currentTarget.reset();
  setTodayDefaults();
  await loadAll();
  renderAll();
  toast("MIS saved");
}

async function saveBill(event) {
  event.preventDefault();
  const data = { ...readForm(event.currentTarget), amount: Number(event.currentTarget.elements.amount.value), createdAt: new Date().toISOString() };
  await put("bills", data);
  event.currentTarget.reset();
  setTodayDefaults();
  await loadAll();
  renderAll();
  toast("Bill saved");
}

function resetInvoiceForm() {
  const form = $("#invoiceForm");
  const today = new Date().toISOString().slice(0, 10);
  form.reset();
  form.elements.invoiceNo.value = nextInvoiceNo();
  form.elements.invoiceDate.value = today;
  updateWords();
}

function nextInvoiceNo() {
  return state.invoices.reduce((max, invoice) => Math.max(max, Number(invoice.invoiceNo || 0)), 0) + 1;
}

function updateWords() {
  $("#invoiceWords").textContent = amountToIndianWords(Number($("#invoiceForm").elements.amount.value || 0));
}

function renderAll() {
  fillForm($("#profileForm"), state.profile);
  renderBindings();
  renderDashboard();
  renderInvoices();
  renderMis();
  renderBills();
  renderBalance();
}

function renderBindings() {
  $$("[data-bind]").forEach((node) => {
    node.textContent = state.profile[node.dataset.bind] || "";
  });
  $("#factOwner").textContent = state.profile.owner || "-";
  $("#factMobile").textContent = state.profile.mobile || "-";
  $("#factGstin").textContent = state.profile.gstin || "-";
  $("#factEmail").textContent = state.profile.email || "-";
}

function renderDashboard() {
  const income = sum(state.invoices, "amount") + sum(state.mis, "amount");
  const expense = sum(state.bills, "amount");
  $("#dashIncome").textContent = money(income);
  $("#dashExpense").textContent = money(expense);
  $("#dashBalance").textContent = money(income - expense);
  $("#dashInvoices").textContent = String(state.invoices.length);
  const recent = [
    ...state.invoices.map((row) => ({ label: `Invoice ${row.invoiceNo}`, date: row.invoiceDate, amount: row.amount })),
    ...state.mis.map((row) => ({ label: `MIS ${row.vehicle}`, date: row.date, amount: row.amount })),
    ...state.bills.map((row) => ({ label: `Bill ${row.type}`, date: row.date, amount: -row.amount }))
  ].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8);
  $("#recentList").innerHTML = recent.length ? table(["Date", "Particular", "Amount"], recent.map((r) => [dateShort(r.date), r.label, money(r.amount)])) : "No entries yet.";
}

function renderInvoices() {
  const search = $("#invoiceSearch").value.trim();
  const rows = state.invoices.filter((row) => !search || String(row.invoiceNo).includes(search));
  $("#invoiceList").innerHTML = table(["Invoice No.", "Date", "Description", "Month", "Amount", "Action"], rows.map((row) => [
    row.invoiceNo,
    dateShort(row.invoiceDate),
    row.description,
    `${dateLong(row.monthFrom)} To ${dateLong(row.monthTo)}`,
    money(row.amount),
    `<div class="row-actions"><button type="button" onclick="editInvoice(${row.invoiceNo})">Edit</button></div>`
  ]));
}

window.editInvoice = (invoiceNo) => {
  const row = state.invoices.find((invoice) => invoice.invoiceNo === invoiceNo);
  if (!row) return;
  const form = $("#invoiceForm");
  fillForm(form, row);
  updateWords();
  showTab("invoice");
};

function renderMis() {
  $("#misList").innerHTML = table(["Date", "Vehicle", "Party", "Route", "Ref", "Amount"], state.mis.map((row) => [
    dateShort(row.date), row.vehicle, row.party, row.route || "", row.reference || "", money(row.amount)
  ]));
}

function renderBills() {
  $("#billList").innerHTML = table(["Date", "Type", "Vendor", "Bill No.", "Amount", "Notes"], state.bills.map((row) => [
    dateShort(row.date), row.type, row.vendor, row.billNo || "", money(row.amount), row.notes || ""
  ]));
}

function renderBalance() {
  const invoiceIncome = sum(state.invoices, "amount");
  const misIncome = sum(state.mis, "amount");
  const expense = sum(state.bills, "amount");
  $("#balanceSheet").innerHTML = `
    <section class="balance-box">
      <h2>Assets / Income</h2>
      <div class="balance-row"><span>Invoice Income</span><strong>${money(invoiceIncome)}</strong></div>
      <div class="balance-row"><span>MIS Income</span><strong>${money(misIncome)}</strong></div>
      <div class="balance-row"><span>Total Income</span><strong>${money(invoiceIncome + misIncome)}</strong></div>
    </section>
    <section class="balance-box">
      <h2>Liabilities / Expenses</h2>
      <div class="balance-row"><span>Total Bills</span><strong>${money(expense)}</strong></div>
      <div class="balance-row"><span>Closing Balance</span><strong>${money(invoiceIncome + misIncome - expense)}</strong></div>
    </section>
  `;
}

function table(headers, rows) {
  if (!rows.length) return `<div class="empty">No records.</div>`;
  return `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell ?? ""}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function previewDocument(type) {
  const doc = buildDocument(type);
  if (!doc) return;
  $("#previewDialog").dataset.type = type;
  $("#previewTitle").textContent = doc.title;
  $("#previewFrame").srcdoc = previewShell(doc.html);
  $("#previewDialog").showModal();
}

function printPreview() {
  const frame = $("#previewFrame");
  frame.contentWindow.focus();
  frame.contentWindow.print();
}

function downloadDocumentPdf(type) {
  const doc = buildDocument(type);
  if (!doc) return;
  const pdf = buildPdf(doc);
  download(doc.filename, pdf, "application/pdf");
}

function buildDocument(type) {
  const head = printHead();
  const docs = {
    invoice: () => ({ title: "Invoice PDF", filename: `invoice_${$("#invoiceForm").elements.invoiceNo.value || "draft"}_${safeDate($("#invoiceForm").elements.invoiceDate.value)}.pdf`, html: printInvoice(), lines: invoicePdfLines() }),
    "business-card": () => ({ title: "Business Card PDF", filename: "srkr_business_card.pdf", html: `<div class="print-sheet card-sheet">${$("#businessCardPrint").innerHTML}</div>`, lines: businessCardPdfLines() }),
    letterhead: () => ({ title: "Letterhead PDF", filename: "srkr_letterhead.pdf", html: printLetterhead(), lines: letterheadPdfLines() }),
    mis: () => ({ title: "MIS Register PDF", filename: `mis_register_${safeDate(new Date().toISOString().slice(0, 10))}.pdf`, html: `<div class="print-sheet">${head}<h2>MIS Register</h2>${$("#misList").innerHTML}</div>`, lines: registerPdfLines("MIS Register", ["Date", "Vehicle", "Party", "Route", "Ref", "Amount"], state.mis.map((row) => [dateShort(row.date), row.vehicle, row.party, row.route || "", row.reference || "", money(row.amount)])) }),
    bills: () => ({ title: "Bills Register PDF", filename: `bills_register_${safeDate(new Date().toISOString().slice(0, 10))}.pdf`, html: `<div class="print-sheet">${head}<h2>Bill Register</h2>${$("#billList").innerHTML}</div>`, lines: registerPdfLines("Bill Register", ["Date", "Type", "Vendor", "Bill No.", "Amount"], state.bills.map((row) => [dateShort(row.date), row.type, row.vendor, row.billNo || "", money(row.amount)])) }),
    balance: () => ({ title: "Balance Sheet PDF", filename: `balance_sheet_${safeDate(new Date().toISOString().slice(0, 10))}.pdf`, html: `<div class="print-sheet">${head}<h2>Balance Sheet</h2>${$("#balanceSheet").innerHTML}</div>`, lines: balancePdfLines() })
  };
  return docs[type] ? docs[type]() : null;
}

function printHead() {
  return `<header class="print-head"><img src="assets/image2.png" alt=""><div><h2>${escapeHtml(state.profile.companyName)}</h2><p>${escapeHtml(state.profile.address)}</p><p>Mob: ${escapeHtml(state.profile.mobile)}</p><p>${escapeHtml(state.profile.email)}</p></div></header>`;
}

function printLetterhead() {
  return `<div class="print-sheet letterhead-sheet">${printHead()}<div class="letterhead-body"></div><footer class="letterhead-footer"><p>${escapeHtml(state.profile.bank || "")}</p><p><strong>Authorized Signatory</strong></p></footer></div>`;
}

function printInvoice() {
  const form = $("#invoiceForm");
  const invoice = readForm(form);
  invoice.amount = Number(form.elements.amount.value || 0);
  return `<div class="print-sheet">${printHead()}<h2>INVOICE BILL</h2>
    <table class="print-table">
      <tr><th colspan="2">TO, TVS SUPPLY CHAIN<br>SOLUTIONS LTD RANCHI<br>JHARKHAND<br>GSTIN: 20AACCT1412E1Z9</th><th colspan="2">INVOICE NO.: ${escapeHtml(invoice.invoiceNo)}<br>INVOICE DATE ${dateShort(invoice.invoiceDate)}</th></tr>
      <tr><th>SERIAL NO.</th><th>DESCRIPTION</th><th>MONTH OF BILL</th><th>AMOUNT</th></tr>
      <tr><td>01</td><td>${escapeHtml(invoice.description || "")}</td><td>${dateLong(invoice.monthFrom)} To ${dateLong(invoice.monthTo)}</td><td>${money(invoice.amount)}</td></tr>
      <tr><th colspan="3">Net Amount</th><th>${money(invoice.amount)}</th></tr>
    </table>
    <p><strong>AMOUNT IN WORDS: ${amountToIndianWords(invoice.amount)}</strong></p>
    <p>AGENCY (GTA) IS EXEMPT UNDER GST as per entry no. 22 of Notification No. 12/2017 Central Tax Rate 28,2017.</p>
  </div>`;
}

function previewShell(content) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${printCss()}</style></head><body>${content}</body></html>`;
}

function printCss() {
  return `
    body{margin:0;background:#eef2f0;font-family:Arial,Helvetica,sans-serif;color:#000}
    .print-sheet{width:190mm;min-height:277mm;margin:12px auto;background:white;padding:8mm;box-shadow:0 10px 28px rgba(0,0,0,.14)}
    .print-head{display:grid;grid-template-columns:70px 1fr;gap:12px;align-items:center;border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:16px}
    .print-head img{width:64px}.print-head h2{margin:0;font-size:24px}.print-head p{margin:2px 0}
    table{width:100%;border-collapse:collapse}.print-table th,.print-table td,th,td{border:1px solid #000;padding:8px;text-align:left;vertical-align:top}
    th{font-weight:700}.letterhead-body{height:220mm}.letterhead-footer{display:flex;justify-content:space-between;gap:20px;border-top:1px solid #000;padding-top:10px}
    .card-sheet{display:grid;place-items:center}.card-face{width:90mm;height:52mm;border:1px solid #000;padding:6mm;display:grid;grid-template-columns:24mm 1fr;gap:4mm}.card-face img{width:22mm}.card-face h2{margin:0;font-size:15px}.card-face p{margin:2px 0 8px}.card-face strong,.card-face span,.card-face small{grid-column:2}
  `;
}

function invoicePdfLines() {
  const form = $("#invoiceForm");
  const invoice = readForm(form);
  const amount = Number(form.elements.amount.value || 0);
  return [
    ...companyPdfHeader(),
    "",
    "INVOICE BILL",
    `Invoice No.: ${invoice.invoiceNo || ""}`,
    `Invoice Date: ${dateShort(invoice.invoiceDate)}`,
    "To: TVS SUPPLY CHAIN SOLUTIONS LTD RANCHI JHARKHAND",
    "GSTIN: 20AACCT1412E1Z9",
    "",
    "SERIAL NO.    DESCRIPTION                  MONTH OF BILL                       AMOUNT",
    `01            ${invoice.description || ""}    ${dateLong(invoice.monthFrom)} To ${dateLong(invoice.monthTo)}    ${money(amount)}`,
    "",
    `Net Amount: ${money(amount)}`,
    `Amount in words: ${amountToIndianWords(amount)}`,
    "AGENCY (GTA) IS EXEMPT UNDER GST as per entry no. 22 of Notification No. 12/2017 Central Tax Rate 28,2017."
  ];
}

function businessCardPdfLines() {
  return [...companyPdfHeader(), "", `Contact Person: ${state.profile.owner || ""}`, `Tagline: ${state.profile.tagline || ""}`];
}

function letterheadPdfLines() {
  return [...companyPdfHeader(), "", "", "", "", "", "", "", "", "", "", "", "", "", "", "Authorized Signatory"];
}

function registerPdfLines(title, headers, rows) {
  const lines = [...companyPdfHeader(), "", title, headers.join(" | "), "-".repeat(96)];
  rows.forEach((row) => lines.push(row.join(" | ")));
  if (!rows.length) lines.push("No records.");
  return lines;
}

function balancePdfLines() {
  const invoiceIncome = sum(state.invoices, "amount");
  const misIncome = sum(state.mis, "amount");
  const expense = sum(state.bills, "amount");
  return [
    ...companyPdfHeader(),
    "",
    "Balance Sheet",
    `Invoice Income: ${money(invoiceIncome)}`,
    `MIS Income: ${money(misIncome)}`,
    `Total Income: ${money(invoiceIncome + misIncome)}`,
    `Total Bills: ${money(expense)}`,
    `Closing Balance: ${money(invoiceIncome + misIncome - expense)}`
  ];
}

function companyPdfHeader() {
  return [
    state.profile.companyName || "",
    state.profile.address || "",
    `Mob: ${state.profile.mobile || ""}`,
    state.profile.email || "",
    state.profile.gstin ? `GSTIN: ${state.profile.gstin}` : ""
  ].filter(Boolean);
}

function buildPdf(doc) {
  const lines = doc.lines || [];
  const pages = [];
  for (let i = 0; i < lines.length; i += 40) pages.push(lines.slice(i, i + 40));
  if (!pages.length) pages.push(["No data"]);
  const fontNormal = 3 + pages.length * 2;
  const fontBold = fontNormal + 1;
  const kids = [];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    ""
  ];
  pages.forEach((pageLines, index) => {
    const pageObj = 3 + index * 2;
    const contentObj = pageObj + 1;
    const stream = pdfStream(pageLines, index === 0 ? doc.title : "");
    kids.push(`${pageObj} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontNormal} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentObj} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

function pdfStream(lines, title) {
  const out = ["BT", "/F2 15 Tf", "48 795 Td", `(${pdfText(title)}) Tj`, "/F1 10 Tf", "0 -24 Td"];
  lines.forEach((line) => {
    wrapPlain(line, 92).forEach((part) => {
      out.push(`(${pdfText(part)}) Tj`, "0 -15 Td");
    });
  });
  out.push("ET");
  return out.join("\n");
}

function wrapPlain(text, limit) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";
  words.forEach((word) => {
    if (`${line} ${word}`.trim().length > limit) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = `${line} ${word}`.trim();
    }
  });
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function pdfText(value) {
  return String(value || "").replace(/[^\x20-\x7E]/g, " ").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function safeDate(value) {
  return (value || new Date().toISOString().slice(0, 10)).replaceAll("-", ".");
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

async function exportBackup() {
  const payload = { exportedAt: new Date().toISOString(), version: 1, data: state };
  download(`srkr-business-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), "application/json");
}

async function importBackup() {
  const file = $("#importFile").files[0];
  if (!file) return toast("Backup JSON select karo");
  const payload = JSON.parse(await file.text());
  const data = payload.data || payload;
  for (const store of STORES) await clearStore(store);
  await put("profile", { ...(data.profile || defaults), id: "main" });
  for (const row of data.invoices || []) await put("invoices", row);
  for (const row of data.mis || []) await put("mis", row);
  for (const row of data.bills || []) await put("bills", row);
  await loadAll();
  renderAll();
  toast("Backup imported");
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function dateShort(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
}

function dateLong(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return `${date.getDate()} ${date.toLocaleString("en-IN", { month: "short" })} ${date.getFullYear()}`;
}

function amountToIndianWords(amount) {
  const number = Math.floor(Number(amount || 0));
  if (!number) return "Rupees Zero Only.";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (n) => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]} ${ones[n % 10]}`.trim());
  const three = (n) => `${n > 99 ? `${ones[Math.floor(n / 100)]} Hundred ` : ""}${two(n % 100)}`.trim();
  const parts = [];
  let n = number;
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${three(lakh)} Lakh`);
  if (thousand) parts.push(`${three(thousand)} Thousand`);
  if (n) parts.push(three(n));
  return `Rupees ${parts.join(" ")} Only.`;
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  setTimeout(() => node.classList.remove("show"), 2200);
}
