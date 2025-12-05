// Main exports
export { createJob, SimpleJob } from "./create-job";
export type { JobOptions, JobContext, JobResult } from "./create-job";

// Driver exports
export type {
  Driver,
  DriverJob,
  DriverQueue,
  DriverWorker,
} from "./drivers/types";
export { RedisDriver } from "./drivers/redis";
export type { RedisDriverConfig } from "./drivers/redis";
export type { DriverType, DriverFactoryConfig } from "./drivers";
export { createDriver } from "./drivers";

// Config exports
export { defineConfig, createRedisConfig } from "./config";
export type { TypedJobsConfig } from "./config";

// Driver manager (for internal use, but exposed for advanced usage)
export { setDriver, getDriver, hasDriver } from "./driver-manager";
