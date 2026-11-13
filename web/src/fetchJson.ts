class RetryableFetchError extends Error {}

export function isRetryableFetchError(error: unknown): boolean {
  return error instanceof RetryableFetchError;
}

/** Fetch JSON; transport and 5xx/429/408 failures are retried. */
export async function fetchJson<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new RetryableFetchError(`Download failed: ${String(error)}`);
  }
  if (!response.ok) {
    const errorType =
      response.status === 408 || response.status === 429 || response.status >= 500
        ? RetryableFetchError
        : Error;
    throw new errorType(`HTTP ${response.status}`);
  }
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new RetryableFetchError(`Download interrupted: ${String(error)}`);
  }
  return JSON.parse(text) as T;
}
