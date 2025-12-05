export type {
  Driver,
  DriverConnection,
  DriverJob,
  DriverOptions,
  DriverQueue,
  DriverWorker,
} from "./types";
export { RedisDriver } from "./redis";
export type { RedisDriverConfig } from "./redis";

import type { Driver } from "./types";
import type { RedisDriverConfig } from "./redis";
import { RedisDriver } from "./redis";

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
