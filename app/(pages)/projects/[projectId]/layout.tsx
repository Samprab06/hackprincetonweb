import Link from "next/link";

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-line bg-white">
        <div className="mx-auto max-w-5xl px-5 py-5 sm:px-8">
          <Link href="/" className="text-xl font-bold tracking-tight text-pine">Sitework</Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-7 sm:px-8">{children}</main>
    </>
  );
}
