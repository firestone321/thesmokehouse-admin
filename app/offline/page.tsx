import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Offline"
};

export default function OfflinePage() {
  return (
    <main className="min-h-screen bg-[#f6efe7] px-4 py-10">
      <div className="mx-auto max-w-xl rounded-3xl border border-[#dfd2c2] bg-white p-8 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#a0562c]">Offline</p>
        <h1 className="mt-2 text-3xl font-bold text-[#2d2219]">Firestone Country Smokehouse Admin is offline</h1>
        <p className="mt-3 text-sm text-[#5f5348]">
          Reconnect to sync live orders, inventory, and dashboard metrics. Static app assets stay available, but operational data needs the network.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/dashboard" className="rounded-xl bg-[#2d2219] px-5 py-3 text-sm font-semibold text-[#f6efe7]">
            Back to Dashboard
          </Link>
          <Link href="/login" className="rounded-xl border border-[#d7c7b5] px-5 py-3 text-sm font-semibold text-[#2d2219]">
            Go to Login
          </Link>
        </div>
      </div>
    </main>
  );
}
