import { useEffect } from "react";
import { Link, useNavigate } from "react-router";

import { Resource } from "sst/resource";

import { AddTableField } from "~/components";
import { useStatsDispatch } from "~/components/StatsContext";
import { createSQLLog, prepareStatements } from "~/lib/utils";

import type { Route } from "./+types/supplier-invoice.$id";

interface SupplierInvoiceRow {
  Id: number;
  SupplierId: number;
  SupplierName: string;
  InvoiceDate: string;
  DueDate: string;
  TotalAmount: string | number;
  Status: string;
  Reference: string;
}

interface SupplierInvoiceDetailRow {
  Id: number;
  ProductId: number;
  ProductName: string;
  Quantity: number;
  UnitCost: string | number;
  LineTotal: string | number;
}

interface SupplierPaymentRow {
  Id: number;
  PaymentDate: string;
  Amount: string | number;
  Method: string;
  Reference: string;
}

const currency = (value: string | number) =>
  `$${Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export async function loader({ params }: Route.LoaderArgs) {
  const session = Resource.MyDatabase.withSession("first-unconstrained");
  const { id } = params;

  const [stmts, sql] = prepareStatements(
    session,
    false,
    [
      "SELECT SupplierInvoice.Id, SupplierInvoice.SupplierId, Supplier.CompanyName AS SupplierName, InvoiceDate, DueDate, TotalAmount, Status, Reference FROM SupplierInvoice, Supplier WHERE SupplierInvoice.SupplierId = Supplier.Id AND SupplierInvoice.Id = ?1",
      "SELECT SupplierInvoiceDetail.Id, ProductId, Product.ProductName, Quantity, UnitCost, LineTotal FROM SupplierInvoiceDetail, Product WHERE SupplierInvoiceDetail.ProductId = Product.Id AND SupplierInvoiceDetail.SupplierInvoiceId = ?1 ORDER BY SupplierInvoiceDetail.Id",
      "SELECT Id, PaymentDate, Amount, Method, Reference FROM SupplierPayment WHERE SupplierInvoiceId = ?1 ORDER BY PaymentDate, Id",
    ],
    [[id], [id], [id]],
  );

  try {
    const startTime = Date.now();
    const response: D1Result<unknown>[] = await session.batch(
      stmts as D1PreparedStatement[],
    );
    const overallTimeMs = Date.now() - startTime;

    const invoice = response[0].results
      ? (response[0].results[0] as SupplierInvoiceRow)
      : undefined;
    const details = (response[1].results ?? []) as SupplierInvoiceDetailRow[];
    const payments = (response[2].results ?? []) as SupplierPaymentRow[];

    return {
      stats: {
        queries: stmts.length,
        results: (invoice ? 1 : 0) + details.length + payments.length,
        select: stmts.length,
        overallTimeMs,
        log: createSQLLog(sql, response, overallTimeMs),
      },
      invoice,
      details,
      payments,
    };
  } catch (e: unknown) {
    return { error: 404, msg: e instanceof Error ? e.toString() : String(e) };
  }
}

export default function SupplierInvoice({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const invoice = loaderData.invoice;
  const details = loaderData.details ?? [];
  const payments = loaderData.payments ?? [];
  const stats = loaderData.stats;
  const dispatch = useStatsDispatch();

  useEffect(() => {
    dispatch && stats && dispatch(stats);
  }, [dispatch, stats]);

  const paid = payments.reduce(
    (sum: number, payment: SupplierPaymentRow) => sum + Number(payment.Amount),
    0,
  );
  const balance = invoice ? Number(invoice.TotalAmount) - paid : 0;

  return (
    <>
      {invoice ? (
        <div className="card mb-6">
          <header className="card-header">
            <p className="card-header-title">
              <span className="icon material-icons">receipt_long</span>
              <span className="ml-2">Supplier invoice information</span>
            </p>
          </header>
          <div className="card-content">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <AddTableField name="Reference" value={invoice.Reference} />
                <AddTableField
                  name="Supplier"
                  link={`/supplier/${invoice.SupplierId}`}
                  value={invoice.SupplierName}
                />
                <AddTableField name="Status" value={invoice.Status} />
                <AddTableField
                  name="Total"
                  value={currency(invoice.TotalAmount)}
                />
              </div>
              <div>
                <AddTableField
                  name="Invoice Date"
                  value={invoice.InvoiceDate}
                />
                <AddTableField name="Due Date" value={invoice.DueDate} />
                <AddTableField name="Paid" value={currency(paid)} />
                <AddTableField name="Balance" value={currency(balance)} />
              </div>
            </div>
          </div>

          <div className="card has-table">
            <header className="card-header">
              <p className="card-header-title">Invoice Details</p>
            </header>
            <div className="card-content">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Quantity</th>
                    <th>Unit Cost</th>
                    <th>Line Total</th>
                  </tr>
                </thead>
                <tbody>
                  {details.map((detail: SupplierInvoiceDetailRow) => {
                    return (
                      <tr key={detail.Id}>
                        <td data-label="Product">
                          <Link
                            className="link"
                            to={`/product/${detail.ProductId}`}
                          >
                            {detail.ProductName}
                          </Link>
                        </td>
                        <td data-label="Quantity">{detail.Quantity}</td>
                        <td data-label="Unit Cost">
                          {currency(detail.UnitCost)}
                        </td>
                        <td data-label="Line Total">
                          {currency(detail.LineTotal)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card has-table">
            <header className="card-header">
              <p className="card-header-title">Payments</p>
            </header>
            <div className="card-content">
              {payments.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Date</th>
                      <th>Method</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((payment: SupplierPaymentRow) => {
                      return (
                        <tr key={payment.Id}>
                          <td data-label="Reference">{payment.Reference}</td>
                          <td data-label="Date">{payment.PaymentDate}</td>
                          <td data-label="Method">{payment.Method}</td>
                          <td data-label="Amount">
                            {currency(payment.Amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p>No payments recorded for this invoice.</p>
              )}
            </div>
          </div>

          <div className="card-content">
            <div className="field grouped">
              <div className="control">
                <button
                  type="reset"
                  onClick={() => {
                    navigate(`/supplier-invoices`, { replace: false });
                  }}
                  className="button red"
                >
                  Go back
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="card-content">
          <h2>No such supplier invoice</h2>
        </div>
      )}
    </>
  );
}
