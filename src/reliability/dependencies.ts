export class DependencyUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DependencyUnavailableError";
  }
}

export interface DependencyRetryOptions {
  attempts: number;
  delayMs: number;
  timeoutMs?: number;
  operationName: string;
}

export async function retryDependency<T>(
  operation: () => Promise<T>,
  options: DependencyRetryOptions
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const result = operation();
      return options.timeoutMs === undefined
        ? await result
        : await withTimeout(result, options.timeoutMs, options.operationName);
    } catch (error) {
      lastError = error;

      if (attempt === options.attempts) {
        break;
      }

      await delay(options.delayMs);
    }
  }

  throw new DependencyUnavailableError(
    `${options.operationName} failed after ${options.attempts} attempt(s).`,
    { cause: lastError }
  );
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new DependencyUnavailableError(`${operationName} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    timeout.unref();
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function delay(delayMs: number): Promise<void> {
  if (delayMs === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, delayMs);
    timeout.unref();
  });
}
