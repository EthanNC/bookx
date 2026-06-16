# bookx

book keeping example on northwind database


### Extending Dataset
extending the dataset to add full accounting cycle:
- CustomerPayment
- SupplierInvoice
- SupplierInvoiceDetail
- SupplierPayment



### Account Payables (AP)

```mermaid
graph TD
    supplier[Supplier] --> invoice[SupplierInvoice]
    invoice --> detail[SupplierInvoiceDetail]
    invoice --> payment[SupplierPayment]
```

### Account Receivables (AR)

```mermaid
graph TD
    customer[Customer] --> order[Order]
    order --> detail[OrderDetail]
    order --> payment[CustomerPayment]
```