import { api } from './client';

export interface WalletBalance {
  playerId: string;
  available: string;
  locked: string;
  clearing: string;
}

export function fetchBalance(): Promise<WalletBalance> {
  return api.get<WalletBalance>('/me/balance');
}
