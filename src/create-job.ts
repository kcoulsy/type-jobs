import type { DriverJob, DriverQueue, DriverWorker } from "./drivers/types.js";
import { getDriver } from "./driver-manager.js";
import { jobLogger } from "./logger.js";

export interface JobOptions {
  name: string;
  concurrency?: number;
  attempts?: number;
  backoffDelay?: number;
  removeOnComplete?: number;
  removeOnFail?: number;
}

// biome-ignore lint/suspicious/noExplicitAny: not worth it, it's typed e2e
export interface JobResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// biome-ignore lint/suspicious/noExplicitAny: not worth it, it's typed e2e
export interface JobContext<TData = any> {
  // The original job data
  data: TData;
  // Current attempt number (1-based)
  attempt: number;
  // Maximum number of attempts allowed
  maxAttempts: number;
  // Whether the job can have more attempts
  canRetry: boolean;
  // Redispatch the same job with the same data
  redispatch: (delay?: number) => Promise<void>;
  // Redispatch with modified data
  redispatchWithData: (newData: TData, delay?: number) => Promise<void>;
  // Get the underlying driver job instance for advanced operations
  getJob: () => DriverJob<TData>;
}

// biome-ignore lint/suspicious/noExplicitAny: not worth it, it's typed e2e
export class SimpleJob<TData = any, TResult = any> {
  private queue: DriverQueue<TData> | null = null;
  private worker: DriverWorker<TData> | null = null;
  private handler: (context: JobContext<TData>) => Promise<TResult>;
  private options: JobOptions;

  constructor(
    options: JobOptions,
    handler: (context: JobContext<TData>) => Promise<TResult>
  ) {
    this.options = options;
    this.handler = handler;
  }

  private async getQueue(): Promise<DriverQueue<TData>> {
    if (!this.queue) {
      const driver = getDriver();
      const queueResult = driver.createQueue({
        name: this.options.name,
        concurrency: this.options.concurrency,
        attempts: this.options.attempts,
        backoffDelay: this.options.backoffDelay,
        removeOnComplete: this.options.removeOnComplete,
        removeOnFail: this.options.removeOnFail,
      });
      // Handle both sync and async queue creation
      this.queue =
        queueResult instanceof Promise ? await queueResult : queueResult;
    }
    return this.queue;
  }

  async register(): Promise<void> {
    if (this.worker) {
      throw new Error("Worker already registered");
    }

    const driverQueue = await this.getQueue();
    const driver = getDriver();
    const workerResult = driver.createWorker(
      driverQueue,
      {
        name: this.options.name,
        concurrency: this.options.concurrency,
        attempts: this.options.attempts,
        backoffDelay: this.options.backoffDelay,
        removeOnComplete: this.options.removeOnComplete,
        removeOnFail: this.options.removeOnFail,
      },
      async (job: DriverJob<TData>) => {
        try {
          // Create the job context
          const context: JobContext<TData> = {
            data: job.data,
            attempt: job.attemptsMade + 1, // Driver uses 0-based attempts, we use 1-based
            maxAttempts: job.opts.attempts || this.options.attempts || 3,
            canRetry:
              job.attemptsMade + 1 <
              (job.opts.attempts || this.options.attempts || 3),
            redispatch: async (delay?: number) => {
              const driverQueue = await this.getQueue();
              await driverQueue.add(driverQueue.name, job.data, { delay });
            },
            redispatchWithData: async (newData: TData, delay?: number) => {
              const driverQueue = await this.getQueue();
              await driverQueue.add(driverQueue.name, newData, { delay });
            },
            getJob: () => job,
          };

          const result = await this.handler(context);
          return { success: true, data: result };
        } catch (error) {
          jobLogger.error(
            {
              event: "job_failed",
              jobName: job.name,
              jobId: job.id,
              attempt: job.attemptsMade + 1,
              maxAttempts: job.opts.attempts || this.options.attempts || 3,
              error: error instanceof Error ? error.message : String(error),
            },
            "Job failed"
          );
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    );
    // Handle both sync and async worker creation
    this.worker =
      workerResult instanceof Promise ? await workerResult : workerResult;

    this.worker.on("completed", (job) => {
      jobLogger.info(
        {
          event: "job_completed",
          jobName: job.name,
          jobId: job.id,
          attempt: job.attemptsMade + 1,
        },
        "Job completed successfully"
      );
    });

    this.worker.on("failed", (job, err) => {
      jobLogger.error(
        {
          event: "job_failed",
          jobName: job?.name,
          jobId: job?.id,
          attempt: job ? job.attemptsMade + 1 : undefined,
          maxAttempts: job?.opts.attempts || this.options.attempts || 3,
          error: err.message,
        },
        "Job failed"
      );
    });

    jobLogger.info(
      {
        event: "worker_registered",
        queueName: driverQueue.name,
      },
      "Worker registered for queue"
    );
  }

  async dispatch(data: TData): Promise<void> {
    const driverQueue = await this.getQueue();
    await driverQueue.add(driverQueue.name, data);
  }

  async dispatchWithDelay(data: TData, delay: number): Promise<void> {
    const driverQueue = await this.getQueue();
    await driverQueue.add(driverQueue.name, data, { delay });
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }

  // Method to get the queue instance for advanced operations
  // Note: This returns the driver queue, which may have driver-specific methods
  async getQueueInstance(): Promise<DriverQueue<TData>> {
    return this.getQueue();
  }
}

// Helper function to create a job with the exact API you requested
export function createJob<TData, TResult>(
  options: JobOptions,
  handler: (context: JobContext<TData>) => Promise<TResult>
): SimpleJob<TData, TResult> {
  return new SimpleJob(options, handler);
}
