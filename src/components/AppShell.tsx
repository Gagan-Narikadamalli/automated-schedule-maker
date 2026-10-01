"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import styles from "./AppShell.module.css";

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
  { href: "/settings/data-maintenance", label: "Data Maintenance" },
];

const SIDEBAR_STORAGE_KEY = "sos-scheduler-sidebar-open";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const storedValue = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);

    if (storedValue === "true") {
      setSidebarOpen(true);
    }
  }, []);

  function toggleSidebar() {
    setSidebarOpen((currentValue) => {
      const nextValue = !currentValue;
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(nextValue));
      return nextValue;
    });
  }

  function closeSidebarOnSmallScreen() {
    if (window.innerWidth <= 800) {
      setSidebarOpen(false);
    }
  }

  return (
    <div
      className={`app-shell ${styles.shell} ${
        sidebarOpen ? styles.shellOpen : ""
      }`}
    >
      <button
        type="button"
        className={styles.toggleButton}
        onClick={toggleSidebar}
        aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
        aria-expanded={sidebarOpen}
      >
        ☰
      </button>

      <aside
        className={`sidebar ${styles.sidebar} ${
          sidebarOpen ? styles.sidebarOpen : ""
        }`}
        aria-hidden={!sidebarOpen}
      >
        <div className="sidebar-brand">
          <span className="sidebar-brand-main">SUCCESS ON THE SPECTRUM</span>
          <span className="sidebar-brand-subtitle">Automated Schedule Maker</span>
        </div>

        <nav className="sidebar-navigation" aria-label="Primary navigation">
          {navigationItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="sidebar-link"
              onClick={closeSidebarOnSmallScreen}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      {sidebarOpen && (
        <button
          type="button"
          className={styles.backdrop}
          aria-label="Close navigation"
          onClick={toggleSidebar}
        />
      )}

      <main className="main-content">{children}</main>
    </div>
  );
}
