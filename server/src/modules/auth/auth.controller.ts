import type { Request, Response } from 'express';
import * as authService from './auth.service';

export async function register(req: Request, res: Response) {
  const result = await authService.registerContractor(req.body);
  res.status(201).json(result);
}

export async function login(req: Request, res: Response) {
  const { phone, password } = req.body;
  const result = await authService.login(phone, password);
  res.json(result);
}

export async function refresh(req: Request, res: Response) {
  const { refreshToken } = req.body;
  const tokens = await authService.refreshAccessToken(refreshToken);
  res.json(tokens);
}

export async function logout(req: Request, res: Response) {
  const { refreshToken } = req.body;
  await authService.revokeRefreshToken(refreshToken);
  res.status(204).send();
}
