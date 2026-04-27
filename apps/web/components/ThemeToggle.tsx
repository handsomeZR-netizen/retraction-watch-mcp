"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const toggle = () => {
    document.documentElement.classList.add("theme-transition");
    setTheme(theme === "dark" ? "light" : "dark");
    window.setTimeout(
      () => document.documentElement.classList.remove("theme-transition"),
      400,
    );
  };

  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className="btn btn-ghost btn-icon"
      type="button"
    >
      {!mounted ? (
        <span className="w-4 h-4" />
      ) : theme === "dark" ? (
        <Sun className="w-4 h-4" />
      ) : (
        <Moon className="w-4 h-4" />
      )}
    </button>
  );
}
