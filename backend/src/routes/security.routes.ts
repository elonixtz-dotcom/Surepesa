import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { setTransactionPin } from '../services/pin.service';

export const securityRouter = Router();
securityRouter.use(requireAuth);

const schema = z.object({
  pin: z.string().regex(/^\d{6}$/),
  currentPin: z.string().regex(/^\d{6}$/).optional(),
});

securityRouter.get('/pin', async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.user!.id },
    select: { pinHash: true, phoneVerifiedAt: true },
  });
  res.json({ configured: Boolean(user.pinHash), phoneVerified: Boolean(user.phoneVerifiedAt) });
});

securityRouter.put('/pin', async (req, res) => {
  const input = schema.parse(req.body);
  await setTransactionPin(req.user!.id, input.pin, input.currentPin);
  res.status(204).end();
});
