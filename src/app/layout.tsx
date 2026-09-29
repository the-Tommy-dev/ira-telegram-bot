import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Telegram-бот Иры",
  description: "Служебная страница Telegram-бота Иры",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
