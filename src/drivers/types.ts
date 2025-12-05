// biome-ignore lint/suspicious/noExplicitAny: driver needs to handle any job data
export interface DriverJob<TData = any> {
  id: string;
  name: string;
  data: TData;
  attemptsMade: number;
  opts: {
    attempts?: number;
    delay?: number;
  };
}

// biome-ignore lint/suspicious/noExplicitAny: driver needs to handle any job data
export interface DriverQueue<TData = any> {
  name: string;
  add(name: string, data: TData, options?: { delay?: number }): Promise<void>;
  close(): Promise<void>;
}

// biome-ignore lint/suspicious/noExplicitAny: driver needs to handle any job data
export interface DriverWorker<TData = any> {
  on(event: "completed", handler: (job: DriverJob<TData>) => void): void;
  on(
    event: "failed",
    handler: (job: DriverJob<TData> | null, error: Error) => void
  ): void;
  close(): Promise<void>;
}

export interface DriverConnection {
  close(): Promise<void>;
}

export interface DriverOptions {
  name: string;
  concurrency?: number;
  attempts?: number;
  backoffDelay?: number;
  removeOnComplete?: number;
  removeOnFail?: number;
}

// biome-ignore lint/suspicious/noExplicitAny: driver needs to handle any job data and result
export interface Driver<TData = any, TResult = any> {
  createQueue(options: DriverOptions): DriverQueue<TData>;
  createWorker(
    queue: DriverQueue<TData>,
    options: DriverOptions,
    handler: (
      job: DriverJob<TData>
    ) => Promise<{ success: boolean; data?: TResult; error?: string }>
  ): DriverWorker<TData>;
  getConnection(): DriverConnection;
}
