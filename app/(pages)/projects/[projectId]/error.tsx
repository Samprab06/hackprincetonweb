"use client";

export default function ProjectError({ reset }: { reset: () => void }) {
  return (
    <section role="alert" className="rounded-2xl border border-line bg-white p-7">
      <h1 className="text-xl font-semibold">Unable to load this project view</h1>
      <button type="button" onClick={reset} className="mt-4 rounded-lg bg-pine px-4 py-2 text-white">Try again</button>
    </section>
  );
}
