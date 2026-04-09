import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Smokehouse Admin",
    short_name: "Smokehouse",
    description: "Installable operations dashboard for Smokehouse orders, inventory, and menu management.",
    start_url: "/login",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f4eadf",
    theme_color: "#f4eadf",
    categories: ["business", "productivity", "food"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png"
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png"
      },
      {
        src: "/icons/logo-bigger.jpg",
        sizes: "1280x1280",
        type: "image/jpeg"
      }
    ],
    shortcuts: [
      {
        name: "Dashboard",
        short_name: "Dashboard",
        url: "/dashboard",
        description: "View live operational metrics."
      },
      {
        name: "Orders",
        short_name: "Orders",
        url: "/orders",
        description: "Review and update customer orders."
      },
      {
        name: "Inventory",
        short_name: "Inventory",
        url: "/inventory",
        description: "Check stock and adjustments."
      }
    ]
  };
}
