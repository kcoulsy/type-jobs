import type { DriverFactoryConfig, RedisDriverConfig } from "./drivers/index.js";

export interface TypedJobsConfig {
  driver: DriverFactoryConfig;
  jobsDir?: string;
}

export function defineConfig(config: TypedJobsConfig): TypedJobsConfig {
  return config;
}

// Helper to create a Redis-based config
export function createRedisConfig(
  redisConfig?: RedisDriverConfig,
  jobsDir?: string
): TypedJobsConfig {
  return {
    driver: {
      type: "redis",
      redis: redisConfig,
    },
    jobsDir,
  };
}
