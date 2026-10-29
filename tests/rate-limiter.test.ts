import { createSocketRateChecker } from '../server/src/services/rate-limiter.service';

describe('Socket Rate Limiter Service', () => {
    it('should allow requests within limit', () => {
        const checker = createSocketRateChecker('test-user-1');

        for (let i = 0; i < 3; i++) {
            const allowed = checker('join-room');
            expect(allowed).toBe(true);
        }
    });

    it('should block requests exceeding the limit', () => {
        const checker = createSocketRateChecker('test-user-2');

        // 'join-room' limit is 3 per 10s
        expect(checker('join-room')).toBe(true);
        expect(checker('join-room')).toBe(true);
        expect(checker('join-room')).toBe(true);
        // 4th request must be blocked
        expect(checker('join-room')).toBe(false);
    });

    it('should allow untracked events without limitation', () => {
        const checker = createSocketRateChecker('test-user-3');
        for (let i = 0; i < 50; i++) {
            expect(checker('unknown-event')).toBe(true);
        }
    });
});

