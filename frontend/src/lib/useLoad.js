"use client";
// Loads data from the API and keeps it in state.
//   const { data, error, loading, reload } = useLoad(() => api("/market"), []);
// It loads again when a value in the list (the second argument) changes, or when you call reload().
import { useCallback, useEffect, useRef, useState } from "react";

export function useLoad(fn, deps) {
  const fnRef = useRef(fn);
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [version, setVersion] = useState(0);
  const key = JSON.stringify(deps);

  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    let active = true;
    fnRef.current().then(
      (data) => active && setState({ data, error: null, loading: false }),
      (err) => active && setState((s) => ({ ...s, error: err.message, loading: false }))
    );
    return () => {
      active = false;
    };
  }, [key, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}
