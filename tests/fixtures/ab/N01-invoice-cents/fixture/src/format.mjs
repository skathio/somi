export const formatAmount = (x) => `$${x.toFixed(2)}`;
export const formatTotals = ({ net, tax, gross }) => ({ net: formatAmount(net), tax: formatAmount(tax), gross: formatAmount(gross) });
