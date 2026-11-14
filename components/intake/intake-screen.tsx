"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { answerPrompt, fields, initialSession, intakeSessionSchema, missingFields, profileValidationMessage, updateProfile, type IntakeSession } from "./profile";

const subscribe = () => () => {};

export function IntakeScreen({ projectId }: { projectId: string }) {
  const key = `sitework:intake:v1:${projectId}`;
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  if (!ready) return <p role="status">Loading intake…</p>;
  return <IntakeForm key={key} storageKey={key} />;
}

function readSession(key: string): IntakeSession {
  try {
    const saved = localStorage.getItem(key);
    return saved ? intakeSessionSchema.parse(JSON.parse(saved)) : initialSession;
  } catch {
    return initialSession;
  }
}

function IntakeForm({ storageKey }: { storageKey: string }) {
  const [session, setSession] = useState(() => readSession(storageKey));
  const [message, setMessage] = useState("");
  const [drafts, setDrafts] = useState<Partial<Record<(typeof fields)[number]["key"], string>>>({});
  const [storageError, setStorageError] = useState(false);
  const missing = missingFields(session.profile);
  const next = missing[0];

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey) setSession(readSession(storageKey));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [storageKey]);

  function save(updated: IntakeSession) {
    setSession(updated);
    try {
      localStorage.setItem(storageKey, JSON.stringify(updated));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }

  return (
    <>
      {storageError && <p role="alert" className="mb-4 text-sm">This browser could not save your changes.</p>}
      <div className="grid items-start gap-8 md:grid-cols-2">
        <section aria-labelledby="chat-heading">
          <h2 id="chat-heading" className="text-lg font-semibold">Intake conversation</h2>
          <p className="mt-1 text-sm text-muted">This conversation uses a fixture.</p>
          <ol role="list" aria-live="polite" aria-label="Conversation" tabIndex={0} className="my-4 max-h-96 space-y-3 overflow-y-auto">
            {session.messages.map((entry, index) => (
              <li key={index} className={entry.role === "founder" ? "ml-5 rounded-xl bg-mint p-3" : "mr-5 rounded-xl bg-paper p-3"}>
                <span className="block text-xs font-semibold">{entry.role === "founder" ? "You" : "Intake"}</span>
                <p className="mt-1 break-words text-sm">{entry.text}</p>
              </li>
            ))}
          </ol>
          <form onSubmit={(event) => {
            event.preventDefault();
            if (!message.trim()) return;
            const updated = answerPrompt(session, message);
            if (next && updated.profile !== session.profile) {
              setDrafts((current) => ({ ...current, [next.key]: undefined }));
            }
            save(updated);
            setMessage("");
          }}>
            <label className="block text-sm font-medium" htmlFor={next ? "intake-message" : undefined}>
              {next ? `Your answer · ${next.label}` : "Your profile is complete"}
            </label>
            {next && (
              <div className="mt-2 flex flex-wrap gap-2">
                <input id="intake-message" className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2"
                  value={message} onChange={(event) => setMessage(event.target.value)} required />
                <button type="submit" className="rounded-lg bg-pine px-4 py-2 text-white">Send</button>
              </div>
            )}
          </form>
        </section>
        <section aria-labelledby="profile-heading">
          <h2 id="profile-heading" className="text-lg font-semibold">Business profile</h2>
          <p className="mt-2 text-sm text-muted" aria-live="polite">
            {missing.length ? `Still needed: ${missing.map((field) => field.label).join(", ")}.` : "All required fields are filled."}
          </p>
          <div className="mt-5 grid gap-4">
            {fields.map((field) => {
              const answer = session.profile[field.key];
              const draft = drafts[field.key];
              const error = draft === undefined ? undefined : profileValidationMessage(field, draft);
              const errorId = `profile-${field.key}-error`;
              const value = draft ?? answer?.value ?? "";
              const changed = (input: string) => {
                const invalid = profileValidationMessage(field, input);
                setDrafts((current) => ({ ...current, [field.key]: invalid ? input : undefined }));
                if (!invalid) save({ ...session, profile: updateProfile(session.profile, field.key, input) });
              };
              const inputClass = "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm";
              return (
                <div key={field.key}>
                  <label htmlFor={`profile-${field.key}`} className="text-sm font-medium">{field.label}</label>
                  {answer?.origin === "default" && <span className="ml-2 rounded bg-mint px-2 py-0.5 text-xs">Default</span>}
                  {"options" in field ? (
                    <select className={inputClass} id={`profile-${field.key}`} value={value} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} onChange={(event) => changed(event.target.value)}>
                      <option value="">Select an option</option>
                      {field.options.map((option) => <option key={option}>{option}</option>)}
                    </select>
                  ) : (
                    <input className={inputClass} type={"numeric" in field ? "number" : "text"}
                      min={"numeric" in field ? (field.key === "staff" ? 1 : 0) : undefined}
                      step={"numeric" in field ? 1 : undefined}
                      id={`profile-${field.key}`} value={value} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} onChange={(event) => changed(event.target.value)} />
                  )}
                  {error && <p id={errorId} role="alert" className="mt-1 text-sm font-medium text-red-800">{error}</p>}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}
