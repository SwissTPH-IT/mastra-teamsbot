"use client";

// Die Seitenleiste aus der Vorlage.
//
// Client-Komponente, weil der aktive Navigationspunkt am Pfad haengt
// (usePathname) - und weil "Receipts" auch aus der Detailansicht heraus aktiv
// bleiben muss. Die Zaehler kommen als Props von der Serverseite; diese
// Komponente holt keine Daten.

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  badge?: string | null;
  /**
   * Ausgegraut: entworfen, aber noch nicht gebaut. Sichtbar zu lassen ist
   * Absicht - ein verstecktes Feature laesst beim Nutzer die Frage offen, ob
   * er es nur nicht findet. Heute betrifft das keinen Eintrag.
   */
  disabled?: boolean;
};

export function Sidebar({
  userName,
  userEmail,
  receiptCount,
  signOut,
}: {
  userName: string;
  userEmail: string;
  receiptCount: number | null;
  /**
   * Der Abmelde-Knopf, von der Serverseite hereingegeben. Auth.js erwartet
   * beim Abmelden ein CSRF-Token; ein handgeschriebenes <form action="/api/
   * auth/signout"> scheitert daran. Eine Server Action bringt es mit, kann
   * aber in einer Client-Komponente nicht definiert werden - deshalb als
   * Slot.
   */
  signOut: React.ReactNode;
}) {
  const pathname = usePathname();

  const items: NavItem[] = [
    { href: "/", label: "Home" },
    {
      href: "/receipts",
      label: "Receipts",
      badge: receiptCount === null ? null : String(receiptCount),
    },
    { href: "/settlements", label: "Settlements" },
  ];

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="border-line bg-panel sticky top-0 flex h-dvh w-[244px] flex-none flex-col gap-[26px] self-stretch border-r px-[14px] pt-[26px] pb-[18px]">
      <div className="px-[10px]">
        {/* Die Wortmarke aus der Vorlage. Unoptimiert ausgeliefert: ein
            einzelnes Logo rechtfertigt keinen Bildoptimierungs-Dienst im
            Container. */}
        <Image
          src="/swiss-tph.png"
          alt="Swiss TPH"
          width={136}
          height={39}
          priority
          unoptimized
          className="block h-auto w-[136px]"
        />
        <div className="text-ink-3 mt-3 text-xs tracking-[0.01em]">Expenses</div>
      </div>

      <nav className="flex flex-col gap-[2px]">
        {items.map((item) =>
          item.disabled ? (
            <span
              key={item.href}
              aria-disabled="true"
              title="Not available yet"
              className="text-ink-3 flex h-10 cursor-not-allowed items-center justify-between gap-2 rounded-[10px] px-[10px] text-sm opacity-60"
            >
              <span>{item.label}</span>
              {item.badge ? (
                <span className="bg-surface text-ink-3 rounded-full px-[7px] py-px text-[11.5px] font-medium">
                  {item.badge}
                </span>
              ) : null}
            </span>
          ) : (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={
                isActive(item.href)
                  ? "bg-brand-soft text-brand-deep flex h-10 items-center justify-between gap-2 rounded-[10px] px-[10px] text-sm font-semibold"
                  : "text-ink-2 hover:bg-surface flex h-10 items-center justify-between gap-2 rounded-[10px] px-[10px] text-sm"
              }
            >
              <span>{item.label}</span>
              {item.badge ? (
                <span className="bg-surface text-ink-2 tabular rounded-full px-[7px] py-px text-[11.5px] font-medium">
                  {item.badge}
                </span>
              ) : null}
            </Link>
          ),
        )}
      </nav>

      <div className="mt-auto flex flex-col gap-[14px]">
        <div className="bg-line h-px" />

        <div className="flex flex-col gap-[10px] px-1">
          <div className="flex items-center gap-[10px]">
            <div className="bg-brand-soft text-brand-deep flex h-8 w-8 flex-none items-center justify-center rounded-full text-xs font-semibold">
              {initialsOf(userName)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{userName}</div>
              <div className="text-ink-3 truncate text-[11.5px]">{userEmail}</div>
            </div>
          </div>

          {/* Anstelle des "Settings"-Knopfes aus der Vorlage: es gibt keine
              Einstellungen, aber es braucht einen Weg aus der Anmeldung
              heraus. */}
          {signOut}
        </div>
      </div>
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}
