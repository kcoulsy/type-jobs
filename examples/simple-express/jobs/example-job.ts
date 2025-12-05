import { createJob, type JobContext } from "typed-jobs";

interface ExampleJobData {
  userId: string;
  message: string;
  timestamp: number;
}

interface ExampleJobResult {
  processed: boolean;
  processedAt: number;
}

export default createJob<ExampleJobData, ExampleJobResult>(
  {
    name: "example-job",
    concurrency: 1,
    attempts: 3,
    backoffDelay: 1000,
    removeOnComplete: 100,
    removeOnFail: 50,
  },
  async (context: JobContext<ExampleJobData>) => {
    const { data, attempt, maxAttempts } = context;

    console.log(
      `Processing job for user ${data.userId} (attempt ${attempt}/${maxAttempts})`
    );
    console.log(`Message: ${data.message}`);
    console.log(
      `Original timestamp: ${new Date(data.timestamp).toISOString()}`
    );

    // Simulate some work
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Example: Simulate failure on first attempt for user "fail-me"
    if (data.userId === "fail-me" && attempt === 1) {
      throw new Error("Simulated failure - will retry");
    }

    return {
      processed: true,
      processedAt: Date.now(),
    };
  }
);
