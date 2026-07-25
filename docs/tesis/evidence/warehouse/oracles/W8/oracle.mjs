// external Warehouse oracle
import { runExternalOracle } from "../oracle-core.mjs";
await runExternalOracle({ increment: "W8", capabilities: ["layout", "inventory", "visual", "orders", "simulation", "routing", "congestion", "persistence", "analytics", "accessibility"] });
