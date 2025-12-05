import type { Driver } from "./drivers/types.js";
import type { DriverFactoryConfig } from "./drivers/index.js";
import { createDriver } from "./drivers/index.js";

let globalDriver: Driver | null = null;

export function setDriver(config: DriverFactoryConfig): void {
  globalDriver = createDriver(config);
}

export function getDriver(): Driver {
  if (!globalDriver) {
    throw new Error(
      "Driver not initialized. Call setDriver() or configure via typed-jobs.config.ts"
    );
  }
  return globalDriver;
}

export function hasDriver(): boolean {
  return globalDriver !== null;
}
