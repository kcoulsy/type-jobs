import * as Sentry from "@sentry/node";
import { processAudioClipJob } from "./jobs/process-audio-clip-job";
import { processVideoJob } from "./jobs/process-video-job";
import { splitAudioJob } from "./jobs/split-audio-job";
import { translateVideoAudioClipJob } from "./jobs/translate-video-audio-clip-job";
import { workerLogger } from "./lib/logger";
import { sseBroadcaster } from "./lib/sse-broadcaster";

Sentry.init({
  dsn: "https://3aa38b73204589e743b16265e1ec0d7a@o4504735425822720.ingest.us.sentry.io/4509705431875585",
  // Adds request headers and IP for users, for more info visit:
  // https://docs.sentry.io/platforms/javascript/guides/node/configuration/options/#sendDefaultPii
  sendDefaultPii: true,

  // Enable logs to be sent to Sentry
  _experiments: { enableLogs: true },

  // Set tracesSampleRate to 1.0 to capture 100%
  // of transactions for tracing.
  // We recommend adjusting this value in production
  tracesSampleRate: 1.0,

  // Enable performance monitoring with proper integrations
  integrations: [
    Sentry.httpIntegration(),
    Sentry.consoleLoggingIntegration({ levels: ["log", "error", "warn"] }),
  ],

  // Set environment
  environment:
    process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",

  // Set release version (you can set this via environment variable)
  release: process.env.SENTRY_RELEASE || "worker@1.0.0",

  // Enable profiling for better performance insights
  profilesSampleRate: 1.0,
});

// Initialize SSE broadcaster for worker process
async function initializeWorker() {
  try {
    workerLogger.info({ event: "initializing" }, "Initializing worker");

    // Initialize only the publisher for cross-process communication
    await sseBroadcaster.initializePublisher();

    // Register all jobs
    processVideoJob.register();
    splitAudioJob.register();
    translateVideoAudioClipJob.register();
    processAudioClipJob.register();

    workerLogger.info(
      { event: "initialized" },
      "Worker initialized successfully"
    );

    // Set up graceful shutdown
    process.on("SIGINT", async () => {
      workerLogger.info(
        { event: "shutdown_signal", signal: "SIGINT" },
        "Shutting down worker"
      );
      await sseBroadcaster.cleanup();
      await processVideoJob.close();
      await splitAudioJob.close();
      await translateVideoAudioClipJob.close();
      await processAudioClipJob.close();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      workerLogger.info(
        { event: "shutdown_signal", signal: "SIGTERM" },
        "Shutting down worker"
      );
      await sseBroadcaster.cleanup();
      await processVideoJob.close();
      await splitAudioJob.close();
      await translateVideoAudioClipJob.close();
      await processAudioClipJob.close();
      process.exit(0);
    });
  } catch (error) {
    Sentry.captureException(error);
    workerLogger.error(
      {
        event: "initialization_failed",
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to initialize worker"
    );
    process.exit(1);
  }
}

// Initialize the worker
initializeWorker();
