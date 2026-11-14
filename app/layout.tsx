import type { Metadata } from "next";
import "./workspace.css";

export const metadata: Metadata = { title: "Sitework", description: "Explore locations for your service business." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
