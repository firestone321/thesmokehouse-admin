"use client";

import { useEffect, useRef, useState } from "react";
import {OrdersResults} from "./orders-results";
import { useOrdersRealtime } from "@/components/ops/use-orders-realtime";
import type { OrdersRealtimeEvent } from "@/lib/ops/orders-realtime";
import type { OrderListItem } from "@/lib/ops/types";

const RECONCILE_DEBOUNCE_MS = 150;
const RECONCILE_BATCH_LIMIT = 50;

type OrdersPayload =
  | {
      ok?: boolean;
      data?: {
        orders?: OrderListItem[];
      };
      message?: string;
    }
  | null;

type ReconcilePayload =
  | {
      ok?: boolean;
      data?: {
        orders?: OrderListItem[];
      };
      message?: string;
    }
  | null;

function sortOrders(orders: OrderListItem[]) {
  return [...orders].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function orderMatchesFilters(order: OrderListItem, status: string, search: string) {
  if (status !== "all" && order.status !== status) {
    return false;
  }

  const normalizedSearch = search.trim().toLowerCase();

  if (!normalizedSearch) {
    return true;
  }

  return [order.orderNumber, order.customerName, order.customerPhone].some((value) =>
    String(value ?? "").toLowerCase().includes(normalizedSearch)
  );
}

async function fetchOrdersSnapshot(status: string, search: string, limit: number, page: number) {
  const params = new URLSearchParams({
    status,
    search,
    limit: String(limit),
    page: String(page)
  });
  const response = await fetch(`/api/admin/orders?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  const payload = (await response.json().catch(() => null)) as OrdersPayload;

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message ?? "Unable to load orders.");
  }

  return payload.data?.orders ?? [];
}

async function fetchOrdersReconcile(orderIds: string[]) {
  const response = await fetch("/api/admin/orders/reconcile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderIds }),
    cache: "no-store"
  });
  const payload = (await response.json().catch(() => null)) as ReconcilePayload;

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message ?? "Unable to reconcile orders.");
  }

  return payload.data?.orders ?? [];
}

export function LiveOrdersPanel({
  orders,
  status,
  search,
  limit,
  page,
  hasNextPage
}: {
  orders: OrderListItem[];
  status: string;
  search: string;
  limit: number;
  page: number;
  hasNextPage: boolean;
}) {
  const [localOrders, setLocalOrders] = useState<OrderListItem[]>(orders);
  const pendingReconcileIdsRef = useRef<Set<string>>(new Set());
  const reconcileBatchTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setLocalOrders(orders);
  }, [orders]);

  useEffect(() => {
    return () => {
      if (reconcileBatchTimeoutRef.current !== null) {
        window.clearTimeout(reconcileBatchTimeoutRef.current);
      }

      pendingReconcileIdsRef.current.clear();
      reconcileBatchTimeoutRef.current = null;
    };
  }, []);

  const removeOrder = (orderId: string) => {
    setLocalOrders((current) => current.filter((order) => String(order.id) !== orderId));
  };

  const refreshOrders = async () => {
    const nextOrders = await fetchOrdersSnapshot(status, search, limit, page);
    setLocalOrders(nextOrders);
  };

  const flushReconcileBatch = async () => {
    const ids = Array.from(pendingReconcileIdsRef.current);
    pendingReconcileIdsRef.current.clear();
    reconcileBatchTimeoutRef.current = null;

    if (ids.length === 0) {
      return;
    }

    const reconciledOrders = await fetchOrdersReconcile(ids);
    const reconciledIds = new Set(reconciledOrders.map((order) => String(order.id)));

    setLocalOrders((current) => {
      let next = current.filter((order) => !ids.includes(String(order.id)) || reconciledIds.has(String(order.id)));

      for (const order of reconciledOrders) {
        next = orderMatchesFilters(order, status, search)
          ? [order, ...next.filter((candidate) => candidate.id !== order.id)]
          : next.filter((candidate) => candidate.id !== order.id);
      }

      return sortOrders(next).slice(0, limit);
    });
  };

  const scheduleBatchReconcile = (orderId: string) => {
    pendingReconcileIdsRef.current.add(orderId);

    if (pendingReconcileIdsRef.current.size > RECONCILE_BATCH_LIMIT) {
      pendingReconcileIdsRef.current.clear();
      if (reconcileBatchTimeoutRef.current !== null) {
        window.clearTimeout(reconcileBatchTimeoutRef.current);
        reconcileBatchTimeoutRef.current = null;
      }
      void refreshOrders();
      return;
    }

    if (reconcileBatchTimeoutRef.current !== null) {
      return;
    }

    reconcileBatchTimeoutRef.current = window.setTimeout(() => {
      void flushReconcileBatch();
    }, RECONCILE_DEBOUNCE_MS);
  };

  const scheduleReconcile = (event: OrdersRealtimeEvent) => {
    if (event.type === "DELETE" && event.orderId) {
      removeOrder(event.orderId);
      return;
    }

    if (!event.orderId) {
      void refreshOrders();
      return;
    }

    scheduleBatchReconcile(event.orderId);
  };

  useOrdersRealtime({
    source: "OrdersPage",
    autoRefresh: false,
    refreshOnFallback: false,
    onInsert: scheduleReconcile,
    onRefresh: scheduleReconcile
  });

  return <OrdersResults orders={localOrders} status={status} search={search} limit={limit} page={page} hasNextPage={hasNextPage}/>;
}
