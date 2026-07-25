// external Warehouse oracle
import { runExternalOracle } from "../oracle-core.mjs";
await runExternalOracle({ increment: "W7", capabilities: ["layout", "inventory", "visual", "orders", "simulation", "routing", "congestion", "persistence"] });
