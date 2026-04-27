"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "首页" },
  { href: "/settings", label: "设置" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="nav-link"
          data-active={pathname === link.href}
        >
          {link.label}
        </Link>
      ))}
      <a
        href="https://retractionwatch.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="nav-link"
      >
        Retraction Watch ↗
      </a>
    </>
  );
}
