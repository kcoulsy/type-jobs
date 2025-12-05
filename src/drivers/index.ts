export type {
  Driver,
  DriverConnection,
  DriverJob,
  DriverOptions,
  DriverQueue,
  DriverWorker,
} from "./types.js";
export { RedisDriver } from "./redis.js";
export type { RedisDriverConfig } from "./redis.js";

import type { Driver } from "./types.js";
import type { RedisDriverConfig } from "./redis.js";
import { RedisDriver } from "./redis.js";

export type DriverType = "redis" | "rabbitmq"; // Future: add more drivers

export interface DriverFactoryConfig {
  type: DriverType;
  redis?: RedisDriverConfig;
  // Future: rabbitmq?: RabbitMQDriverConfig;
}

// biome-ignore lint/suspicious/noExplicitAny: driver factory needs to handle any job data and result
export function createDriver<TData = any, TResult = any>(
  config: DriverFactoryConfig
): Driver<TData, TResult> {
  switch (config.type) {
    case "redis":
      return new RedisDriver<TData, TResult>(config.redis) as Driver<
        TData,
        TResult
      >;
    case "rabbitmq":
      throw new Error("RabbitMQ driver not yet implemented");
    default:
      throw new Error(`Unknown driver type: ${config.type}`);
  }
}
