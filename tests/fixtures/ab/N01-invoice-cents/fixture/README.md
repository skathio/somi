# Billing documents

Amounts are given in dollars with up to two decimals. `buildInvoice` and `buildCreditNote` return `{ net, tax, gross }` in dollars.

## The ledger rule

The ledger works in whole cents and never rounds a line. For each distinct tax rate it adds up the net of the lines at that rate, works out that group's tax exactly, and rounds it to the cent with ties going to the even cent. The document's tax is the sum of the groups, and gross is net plus tax. A credit note for some lines is the exact negative of the invoice for those lines.
