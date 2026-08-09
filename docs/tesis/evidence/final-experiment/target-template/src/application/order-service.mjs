import { placeOrder } from "../domain/orders.mjs";

export function createOrderService(initialState) {
  let state = initialState;
  const events = [];
  return {
    place(request) {
      state = placeOrder(state, request);
      events.push({ type: "order-reserved", orderId: request.orderId });
      return state;
    },
    current() {
      return state;
    },
    events() {
      return [...events];
    }
  };
}
