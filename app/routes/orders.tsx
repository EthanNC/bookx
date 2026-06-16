import { useEffect } from "react";
import { Link, useNavigate } from "react-router";

import { Resource } from "sst/resource";

import { Paginate } from "~/components";
import { useStatsDispatch } from "~/components/StatsContext";
import { createSQLLog, prepareStatements } from "~/lib/utils";

import type { Route } from "./+types/orders";

export interface Order {
  Id: string;
  OrderDate: string;
  ShipName: string;
  ShipCity: string;
  ShipCountry: string;
  TotalReceivable: string;
}

interface CountRow {
  total: number;
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
    count ? '"Order"' : false,
    [
      'SELECT "Order".Id, "Order".OrderDate, "Order".ShipName, "Order".ShipCity, "Order".ShipCountry, CustomerReceivable_V.TotalReceivable FROM "Order" JOIN CustomerReceivable_V ON CustomerReceivable_V.OrderId = "Order".Id ORDER BY "Order".OrderDate DESC, "Order".Id DESC LIMIT ?1 OFFSET ?2',
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

    const orders = (
      count ? response.slice(1)[0].results : response[0].results
    ) as Order[];

    return {
      page: page,
      pages: count ? Math.ceil(total / itemsPerPage) : 0,
      items: itemsPerPage,
      total: count ? total : 0,
      stats: {
        queries: stmts.length,
        results: orders.length + (count ? 1 : 0),
        select: stmts.length,
        overallTimeMs: overallTimeMs,
        log: createSQLLog(sql, response, overallTimeMs),
      },
      orders: orders,
    };
  } catch (e: unknown) {
    return { error: 404, msg: e instanceof Error ? e.toString() : String(e) };
  }
}

export default function Orders({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const orders = loaderData.orders ?? [];
  const page = loaderData.page ?? 1;
  const pages = loaderData.pages ?? 0;
  const stats = loaderData.stats;
  const dispatch = useStatsDispatch();

  useEffect(() => {
    dispatch && stats && dispatch(stats);
  }, [dispatch, stats]);

  const setPage = (page: number) => {
    navigate(`/orders?page=${page}`);
  };

  return (
    <>
      {orders.length ? (
        <div className="card has-table">
          <header className="card-header">
            <p className="card-header-title">Orders</p>
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
                  <th>Id</th>
                  <th>Date</th>
                  <th>Ship Name</th>
                  <th>City</th>
                  <th>Country</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order: Order) => {
                  return (
                    <tr key={order.Id}>
                      <td data-label="Id">
                        <Link className="link" to={`/order/${order.Id}`}>
                          {order.Id}
                        </Link>
                      </td>
                      <td data-label="Date">{order.OrderDate}</td>
                      <td data-label="Ship Name">{order.ShipName}</td>
                      <td data-label="City">{order.ShipCity}</td>
                      <td data-label="Country">{order.ShipCountry}</td>
                      <td data-label="Total">
                        {currency(order.TotalReceivable)}
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
          <h2>Loading orders...</h2>
        </div>
      )}
    </>
  );
}
