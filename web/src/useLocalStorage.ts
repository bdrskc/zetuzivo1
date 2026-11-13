import { useState, useCallback, useRef, type Dispatch, type SetStateAction } from "react";

interface UseLocalStorageOptions<T> {
  serialize?: (value: T) => string;
  deserialize?: (value: string) => T;
}

export function useLocalStorage<T>(
  key: string,
  initialValue: T,
  options: UseLocalStorageOptions<T> = {},
): [T, Dispatch<SetStateAction<T>>] {
  const { serialize = JSON.stringify, deserialize = JSON.parse } = options;

  const getStoredValue = useCallback((): T => {
    try {
      const item = window.localStorage.getItem(key);
      return item === null ? initialValue : deserialize(item);
    } catch {
      return initialValue;
    }
  }, [key, deserialize, initialValue]);

  const [storedValue, setStoredValue] = useState<T>(getStoredValue);
  const valueRef = useRef(storedValue);

  const setValue = useCallback(
    (value: SetStateAction<T>) => {
      const next =
        typeof value === "function"
          ? (value as (prev: T) => T)(valueRef.current)
          : value;
      valueRef.current = next;
      setStoredValue(next);
      try {
        window.localStorage.setItem(key, serialize(next));
      } catch {
        // Storage unavailable: keep working in memory only.
      }
    },
    [key, serialize],
  );

  return [storedValue, setValue];
}
