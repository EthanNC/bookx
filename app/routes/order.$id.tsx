import { useEffect } from "react";
import { Link, useNavigate } from "react-router";

import { Resource } from "sst/resource";

import { AddTableField } from "~/components";
import { useStatsDispatch } from "~/components/StatsContext";
import { createSQLLog, prepareStatements } from "~/lib/utils";

import type { Route } from "./+types/order.$id";

interface OrderRow {
  Id: string;
  CustomerId: string;
  OrderDate: string;
  ShippedDate: string;
  ShipName: string;
  TotalReceivable: string | number;
  PaymentAmount: string | number;
  ReceivableBalance: string | number;
  ReceivableStatus: string;
}

interface OrderProductRow {
  Id: number;
  ProductName: string;
  Quantity: number;
  OrderUnitPrice: string | number;
  Discount: number;
}

interface CustomerPaymentRow {
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
      'SELECT "Order".Id, "Order".CustomerId, "Order".OrderDate, "Order".ShippedDate, "Order".ShipName, CustomerReceivable_V.TotalReceivable, CustomerReceivable_V.PaymentAmount, CustomerReceivable_V.ReceivableBalance, CustomerReceivable_V.ReceivableStatus FROM "Order" JOIN CustomerReceivable_V ON CustomerReceivable_V.OrderId = "Order".Id WHERE "Order".Id = ?1',
      "SELECT OrderDetail.OrderId, OrderDetail.Quantity, OrderDetail.UnitPrice AS OrderUnitPrice, OrderDetail.Discount, Product.Id, ProductName, SupplierId, CategoryId, QuantityPerUnit, Product.UnitPrice AS ProductUnitPrice, UnitsInStock, UnitsOnOrder, ReorderLevel, Discontinued FROM Product, OrderDetail WHERE OrderDetail.OrderId = ?1 AND OrderDetail.ProductId = Product.Id",
      "SELECT Id, PaymentDate, Amount, Method, Reference FROM CustomerPayment WHERE OrderId = ?1 ORDER BY PaymentDate, Id",
    ],
    [[id], [id], [id]],
  );
  try {
    const startTime = Date.now();
    const response: D1Result<unknown>[] = await session.batch(
      stmts as D1PreparedStatement[],
    );
    const overallTimeMs = Date.now() - startTime;

    const orders = response[0].results as OrderRow[] | undefined;
    const products = (response[1].results ?? []) as OrderProductRow[];
    const payments = (response[2].results ?? []) as CustomerPaymentRow[];
    return {
      stats: {
        queries: stmts.length,
        results: (orders?.length ?? 0) + products.length + payments.length,
        select: stmts.length,
        overallTimeMs: overallTimeMs,
        log: createSQLLog(sql, response, overallTimeMs),
      },
      order: orders ? orders[0] : undefined,
      products: products,
      payments: payments,
    };
  } catch (e: unknown) {
    return { error: 404, msg: e instanceof Error ? e.toString() : String(e) };
  }
}

export default function Order({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();

  const order = loaderData.order;
  const products = loaderData.products ?? [];
  const payments = loaderData.payments ?? [];
  const stats = loaderData.stats;

  const dispatch = useStatsDispatch();
  useEffect(() => {
    dispatch && stats && dispatch(stats);
  }, [dispatch, stats]);

  return (
    <>
      {order ? (
        <div className="card mb-6">
          <header className="card-header">
            <p className="card-header-title">
              <span className="icon material-icons">ballot</span>
              <span className="ml-2">Order information</span>
            </p>
          </header>
          <div className="card-content">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <AddTableField
                  name="Customer Id"
                  link={`/customer/${order.CustomerId}`}
                  value={order.CustomerId}
                />
                <AddTableField name="Ship Name" value={order.ShipName} />
                <AddTableField name="Status" value={order.ReceivableStatus} />
                <AddTableField
                  name="Total"
                  value={currency(order.TotalReceivable)}
                />
              </div>
              <div>
                <AddTableField name="Order Date" value={order.OrderDate} />
                <AddTableField name="Shipped Date" value={order.ShippedDate} />
                <AddTableField
                  name="Paid"
                  value={currency(order.PaymentAmount)}
                />
                <AddTableField
                  name="Balance"
                  value={currency(order.ReceivableBalance)}
                />
              </div>
            </div>
          </div>
          <div className="card has-table">
            <header className="card-header">
              <p className="card-header-title">Products in Order</p>
            </header>
            <div className="card-content">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Quantity</th>
                    <th>Order Price</th>
                    <th>Total Price</th>
                    <th>Discount</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product: OrderProductRow) => {
                    const lineTotal =
                      Number(product.OrderUnitPrice) * Number(product.Quantity);
                    return (
                      <tr key={product.Id}>
                        <td data-label="Product">
                          <Link className="link" to={`/product/${product.Id}`}>
                            {product.ProductName}
                          </Link>
                        </td>
                        <td data-label="Quantity">{product.Quantity}</td>
                        <td data-label="OrderPrice">
                          {currency(product.OrderUnitPrice)}
                        </td>
                        <td data-label="TotalPrice">{currency(lineTotal)}</td>
                        <td data-label="Discount">{`${
                          product.Discount * 100
                        }%`}</td>
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
                    {payments.map((payment: CustomerPaymentRow) => {
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
                <p>No payments recorded for this order.</p>
              )}
            </div>
          </div>
          <div className="card-content">
            <div className="field grouped">
              <div className="control">
                <button
                  type="reset"
                  onClick={() => {
                    navigate(`/orders`, { replace: false });
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
          <h2>No such order</h2>
        </div>
      )}
    </>
  );
}
