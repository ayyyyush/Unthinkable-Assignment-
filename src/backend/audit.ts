import type { TransactionClient } from "./booking";
import { prisma } from "./db";

interface AuditEntry {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Accepts either a transaction client or the base prisma client, so audit
 * entries can be written atomically alongside the mutation they describe
 * (preferred) or standalone when there's no enclosing transaction.
 */
export async function writeAuditLog(
  client: TransactionClient | typeof prisma,
  entry: AuditEntry
) {
  await client.auditLog.create({
    data: {
      userId: entry.userId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata ?? undefined,
    },
  });
}
