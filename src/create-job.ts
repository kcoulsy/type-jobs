import { type Job, Queue, Worker } from "bullmq";
import { jobLogger } from "./logger";
import { redis } from "./redis";

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
	// Get the underlying BullMQ job instance for advanced operations
	getJob: () => Job<TData>;
}

// biome-ignore lint/suspicious/noExplicitAny: not worth it, it's typed e2e
export class SimpleJob<TData = any, TResult = any> {
	private queue: Queue;
	private worker: Worker | null = null;
	private handler: (context: JobContext<TData>) => Promise<TResult>;
	private options: JobOptions;

	constructor(
		options: JobOptions,
		handler: (context: JobContext<TData>) => Promise<TResult>,
	) {
		this.options = options;
		this.queue = new Queue(options.name, {
			connection: redis,
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

		this.handler = handler;
	}

	async register(): Promise<void> {
		if (this.worker) {
			throw new Error("Worker already registered");
		}

		this.worker = new Worker(
			this.queue.name,
			async (job: Job<TData>) => {
				try {
					// Create the job context
					const context: JobContext<TData> = {
						data: job.data,
						attempt: job.attemptsMade + 1, // BullMQ uses 0-based attempts, we use 1-based
						maxAttempts: job.opts.attempts || this.options.attempts || 3,
						canRetry:
							job.attemptsMade + 1 <
							(job.opts.attempts || this.options.attempts || 3),
						redispatch: async (delay?: number) => {
							if (delay) {
								await this.queue.add(this.queue.name, job.data, { delay });
							} else {
								await this.queue.add(this.queue.name, job.data);
							}
						},
						redispatchWithData: async (newData: TData, delay?: number) => {
							if (delay) {
								await this.queue.add(this.queue.name, newData, { delay });
							} else {
								await this.queue.add(this.queue.name, newData);
							}
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
						"Job failed",
					);
					return {
						success: false,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			},
			{
				connection: redis,
				concurrency: 1,
			},
		);

		this.worker.on("completed", (job) => {
			jobLogger.info(
				{
					event: "job_completed",
					jobName: job.name,
					jobId: job.id,
					attempt: job.attemptsMade + 1,
				},
				"Job completed successfully",
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
				"Job failed",
			);
		});

		jobLogger.info(
			{
				event: "worker_registered",
				queueName: this.queue.name,
			},
			"Worker registered for queue",
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
	getQueue(): Queue {
		return this.queue;
	}
}

// Helper function to create a job with the exact API you requested
export function createJob<TData, TResult>(
	options: JobOptions,
	handler: (context: JobContext<TData>) => Promise<TResult>,
): SimpleJob<TData, TResult> {
	return new SimpleJob(options, handler);
}
