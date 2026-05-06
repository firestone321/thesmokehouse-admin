"use client";

import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

const ORDERS_REALTIME_CHANNEL_NAME = "ops-orders-realtime-v1";
const FALLBACK_POLL_INTERVAL_MS = 10_000;
const SUBSCRIPTION_TIMEOUT_MS = 5_000;
const BATCH_FLUSH_MS = 400;

export type OrdersRealtimeEvent = {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: "orders" | "order_items";
  orderId: string | null;
};

type OrdersRealtimeConsumer = {
  id: string;
  source: string;
  onRefresh: (event: OrdersRealtimeEvent) => void;
  onInsert?: (event: OrdersRealtimeEvent) => void;
  onFallbackStart?: (reason: string) => void;
  onFallbackStop?: () => void;
};

type OrdersRealtimeSubscription = Omit<OrdersRealtimeConsumer, "id">;
type OrdersRealtimeStatus = "CLOSED" | "CHANNEL_ERROR" | "ERRORED" | "SUBSCRIBED" | "TIMED_OUT" | "SUBSCRIPTION_TIMEOUT";
let consumerSequence = 0;
let ordersRealtimeManager: OrdersRealtimeManager | null = null;

function getOrdersRealtimeManager() {
  if (!ordersRealtimeManager) {
    ordersRealtimeManager = new OrdersRealtimeManager();
  }

  return ordersRealtimeManager;
}

export function subscribeToOrdersRealtime(options: OrdersRealtimeSubscription) {
  return getOrdersRealtimeManager().subscribe(options);
}

class OrdersRealtimeManager {
  private readonly supabase = createBrowserSupabaseClient();
  private readonly consumers = new Map<string, OrdersRealtimeConsumer>();
  private channel: RealtimeChannel | null = null;
  private channelCloseExpected = false;
  private fallbackReason: string | null = null;
  private pollingIntervalId: number | null = null;
  private subscriptionTimeoutId: number | null = null;

  // Batch state — events accumulate here until the flush timer fires.
  private batchTimerId: number | null = null;
  private pendingRefreshIds = new Set<string>();
  private pendingInsertIds = new Set<string>();
  private pendingFullRefresh = false;
  private pageHidden = false;
  private visibilityHandler: (() => void) | null = null;

  subscribe(options: OrdersRealtimeSubscription) {
    const consumer: OrdersRealtimeConsumer = {
      id: `orders-realtime-consumer-${++consumerSequence}`,
      ...options
    };

    this.consumers.set(consumer.id, consumer);
    this.ensureChannel();

    if (this.fallbackReason) {
      consumer.onFallbackStart?.(this.fallbackReason);
    }

    return () => {
      this.unsubscribe(consumer.id);
    };
  }

  private unsubscribe(consumerId: string) {
    this.consumers.delete(consumerId);

    if (this.consumers.size === 0) {
      this.teardownChannel();
    }
  }

