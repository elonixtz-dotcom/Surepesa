import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { login, requireAdmin, requirePermission } from './auth';
import { permissionsFor, ROLE_LABELS } from './permissions';
import { pageParams } from './present';
import { approvalsRouter } from './routes/approvals.routes';
import { casesRouter } from './routes/cases.routes';
import { customersRouter } from './routes/customers.routes';
import { kycReviewRouter } from './routes/kyc.routes';
import { overviewRouter } from './routes/overview.routes';
import { transactionsRouter } from './routes/transactions.routes';
import { railsRouter } from './routes/rails.routes';
import { feesRouter } from './routes/fees.routes';
import { reportsRouter } from './routes/reports.routes';

/** Back-office API: /admin/v1 */
export const adminRouter = Router();

// Simple per-IP throttle on the login endpoint, in addition to per-account lockout.
const attempts = new Map<string, { count: number; resetAt: number }>();
adminRouter.post('/auth/login', async (req, res) => {
  const key = req.ip ?? 'unknown';
  const now = Date.now();
  const entry = attempts.get(key);
  if (entry && entry.resetAt > now && entry.count >= 20) {
    res.status(429).json({ error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many sign-in attempts. Wait a few minutes.' } });
    return;
  }
  attempts.set(key, entry && entry.resetAt > now ? { ...entry, count: entry.count + 1 } : { count: 1, resetAt: now + 10 * 60_000 });

  const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const { token, admin } = await login(email, password, req.ip);
  res.json({ token, admin: present(admin) });
});

adminRouter.use(requireAdmin);

function present(a: { id: string; email: string; fullName: string; role: keyof typeof ROLE_LABELS; lastLoginAt: Date | null }) {
  return {
    id: a.id,
    email: a.email,
    fullName: a.fullName,
    role: a.role,
    roleLabel: ROLE_LABELS[a.role],
    permissions: permissionsFor(a.role),
    lastLoginAt: a.lastLoginAt,
  };
}

adminRouter.get('/me', (req, res) => {
  res.json(present(req.admin!));
});

adminRouter.use(overviewRouter);
adminRouter.use(customersRouter);
adminRouter.use(transactionsRouter);
adminRouter.use(casesRouter);
adminRouter.use(approvalsRouter);
adminRouter.use(kycReviewRouter);
adminRouter.use(railsRouter);
adminRouter.use(reportsRouter);
adminRouter.use(feesRouter);

/** Audit trail with actor names resolved. */
adminRouter.get('/audit-logs', requirePermission('audit:view'), async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req.query);
  const where = req.query.action ? { action: String(req.query.action) } : {};
  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, skip, take, orderBy: { id: 'desc' } }),
  ]);
  const adminIds = [...new Set(logs.filter((l) => l.actorType === 'ADMIN' && l.actorId).map((l) => l.actorId!))];
  const admins = new Map(
    (await prisma.adminUser.findMany({ where: { id: { in: adminIds } }, select: { id: true, fullName: true, role: true } })).map((a) => [a.id, a]),
  );
  res.json({
    page,
    pageSize,
    total,
    items: logs.map((l) => ({
      id: l.id.toString(),
      at: l.createdAt,
      actorType: l.actorType,
      actor: l.actorId ? (admins.get(l.actorId)?.fullName ?? l.actorId) : 'System',
      actorRole: l.actorId ? (admins.get(l.actorId)?.role ?? null) : null,
      action: l.action,
      entityType: l.entityType,
      entityId: l.entityId,
      before: l.before,
      after: l.after,
      ipAddress: l.ipAddress,
    })),
  });
});
