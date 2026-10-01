import { AuditLog } from "@/models/AuditLog";

type AuditEntry = {
  locationId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  summary: string;
  before?: unknown;
  after?: unknown;
};

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  await AuditLog.create({
    locationId: entry.locationId,
    userId: entry.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? "",
    summary: entry.summary,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}
