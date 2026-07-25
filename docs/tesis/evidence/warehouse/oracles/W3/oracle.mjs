// external Warehouse oracle
import { runExternalOracle } from "../oracle-core.mjs";
await runExternalOracle({ increment: "W3", capabilities: ["layout", "inventory", "visual", "orders"] });
