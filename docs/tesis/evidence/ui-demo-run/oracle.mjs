import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const target = resolve(process.argv[2] ?? "");
if (!target) throw new Error("usage: node oracle.mjs <target-checkout>");

const { createWarehouseState } = await import(pathToFileURL(resolve(target, "src/domain/warehouse.mjs")));
const { InMemoryWarehouseRepository } = await import(pathToFileURL(resolve(target, "src/infrastructure/in-memory-repository.mjs")));
const { WarehouseService } = await import(pathToFileURL(resolve(target, "src/application/warehouse-service.mjs")));
const { createWarehouseApi } = await import(pathToFileURL(resolve(target, "src/api/warehouse-api.mjs")));
const { buildDashboardModel } = await import(pathToFileURL(resolve(target, "src/ui/dashboard-view.mjs")));

const repository = new InMemoryWarehouseRepository(createWarehouseState({ A: 10, B: 4 }));
const service = new WarehouseService(repository);
const api = createWarehouseApi(service);
const createdAt = "2026-08-09T12:00:00.000Z";

const reservation = api.reserveStock({
  reservationId: "R-1",
  orderId: "O-1",
  lines: [{ skuId: "A", quantity: 3 }, { skuId: "B", quantity: 2 }],
  ttlMinutes: 30,
  now: createdAt
});
assert.equal(reservation.status, "active");
assert.equal(reservation.expiresAt, "2026-08-09T12:30:00.000Z");
assert.deepEqual(api.getSnapshot().stockBySku, { A: 7, B: 2 });

const confirmed = api.confirmReservation({ reservationId: "R-1", now: "2026-08-09T12:10:00.000Z" });
assert.equal(confirmed.status, "confirmed");
assert.deepEqual(api.getSnapshot().stockBySku, { A: 7, B: 2 });

api.reserveStock({
  reservationId: "R-2",
  orderId: "O-2",
  lines: [{ skuId: "A", quantity: 2 }],
  ttlMinutes: 10,
  now: createdAt
});
const released = api.releaseExpired({ now: "2026-08-09T12:11:00.000Z" });
assert.equal(released.length, 1);
assert.equal(released[0].reservationId, "R-2");
assert.deepEqual(api.getSnapshot().stockBySku, { A: 7, B: 2 });

const reservations = api.listReservations();
assert.equal(reservations.length, 2);
assert.deepEqual(reservations.map((item) => item.status).sort(), ["confirmed", "expired"]);
assert.deepEqual(api.getSnapshot().events.map((event) => event.type), [
  "reservation-created",
  "reservation-confirmed",
  "reservation-created",
  "reservation-expired"
]);

const dashboard = buildDashboardModel(api.getSnapshot());
assert.equal(dashboard.reservations.activeCount, 0);
assert.equal(dashboard.reservations.expiredCount, 1);
assert.equal(dashboard.reservations.reservedUnits, 0);
assert.equal(dashboard.reservations.nextExpiry, null);

console.log("ui-demo oracle: PASS");
