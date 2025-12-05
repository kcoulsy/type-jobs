import type { DriverJob, DriverQueue, DriverWorker } from "./drivers/types";
import { getDriver } from "./driver-manager";
import { jobLogger } from "./logger";

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
  private queue: DriverQueue<TData>;
  private worker: DriverWorker<TData> | null = null;
  private handler: (context: JobContext<TData>) => Promise<TResult>;
  private options: JobOptions;

  constructor(
    options: JobOptions,
    handler: (context: JobContext<TData>) => Promise<TResult>
  ) {
    this.options = options;
    const driver = getDriver();
    this.queue = driver.createQueue({
      name: options.name,
      concurrency: options.concurrency,
      attempts: options.attempts,
      backoffDelay: options.backoffDelay,
      removeOnComplete: options.removeOnComplete,
      removeOnFail: options.removeOnFail,
    });

    this.handler = handler;
  }

  async register(): Promise<void> {
    if (this.worker) {
      throw new Error("Worker already registered");
    }

    const driver = getDriver();
    this.worker = driver.createWorker(
      this.queue,
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
              await this.queue.add(this.queue.name, job.data, { delay });
            },
            redispatchWithData: async (newData: TData, delay?: number) => {
              await this.queue.add(this.queue.name, newData, { delay });
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
        queueName: this.queue.name,
      },
      "Worker registered for queue"
    );
  }

  async dispatch(data: TData): Promise<void> {
    await this.queue.add(this.queue.name, data);
  }

  async dispatchWithDelay(data: TData, delay: number): Promise<void> {
    await this.queue.add(this.queue.name, data, { delay });
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }

  // Method to get the queue instance for advanced operations
  // Note: This returns the driver queue, which may have driver-specific methods
  getQueue(): DriverQueue<TData> {
    return this.queue;
  }
}

// Helper function to create a job with the exact API you requested
export function createJob<TData, TResult>(
  options: JobOptions,
  handler: (context: JobContext<TData>) => Promise<TResult>
): SimpleJob<TData, TResult> {
  return new SimpleJob(options, handler);
}
