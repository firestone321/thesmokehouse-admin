"use client";

import { useEffect, useState } from "react";
import {
  isThisDevicePosPrintStation,
  setThisDevicePosPrintStation
} from "@/components/pwa/admin-push-auto-enrollment";

/** A device-local opt-in; enabling it moves paid-order receipt pushes to this browser. */
export function PosPrintStationToggle() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(isThisDevicePosPrintStation());
  }, []);

  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[#D7DDE4] bg-white px-4 py-3 text-sm text-[#4B5563]">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(event) => {
          const next = event.target.checked;
          setEnabled(next);
          setThisDevicePosPrintStation(next);
        }}
        className="mt-0.5 h-4 w-4 accent-[#287241]"
      />
      <span>
        <span className="block font-semibold text-[#111418]">This is the online-order receipt printer</span>
        <span className="mt-0.5 block text-xs leading-5">Enable only on the POS PC with the local bridge. It receives one paid-order print job at a time.</span>
      </span>
    </label>
  );
}
