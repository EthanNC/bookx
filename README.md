# bookx

Bookkeeping demo on the [Northwind](https://github.com/jpwhite3/northwind-SQLite3) 

## Accounting extensions

AR/AP tables on top of Northwind: `CustomerPayment`, `SupplierInvoice`, `SupplierInvoiceDetail`, `SupplierPayment`.

```mermaid
graph TD
    supplier[Supplier] --> invoice[SupplierInvoice]
    invoice --> detail[SupplierInvoiceDetail]
    invoice --> payment[SupplierPayment]
```

```mermaid
graph TD
    customer[Customer] --> order[Order]
    order --> detail[OrderDetail]
    order --> payment[CustomerPayment]
```

## Stack

[React Router](https://reactrouter.com/) · [Cloudflare D1](https://developers.cloudflare.com/d1/) · [SST](https://sst.dev/)
