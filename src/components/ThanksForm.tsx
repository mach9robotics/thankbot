"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Person, PersonSummary } from "@/lib/types";
import { PersonTypeahead } from "./PersonTypeahead";

const MAX_REASON_LENGTH = 500;
const ALLOW_SELF_THANKS = process.env.NEXT_PUBLIC_ALLOW_SELF_THANKS === "true";

type FormPerson = PersonSummary & { email?: string | null };

export function ThanksForm({
  currentPerson,
  people,
}: {
  currentPerson: Person;
  people: FormPerson[];
}) {
  const router = useRouter();
  const [recipients, setRecipients] = useState<FormPerson[]>([]);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);

  const teammates = useMemo(
    () =>
      ALLOW_SELF_THANKS
        ? people
        : people.filter((person) => person.id !== currentPerson.id),
    [people, currentPerson.id]
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (recipients.length === 0) {
      setError("Pick at least one teammate.");
      return;
    }

    setStatus("sending");

    try {
      const response = await fetch("/api/thanks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to_person_ids: recipients.map((person) => person.id),
          reason,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        thanks?: { id: string };
      };

      if (!response.ok || !payload.thanks) {
        setError(payload.error ?? "Could not send that thanks.");
        setStatus("idle");
        return;
      }

      router.push(`/thanks/${payload.thanks.id}`);
    } catch {
      setError("Network error — try again.");
      setStatus("idle");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Send thanks"
      className="rounded-2xl border border-brand-100 bg-white/80 p-6 shadow-sm"
    >
      <label className="block">
        <span className="text-sm font-medium text-ink-700">To</span>
        <div className="mt-1.5">
          <PersonTypeahead
            people={teammates}
            selected={recipients}
            onChange={setRecipients}
            disabled={status === "sending"}
            placeholder="Search Mach9 teammates…"
          />
        </div>
      </label>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block min-w-0 flex-1">
          <span className="text-sm font-medium text-ink-700">For</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={MAX_REASON_LENGTH}
            required
            placeholder="reviewing my PR at midnight"
            className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 outline-none transition placeholder:text-ink-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          />
        </label>

        <button
          type="submit"
          disabled={status === "sending" || teammates.length === 0}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-brand-600 to-brand-400 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand-600/25 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 sm:mb-0"
        >
          {status === "sending" ? "Sending…" : "Send"}
        </button>
      </div>

      {teammates.length === 0 ? (
        <p className="mt-4 text-sm text-ink-500">
          No teammates on the board yet — once a colleague signs in, they show up
          here.
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 text-right text-sm text-heart-600">{error}</p>
      ) : null}
    </form>
  );
}
