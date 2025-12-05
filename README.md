# typed-jobs

A type-safe, driver-based job queue system for JavaScript/TypeScript projects. Supports multiple queue backends (Redis/BullMQ, RabbitMQ coming soon).

## Installation

```bash
npm install typed-jobs
# or
yarn add typed-jobs
# or
pnpm add typed-jobs
```

### Driver Dependencies

If you're using the Redis driver, you'll also need to install the required dependencies:

```bash
npm install bullmq ioredis
# or
yarn add bullmq ioredis
# or
pnpm add bullmq ioredis
```

## Quick Start

### 1. Create Configuration File

Create a `typed-jobs.config.ts` file in your project root:

```typescript
import { defineConfig } from 'typed-jobs';

export default defineConfig({
  // Driver configuration
  driver: {
    type: 'redis', // Currently supports 'redis', 'rabbitmq' coming soon
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD,
      username: process.env.REDIS_USERNAME,
      tls: process.env.REDIS_TLS === 'true',
    },
  },
  // Jobs directory (relative to project root)
  jobsDir: './jobs',
});
```

### 2. Add Script to package.json

Add the worker script to your `package.json`:

```json
{
  "scripts": {
    "typed-jobs": "typed-jobs run"
  }
}
```

### 3. Create Jobs Directory

Create a directory in your project to hold your jobs (e.g., `./jobs`).

### 4. Create a Job

Create a job file in your jobs directory. Each job file should export a default job created with `createJob`:

```typescript
// jobs/example-job.ts
import { createJob, type JobContext } from 'typed-jobs';

interface ExampleJobData {
  userId: string;
  message: string;
}

interface ExampleJobResult {
  processed: boolean;
  timestamp: number;
}

export default createJob<ExampleJobData, ExampleJobResult>(
  {
    name: 'example-job',
    concurrency: 1,
    attempts: 3,
    backoffDelay: 1000,
    removeOnComplete: 100,
    removeOnFail: 50,
  },
  async (context: JobContext<ExampleJobData>) => {
    const { data, attempt, maxAttempts, canRetry, redispatch, redispatchWithData } = context;

    console.log(`Processing job for user ${data.userId} (attempt ${attempt}/${maxAttempts})`);

    // Your job logic here
    if (data.userId === 'retry-me') {
      if (canRetry) {
        throw new Error('Simulated failure - will retry');
      }
    }

    // Example: Redispatch with delay if needed
    // await redispatch(5000); // Redispatch after 5 seconds

    // Example: Redispatch with modified data
    // await redispatchWithData({ ...data, message: 'Updated' }, 1000);

    return {
      processed: true,
      timestamp: Date.now(),
    };
  }
);
```

### 5. Run the Worker

Start the worker process:

```bash
npm run typed-jobs
# or
yarn typed-jobs
# or
pnpm typed-jobs
```

The worker will automatically discover and register all jobs exported from your jobs directory.

## Usage

### Dispatching Jobs

To dispatch a job from your application code:

```typescript
import exampleJob from './jobs/example-job';

// Dispatch immediately
await exampleJob.dispatch({
  userId: 'user-123',
  message: 'Hello, world!',
});

// Dispatch with delay (milliseconds)
await exampleJob.dispatchWithDelay(
  {
    userId: 'user-123',
    message: 'Hello, delayed world!',
  },
  5000 // 5 seconds
);
```

### Job Context

Each job handler receives a `JobContext` object with the following properties:

- `data: TData` - The job data
- `attempt: number` - Current attempt number (1-based)
- `maxAttempts: number` - Maximum number of attempts allowed
- `canRetry: boolean` - Whether the job can have more attempts
- `redispatch(delay?: number): Promise<void>` - Redispatch the same job with the same data
- `redispatchWithData(newData: TData, delay?: number): Promise<void>` - Redispatch with modified data
- `getJob(): DriverJob<TData>` - Get the underlying driver job instance for advanced operations

### Job Options

When creating a job, you can configure:

- `name: string` - Unique job name (required)
- `concurrency?: number` - Number of concurrent jobs to process (default: 1)
- `attempts?: number` - Maximum number of retry attempts (default: 3)
- `backoffDelay?: number` - Initial delay for exponential backoff in milliseconds (default: 1000)
- `removeOnComplete?: number` - Number of completed jobs to keep (default: 100)
- `removeOnFail?: number` - Number of failed jobs to keep (default: 50)

## Environment Variables

When using the Redis driver, you can configure the connection via environment variables (these are used as fallbacks if not specified in config):

- `REDIS_HOST` - Redis host (default: `localhost`)
- `REDIS_PORT` - Redis port (default: `6379`)
- `REDIS_PASSWORD` - Redis password (optional)
- `REDIS_USERNAME` - Redis username (optional)
- `REDIS_TLS` - Enable TLS (`true`/`false`, default: `false`)

## Type Safety

`typed-jobs` provides full TypeScript support. Your job data and results are fully typed:

```typescript
// TypeScript will enforce the correct data shape
await exampleJob.dispatch({
  userId: 'user-123', // ✅ Correct
  message: 'Hello',
  // invalidField: 'error' // ❌ TypeScript error
});
```

## Drivers

`typed-jobs` uses a driver-based architecture, allowing you to switch between different queue backends without changing your job code.

### Redis Driver (Default)

The Redis driver uses BullMQ under the hood and is the recommended driver for most use cases.

```typescript
import { defineConfig } from 'typed-jobs';

export default defineConfig({
  driver: {
    type: 'redis',
    redis: {
      host: 'localhost',
      port: 6379,
      // ... other Redis options
    },
  },
  jobsDir: './jobs',
});
```

### Future Drivers

- **RabbitMQ**: Coming soon
- More drivers can be added by implementing the `Driver` interface

## Advanced Usage

### Accessing the Queue

For advanced operations, you can access the underlying driver queue:

```typescript
import exampleJob from './jobs/example-job';

const queue = exampleJob.getQueue();
// Queue type depends on the driver used
// For Redis driver, you can access the underlying BullMQ queue:
// const bullQueue = (queue as any).getQueue();
// const jobs = await bullQueue.getJobs(['completed', 'failed']);
```

### Custom Driver Configuration

You can also configure the driver programmatically:

```typescript
import { setDriver } from 'typed-jobs';

setDriver({
  type: 'redis',
  redis: {
    host: 'custom-redis-host',
    port: 6380,
  },
});
```


## License

MIT

