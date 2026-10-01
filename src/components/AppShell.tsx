import Link from "next/link";
import type { ReactNode } from "react";

import { LogoutButton } from "@/components/LogoutButton";
import { requirePageSession } from "@/lib/auth/session";

const navigationItems = [
  { href: "/", label: "Calendar" },
  { href: "/staff", label: "Staff" },
  { href: "/clients", label: "Clients" },
  { href: "/teams", label: "Teams" },
  { href: "/fixed-events", label: "Speech & Fixed Events" },
  { href: "/templates", label: "Templates" },
  { href: "/overview", label: "Weekly Overview" },
  { href: "/activity", label: "Activity & Changes" },
  { href: "/supervision", label: "Supervision" },
  { href: "/settings", label: "Clinic Settings" },
];

type AppShellProps = {
  children: ReactNode;
};

export async function AppShell({ children }: AppShellProps) {
  const session = await requirePageSession();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-brand-main">SUCCESS ON THE SPECTRUM</span>
          <span className="sidebar-brand-subtitle">Automated Schedule Maker</span>
        </div>

        <div className="sidebar-user-card">
          <strong>{session.username}</strong>
          <span>{session.role.replaceAll("_", " ")}</span>
        </div>

        <nav className="sidebar-navigation" aria-label="Primary navigation">
          {navigationItems.map((item) => (
            <Link key={item.href} href={item.href} className="sidebar-link">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          <LogoutButton />
        </div>
      </aside>

      <main className="main-content">{children}</main>
    </div>
  );
}
