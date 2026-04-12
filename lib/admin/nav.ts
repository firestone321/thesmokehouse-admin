export interface AdminNavItem {
  label: string;
  href: string;
  description: string;
}

export const adminNavItems: AdminNavItem[] = [
  { label: "Dashboard", href: "/dashboard", description: "Live operational read model" },
  { label: "Orders", href: "/orders", description: "Tickets, status flow, and timeline" },
  { label: "Menu", href: "/menu", description: "Sellable items and availability" },
  { label: "Resupplies", href: "/procurement", description: "Protein receiving and processing" },
  { label: "Suppliers", href: "/suppliers", description: "Supplier master records and traceability" },
  { label: "Inventory", href: "/inventory", description: "Resupplies, stock, and movement history" },
  { label: "Kitchen Queue", href: "/kitchen-queue", description: "Prep and smoker load plan" },
  { label: "Staff", href: "/staff", description: "Staff planning stays deferred" },
  { label: "Settings", href: "/settings", description: "Controls and guardrails" }
];
