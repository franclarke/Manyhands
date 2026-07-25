// external Warehouse oracle
import { runExternalOracle } from "../oracle-core.mjs";
await runExternalOracle({ increment: "W2", capabilities: ["layout", "inventory", "visual"] });
