import { useEffect } from "react";
import { Link, useNavigate } from "react-router";

import { Resource } from "sst/resource";

import { Paginate } from "~/components";
import { useStatsDispatch } from "~/components/StatsContext";
import { createSQLLog, prepareStatements } from "~/lib/utils";

import type { Route } from "./+types/supplier-invoices";

interface CountRow {
  total: number;
}

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

const currency = (value: string | number) =>
  `$${Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export async function loader({ request }: Route.LoaderArgs) {
  const session = Resource.MyDatabase.withSession("first-unconstrained");
  const { searchParams } = new URL(request.url);
  const count = true;
  const page = parseInt(searchParams.get("page") as string, 10) || 1;
  const itemsPerPage = 20;

  const [stmts, sql] = prepareStatements(
    session,
    count ? "SupplierInvoice" : false,
    [
      "SELECT SupplierInvoice.Id, SupplierInvoice.SupplierId, Supplier.CompanyName AS SupplierName, InvoiceDate, DueDate, TotalAmount, Status, Reference FROM SupplierInvoice, Supplier WHERE SupplierInvoice.SupplierId = Supplier.Id ORDER BY InvoiceDate DESC, SupplierInvoice.Id DESC LIMIT ?1 OFFSET ?2",
    ],
    [[itemsPerPage, (page - 1) * itemsPerPage]],
  );

  try {
    const startTime = Date.now();
    const response: D1Result<unknown>[] = await session.batch(
      stmts as D1PreparedStatement[],
    );
    const overallTimeMs = Date.now() - startTime;

    const first = response[0];
    const total =
      count && first.results ? (first.results[0] as CountRow).total : 0;
    const invoices = (
      count ? response.slice(1)[0].results : response[0].results
    ) as SupplierInvoiceRow[];

    return {
      page,
      pages: count ? Math.ceil(total / itemsPerPage) : 0,
      items: itemsPerPage,
      total: count ? total : 0,
      stats: {
        queries: stmts.length,
        results: invoices.length + (count ? 1 : 0),
        select: stmts.length,
        overallTimeMs,
        log: createSQLLog(sql, response, overallTimeMs),
      },
      invoices,
    };
  } catch (e: unknown) {
    return { error: 404, msg: e instanceof Error ? e.toString() : String(e) };
  }
}

export default function SupplierInvoices({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const invoices = loaderData.invoices ?? [];
  const page = loaderData.page ?? 1;
  const pages = loaderData.pages ?? 0;
  const stats = loaderData.stats;
  const dispatch = useStatsDispatch();

  useEffect(() => {
    dispatch && stats && dispatch(stats);
  }, [dispatch, stats]);

  const setPage = (page: number) => {
    navigate(`/supplier-invoices?page=${page}`);
  };

  return (
    <>
      {invoices.length ? (
        <div className="card has-table">
          <header className="card-header">
            <p className="card-header-title">Payables</p>
            <button
              className="card-header-icon"
              type="button"
              onClick={() => {
                window.location.reload();
              }}
            >
              <span className="material-icons">redo</span>
            </button>
          </header>
          <div className="card-content">
            <table>
              <thead>
                <tr>
                  <th>Invoice Reference</th>
                  <th>Supplier</th>
                  <th>Invoice Date</th>
                  <th>Due Date</th>
                  <th>Status</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice: SupplierInvoiceRow) => {
                  return (
                    <tr key={invoice.Id}>
                      <td data-label="Reference">
                        <Link
                          className="link"
                          to={`/supplier-invoice/${invoice.Id}`}
                        >
                          {invoice.Reference}
                        </Link>
                      </td>
                      <td data-label="Supplier">
                        <Link
                          className="link"
                          to={`/supplier/${invoice.SupplierId}`}
                        >
                          {invoice.SupplierName}
                        </Link>
                      </td>
                      <td data-label="Invoice Date">{invoice.InvoiceDate}</td>
                      <td data-label="Due Date">{invoice.DueDate}</td>
                      <td data-label="Status">{invoice.Status}</td>
                      <td data-label="Total">
                        {currency(invoice.TotalAmount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Paginate pages={pages} page={page} setPage={setPage} />
          </div>
        </div>
      ) : (
        <div className="card-content">
          <h2>Loading supplier invoices...</h2>
        </div>
      )}
    </>
  );
}
