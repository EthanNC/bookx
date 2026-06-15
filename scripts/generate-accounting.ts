/**
 * Generates accounting seed data (db/accounting.sql) for the Northwind dataset.
 *
 * The blueprint adds four tables that give accountants a full AR + AP cycle:
 *   - CustomerPayment        settlements against existing Orders (receivables)
 *   - SupplierInvoice        what suppliers billed us (payables)
 *   - SupplierInvoiceDetail  purchase lines, carrying inventory cost basis
 *   - SupplierPayment        what we paid suppliers
 *
 * Nothing is invented out of thin air: every row is derived deterministically
 * from the canonical data in db/data.sql so the numbers reconcile.
 *   - CustomerPayment.Amount equals the order's net line total.
 *   - SupplierInvoiceDetail.UnitCost sits below Product.UnitPrice, so
 *     (sale price - cost) is a sensible gross margin per product.
 *   - Recent orders/invoices are left open so AR/AP aging is non-trivial.
 *
 * Run with:  bun scripts/generate-accounting.ts
 */

import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const dataFile = join(root, "db/data.sql");
const outFile = join(root, "db/accounting.sql");

// --- deterministic helpers -------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function pick<T>(items: readonly T[], r: number): T {
  return items[Math.min(items.length - 1, Math.floor(r * items.length))];
}

// --- date helpers (UTC, YYYY-MM-DD) ---------------------------------------

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

function monthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// --- SQL value-tuple parser -----------------------------------------------
// Parses the inside of `VALUES(...)`, honouring single-quoted strings with
// '' escapes, NULLs and numeric literals.

