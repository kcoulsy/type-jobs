// Simple logger implementation
// Can be replaced with a more sophisticated logger if needed

interface LogContext {
  event?: string;
  [key: string]: unknown;
}

function log(level: string, context: LogContext, message: string): void {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    ...context,
    message,
  };
  console.log(JSON.stringify(logEntry));
}

export const jobLogger = {
  info: (context: LogContext, message: string) => log("info", context, message),
  error: (context: LogContext, message: string) =>
    log("error", context, message),
  warn: (context: LogContext, message: string) => log("warn", context, message),
};

export const workerLogger = {
  info: (context: LogContext, message: string) => log("info", context, message),
  error: (context: LogContext, message: string) =>
    log("error", context, message),
  warn: (context: LogContext, message: string) => log("warn", context, message),
};
