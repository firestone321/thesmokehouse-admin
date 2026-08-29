import type { AdminRole } from "@/lib/auth/admin-role";

export interface AdminNavItem {
  label: string;
  href: string;
  description: string;
  allowedRoles?: AdminRole[];
}

export const adminNavItems: AdminNavItem[] = [
  { label: "Dashboard", href: "/dashboard", description: "Live operational read model" },
  { label: "POS", href: "/pos", description: "Walk-in counter sales", allowedRoles: ["admin", "manager", "cashier", "staff"] },
  { label: "Orders", href: "/orders", description: "Tickets, status flow, and timeline" },
  { label: "Menu", href: "/menu", description: "Sellable items and availability" },
  { label: "Resupplies", href: "/procurement", description: "Protein receiving and processing" },
  { label: "Raw Materials", href: "/raw-materials", description: "Edible and non-edible inputs" },
  { label: "Suppliers", href: "/suppliers", description: "Supplier master records and traceability" },
  { label: "Inventory", href: "/inventory", description: "Resupplies, stock, and movement history" },
  { label: "Kitchen Queue", href: "/kitchen-queue", description: "Prep and smoker load plan" },
  { label: "Activity", href: "/activity", description: "Staff changes and approvals", allowedRoles: ["admin", "manager"] },
  { label: "Daily Issues", href: "/daily-issues", description: "Opening issues and staff notes", allowedRoles: ["admin", "manager"] },
  { label: "Reports", href: "/reports", description: "Sales, stock, and operations insights", allowedRoles: ["admin", "manager"] },
  { label: "Staff", href: "/staff", description: "Staff planning stays deferred", allowedRoles: ["admin", "manager"] },
  { label: "Settings", href: "/settings", description: "Controls and guardrails" }
];