function parseTuple(inner: string): (string | null)[] {
  const out: (string | null)[] = [];
  let i = 0;
  const n = inner.length;
  while (i < n) {
    while (i < n && (inner[i] === " " || inner[i] === ",")) i++;
    if (i >= n) break;
    if (inner[i] === "'") {
      i++;
      let s = "";
      while (i < n) {
        if (inner[i] === "'") {
          if (inner[i + 1] === "'") {
            s += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        s += inner[i++];
      }
      out.push(s);
    } else {
      let tok = "";
      while (i < n && inner[i] !== ",") tok += inner[i++];
      tok = tok.trim();
      out.push(tok.toUpperCase() === "NULL" ? null : tok);
    }
  }
  return out;
}

type Row = (string | null)[];

function parseTable(sql: string, table: string): Row[] {
  const rows: Row[] = [];
  const re = new RegExp(
    `^INSERT INTO (?:"${table}"|${table}) VALUES\\((.*)\\);\\s*$`,
    "gm",
  );
  let m = re.exec(sql);
  while (m !== null) {
    rows.push(parseTuple(m[1]));
    m = re.exec(sql);
  }
  return rows;
}

// --- SQL output helpers ----------------------------------------------------

function sqlStr(s: string | null): string {
  if (s === null) return "NULL";
  return `'${s.replace(/'/g, "''")}'`;
}

function sqlNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// --- main ------------------------------------------------------------------

const sql = await Bun.file(dataFile).text();

// Order: Id, CustomerId, EmployeeId, OrderDate, ...
const orders = parseTable(sql, "Order").map((r) => ({
  id: Number(r[0]),
  customerId: r[1],
  date: parseDate(r[3]),
}));

// OrderDetail: Id, OrderId, ProductId, UnitPrice, Quantity, Discount
const orderDetails = parseTable(sql, "OrderDetail").map((r) => ({
  orderId: Number(r[1]),
  productId: Number(r[2]),
  unitPrice: Number(r[3]),
  quantity: Number(r[4]),
  discount: Number(r[5]),
}));

// Product: Id, ProductName, SupplierId, CategoryId, QuantityPerUnit, UnitPrice
const products = parseTable(sql, "Product").map((r) => ({
  id: Number(r[0]),
  supplierId: Number(r[2]),
  unitPrice: Number(r[5]),
}));

const suppliers = parseTable(sql, "Supplier").map((r) => ({
  id: Number(r[0]),
}));

const productById = new Map(products.map((p) => [p.id, p]));
const orderById = new Map(orders.map((o) => [o.id, o]));

// Dataset "today": shortly after the most recent order, so that the tail end
// of orders/invoices is still outstanding (realistic AR/AP aging).
const orderTimes: number[] = [];
for (const o of orders) {
  if (o.date) orderTimes.push(o.date.getTime());
}
const maxOrderTime = Math.max(...orderTimes);
const datasetToday = addDays(new Date(maxOrderTime), 15);

const METHODS = ["bank_transfer", "cheque", "credit"] as const;

// === CustomerPayment (AR) ==================================================
// Net total per order, paid on payment terms inferred from the customer.

const netByOrder = new Map<number, number>();
for (const d of orderDetails) {
  const net = d.unitPrice * d.quantity * (1 - d.discount);
  netByOrder.set(d.orderId, (netByOrder.get(d.orderId) ?? 0) + net);
}

const customerPayments: string[] = [];
let cpId = 0;
let arOutstanding = 0;
let arOutstandingAmt = 0;

for (const o of [...orders].sort((a, b) => a.id - b.id)) {
  const net = netByOrder.get(o.id);
  if (!net || !o.date) continue;
  const amount = round2(net);

  // Base payment terms depend on the customer; jitter per order.
  const r = mulberry32(o.id * 2654435761);
  const baseTerms = pick(
    [10, 14, 30, 30, 45, 60],
    (hashStr(o.customerId ?? "") % 1000) / 1000,
  );
  const termsDays = baseTerms + Math.floor(r() * 16);
  const payDate = addDays(o.date, termsDays);

  if (payDate.getTime() > datasetToday.getTime()) {
    arOutstanding++;
    arOutstandingAmt += amount;
    continue; // still an open receivable
  }

  cpId++;
  const method = pick(METHODS, r());
  customerPayments.push(
    `INSERT INTO "CustomerPayment" VALUES(${cpId},${o.id},${sqlStr(o.customerId)},${sqlStr(fmtDate(payDate))},${sqlNum(amount)},${sqlStr(method)},${sqlStr(`PMT-${o.id}`)});`,
  );
}

// === SupplierInvoice / Detail / Payment (AP) ===============================
// Northwind has no purchasing records, so we synthesise monthly purchases
// from each supplier sized to the demand for their products that month.

// Aggregate demand: supplier -> month -> product -> units sold.
type MonthAgg = { start: Date; products: Map<number, number> };
const bySupplier = new Map<number, Map<string, MonthAgg>>();

for (const d of orderDetails) {
  const p = productById.get(d.productId);
  const o = orderById.get(d.orderId);
  if (!p || !o?.date) continue;
  const mk = monthKey(o.date);
  let months = bySupplier.get(p.supplierId);
  if (!months) {
    months = new Map();
    bySupplier.set(p.supplierId, months);
  }
  let agg = months.get(mk);
  if (!agg) {
    agg = { start: monthStart(o.date), products: new Map() };
    months.set(mk, agg);
  }
  agg.products.set(
    d.productId,
    (agg.products.get(d.productId) ?? 0) + d.quantity,
  );
}

// Per-product cost ratio (cost as a fraction of sale price) → gross margin.
function costRatio(productId: number): number {
  const r = mulberry32(hashStr(`cost-${productId}`));
  return 0.55 + r() * 0.17; // 0.55..0.72 → 28%..45% margin
}

const supplierInvoices: string[] = [];
const supplierInvoiceDetails: string[] = [];
const supplierPayments: string[] = [];
let siId = 0;
let sidId = 0;
let spId = 0;
let apOutstanding = 0;
let apOutstandingAmt = 0;

for (const s of [...suppliers].sort((a, b) => a.id - b.id)) {
  const months = bySupplier.get(s.id);
  if (!months) continue;
  // chronological order of months
  const entries = [...months.entries()].sort(
    (a, b) => a[1].start.getTime() - b[1].start.getTime(),
  );

  for (const [mk, agg] of entries) {
    siId++;
    const r = mulberry32(hashStr(`inv-${s.id}-${mk}`));
    // Purchase a little ahead of demand (buffer stock).
    const lines: {
      productId: number;
      qty: number;
      unitCost: number;
      lineTotal: number;
    }[] = [];
    for (const [productId, demand] of [...agg.products.entries()].sort(
      (a, b) => a[0] - b[0],
    )) {
      const p = productById.get(productId);
      if (!p) continue;
      const buffer = 1.1 + r() * 0.25;
      const qty = Math.max(1, Math.ceil(demand * buffer));
      const unitCost = round2(p.unitPrice * costRatio(productId));
      const lineTotal = round2(qty * unitCost);
      lines.push({ productId, qty, unitCost, lineTotal });
    }
    const total = round2(lines.reduce((sum, l) => sum + l.lineTotal, 0));

    const invoiceDate = addDays(agg.start, Math.floor(r() * 10));
    const dueDate = addDays(invoiceDate, 30);
    const payDelay = -3 + Math.floor(r() * 11); // -3..7 days around due date
    const payDate = addDays(dueDate, payDelay);

    let status: string;
    if (payDate.getTime() <= datasetToday.getTime()) {
      status = "paid";
      spId++;
      supplierPayments.push(
        `INSERT INTO "SupplierPayment" VALUES(${spId},${siId},${sqlStr(fmtDate(payDate))},${sqlNum(total)},${sqlStr(pick(METHODS, r()))},${sqlStr(`SPMT-${String(spId).padStart(5, "0")}`)});`,
      );
    } else if (invoiceDate.getTime() <= datasetToday.getTime()) {
      status = "approved";
      apOutstanding++;
      apOutstandingAmt += total;
    } else {
      status = "draft";
    }

    supplierInvoices.push(
      `INSERT INTO "SupplierInvoice" VALUES(${siId},${s.id},${sqlStr(fmtDate(invoiceDate))},${sqlStr(fmtDate(dueDate))},${sqlNum(total)},${sqlStr(status)},${sqlStr(`S${s.id}-${mk}`)});`,
    );
    for (const l of lines) {
      sidId++;
      supplierInvoiceDetails.push(
        `INSERT INTO "SupplierInvoiceDetail" VALUES(${sidId},${siId},${l.productId},${l.qty},${sqlNum(l.unitCost)},${sqlNum(l.lineTotal)});`,
      );
    }
  }
}

// --- write -----------------------------------------------------------------

const header = `-- Generated by scripts/generate-accounting.ts — do not edit by hand.
-- Derived deterministically from db/data.sql (Order, OrderDetail, Product, Supplier).
-- Dataset reference date: ${fmtDate(datasetToday)}
`;

const body = [
  "",
  `-- CustomerPayment: ${customerPayments.length} settlements (AR)`,
  ...customerPayments,
  "",
  `-- SupplierInvoice: ${supplierInvoices.length} invoices (AP)`,
  ...supplierInvoices,
  "",
  `-- SupplierInvoiceDetail: ${supplierInvoiceDetails.length} purchase lines`,
  ...supplierInvoiceDetails,
  "",
  `-- SupplierPayment: ${supplierPayments.length} payments (AP)`,
  ...supplierPayments,
  "",
].join("\n");

await Bun.write(outFile, header + body);

console.log("Wrote db/accounting.sql");
console.log(`  CustomerPayment       ${customerPayments.length} rows`);
console.log(
  `  Open receivables      ${arOutstanding} orders (${round2(arOutstandingAmt)})`,
);
console.log(`  SupplierInvoice       ${supplierInvoices.length} rows`);
console.log(`  SupplierInvoiceDetail ${supplierInvoiceDetails.length} rows`);
console.log(`  SupplierPayment       ${supplierPayments.length} rows`);
console.log(
  `  Open payables         ${apOutstanding} invoices (${round2(apOutstandingAmt)})`,
);
