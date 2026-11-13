import { useEffect, useState } from "react";

export function useAsyncData<T>(
  dependency: string | number | null | undefined,
  fetchFn: (key: string) => Promise<T>,
  retryable: (error: unknown) => boolean = () => true,
): { data: T | null; error: unknown; retrying: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (dependency == null) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const attempt = (retriesLeft: number, delayMs: number) => {
      if (cancelled) return;
      if (retriesLeft < 5) setRetrying(true);
      fetchFn(String(dependency))
        .then((value) => {
          if (cancelled) return;
          setData(value);
          setError(null);
          setRetrying(false);
        })
        .catch((err) => {
          if (cancelled) return;
          if (retriesLeft > 0 && retryable(err)) {
            setTimeout(() => attempt(retriesLeft - 1, delayMs * 2), delayMs);
            return;
          }
          setError(err);
          setRetrying(false);
        });
    };
    attempt(5, 700);
    return () => {
      cancelled = true;
    };
  }, [dependency, fetchFn, retryable]);

  return { data, error, retrying };
}
