import type { AccessTokenPayload } from '../types/auth';

/** Custom data attached to every authenticated socket (see socket-auth.ts). */
export interface SocketData {
  user: AccessTokenPayload;
}
