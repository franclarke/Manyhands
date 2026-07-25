// external Warehouse oracle
import { runExternalOracle } from "../oracle-core.mjs";
await runExternalOracle({ increment: "W6", capabilities: ["layout", "inventory", "visual", "orders", "simulation", "routing", "congestion"] });
