// external Warehouse oracle
import { runExternalOracle } from "../oracle-core.mjs";
await runExternalOracle({ increment: "W4", capabilities: ["layout", "inventory", "visual", "orders", "simulation"] });
