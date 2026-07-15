import { PrismaClient } from "@prisma/client";

// Next.js dev mode hot-reloads modules on every save. Without this guard,
// each reload would instantiate a brand new PrismaClient (and a new
// connection pool) while the old one is still alive, eventually exhausting
// Postgres' max_connections. Stashing the instance on `globalThis` survives
// the module reload; production only ever creates one instance anyway.
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}
