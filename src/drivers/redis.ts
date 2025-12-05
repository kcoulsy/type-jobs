import { type Job, Queue, Worker } from "bullmq";
import IORedis, { type RedisOptions } from "ioredis";
import type {
  Driver,
  DriverConnection,
  DriverJob,
  DriverOptions,
  DriverQueue,
  DriverWorker,
} from "./types.js";

// biome-ignore lint/suspicious/noExplicitAny: driver needs to handle any job data
class RedisQueue<TData = any> implements DriverQueue<TData> {
  private queue: Queue<TData>;

  constructor(queue: Queue<TData>) {
    this.queue = queue;
  }

  get name(): string {
    return this.queue.name;
  }

  async add(
    name: string,
    data: TData,
    options?: { delay?: number }
  ): Promise<void> {
    await (this.queue as any).add(name, data, options);
  }

  async close(): Promise<void> {
    await this.queue.close();
  }

  // Expose underlying queue for advanced operations
  getQueue(): Queue<TData> {
    return this.queue;
  }
}

// biome-ignore lint/suspicious/noExplicitAny: driver needs to handle any job data
class RedisWorker<TData = any> implements DriverWorker<TData> {
  private worker: Worker<TData>;
  private eventHandlers: {
    completed?: (job: DriverJob<TData>) => void;
    failed?: (job: DriverJob<TData> | null, error: Error) => void;
  } = {};

  constructor(worker: Worker<TData>) {
    this.worker = worker;

    // Set up event forwarding
    this.worker.on("completed", (job: Job<TData>) => {
      if (this.eventHandlers.completed) {
        this.eventHandlers.completed(this.toDriverJob(job));
      }
    });

    this.worker.on("failed", (job: Job<TData> | undefined, err: Error) => {
      if (this.eventHandlers.failed) {
        this.eventHandlers.failed(job ? this.toDriverJob(job) : null, err);
      }
    });
  }

  private toDriverJob(job: Job<TData>): DriverJob<TData> {
    return {
      id: job.id || "",
      name: job.name,
      data: job.data,
      attemptsMade: job.attemptsMade,
      opts: {
        attempts: job.opts.attempts,
        delay: job.opts.delay,
      },
    };
  }

  on(event: "completed", handler: (job: DriverJob<TData>) => void): void;
  on(
    event: "failed",
    handler: (job: DriverJob<TData> | null, error: Error) => void
  ): void;
  on(
    event: "completed" | "failed",
    handler:
      | ((job: DriverJob<TData>) => void)
      | ((job: DriverJob<TData> | null, error: Error) => void)
  ): void {
    if (event === "completed") {
      this.eventHandlers.completed = handler as (job: DriverJob<TData>) => void;
    } else if (event === "failed") {
      this.eventHandlers.failed = handler as (
        job: DriverJob<TData> | null,
        error: Error
      ) => void;
    }
  }

  async close(): Promise<void> {
    await this.worker.close();
  }

  // Expose underlying worker for advanced operations
  getWorker(): Worker<TData> {
    return this.worker;
  }
}

class RedisConnection implements DriverConnection {
  private connection: IORedis;

  constructor(connection: IORedis) {
    this.connection = connection;
  }

  async close(): Promise<void> {
    await this.connection.quit();
  }

  // Expose underlying connection for advanced operations
  getConnection(): IORedis {
    return this.connection;
  }
}

export interface RedisDriverConfig {
  host?: string;
  port?: number;
  password?: string;
  username?: string;
  tls?: boolean;
}

