import { useEffect, useState } from "react";

/** Loads something async (a texture) and returns it once ready; null until then. */
export function useAsset<T>(make: () => Promise<T>, key: string): T | null {
  const [v, setV] = useState<{ key: string; value: T } | null>(null);
  useEffect(() => {
    let live = true;
    make().then(
      (value) => live && setV({ key, value }),
      (e) => console.warn(e),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return v && v.key === key ? v.value : null;
}
