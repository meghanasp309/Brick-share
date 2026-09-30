import { AuthProvider } from "@/lib/auth";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import "./globals.css";

export const metadata = {
  title: "BrickShare",
  description: "Own a share of real property. Buy, hold and trade it like a stock.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col font-sans antialiased">
        <AuthProvider>
          <Nav />
          <main className="flex-1">{children}</main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
