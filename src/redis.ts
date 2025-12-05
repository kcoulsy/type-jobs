import IORedis, { type RedisOptions } from "ioredis";

// Redis connection utility
export const createRedisConnection = () => {
  const config: RedisOptions = {
    host: process.env.REDIS_HOST || "localhost",
    port: Number(process.env.REDIS_PORT) || 6379,
    maxRetriesPerRequest: null,
  };

  // Only add authentication if credentials are provided
  if (process.env.REDIS_USERNAME && process.env.REDIS_PASSWORD) {
    config.username = process.env.REDIS_USERNAME;
    config.password = process.env.REDIS_PASSWORD;
  } else if (process.env.REDIS_PASSWORD) {
    // Legacy auth with just password
    config.password = process.env.REDIS_PASSWORD;
  }

  // Add TLS if enabled
  if (process.env.REDIS_TLS === "true") {
    config.tls = {};
  }

  const connection = new IORedis(config);

  // Add error handling
  connection.on("error", (err) => {
    console.error("Redis connection error:", err);
  });

  connection.on("connect", async () => {
    console.log("Redis connected successfully");

    // Ensure eviction policy is set to noeviction for BullMQ
    // This is CRITICAL - jobs must not be evicted from memory
    try {
      await connection.config("SET", "maxmemory-policy", "noeviction");
      console.log("Redis eviction policy set to noeviction");

      // Verify the setting was applied
      const policy = await connection.config("GET", "maxmemory-policy");
      const currentPolicy = Array.isArray(policy) ? policy[1] : policy;
      if (currentPolicy !== "noeviction") {
        console.warn(
          `Warning: Redis eviction policy is ${currentPolicy}, expected noeviction`
        );
      }
    } catch (err) {
      console.error("Failed to set Redis eviction policy:", err);
      console.error("This may cause jobs to be evicted from memory!");
    }
  });

  return connection;
};

// Default redis connection for BullMQ
export const redis = createRedisConnection();
