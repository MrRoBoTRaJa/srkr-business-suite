"use strict";

const APP_VERSION = "1.0.9";
const RELEASE_API = "https://api.github.com/repos/MrRoBoTRaJa/spark-erp/releases/latest";
const RELEASE_PAGE = "https://github.com/MrRoBoTRaJa/spark-erp/releases/latest";
const DB_NAME = "spark_erp_phase1";
const DB_VERSION = 3;
const STORES = ["users", "companies", "ledgers", "costCategories", "costCentres", "vouchers", "invoices", "stock", "backups"];
const DEFAULT_USER = { id: "admin", userId: "admin", password: "spark@123", role: "Super Admin", companyId: "" };

let db;
let currentUser = null;
let activeCompanyId = localStorage.getItem("spark_erp_active_company") || "";
let state = { users: [], companies: [], ledgers: [], costCategories: [], costCentres: [], vouchers: [], invoices: [], stock: [], backups: [] };

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", init);

async function init() {
  db = await openDb();
  await ensureDefaultUser();
  await loadAll();
  await ensureCompanyCodes();
  await loadAll();
  bindUi();
  setToday();
  setLoginMode("buyer");
  renderAll();
  applyAuth();
  await requestPersistentStorage();
  setTimeout(() => checkForUpdate(false), 2500);
  registerServiceWorker();
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      STORES.forEach((store) => {
        if (!database.objectStoreNames.contains(store)) database.createObjectStore(store, { keyPath: "id" });
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function store(name, mode = "readonly") {
  return db.transaction(name, mode).objectStore(name);
}

function getAll(name) {
  return new Promise((resolve, reject) => {
    const request = store(name).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function put(name, value) {
  return new Promise((resolve, reject) => {
    const request = store(name, "readwrite").put(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function ensureDefaultUser() {
  const users = await getAll("users");
  if (!users.length) {
    await put("users", DEFAULT_USER);
    return;
  }
  const admin = users.find((user) => user.id === "admin" || user.userId === "admin");
  if (admin && admin.role !== "Super Admin") {
    await put("users", { ...admin, id: "admin", userId: "admin", role: "Super Admin", companyId: "" });
  }
}

async function loadAll() {
  const entries = await Promise.all(STORES.map((name) => getAll(name)));
  STORES.forEach((name, index) => state[name] = entries[index]);
  if (currentUser && !isSuperAdmin(currentUser) && currentUser.companyId) {
    setActiveCompany(currentUser.companyId, false);
    return;
  }
  if (!activeCompanyId && state.companies[0]) setActiveCompany(state.companies[0].id, false);
}

async function ensureCompanyCodes() {
  let changed = false;
  for (let index = 0; index < state.companies.length; index += 1) {
    const company = state.companies[index];
    if (!company.code) {
      await put("companies", { ...company, code: `SPK${String(index + 1).padStart(3, "0")}` });
      changed = true;
    }
  }
  return changed;
}

function bindUi() {
  $("#loginForm").addEventListener("submit", login);
  $$("[data-login-mode]").forEach((button) => button.addEventListener("click", () => setLoginMode(button.dataset.loginMode)));
  $("#logoutBtn").addEventListener("click", logout);
  $$(".nav-btn").forEach((button) => button.addEventListener("click", () => showTab(button.dataset.tab)));
  $$("[data-jump]").forEach((button) => button.addEventListener("click", () => showTab(button.dataset.jump)));
  $("#companyForm").addEventListener("submit", saveCompany);
  $("#newCompanyBtn").addEventListener("click", () => $("#companyForm").reset());
  $("#companyList").addEventListener("click", handleCompanyListClick);
  $("#userForm").addEventListener("submit", saveUser);
  $("#newUserBtn").addEventListener("click", resetUserForm);
  $("#userList").addEventListener("click", handleUserListClick);
  $("#userForm").elements.role.addEventListener("change", updateUserCompanyField);
  $("#ledgerForm").addEventListener("submit", saveLedger);
  $("#newLedgerBtn").addEventListener("click", () => $("#ledgerForm").reset());
  $("#costCategoryForm").addEventListener("submit", saveCostCategory);
  $("#newCostCategoryBtn").addEventListener("click", () => $("#costCategoryForm").reset());
  $("#importCostCategoryBtn").addEventListener("click", importCostCategories);
  $("#downloadCostCategorySampleBtn").addEventListener("click", downloadCostCategorySample);
  $("#costCentreForm").addEventListener("submit", saveCostCentre);
  $("#newCostCentreBtn").addEventListener("click", () => $("#costCentreForm").reset());
  $$("[name='costCategoryId']").forEach((select) => select.addEventListener("change", renderCostCentreOptions));
  $("#voucherForm").addEventListener("submit", saveVoucher);
  $("#invoiceForm").addEventListener("submit", saveInvoice);
  $("#addInvoiceItemBtn").addEventListener("click", () => addInvoiceItem());
  $("#stockForm").addEventListener("submit", saveStock);
  $("#refreshReportsBtn").addEventListener("click", renderReports);
  $("#persistStorageBtn").addEventListener("click", () => requestPersistentStorage(true));
  $("#checkUpdateBtn").addEventListener("click", () => checkForUpdate(true));
  $("#downloadLatestBtn").addEventListener("click", downloadUpdate);
  $("#dismissUpdateBtn").addEventListener("click", hideUpdatePopup);
  $("#downloadUpdateBtn").addEventListener("click", downloadUpdate);
  $("#exportBackupBtn").addEventListener("click", exportBackup);
  $("#createBackupBtn").addEventListener("click", () => autoBackup("manual"));
  $("#importBackupBtn").addEventListener("click", importBackup);
}

function setToday() {
  const today = new Date().toISOString().slice(0, 10);
  ["voucherForm", "invoiceForm", "stockForm"].forEach((id) => {
    const input = $(`#${id}`).elements.date;
    if (input && !input.value) input.value = today;
  });
  $("#companyForm").elements.fyFrom.value ||= "2026-04-01";
  $("#companyForm").elements.fyTo.value ||= "2027-03-31";
}

function login(event) {
  event.preventDefault();
  const data = readForm(event.currentTarget);
  const code = String(data.companyCode || "").trim().toUpperCase();
  const company = state.companies.find((item) => companyCode(item) === code);
  const user = state.users.find((item) => {
    const credentialsMatch = item.userId === data.userId && item.password === data.password;
    if (!credentialsMatch) return false;
    if (item.role === "Super Admin" && data.loginMode === "super") return true;
    return data.loginMode === "buyer" && company && item.companyId === company.id;
  });
  if (!user) {
    $("#loginMessage").textContent = data.loginMode === "buyer" ? "Wrong Company Code, User ID or Password" : "Wrong Super Admin login";
    return;
  }
  currentUser = user;
  sessionStorage.setItem("spark_erp_user", user.id);
  if (!isSuperAdmin(user) && user.companyId) setActiveCompany(user.companyId, false);
  event.currentTarget.reset();
  applyAuth();
  renderAll();
}

function logout() {
  currentUser = null;
  sessionStorage.removeItem("spark_erp_user");
  applyAuth();
}

function applyAuth() {
  const saved = sessionStorage.getItem("spark_erp_user");
  if (!currentUser && saved) currentUser = state.users.find((user) => user.id === saved) || null;
  const ok = !!currentUser;
  document.body.classList.toggle("is-locked", !ok);
  document.body.classList.toggle("is-super-admin", ok && isSuperAdmin(currentUser));
  document.body.classList.toggle("is-company-admin", ok && currentUser?.role === "Company Admin");
  document.body.classList.toggle("is-accountant", ok && currentUser?.role === "Accountant");
  document.body.classList.toggle("is-viewer", ok && currentUser?.role === "Viewer");
  document.body.classList.toggle("is-buyer-user", ok && !isSuperAdmin(currentUser));
  $("#loginScreen").hidden = ok;
  $("#activeRole").textContent = ok ? currentUser.role : "Locked";
  updateAccessUi();
}

function setLoginMode(mode) {
  const form = $("#loginForm");
  form.elements.loginMode.value = mode;
  $$("[data-login-mode]").forEach((button) => button.classList.toggle("active", button.dataset.loginMode === mode));
  $("#companyCodeField").hidden = mode === "super";
  $("#loginHintTitle").textContent = mode === "super" ? "Super Admin login" : "Buyer login";
  $("#loginHintLine1").textContent = mode === "super" ? "Owner credentials required" : "Company Code + User ID + Password";
  $("#loginHintLine2").textContent = mode === "super" ? "ID/password owner ke paas rahega." : "Purchase ke baad ye details buyer ko milega.";
  $("#loginMessage").textContent = "";
}

function showTab(id) {
  if (!canOpenTab(id)) {
    toast("Is login me ye option allowed nahi hai");
    id = "dashboard";
  }
  $$(".nav-btn").forEach((button) => button.classList.toggle("active", button.dataset.tab === id));
  $$(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === id));
}

function activeCompany() {
  return state.companies.find((company) => company.id === activeCompanyId) || null;
}

function companyRows(rows) {
  return rows.filter((row) => row.companyId === activeCompanyId);
}

function setActiveCompany(id, rerender = true) {
  if (currentUser && !isSuperAdmin(currentUser) && currentUser.companyId && currentUser.companyId !== id) {
    toast("Aapka login sirf apni company ke liye hai");
    return;
  }
  activeCompanyId = id;
  localStorage.setItem("spark_erp_active_company", id);
  if (rerender) renderAll();
}

async function saveCompany(event) {
  event.preventDefault();
  if (!isSuperAdmin(currentUser)) return toast("New company sirf Super Admin bana sakta hai");
  const data = readForm(event.currentTarget);
  const company = { ...data, id: data.id || uid("cmp") };
  company.code = String(data.code || nextCompanyCode()).trim().toUpperCase();
  await put("companies", company);
  setActiveCompany(company.id, false);
  await afterWrite("Company saved");
  event.currentTarget.reset();
}

async function saveUser(event) {
  event.preventDefault();
  const data = readForm(event.currentTarget);
  if (!canManageUsers()) return toast("Users manage karne ke liye admin login chahiye");
  if (data.role === "Super Admin" && !isSuperAdmin(currentUser)) return toast("Super Admin sirf main admin bana sakta hai");
  if (data.role !== "Super Admin" && !(data.companyId || activeCompanyId)) {
    toast("Pehle company select karo");
    showTab("companies");
    return;
  }
  const companyId = data.role === "Super Admin" ? "" : (isSuperAdmin(currentUser) ? (data.companyId || activeCompanyId) : currentUser.companyId);
  await put("users", { ...data, id: data.id || data.userId || uid("usr"), companyId });
  await afterWrite("User saved");
  resetUserForm();
}

async function saveLedger(event) {
  event.preventDefault();
  if (!requireCompany()) return;
  const data = readForm(event.currentTarget);
  await put("ledgers", { ...data, id: data.id || uid("led"), companyId: activeCompanyId, opening: num(data.opening) });
  await afterWrite("Ledger saved");
  event.currentTarget.reset();
}

async function saveCostCategory(event) {
  event.preventDefault();
  if (!requireCompany()) return;
  const data = readForm(event.currentTarget);
  await put("costCategories", { ...data, id: data.id || uid("cc"), companyId: activeCompanyId, createdAt: now() });
  await afterWrite("Cost Category saved");
  event.currentTarget.reset();
}

async function importCostCategories() {
  if (!requireCompany()) return;
  const file = $("#costCategoryImportFile").files[0];
  if (!file) return toast("Excel/CSV file select karo");
  let rows = [];
  const ext = file.name.split(".").pop().toLowerCase();
  if (["xlsx", "xls"].includes(ext)) {
    if (!window.XLSX) return toast("Excel parser load nahi hua");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  } else if (ext === "csv") {
    rows = parseCsv(await file.text());
  } else {
    return toast("Sirf .xlsx, .xls, .csv file upload karein");
  }
  const imported = [];
  for (const source of rows) {
    const row = normalizeImportRow(source);
    if (!row.name) continue;
    const existing = companyRows(state.costCategories).find((item) => item.name.toLowerCase() === row.name.toLowerCase());
    imported.push({
      id: existing?.id || uid("cc"),
      companyId: activeCompanyId,
      name: row.name,
      type: row.type || existing?.type || "Primary",
      status: row.status || existing?.status || "Active",
      notes: row.notes || existing?.notes || "",
      createdAt: existing?.createdAt || now()
    });
  }
  if (!imported.length) return toast("File me category list nahi mila");
  for (const row of imported) await put("costCategories", row);
  $("#costCategoryImportFile").value = "";
  await afterWrite(`${imported.length} category imported`);
}

function downloadCostCategorySample() {
  const csv = "Category Name,Type,Status,Notes\nDigital Marketing,Project,Active,Sample category\nWebsite Design,Campaign,Active,Sample category\nPrinting,Department,Active,Sample category\n";
  download("cost-category-sample.csv", csv, "text/csv");
}

async function saveCostCentre(event) {
  event.preventDefault();
  if (!requireCompany()) return;
  const data = readForm(event.currentTarget);
  await put("costCentres", { ...data, id: data.id || uid("ctr"), companyId: activeCompanyId, createdAt: now() });
  await afterWrite("Cost Centre saved");
  event.currentTarget.reset();
}

async function saveVoucher(event) {
  event.preventDefault();
  if (!requireCompany()) return;
  const data = readForm(event.currentTarget);
  await put("vouchers", { ...data, id: uid("vch"), companyId: activeCompanyId, amount: num(data.amount), createdAt: now() });
  await afterWrite("Voucher saved");
  event.currentTarget.reset();
  setToday();
}

async function saveInvoice(event) {
  event.preventDefault();
  if (!requireCompany()) return;
  const data = readForm(event.currentTarget);
  const items = getInvoiceItems().filter((item) => item.item && item.qty && item.rate);
  if (!items.length) return toast("Invoice item add karo");
  const totals = invoiceTotals(items);
  const invoice = { ...data, id: uid("inv"), companyId: activeCompanyId, invoiceNo: data.invoiceNo || nextInvoiceNo(), items, ...totals, createdAt: now() };
  await put("invoices", invoice);
  await afterWrite("GST invoice saved");
  resetInvoiceForm();
}

async function saveStock(event) {
  event.preventDefault();
  if (!requireCompany()) return;
  const data = readForm(event.currentTarget);
  await put("stock", { ...data, id: uid("stk"), companyId: activeCompanyId, qty: num(data.qty), rate: num(data.rate), createdAt: now() });
  await afterWrite("Stock entry saved");
  event.currentTarget.reset();
  setToday();
}

async function afterWrite(message) {
  await loadAll();
  renderAll();
  await autoBackup("auto");
  toast(message);
}

function renderAll() {
  renderHeader();
  renderCompanyList();
  renderCompanyOptions();
  renderUserList();
  renderLedgerList();
  renderLedgerOptions();
  renderCostCategoryList();
  renderCostCategoryOptions();
  renderCostCentreList();
  renderCostCentreOptions();
  renderVoucherList();
  renderInvoiceItems();
  renderInvoiceList();
  renderStock();
  renderReports();
  renderGst();
  renderBackupList();
  updateAccessUi();
}

function renderHeader() {
  const company = activeCompany();
  $("#activeCompanyName").textContent = company ? company.name : "No Company";
  $("#dashCompany").textContent = company ? company.name : "-";
  $("#dashCompanyCode").textContent = company ? companyCode(company) : "-";
  $("#dashFy").textContent = company ? `${dateShort(company.fyFrom)} to ${dateShort(company.fyTo)}` : "-";
  $("#dashUser").textContent = currentUser ? `${currentUser.userId} (${currentUser.role})` : "-";
  renderStorageStatus(localStorage.getItem("spark_erp_storage_status") || "Checking...");
  $("#dashBackup").textContent = localStorage.getItem("spark_erp_last_backup") || "-";
  $("#statUsers").textContent = visibleUsers().length;
  $("#statLedgers").textContent = companyRows(state.ledgers).length;
  $("#statCostCategories").textContent = companyRows(state.costCategories).length;
  $("#statCostCentres").textContent = companyRows(state.costCentres).length;
  $("#statVouchers").textContent = companyRows(state.vouchers).length;
  $("#statInvoices").textContent = companyRows(state.invoices).length;
  $("#statStock").textContent = stockSummary().length;
  $("#invoiceForm").elements.invoiceNo.value ||= nextInvoiceNo();
}

function resetInvoiceForm() {
  const form = $("#invoiceForm");
  form.reset();
  form.elements.invoiceNo.value = nextInvoiceNo();
  form.elements.date.value = new Date().toISOString().slice(0, 10);
  $("#invoiceItems").innerHTML = "";
  addInvoiceItem();
  updateInvoiceTotal();
}

function renderCompanyList() {
  const companies = isSuperAdmin(currentUser) ? state.companies : state.companies.filter((row) => row.id === currentUser?.companyId);
  $("#companyList").innerHTML = table(["Company", "Code", "GSTIN", "FY", "Action"], companies.map((row) => [
    row.name, companyCode(row), row.gstin || "", `${dateShort(row.fyFrom)} to ${dateShort(row.fyTo)}`,
    `<button type="button" data-open-company="${escapeAttr(row.id)}">Open</button>`
  ]));
}

function handleCompanyListClick(event) {
  const button = event.target.closest("[data-open-company]");
  if (!button) return;
  openCompany(button.dataset.openCompany);
}

function openCompany(id) {
  const company = state.companies.find((row) => row.id === id);
  if (!company) return toast("Company record nahi mila");
  setActiveCompany(id, false);
  renderAll();
  showTab("dashboard");
  toast(`${company.name} open ho gaya`);
}

function renderCompanyOptions() {
  const select = $("#userForm").elements.companyId;
  const companies = isSuperAdmin(currentUser) ? state.companies : state.companies.filter((row) => row.id === currentUser?.companyId);
  const options = companies.map((row) => `<option value="${escapeAttr(row.id)}">${escapeHtml(row.name)}</option>`).join("");
  select.innerHTML = `<option value="">Select Company</option>${options}`;
  if (activeCompanyId) select.value = activeCompanyId;
  updateUserCompanyField();
}

function renderUserList() {
  $("#userList").innerHTML = table(["User ID", "Role", "Company", "Password", "Action"], visibleUsers().map((row) => [
    row.userId,
    roleBadge(row.role),
    row.companyId ? companyName(row.companyId) : "All Companies",
    "••••••",
    `<button type="button" data-edit-user="${escapeAttr(row.id)}">Edit</button>`
  ]));
}

function visibleUsers() {
  if (isSuperAdmin(currentUser)) return state.users;
  if (!currentUser?.companyId) return [];
  return state.users.filter((row) => row.companyId === currentUser.companyId || row.id === currentUser.id);
}

function handleUserListClick(event) {
  const button = event.target.closest("[data-edit-user]");
  if (!button) return;
  editUser(button.dataset.editUser);
}

function editUser(id) {
  const user = state.users.find((row) => row.id === id);
  if (!user) return toast("User record nahi mila");
  const form = $("#userForm");
  fillForm(form, user);
  updateUserCompanyField();
  showTab("users");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  toast(`${user.userId} edit ke liye load ho gaya`);
}

window.editUser = editUser;

function renderLedgerList() {
  const rows = companyRows(state.ledgers);
  $("#ledgerList").innerHTML = table(["Ledger", "Group", "Opening", "GSTIN"], rows.map((row) => [row.name, row.group, `${money(row.opening)} ${row.balanceType}`, row.gstin || ""]));
}

function renderLedgerOptions() {
  const ledgers = companyRows(state.ledgers);
  const options = ledgers.map((row) => `<option value="${row.id}">${escapeHtml(row.name)}</option>`).join("");
  ["debitLedger", "creditLedger", "partyLedger"].forEach((name) => {
    const el = document.querySelector(`[name="${name}"]`);
    if (el) el.innerHTML = `<option value="">Select Ledger</option>${options}`;
  });
}

function renderCostCategoryList() {
  const rows = companyRows(state.costCategories);
  $("#costCategoryList").innerHTML = table(["Category", "Type", "Status", "Notes"], rows.map((row) => [
    row.name, row.type || "Primary", row.status || "Active", row.notes || ""
  ]));
}

function renderCostCategoryOptions() {
  const rows = companyRows(state.costCategories).filter((row) => (row.status || "Active") === "Active");
  const options = rows.map((row) => `<option value="${escapeAttr(row.id)}">${escapeHtml(row.name)}</option>`).join("");
  $$("[name='costCategoryId']").forEach((select) => {
    select.innerHTML = `<option value="">No Cost Category</option>${options}`;
  });
}

function renderCostCentreList() {
  const rows = companyRows(state.costCentres);
  $("#costCentreList").innerHTML = table(["Centre", "Category", "Status", "Notes"], rows.map((row) => [
    row.name, costCategoryName(row.costCategoryId), row.status || "Active", row.notes || ""
  ]));
}

function renderCostCentreOptions() {
  const rows = companyRows(state.costCentres).filter((row) => (row.status || "Active") === "Active");
  $$("[name='costCentreId']").forEach((select) => {
    const categoryId = select.closest("form")?.elements.costCategoryId?.value || "";
    const filtered = categoryId ? rows.filter((row) => row.costCategoryId === categoryId) : rows;
    const options = filtered.map((row) => `<option value="${escapeAttr(row.id)}">${escapeHtml(row.name)}</option>`).join("");
    const previous = select.value;
    select.innerHTML = `<option value="">No Cost Centre</option>${options}`;
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  });
}

function renderVoucherList() {
  const rows = companyRows(state.vouchers).sort((a, b) => b.date.localeCompare(a.date));
  $("#voucherList").innerHTML = table(["Date", "Type", "Cost Category", "Cost Centre", "Dr", "Cr", "Amount", "Narration"], rows.map((row) => [
    dateShort(row.date), row.type, costCategoryName(row.costCategoryId), costCentreName(row.costCentreId), ledgerName(row.debitLedger), ledgerName(row.creditLedger), money(row.amount), row.narration || ""
  ]));
}

function renderInvoiceItems() {
  const tbody = $("#invoiceItems");
  if (!tbody.children.length) addInvoiceItem();
  updateInvoiceTotal();
}

function addInvoiceItem(item = {}) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input class="item-name" value="${escapeHtml(item.item || "")}" placeholder="Item"></td>
    <td><input class="item-hsn" value="${escapeHtml(item.hsn || "")}" placeholder="HSN"></td>
    <td><input class="item-qty" type="number" step="0.01" value="${item.qty || ""}"></td>
    <td><input class="item-rate" type="number" step="0.01" value="${item.rate || ""}"></td>
    <td><input class="item-gst" type="number" step="0.01" value="${item.gst || 18}"></td>
    <td class="line-total">0.00</td>
    <td><button class="ghost" type="button">X</button></td>
  `;
  tr.addEventListener("input", updateInvoiceTotal);
  tr.querySelector("button").addEventListener("click", () => {
    if ($$("#invoiceItems tr").length > 1) tr.remove();
    updateInvoiceTotal();
  });
  $("#invoiceItems").appendChild(tr);
  updateInvoiceTotal();
}

function getInvoiceItems() {
  return $$("#invoiceItems tr").map((row) => {
    const item = row.querySelector(".item-name").value.trim();
    const hsn = row.querySelector(".item-hsn").value.trim();
    const qty = num(row.querySelector(".item-qty").value);
    const rate = num(row.querySelector(".item-rate").value);
    const gst = num(row.querySelector(".item-gst").value);
    const taxable = qty * rate;
    const gstAmount = taxable * gst / 100;
    return { item, hsn, qty, rate, gst, taxable, gstAmount, total: taxable + gstAmount };
  });
}

function updateInvoiceTotal() {
  const items = getInvoiceItems();
  $$("#invoiceItems tr").forEach((row, index) => row.querySelector(".line-total").textContent = money(items[index].total));
  $("#invoiceTotal").textContent = `Total: ${money(items.reduce((sum, item) => sum + item.total, 0))}`;
}

function invoiceTotals(items) {
  return {
    taxable: items.reduce((sum, item) => sum + item.taxable, 0),
    gstAmount: items.reduce((sum, item) => sum + item.gstAmount, 0),
    total: items.reduce((sum, item) => sum + item.total, 0)
  };
}

function renderInvoiceList() {
  const rows = companyRows(state.invoices).sort((a, b) => b.date.localeCompare(a.date));
  $("#invoiceList").innerHTML = table(["Date", "Type", "Invoice", "Party", "Cost Category", "Cost Centre", "Taxable", "GST", "Total"], rows.map((row) => [
    dateShort(row.date), row.type, row.invoiceNo, ledgerName(row.partyLedger), costCategoryName(row.costCategoryId), costCentreName(row.costCentreId), money(row.taxable), money(row.gstAmount), money(row.total)
  ]));
}

function renderStock() {
  $("#stockSummary").innerHTML = table(["Item", "Qty", "Value"], stockSummary().map((row) => [row.item, money(row.qty), money(row.value)]));
  const rows = companyRows(state.stock).sort((a, b) => b.date.localeCompare(a.date));
  $("#stockList").innerHTML = table(["Date", "Item", "Type", "Cost Category", "Cost Centre", "Qty", "Rate", "Notes"], rows.map((row) => [dateShort(row.date), row.item, row.type, costCategoryName(row.costCategoryId), costCentreName(row.costCentreId), money(row.qty), money(row.rate), row.notes || ""]));
}

function stockSummary() {
  const map = new Map();
  companyRows(state.stock).forEach((row) => {
    const current = map.get(row.item) || { item: row.item, qty: 0, value: 0 };
    const sign = row.type === "Stock Out" ? -1 : 1;
    current.qty += sign * num(row.qty);
    current.value += sign * num(row.qty) * num(row.rate);
    map.set(row.item, current);
  });
  return [...map.values()];
}

function renderReports() {
  const balances = ledgerBalances();
  $("#trialBalance").innerHTML = table(["Ledger", "Debit", "Credit"], balances.map((row) => [row.name, row.balance >= 0 ? money(row.balance) : "", row.balance < 0 ? money(Math.abs(row.balance)) : ""]));
  const sales = companyRows(state.invoices).filter((row) => row.type === "Sales").reduce((sum, row) => sum + num(row.taxable), 0);
  const purchase = companyRows(state.invoices).filter((row) => row.type === "Purchase").reduce((sum, row) => sum + num(row.taxable), 0);
  const expenses = balances.filter((row) => row.group === "Expense").reduce((sum, row) => sum + Math.max(row.balance, 0), 0);
  $("#profitLoss").innerHTML = `<div><span>Sales</span><strong>${money(sales)}</strong></div><div><span>Purchase</span><strong>${money(purchase)}</strong></div><div><span>Expenses</span><strong>${money(expenses)}</strong></div><div><span>Net Profit</span><strong>${money(sales - purchase - expenses)}</strong></div>`;
  $("#ledgerReport").innerHTML = table(["Ledger", "Group", "Balance"], balances.map((row) => [row.name, row.group, `${money(Math.abs(row.balance))} ${row.balance >= 0 ? "Dr" : "Cr"}`]));
  renderCostCentreReport();
}

function renderCostCentreReport() {
  const rows = costCentreSummary();
  $("#costCentreReport").innerHTML = table(["Cost Centre", "Sales", "Purchase", "Voucher Amount", "Stock Value"], rows.map((row) => [
    row.name, money(row.sales), money(row.purchase), money(row.voucher), money(row.stock)
  ]));
}

function costCentreSummary() {
  const map = new Map(companyRows(state.costCentres).map((row) => [row.id, { id: row.id, name: row.name, sales: 0, purchase: 0, voucher: 0, stock: 0 }]));
  const ensure = (id) => {
    const key = id || "none";
    if (!map.has(key)) map.set(key, { id: key, name: id ? costCentreName(id) || "Unknown" : "No Cost Centre", sales: 0, purchase: 0, voucher: 0, stock: 0 });
    return map.get(key);
  };
  companyRows(state.invoices).forEach((row) => {
    const item = ensure(row.costCentreId);
    if (row.type === "Sales") item.sales += num(row.taxable);
    if (row.type === "Purchase") item.purchase += num(row.taxable);
  });
  companyRows(state.vouchers).forEach((row) => ensure(row.costCentreId).voucher += num(row.amount));
  companyRows(state.stock).forEach((row) => {
    const sign = row.type === "Stock Out" ? -1 : 1;
    ensure(row.costCentreId).stock += sign * num(row.qty) * num(row.rate);
  });
  return [...map.values()].filter((row) => row.id !== "none" || row.sales || row.purchase || row.voucher || row.stock);
}

function ledgerBalances() {
  return companyRows(state.ledgers).map((ledger) => {
    let balance = num(ledger.opening) * (ledger.balanceType === "Cr" ? -1 : 1);
    companyRows(state.vouchers).forEach((voucher) => {
      if (voucher.debitLedger === ledger.id) balance += num(voucher.amount);
      if (voucher.creditLedger === ledger.id) balance -= num(voucher.amount);
    });
    companyRows(state.invoices).forEach((invoice) => {
      if (invoice.partyLedger === ledger.id) balance += invoice.type === "Sales" ? num(invoice.total) : -num(invoice.total);
    });
    return { ...ledger, balance };
  });
}

function renderGst() {
  const rows = companyRows(state.invoices);
  const salesTax = rows.filter((row) => row.type === "Sales").reduce((sum, row) => sum + num(row.gstAmount), 0);
  const purchaseTax = rows.filter((row) => row.type === "Purchase").reduce((sum, row) => sum + num(row.gstAmount), 0);
  $("#gstSummary").innerHTML = table(["Particular", "Amount"], [
    ["Output GST on Sales", money(salesTax)],
    ["Input GST on Purchase", money(purchaseTax)],
    ["Net GST Payable", money(salesTax - purchaseTax)]
  ]);
}

async function autoBackup(reason) {
  const payload = makeBackupPayload(reason);
  await put("backups", { id: uid("bak"), companyId: activeCompanyId || "all", reason, createdAt: now(), payload });
  localStorage.setItem("spark_erp_last_backup", new Date().toLocaleString("en-IN"));
  await loadAll();
  renderBackupList();
}

async function requestPersistentStorage(showToast = false) {
  if (!navigator.storage?.persist) {
    renderStorageStatus("Browser support nahi hai");
    if (showToast) toast("Is browser me persistent storage support nahi hai");
    return false;
  }
  const alreadyPermanent = await navigator.storage.persisted();
  const isPermanent = alreadyPermanent || await navigator.storage.persist();
  const estimate = await navigator.storage.estimate?.();
  const usedMb = estimate?.usage ? ` (${(estimate.usage / 1024 / 1024).toFixed(1)} MB used)` : "";
  const label = isPermanent ? `Permanent${usedMb}` : `Browser managed${usedMb}`;
  renderStorageStatus(label);
  localStorage.setItem("spark_erp_storage_status", label);
  if (showToast) toast(isPermanent ? "Data permanent storage me lock ho gaya" : "Browser ne permanent storage allow nahi kiya");
  return isPermanent;
}

function renderStorageStatus(label) {
  const dash = $("#dashStorage");
  const backup = $("#storageStatus");
  if (dash) dash.textContent = label;
  if (backup) backup.textContent = label;
}

async function checkForUpdate(showToast = false) {
  const status = $("#updateStatus");
  try {
    if (showToast) status.textContent = "Checking online update...";
    const response = await fetch(RELEASE_API, { cache: "no-store" });
    if (!response.ok) throw new Error("No release");
    const release = await response.json();
    const latestVersion = normalizeVersion(release.tag_name || release.name);
    const apk = (release.assets || []).find((asset) => /\.apk$/i.test(asset.name));
    if (apk) {
      localStorage.setItem("spark_erp_update_url", apk.browser_download_url);
      localStorage.setItem("spark_erp_update_page", release.html_url || RELEASE_PAGE);
      localStorage.setItem("spark_erp_update_version", latestVersion);
      $("#downloadLatestBtn").dataset.url = apk.browser_download_url;
      $("#downloadLatestBtn").dataset.page = release.html_url || RELEASE_PAGE;
      $("#downloadLatestBtn").hidden = false;
    }
    if (latestVersion && compareVersions(latestVersion, APP_VERSION) > 0 && apk) {
      status.textContent = `Update available: v${latestVersion}`;
      showUpdatePopup(latestVersion, apk.browser_download_url);
      return true;
    }
    status.textContent = `Latest version installed: v${APP_VERSION}`;
    if (showToast) toast("Aapka app latest hai");
    return false;
  } catch (error) {
    status.textContent = "Update check unavailable";
    if (showToast) toast("Internet/release available nahi hai");
    return false;
  }
}

function showUpdatePopup(version, url) {
  $("#updatePopupText").textContent = `Spark ERP v${version} APK ready hai.`;
  $("#downloadUpdateBtn").dataset.url = url;
  $("#downloadUpdateBtn").dataset.page = localStorage.getItem("spark_erp_update_page") || RELEASE_PAGE;
  $("#updatePopup").hidden = false;
}

function hideUpdatePopup() {
  $("#updatePopup").hidden = true;
}

function downloadUpdate() {
  const page = $("#downloadUpdateBtn").dataset.page || $("#downloadLatestBtn").dataset.page || localStorage.getItem("spark_erp_update_page") || RELEASE_PAGE;
  if (window.SparkAndroid?.openUrl) {
    window.SparkAndroid.openUrl(page);
    toast("APK download page khul raha hai");
    return;
  }
  const url = $("#downloadUpdateBtn").dataset.url || $("#downloadLatestBtn").dataset.url || localStorage.getItem("spark_erp_update_url") || page;
  const link = document.createElement("a");
  link.href = url;
  link.target = "_self";
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => {
    window.location.href = page;
  }, 300);
}

function normalizeVersion(value) {
  const match = String(value || "").match(/\d+(?:\.\d+)*/);
  return match ? match[0] : "";
}

function compareVersions(a, b) {
  const left = a.split(".").map(num);
  const right = b.split(".").map(num);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

function renderBackupList() {
  $("#backupList").innerHTML = table(["Date", "Reason", "Company"], state.backups.slice(-20).reverse().map((row) => [new Date(row.createdAt).toLocaleString("en-IN"), row.reason, row.companyId]));
}

function updateAccessUi() {
  const allowed = allowedTabs();
  $$(".nav-btn").forEach((button) => {
    button.hidden = !allowed.includes(button.dataset.tab);
  });
  $$("[data-jump]").forEach((button) => {
    button.hidden = !allowed.includes(button.dataset.jump);
  });
  $("#sellerSetup").hidden = !isSuperAdmin(currentUser);
  $("#buyerWelcome").hidden = !currentUser || isSuperAdmin(currentUser);
  const activePanel = $(".panel.active")?.id || "dashboard";
  if (currentUser && !allowed.includes(activePanel)) showTab("dashboard");
  const superOption = Array.from($("#userForm").elements.role.options).find((option) => option.value === "Super Admin");
  if (superOption) superOption.hidden = !isSuperAdmin(currentUser);
}

function allowedTabs() {
  if (!currentUser) return ["dashboard"];
  if (isSuperAdmin(currentUser)) return ["dashboard", "companies", "users", "ledgers", "costCategories", "vouchers", "salesPurchase", "inventory", "reports", "gst", "backup"];
  if (currentUser.role === "Company Admin") return ["dashboard", "users", "ledgers", "costCategories", "vouchers", "salesPurchase", "inventory", "reports", "gst", "backup"];
  if (currentUser.role === "Accountant") return ["dashboard", "ledgers", "costCategories", "vouchers", "salesPurchase", "inventory", "reports", "gst", "backup"];
  if (currentUser.role === "Viewer") return ["dashboard", "reports", "gst"];
  return ["dashboard"];
}

function canOpenTab(id) {
  return allowedTabs().includes(id);
}

function makeBackupPayload(reason = "export") {
  return { app: "Spark ERP Phase 1", reason, exportedAt: now(), activeCompanyId, data: state };
}

function exportBackup() {
  const payload = makeBackupPayload("export");
  download(`spark-erp-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), "application/json");
}

async function importBackup() {
  const file = $("#importBackupFile").files[0];
  if (!file) return toast("Backup file select karo");
  const payload = JSON.parse(await file.text());
  const data = payload.data || {};
  for (const name of STORES) {
    const tx = db.transaction(name, "readwrite").objectStore(name);
    await new Promise((resolve, reject) => {
      const req = tx.clear();
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
    });
    for (const row of data[name] || []) await put(name, row);
  }
  activeCompanyId = payload.activeCompanyId || "";
  await loadAll();
  renderAll();
  toast("Backup imported");
}

function requireCompany() {
  if (activeCompany()) return true;
  toast("Pehle company create/select karo");
  showTab("companies");
  return false;
}

function readForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function fillForm(form, data) {
  Object.entries(data).forEach(([key, value]) => {
    const field = form.elements[key];
    if (field) field.value = value ?? "";
  });
}

function resetUserForm() {
  const form = $("#userForm");
  form.reset();
  form.elements.companyId.value = activeCompanyId || "";
  updateUserCompanyField();
}

function updateUserCompanyField() {
  const form = $("#userForm");
  const isGlobal = form.elements.role.value === "Super Admin";
  form.elements.companyId.disabled = isGlobal;
  if (isGlobal) form.elements.companyId.value = "";
  if (!isGlobal && !form.elements.companyId.value && activeCompanyId) form.elements.companyId.value = activeCompanyId;
}

function table(headers, rows) {
  if (!rows.length) return `<div class="empty">No records.</div>`;
  return `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell ?? ""}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function ledgerName(id) {
  return state.ledgers.find((row) => row.id === id)?.name || "";
}

function costCategoryName(id) {
  return state.costCategories.find((row) => row.id === id)?.name || "";
}

function costCentreName(id) {
  return state.costCentres.find((row) => row.id === id)?.name || "";
}

function companyName(id) {
  return state.companies.find((row) => row.id === id)?.name || "Company not found";
}

function companyCode(company) {
  return String(company?.code || company?.id || "").toUpperCase();
}

function nextCompanyCode() {
  const next = state.companies.length + 1;
  return `SPK${String(next).padStart(3, "0")}`;
}

function isSuperAdmin(user) {
  return user?.role === "Super Admin";
}

function canManageUsers() {
  return isSuperAdmin(currentUser) || currentUser?.role === "Company Admin";
}

function nextInvoiceNo() {
  return String(companyRows(state.invoices).length + 1).padStart(4, "0");
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function now() {
  return new Date().toISOString();
}

function num(value) {
  return Number(value || 0);
}

function money(value) {
  return num(value).toFixed(2);
}

function dateShort(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => String(cell).trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  row.push(value);
  if (row.some((cell) => String(cell).trim())) rows.push(row);
  const headers = rows.shift()?.map((cell) => String(cell).trim()) || [];
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header || `Column ${index + 1}`, cells[index] || ""])));
}

function normalizeImportRow(source) {
  const entries = Object.entries(source).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ""), String(value || "").trim()]);
  const pick = (...names) => entries.find(([key]) => names.includes(key))?.[1] || "";
  return {
    name: pick("categoryname", "category", "name", "costcategory", "column1") || String(Object.values(source)[0] || "").trim(),
    type: pick("type", "categorytype") || "Primary",
    status: pick("status") || "Active",
    notes: pick("notes", "note", "remark", "remarks", "description")
  };
}

function roleBadge(role) {
  const safeRole = escapeHtml(role || "Viewer");
  const slug = safeRole.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `<span class="role-badge role-${slug}">${safeRole}</span>`;
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

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  setTimeout(() => node.classList.remove("show"), 2200);
}
