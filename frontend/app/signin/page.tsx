// Die Anmeldeseite. Ein Knopf, kein Formular: die Anmeldung findet bei Entra
// statt, hier wird nur dorthin geschickt.
//
// Der `signIn`-Aufruf ist eine Server Action. Ein <a href="/api/auth/signin">
// waere einfacher, wuerde aber erst auf einer Zwischenseite von Auth.js landen
// - und die zeigt eine Provider-Liste mit genau einem Eintrag.

import Image from "next/image";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;

  // Wer schon angemeldet ist, hat auf der Anmeldeseite nichts zu suchen -
  // sonst wirkt ein zweiter Klick auf "Sign in" wie ein Fehler.
  if (await auth()) redirect(callbackUrl ?? "/");

  return (
    <div className="bg-bg flex min-h-dvh items-center justify-center p-10">
      <div className="bg-panel border-line flex w-[420px] max-w-full flex-col gap-6 rounded-2xl border p-8">
        <div>
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

        <div className="flex flex-col gap-2">
          <h1 className="text-[21px] font-semibold tracking-[-0.018em]">Sign in</h1>
          <p className="text-ink-2 text-[13.5px] leading-[1.6]">
            Your receipts are captured in the Teams chat. Sign in with your work account to see them
            here, check the extracted data and prepare a settlement.
          </p>
        </div>

        {error ? (
          <div className="border-bad bg-bad-soft text-bad-deep rounded-xl border p-[13px] text-[13px] leading-[1.55]">
            Sign-in did not complete. Please try again, or contact IT if it keeps failing.
          </div>
        ) : null}

        <form
          action={async () => {
            "use server";
            await signIn("microsoft-entra-id", { redirectTo: callbackUrl ?? "/" });
          }}
        >
          <button
            type="submit"
            className="bg-brand hover:bg-brand-deep h-10 w-full rounded-[10px] px-4 text-[13.5px] font-medium text-white"
          >
            Continue with Microsoft
          </button>
        </form>
      </div>
    </div>
  );
}
