#!/usr/bin/env node

// CLI entry point for typed-jobs
// This will be compiled and used as the bin command

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, resolve, extname } from "path";
import { pathToFileURL } from "url";
import { setDriver } from "./driver-manager.js";
import type { SimpleJob } from "./create-job.js";
import type { TypedJobsConfig } from "./config.js";

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
          // Try direct import (might work if tsx/ts-node is available in the environment)
          try {
            const config = await import(fileUrl);
            return config.default || config;
          } catch (importError) {
            // If direct import fails, suggest using tsx or a JS config
            throw new Error(
              `Cannot load TypeScript config file. Options:\n` +
                `  1. Install tsx and run: npx tsx typed-jobs.config.ts\n` +
                `  2. Convert to JavaScript: typed-jobs.config.js\n` +
                `  3. Use ts-node: NODE_OPTIONS='--loader ts-node/esm' typed-jobs run\n` +
                `Error: ${
                  importError instanceof Error
                    ? importError.message
                    : String(importError)
                }`
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
    console.log("Loading typed-jobs configuration...");
    const config = await loadConfig();
    const redisConfig = config.driver.redis || {};
    const password = redisConfig.password || process.env.REDIS_PASSWORD;
    console.log("Configuration loaded:", {
      driverType: config.driver.type,
      jobsDir: config.jobsDir || "./jobs",
      redisHost: redisConfig.host || process.env.REDIS_HOST || "localhost",
      redisPort: redisConfig.port || Number(process.env.REDIS_PORT) || 6379,
      redisUsername:
        redisConfig.username || process.env.REDIS_USERNAME || "(not set)",
      redisPassword: password ? `${password.substring(0, 2)}***` : "(not set)",
      redisTls: redisConfig.tls || process.env.REDIS_TLS === "true" || false,
    });

    // Initialize driver
    console.log("Initializing driver...");
    setDriver(config.driver);
    console.log("Driver initialized successfully");

    // Discover and register jobs
    const jobsDir = config.jobsDir || "./jobs";
    console.log(`Discovering jobs in: ${jobsDir}`);
    const jobs = await discoverJobs(jobsDir);

    if (jobs.length === 0) {
      console.warn(`No jobs found in ${jobsDir}`);
      return;
    }

    console.log(`Found ${jobs.length} job(s), registering...`);
    // Register all jobs
    for (const job of jobs) {
      console.log(`Registering job...`);
      await job.register();
      registeredJobs.push(job);
      console.log(`Job registered successfully`);
    }

    console.log(`Successfully registered ${registeredJobs.length} job(s)`);

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

// Parse command line arguments
const command = process.argv[2];

if (command === "run") {
  initializeWorker();
} else {
  console.error(`Unknown command: ${command || "(none)"}`);
  console.error("Usage: typed-jobs run");
  process.exit(1);
}
