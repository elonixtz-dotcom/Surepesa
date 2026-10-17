import { Router } from 'express';
import { TransactionType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { DEFAULT_RULES, invalidateFeeCache } from '../../services/fee.service';
import { audit } from '../audit';
import { requirePermission } from '../auth';

/**
 * Fee schedule, including regulatory caps. Rules are never edited in place: a change is a
 * new rule with its own effective date, and the previous one is deactivated, so the history
 * of what customers were charged stays readable.
 */
export const feesRouter = Router();

feesRouter.get('/fees', requirePermission('fees:view'), async (_req, res) => {
  const rules = await prisma.feeRule.findMany({ orderBy: [{ transactionType: 'asc' }, { effectiveFrom: 'desc' }] });
  res.json({
    rules,
    defaults: Object.entries(DEFAULT_RULES).map(([transactionType, r]) => ({ transactionType, bps: r!.bps, minFee: r!.min, maxFee: r!.max })),
  });
});

const minor = z.string().regex(/^(0|[1-9][0-9]*)$/).transform((v) => BigInt(v));

const ruleSchema = z
  .object({
    transactionType: z.nativeEnum(TransactionType),
    bps: z.number().int().min(0).max(10_000),
    minFee: minor,
    maxFee: minor.nullable(),
    note: z.string().trim().min(5).max(500), // why: pricing decision, regulator circular ...
    effectiveFrom: z.coerce.date().optional(),
  })
  .refine((r) => r.maxFee === null || r.maxFee >= r.minFee, { message: 'maxFee must be at least minFee', path: ['maxFee'] });

feesRouter.post('/fees', requirePermission('fees:manage'), async (req, res) => {
  const input = ruleSchema.parse(req.body);
  const rule = await prisma.$transaction(async (tx) => {
    const previous = await tx.feeRule.findMany({ where: { transactionType: input.transactionType, active: true } });
    // Rules that start later than the new one would override it; keep them, retire the rest.
    const effectiveFrom = input.effectiveFrom ?? new Date();
    const retire = previous.filter((p) => p.effectiveFrom <= effectiveFrom);
    await tx.feeRule.updateMany({ where: { id: { in: retire.map((p) => p.id) } }, data: { active: false } });
    const created = await tx.feeRule.create({
      data: { ...input, effectiveFrom, createdById: req.admin!.id },
    });
    await audit(
      {
        actorId: req.admin!.id,
        action: 'FEE_RULE_CREATED',
        entityType: 'FeeRule',
        entityId: created.id,
        before: retire.map((p) => ({ id: p.id, bps: p.bps, minFee: p.minFee.toString(), maxFee: p.maxFee?.toString() ?? null })),
        after: { transactionType: created.transactionType, bps: created.bps, minFee: created.minFee.toString(), maxFee: created.maxFee?.toString() ?? null, note: created.note },
      },
      tx,
    );
    return created;
  });
  invalidateFeeCache();
  res.status(201).json(rule);
});