  private ensureChannel() {
    if (this.channel) {
      return;
    }

    this.channelCloseExpected = false;
    this.setupVisibility();

    const handleOrdersInsert = (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
      const event = this.toRealtimeEvent("orders", "INSERT", payload);
      if (event.orderId) {
        this.pendingInsertIds.add(event.orderId);
        this.armBatchTimer();
      }
    };

    const handleOrdersUpdate = (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
      const event = this.toRealtimeEvent("orders", "UPDATE", payload);
      if (event.orderId) {
        this.pendingRefreshIds.add(event.orderId);
      } else {
        this.pendingFullRefresh = true;
      }
      this.armBatchTimer();
    };

    const handleOrdersDelete = (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
      // Pass through immediately — consumer removes from local state with no DB fetch.
      this.notifyRefresh(this.toRealtimeEvent("orders", "DELETE", payload));
    };

    const handleOrderItemsChange = (
      type: OrdersRealtimeEvent["type"],
      payload: RealtimePostgresChangesPayload<Record<string, unknown>>
    ) => {
      const event = this.toRealtimeEvent("order_items", type, payload);
      if (event.orderId) {
        this.pendingRefreshIds.add(event.orderId);
      } else {
        this.pendingFullRefresh = true;
      }
      this.armBatchTimer();
    };

    this.channel = this.supabase
      .channel(ORDERS_REALTIME_CHANNEL_NAME)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, handleOrdersInsert)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, handleOrdersUpdate)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "orders" }, handleOrdersDelete)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "order_items" },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => handleOrderItemsChange("INSERT", payload)
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "order_items" },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => handleOrderItemsChange("UPDATE", payload)
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "order_items" },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => handleOrderItemsChange("DELETE", payload)
      )
      .subscribe((status: OrdersRealtimeStatus) => {
        this.handleStatus(status);
      });

    this.armSubscriptionTimeout();
  }

  private setupVisibility() {
    if (this.visibilityHandler || typeof document === "undefined") return;
    this.pageHidden = document.visibilityState === "hidden";
    this.visibilityHandler = () => {
      const nowHidden = document.visibilityState === "hidden";
      if (this.pageHidden && !nowHidden) {
        this.pageHidden = false;
        // Tab became visible — flush any work that built up while hidden.
        if (this.pendingRefreshIds.size > 0 || this.pendingInsertIds.size > 0 || this.pendingFullRefresh) {
          this.flushBatch();
        }
      } else {
        this.pageHidden = nowHidden;
      }
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);
  }

  private teardownVisibility() {
    if (this.visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
    this.pageHidden = false;
  }

  private armBatchTimer() {
    if (this.pageHidden) return; // Accumulate silently; flush on visibility restore.
    if (this.batchTimerId !== null) return; // Timer already running.
    this.batchTimerId = window.setTimeout(() => {
      this.batchTimerId = null;
      this.flushBatch();
    }, BATCH_FLUSH_MS);
  }

  private flushBatch() {
    if (this.batchTimerId !== null) {
      window.clearTimeout(this.batchTimerId);
      this.batchTimerId = null;
    }

    for (const orderId of this.pendingInsertIds) {
      this.notifyInsert({ type: "INSERT", table: "orders", orderId });
    }
    for (const orderId of this.pendingRefreshIds) {
      this.notifyRefresh({ type: "UPDATE", table: "orders", orderId });
    }
    if (this.pendingFullRefresh) {
      this.notifyRefresh({ type: "UPDATE", table: "orders", orderId: null });
    }

    this.pendingInsertIds.clear();
    this.pendingRefreshIds.clear();
    this.pendingFullRefresh = false;
  }

  private handleStatus(status: OrdersRealtimeStatus) {
    const expectedClosed = status === "CLOSED" && this.channelCloseExpected;

    if (status === "SUBSCRIBED") {
      this.clearSubscriptionTimeout();
      this.stopPolling();
      return;
    }

    if (status === "CHANNEL_ERROR" || status === "ERRORED" || status === "TIMED_OUT") {
      this.startPolling(status);
      return;
    }

    if (status === "CLOSED" && !expectedClosed && this.consumers.size > 0) {
      this.startPolling(status);
    }
  }

  private armSubscriptionTimeout() {
    this.clearSubscriptionTimeout();
    this.subscriptionTimeoutId = window.setTimeout(() => {
      this.startPolling("SUBSCRIPTION_TIMEOUT");
    }, SUBSCRIPTION_TIMEOUT_MS);
  }

  private clearSubscriptionTimeout() {
    if (this.subscriptionTimeoutId !== null) {
      window.clearTimeout(this.subscriptionTimeoutId);
      this.subscriptionTimeoutId = null;
    }
  }

  private startPolling(reason: string) {
    if (this.pollingIntervalId !== null) {
      return;
    }

    this.fallbackReason = reason;
    this.notifyFallbackStart(reason);
    this.pollingIntervalId = window.setInterval(() => {
      // Skip while hidden — resume on next visibility restore.
      if (!this.pageHidden) {
        this.notifyRefresh({ type: "UPDATE", table: "orders", orderId: null });
      }
    }, FALLBACK_POLL_INTERVAL_MS);
  }

  private stopPolling() {
    if (this.pollingIntervalId === null) {
      return;
    }

    window.clearInterval(this.pollingIntervalId);
    this.pollingIntervalId = null;
    this.fallbackReason = null;
    this.notifyFallbackStop();
  }

  private teardownChannel() {
    this.clearSubscriptionTimeout();
    this.stopPolling();
    this.teardownVisibility();

    if (this.batchTimerId !== null) {
      window.clearTimeout(this.batchTimerId);
      this.batchTimerId = null;
    }
    this.pendingInsertIds.clear();
    this.pendingRefreshIds.clear();
    this.pendingFullRefresh = false;

    if (!this.channel) {
      return;
    }

    const channel = this.channel;
    this.channel = null;
    this.channelCloseExpected = true;
    void this.supabase.removeChannel(channel);
  }

  private notifyRefresh(event: OrdersRealtimeEvent) {
    for (const consumer of this.consumers.values()) {
      consumer.onRefresh(event);
    }
  }

  private notifyInsert(event: OrdersRealtimeEvent) {
    for (const consumer of this.consumers.values()) {
      consumer.onInsert?.(event);
    }
  }

  private notifyFallbackStart(reason: string) {
    for (const consumer of this.consumers.values()) {
      consumer.onFallbackStart?.(reason);
    }
  }

  private notifyFallbackStop() {
    for (const consumer of this.consumers.values()) {
      consumer.onFallbackStop?.();
    }
  }

  private toRealtimeEvent(
    table: OrdersRealtimeEvent["table"],
    type: OrdersRealtimeEvent["type"],
    payload: RealtimePostgresChangesPayload<Record<string, unknown>>
  ): OrdersRealtimeEvent {
    return {
      table,
      type,
      orderId: this.extractOrderId(table, type, payload)
    };
  }

  private extractOrderId(
    table: OrdersRealtimeEvent["table"],
    type: OrdersRealtimeEvent["type"],
    payload: RealtimePostgresChangesPayload<Record<string, unknown>>
  ) {
    const nextRow = this.asRecord(payload.new);
    const previousRow = this.asRecord(payload.old);

    if (table === "orders") {
      return this.readString(type === "DELETE" ? previousRow.id : nextRow.id);
    }

    return this.readString(type === "DELETE" ? previousRow.order_id : nextRow.order_id);
  }

  private asRecord(value: unknown) {
    if (value && typeof value === "object") {
      return value as Record<string, unknown>;
    }

    return {};
  }

  private readString(value: unknown) {
    if (typeof value === "number") {
      return String(value);
    }

    return typeof value === "string" && value.length > 0 ? value : null;
  }
}