export class RedisDriver<TData = any, TResult = any>
  implements Driver<TData, TResult>
{
  private connection: IORedis;
  private config: RedisDriverConfig;
  private connectionPromise: Promise<IORedis> | null = null;
  // Store resolved values from config + env
  private resolvedConfig: {
    host: string;
    port: number;
    username?: string;
    password?: string;
    tls: boolean;
  };

  constructor(config: RedisDriverConfig = {}) {
    this.config = config;
    const host = config.host || process.env.REDIS_HOST || "localhost";
    const port = config.port || Number(process.env.REDIS_PORT) || 6379;
    const username = config.username || process.env.REDIS_USERNAME;
    const password = config.password || process.env.REDIS_PASSWORD;
    const tls = config.tls || process.env.REDIS_TLS === "true";

    // Store resolved values so createConnection can use them
    this.resolvedConfig = { host, port, username, password, tls };

    console.log("Creating Redis connection...", {
      host,
      port,
      username: username || "(not set)",
      password: password ? `${password.substring(0, 2)}***` : "(not set)",
      tls: tls || false,
    });
    this.connection = this.createConnection();
    this.connectionPromise = this.waitForConnection();
  }

  private async waitForConnection(): Promise<IORedis> {
    // Wait a short time for the connection to be ready, but don't block forever
    // ioredis will handle reconnection automatically
    if (this.connection.status === "ready") {
      return this.connection;
    }

    // Wait up to 5 seconds for ready, but if it doesn't happen, return anyway
    // BullMQ will handle connection issues
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // Timeout - return connection anyway, let BullMQ handle it
        console.log("Redis connection not ready yet, but proceeding anyway");
        resolve(this.connection);
      }, 5000); // 5 second timeout

      const onReady = () => {
        clearTimeout(timeout);
        this.connection.off("ready", onReady);
        console.log("Redis connection ready");
        resolve(this.connection);
      };

      if (this.connection.status === "ready") {
        clearTimeout(timeout);
        resolve(this.connection);
      } else {
        this.connection.once("ready", onReady);
      }
    });
  }

  private createConnection(): IORedis {
    const redisOptions: RedisOptions = {
      host: this.resolvedConfig.host,
      port: this.resolvedConfig.port,
      maxRetriesPerRequest: null,
    };

    // Only add authentication if credentials are provided
    // Set both username and password if both are provided (Redis 6+ ACL)
    if (this.resolvedConfig.username && this.resolvedConfig.password) {
      redisOptions.username = this.resolvedConfig.username;
      redisOptions.password = this.resolvedConfig.password;
    } else if (this.resolvedConfig.password) {
      // Legacy auth with just password
      redisOptions.password = this.resolvedConfig.password;
    }
    // Note: We don't set username-only auth because ioredis will try to authenticate
    // even when Redis doesn't require it, causing connection issues

    // Add TLS if enabled
    if (this.resolvedConfig.tls) {
      redisOptions.tls = {};
    }

    const connection = new IORedis(redisOptions);

    // Add error handling
    connection.on("error", (err: Error & { code?: string }) => {
      // Suppress common reconnection errors
      if (
        err.code !== "ECONNRESET" &&
        err.code !== "ECONNREFUSED" &&
        err.code !== "EPIPE"
      ) {
        console.error("Redis connection error:", err.message || err);
      }
    });

    let isFirstConnection = true;

    connection.on("connect", async () => {
      if (isFirstConnection) {
        console.log("Redis connected successfully");
        isFirstConnection = false;

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
      }
    });

    return connection;
  }

  async createQueue(options: DriverOptions): Promise<DriverQueue<TData>> {
    // Wait briefly for connection, but don't block forever
    // BullMQ will handle connection issues
    if (this.connectionPromise) {
      try {
        await this.connectionPromise;
      } catch (error) {
        // Log but don't throw - let BullMQ handle it
        console.warn(
          "Redis connection not ready yet, but proceeding anyway:",
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    const queue = new Queue<TData>(options.name, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: options.attempts || 3,
        backoff: {
          type: "exponential",
          delay: options.backoffDelay || 1000,
        },
        removeOnComplete: options.removeOnComplete || 100,
        removeOnFail: options.removeOnFail || 50,
      },
    });

    return new RedisQueue(queue);
  }

  async createWorker(
    queue: DriverQueue<TData>,
    options: DriverOptions,
    handler: (
      job: DriverJob<TData>
    ) => Promise<{ success: boolean; data?: TResult; error?: string }>
  ): Promise<DriverWorker<TData>> {
    // Wait briefly for connection, but don't block forever
    // BullMQ will handle connection issues
    if (this.connectionPromise) {
      try {
        await this.connectionPromise;
      } catch (error) {
        // Log but don't throw - let BullMQ handle it
        console.warn(
          "Redis connection not ready yet, but proceeding anyway:",
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    // Get the underlying BullMQ queue
    const redisQueue = (queue as RedisQueue<TData>).getQueue();

    const worker = new Worker<TData>(
      redisQueue.name,
      async (job: Job<TData>) => {
        const driverJob: DriverJob<TData> = {
          id: job.id || "",
          name: job.name,
          data: job.data,
          attemptsMade: job.attemptsMade,
          opts: {
            attempts: job.opts.attempts,
            delay: job.opts.delay,
          },
        };

        return handler(driverJob);
      },
      {
        connection: this.connection,
        concurrency: options.concurrency || 1,
      }
    );

    return new RedisWorker(worker);
  }

  getConnection(): DriverConnection {
    return new RedisConnection(this.connection);
  }

  // Expose underlying connection for advanced operations
  getRedisConnection(): IORedis {
    return this.connection;
  }

  get connectionReadyPromise(): Promise<void> {
    return this.connectionPromise?.then(() => undefined) || Promise.resolve();
  }
}
