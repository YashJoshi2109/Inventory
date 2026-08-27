import { MemoryLedgerStore } from "../memory.ts";
import { runLedgerStoreConformance } from "./conformance.ts";

runLedgerStoreConformance("MemoryLedgerStore", {
  make: (deviceId, now) => new MemoryLedgerStore({ deviceId, now }),
});
