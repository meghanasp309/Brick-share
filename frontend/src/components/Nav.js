"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth";

// Which links each role sees.
const LINKS = {
  guest: [["/", "Market"], ["/network", "Network"]],
  investor: [["/", "Market"], ["/portfolio", "Portfolio"], ["/wallet", "Wallet"], ["/kyc", "KYC"], ["/network", "Network"]],
  owner: [["/", "Market"], ["/owner", "My properties"], ["/portfolio", "Portfolio"], ["/wallet", "Wallet"], ["/kyc", "KYC"], ["/network", "Network"]],
  admin: [["/", "Market"], ["/admin", "Admin"], ["/network", "Network"]],
  land_authority: [["/", "Market"], ["/land", "Land Authority"], ["/network", "Network"]],
};

const roleLabel = { investor: "Investor", owner: "Owner", admin: "Admin", land_authority: "Land Authority" };

export default function Nav() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const links = LINKS[user?.role || "guest"];

  const active = (href) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-card/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand text-sm text-white">B</span>
          BrickShare
        </Link>
        <nav className="hidden gap-1 md:flex">
          {links.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className={`rounded-md px-3 py-1.5 text-sm ${active(href) ? "bg-soft font-medium" : "text-muted hover:text-text"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-3 md:flex">
          {user ? (
            <>
              <span className="text-sm text-muted">
                {user.fullName} · {roleLabel[user.role]}
              </span>
              <button
                className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-soft"
                onClick={() => {
                  logout();
                  router.push("/");
                }}
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="text-sm hover:underline">Log in</Link>
              <Link href="/signup" className="rounded-md bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand-dark">
                Sign up
              </Link>
            </>
          )}
        </div>
        <button className="ml-auto rounded-md border border-line px-3 py-1.5 text-sm md:hidden" onClick={() => setOpen(!open)}>
          Menu
        </button>
      </div>
      {open && (
        <nav className="border-t border-line px-4 py-2 md:hidden" onClick={() => setOpen(false)}>
          {links.map(([href, label]) => (
            <Link key={href} href={href} className="block py-2 text-sm">{label}</Link>
          ))}
          {user ? (
            <button className="block py-2 text-sm text-red-600" onClick={() => { logout(); router.push("/"); }}>
              Log out
            </button>
          ) : (
            <>
              <Link href="/login" className="block py-2 text-sm">Log in</Link>
              <Link href="/signup" className="block py-2 text-sm">Sign up</Link>
            </>
          )}
        </nav>
      )}
    </header>
  );
}
