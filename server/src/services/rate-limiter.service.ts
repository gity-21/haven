/**
 * server/src/services/rate-limiter.service.ts — Soket Başına Rate Limiting Servisi
 *
 * Her bir istemci soketi için olay bazlı hız aşımı (spam/flood) koruması sağlar.
 */

import { SOCKET_RATE_LIMITS, RateLimitConfig } from '../config';
import type { HavenSocket } from '../types/socket-events';

interface RateCounter {
    count: number;
    start: number;
    warned?: boolean;
}

export function createSocketRateChecker(target: HavenSocket | string) {
    const eventCounters: Record<string, RateCounter> = {};
    const identifier = typeof target === 'string' ? target : (target.nickname || target.id);

    return function checkRate(eventName: string): boolean {
        const limit: RateLimitConfig | undefined = SOCKET_RATE_LIMITS[eventName];
        if (!limit) return true;

        const now = Date.now();
        const counter = eventCounters[eventName];

        if (!counter || (now - counter.start) > limit.windowMs) {
            eventCounters[eventName] = { count: 1, start: now, warned: false };
            return true;
        }

        if (counter.count >= limit.max) {
            if (!counter.warned) {
                console.warn(`[RATE] ${identifier} → '${eventName}' hız limiti aşıldı!`);
                counter.warned = true;
            }

            if (typeof target !== 'string' && counter.count > limit.max + 50) {
                console.error(`[DDOS] ${identifier} aşırı istek gönderdiği için bağlantısı koparıldı!`);
                target.disconnect(true);
            }

            counter.count++;
            return false;
        }

        counter.count++;
        return true;
    };
}
