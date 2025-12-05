// Main exports
export { createJob, SimpleJob } from "./create-job.js";
export type { JobOptions, JobContext, JobResult } from "./create-job.js";

// Driver exports
export type {
  Driver,
  DriverJob,
  DriverQueue,
  DriverWorker,
} from "./drivers/types.js";
export { RedisDriver } from "./drivers/redis.js";
export type { RedisDriverConfig } from "./drivers/redis.js";
export type { DriverType, DriverFactoryConfig } from "./drivers/index.js";
export { createDriver } from "./drivers/index.js";

// Config exports
export { defineConfig, createRedisConfig } from "./config.js";
export type { TypedJobsConfig } from "./config.js";

// Driver manager (for internal use, but exposed for advanced usage)
export { setDriver, getDriver, hasDriver } from "./driver-manager.js";
