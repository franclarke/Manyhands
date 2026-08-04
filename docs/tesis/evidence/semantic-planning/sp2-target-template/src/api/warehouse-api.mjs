export function createWarehouseApi(service) {
  return {
    placeOrder(request) {
      return service.place(request);
    },
    currentOrders() {
      return service.current().orders;
    },
    events() {
      return service.events();
    }
  };
}
