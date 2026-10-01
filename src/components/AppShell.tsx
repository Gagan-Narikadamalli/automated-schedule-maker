"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import styles from "./AppShell.module.css";

type NavigationItem = {
  href: string;
  label: string;
  shortLabel: string;
};

const navigationItems: NavigationItem[] = [
  {
    href: "/",
    label: "Calendar",
    shortLabel: "CAL",
  },
  {
    href: "/schedule-preview",
    label: "Auto Schedule Preview",
    shortLabel: "AUTO",
  },
  {
    href: "/staff",
    label: "Staff",
    shortLabel: "STF",
  },
  {
    href: "/clients",
    label: "Clients",
    shortLabel: "CLI",
  },
  {
    href: "/teams",
    label: "Teams",
    shortLabel: "TEAM",
  },
  {
    href: "/fixed-events",
    label: "Speech & Fixed Events",
    shortLabel: "EVT",
  },
  {
    href: "/templates",
    label: "Templates",
    shortLabel: "TPL",
  },
  {
    href: "/overview",
    label: "Weekly Overview",
    shortLabel: "WK",
  },
  {
    href: "/activity",
    label: "Activity & Changes",
    shortLabel: "LOG",
  },
  {
    href: "/supervision",
    label: "Supervision",
    shortLabel: "SUP",
  },
  {
    href: "/settings",
    label: "Clinic Settings",
    shortLabel: "SET",
  },
  {
    href: "/settings/data-maintenance",
    label: "Data Maintenance",
    shortLabel: "DATA",
  },
];

const SIDEBAR_STORAGE_KEY = "sos-scheduler-sidebar-open";

type AppShellProps = {
  children: ReactNode;
};

function pathMatchesNavigationItem(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const storedValue = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);

    if (storedValue === "true") {
      setSidebarOpen(true);
    }
  }, []);

  function setSidebarState(nextValue: boolean) {
    setSidebarOpen(nextValue);
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(nextValue));
  }

  function toggleSidebar() {
    setSidebarState(!sidebarOpen);
  }

  function closeSidebarOnSmallScreen() {
    if (window.innerWidth <= 900) {
      setSidebarState(false);
    }
  }

  return (
    <div
      className={`${styles.shell} ${sidebarOpen ? styles.shellOpen : ""}`}
    >
      <aside
        className={`${styles.sidebar} ${
          sidebarOpen ? styles.sidebarOpen : ""
        }`}
        aria-hidden={!sidebarOpen}
      >
        <div className={styles.sidebarHeader}>
          <div className={styles.brandMark} aria-hidden="true">
            SOS
          </div>

          <div className={styles.sidebarBrandText}>
            <span className={styles.sidebarBrandMain}>
              SUCCESS ON THE SPECTRUM
            </span>
            <span className={styles.sidebarBrandSubtitle}>
              Automated Schedule Maker
            </span>
          </div>

          <button
            type="button"
            className={styles.sidebarCloseButton}
            onClick={() => setSidebarState(false)}
            aria-label="Close navigation"
          >
            ×
          </button>
        </div>

        <nav className={styles.sidebarNavigation} aria-label="Primary navigation">
          {navigationItems.map((item) => {
            const active = pathMatchesNavigationItem(pathname, item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.sidebarLink} ${
                  active ? styles.sidebarLinkActive : ""
                }`}
                onClick={closeSidebarOnSmallScreen}
              >
                <span className={styles.sidebarLinkBadge} aria-hidden="true">
                  {item.shortLabel}
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className={styles.sidebarFooter}>
          <strong>SOS Scheduling Workspace</strong>
          <span>Livingston · Parsippany</span>
        </div>
      </aside>

      {sidebarOpen && (
        <button
          type="button"
          className={styles.backdrop}
          aria-label="Close navigation"
          onClick={() => setSidebarState(false)}
        />
      )}

      <div className={styles.mainColumn}>
        <header className={styles.topBar}>
          <div className={styles.topBarLeft}>
            <button
              type="button"
              className={styles.toggleButton}
              onClick={toggleSidebar}
              aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={sidebarOpen}
            >
              <span className={styles.menuLine} />
              <span className={styles.menuLine} />
              <span className={styles.menuLine} />
            </button>

            <div className={styles.topBarBrand}>
              <span className={styles.topBarEyebrow}>
                SUCCESS ON THE SPECTRUM
              </span>
              <strong>Scheduling Workspace</strong>
            </div>
          </div>

          <div className={styles.topBarStatus}>
            <span className={styles.statusDot} aria-hidden="true" />
            Scheduler workspace
          </div>
        </header>

        <main className={styles.mainContent}>{children}</main>
      </div>
    </div>
  );
}
