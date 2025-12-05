import { type Job, Queue, Worker } from "bullmq";
import IORedis, { type RedisOptions } from "ioredis";
import type {
  Driver,
  DriverConnection,
  DriverJob,
  DriverOptions,
  DriverQueue,
  DriverWorker,
} from "./types";

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

// biome-ignore lint/suspicious/noExplicitAny: driver needs to handle any job data and result
export class RedisDriver<TData = any, TResult = any>
  implements Driver<TData, TResult>
{
  private connection: IORedis;
  private config: RedisDriverConfig;

  constructor(config: RedisDriverConfig = {}) {
    this.config = config;
    this.connection = this.createConnection();
  }

  private createConnection(): IORedis {
    const redisOptions: RedisOptions = {
      host: this.config.host || process.env.REDIS_HOST || "localhost",
      port: this.config.port || Number(process.env.REDIS_PORT) || 6379,
      maxRetriesPerRequest: null,
    };

    // Only add authentication if credentials are provided
    if (this.config.username && this.config.password) {
      redisOptions.username = this.config.username;
      redisOptions.password = this.config.password;
    } else if (this.config.password || process.env.REDIS_PASSWORD) {
      redisOptions.password =
        this.config.password || process.env.REDIS_PASSWORD;
    }

    // Add TLS if enabled
    if (this.config.tls || process.env.REDIS_TLS === "true") {
      redisOptions.tls = {};
    }

    const connection = new IORedis(redisOptions);

    // Add error handling
    connection.on("error", (err: Error) => {
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
  }

  createQueue(options: DriverOptions): DriverQueue<TData> {
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

  createWorker(
    queue: DriverQueue<TData>,
    options: DriverOptions,
    handler: (
      job: DriverJob<TData>
    ) => Promise<{ success: boolean; data?: TResult; error?: string }>
  ): DriverWorker<TData> {
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
}
