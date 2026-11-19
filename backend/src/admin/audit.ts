import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

type Db = Prisma.TransactionClient | typeof prisma;

interface AuditInput {
  actorId: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ipAddress?: string;
}

/** Appends a back-office action to the audit trail (SOP §13.47, §18.1). */
export function audit(input: AuditInput, db: Db = prisma) {
  return db.auditLog.create({ data: { actorType: 'ADMIN', ...input } });
}
