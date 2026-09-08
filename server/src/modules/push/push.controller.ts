import type { Request, Response } from 'express';
import * as pushService from './push.service';

export async function register(req: Request, res: Response) {
  const userId = req.user!.sub;
  await pushService.registerPushToken(userId, req.body);
  res.status(204).send();
}

export async function unregister(req: Request, res: Response) {
  const userId = req.user!.sub;
  await pushService.unregisterPushToken(userId, req.body.expoPushToken);
  res.status(204).send();
}
