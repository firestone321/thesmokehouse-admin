"use client";

import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

const ORDERS_REALTIME_CHANNEL_NAME = "ops-orders-realtime-v1";
const FALLBACK_POLL_INTERVAL_MS = 10_000;
const SUBSCRIPTION_TIMEOUT_MS = 5_000;

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
    const handleOrdersInsert = (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
      this.notifyInsert(this.toRealtimeEvent("orders", "INSERT", payload));
    };
    const handleOrdersRefresh = (
      type: Exclude<OrdersRealtimeEvent["type"], "INSERT">,
      payload: RealtimePostgresChangesPayload<Record<string, unknown>>
    ) => {
      this.notifyRefresh(this.toRealtimeEvent("orders", type, payload));
    };
    const handleOrderItemsRefresh = (
      type: OrdersRealtimeEvent["type"],
      payload: RealtimePostgresChangesPayload<Record<string, unknown>>
    ) => {
      this.notifyRefresh(this.toRealtimeEvent("order_items", type, payload));
    };

    this.channel = this.supabase
      .channel(ORDERS_REALTIME_CHANNEL_NAME)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, handleOrdersInsert)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders" },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
        handleOrdersRefresh("UPDATE", payload)
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "orders" },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
        handleOrdersRefresh("DELETE", payload)
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "order_items" },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
        handleOrderItemsRefresh("INSERT", payload)
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "order_items" },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
        handleOrderItemsRefresh("UPDATE", payload)
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "order_items" },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
        handleOrderItemsRefresh("DELETE", payload)
      )
      .subscribe((status: OrdersRealtimeStatus) => {
        this.handleStatus(status);
      });

    this.armSubscriptionTimeout();
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
      this.notifyRefresh({
        type: "UPDATE",
        table: "orders",
        orderId: null
      });
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
