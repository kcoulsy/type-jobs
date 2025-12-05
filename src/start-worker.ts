import { existsSync, readdirSync, statSync } from "fs";
import { join, resolve, extname } from "path";
import { pathToFileURL } from "url";
import { setDriver } from "./driver-manager";
import type { SimpleJob } from "./create-job";
import type { TypedJobsConfig } from "./config";

// Track registered jobs for graceful shutdown
const registeredJobs: SimpleJob[] = [];

async function loadConfig(): Promise<TypedJobsConfig> {
  const configPaths = [
    resolve(process.cwd(), "typed-jobs.config.ts"),
    resolve(process.cwd(), "typed-jobs.config.js"),
    resolve(process.cwd(), "typed-jobs.config.mjs"),
  ];

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        // For TypeScript config files, we'll need to use ts-node or similar
        // For now, we'll support JS/MJS configs via dynamic import
        // Convert to file URL for dynamic import
        const fileUrl = pathToFileURL(configPath).href;

        if (configPath.endsWith(".ts")) {
          // Try to load as compiled JS first (if using ts-node or tsx)
          const jsPath = configPath.replace(/\.ts$/, ".js");
          if (existsSync(jsPath)) {
            const jsUrl = pathToFileURL(jsPath).href;
            const config = await import(jsUrl);
            return config.default || config;
          }
          // If ts-node/tsx is available, try direct import
          try {
            const config = await import(fileUrl);
            return config.default || config;
          } catch {
            throw new Error(
              `Cannot load TypeScript config. Please use a JavaScript config or ensure ts-node/tsx is available.`
            );
          }
        } else {
          const config = await import(fileUrl);
          return config.default || config;
        }
      } catch (error) {
        throw new Error(
          `Failed to load config from ${configPath}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  throw new Error(
    `No config file found. Please create typed-jobs.config.ts or typed-jobs.config.js in your project root.`
  );
}

async function discoverJobs(jobsDir: string): Promise<SimpleJob[]> {
  const jobsPath = resolve(process.cwd(), jobsDir);

  if (!existsSync(jobsPath)) {
    throw new Error(`Jobs directory not found: ${jobsPath}`);
  }

  if (!statSync(jobsPath).isDirectory()) {
    throw new Error(`Jobs path is not a directory: ${jobsPath}`);
  }

  const jobs: SimpleJob[] = [];
  const files = readdirSync(jobsPath);

  for (const file of files) {
    const filePath = join(jobsPath, file);
    const stat = statSync(filePath);

    // Skip directories and non-JS/TS files
    if (stat.isDirectory()) {
      continue;
    }

    const ext = extname(file);
    if (ext !== ".ts" && ext !== ".js" && ext !== ".mjs") {
      continue;
    }

    try {
      // Convert to file URL for dynamic import
      const fileUrl = pathToFileURL(filePath).href;
      // Try to import the file
      const module = await import(fileUrl);
      const job = module.default;

      // Check if it's a SimpleJob instance
      if (
        job &&
        typeof job === "object" &&
        "register" in job &&
        "close" in job
      ) {
        jobs.push(job as SimpleJob);
      } else {
        console.warn(
          `Skipping ${file}: does not export a default job instance`
        );
      }
    } catch (error) {
      console.error(
        `Failed to load job from ${file}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return jobs;
}

async function initializeWorker() {
  try {
    // Load configuration
    const config = await loadConfig();

    // Initialize driver
    setDriver(config.driver);

    // Discover and register jobs
    const jobsDir = config.jobsDir || "./jobs";
    const jobs = await discoverJobs(jobsDir);

    if (jobs.length === 0) {
      console.warn(`No jobs found in ${jobsDir}`);
      return;
    }

    // Register all jobs
    for (const job of jobs) {
      await job.register();
      registeredJobs.push(job);
    }

    console.log(`Registered ${registeredJobs.length} job(s)`);

    // Set up graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`Received ${signal}, shutting down gracefully...`);

      // Close all jobs
      await Promise.all(
        registeredJobs.map((job) =>
          job.close().catch((err) => {
            console.error(
              `Error closing job: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          })
        )
      );

      process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    console.error(
      `Failed to initialize worker: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exit(1);
  }
}

// Initialize the worker
initializeWorker();
