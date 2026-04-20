"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import { useRouter } from "next/navigation";
import { subscribeToOrdersRealtime, type OrdersRealtimeEvent } from "@/lib/ops/orders-realtime";

const REFRESH_DEBOUNCE_MS = 120;

type Options = {
  source: string;
  autoRefresh?: boolean;
  refreshOnFallback?: boolean;
  onInsert?: (event: OrdersRealtimeEvent) => void;
  onRefresh?: (event: OrdersRealtimeEvent) => void;
};

export function useOrdersRealtime(options: Options) {
  const { source, autoRefresh = true, refreshOnFallback = true, onInsert, onRefresh } = options;
  const router = useRouter();
  const refreshTimeoutRef = useRef<number | null>(null);
  const fallbackActiveRef = useRef(false);

  const queueRefresh = useEffectEvent(() => {
    if (refreshTimeoutRef.current !== null) {
      return;
    }

    refreshTimeoutRef.current = window.setTimeout(() => {
      refreshTimeoutRef.current = null;
      router.refresh();
    }, REFRESH_DEBOUNCE_MS);
  });

  const handleRefresh = useEffectEvent((event: OrdersRealtimeEvent) => {
    onRefresh?.(event);

    if (autoRefresh || (refreshOnFallback && fallbackActiveRef.current)) {
      queueRefresh();
    }
  });

  const handleInsert = useEffectEvent((event: OrdersRealtimeEvent) => {
    onInsert?.(event);

    if (autoRefresh) {
      queueRefresh();
    }
  });

  const handleFallbackStart = useEffectEvent(() => {
    fallbackActiveRef.current = true;

    if (refreshOnFallback) {
      queueRefresh();
    }
  });

  const handleFallbackStop = useEffectEvent(() => {
    fallbackActiveRef.current = false;
  });

  useEffect(() => {
    const unsubscribe = subscribeToOrdersRealtime({
      source,
      onRefresh: handleRefresh,
      onInsert: handleInsert,
      onFallbackStart: handleFallbackStart,
      onFallbackStop: handleFallbackStop
    });

    return () => {
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }

      fallbackActiveRef.current = false;
      unsubscribe();
    };
  }, [source]);
}
