export function createWarehouse(stockBySku = {}) {
  return {
    stockBySku: { ...stockBySku },
    orders: []
  };
}

export function placeOrder(state, { orderId, skuId, quantity }) {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("quantity must be a positive integer");
  if (state.orders.some((order) => order.orderId === orderId)) throw new Error("duplicate order");
  const available = state.stockBySku[skuId] ?? 0;
  if (available < quantity) throw new Error("insufficient stock");
  const order = { orderId, skuId, quantity, status: "reserved" };
  return {
    ...state,
    stockBySku: { ...state.stockBySku, [skuId]: available - quantity },
    orders: [...state.orders, order]
  };
}

export function cancelOrder(state, orderId) {
  const order = state.orders.find((candidate) => candidate.orderId === orderId);
  if (order === undefined) throw new Error("unknown order");
  if (order.status === "cancelled") return state;
  return {
    ...state,
    stockBySku: { ...state.stockBySku, [order.skuId]: (state.stockBySku[order.skuId] ?? 0) + order.quantity },
    orders: state.orders.map((candidate) => candidate.orderId === orderId ? { ...candidate, status: "cancelled" } : candidate)
  };
}
