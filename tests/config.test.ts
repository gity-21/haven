import { PORT, HOST, CORS_WHITELIST, SOCKET_RATE_LIMITS, HTTP_RATE_LIMITS } from '../server/src/config';

describe('Server Configuration', () => {
    it('should have valid default port and host', () => {
        expect(PORT).toBeGreaterThan(0);
        expect(typeof HOST).toBe('string');
        expect(HOST.length).toBeGreaterThan(0);
    });

    it('should configure CORS whitelist correctly', () => {
        expect(CORS_WHITELIST.has('http://localhost:3847')).toBe(true);
        expect(CORS_WHITELIST.has('http://127.0.0.1:3847')).toBe(true);
    });

    it('should have socket rate limits defined for critical events', () => {
        expect(SOCKET_RATE_LIMITS['send-message']).toBeDefined();
        expect(SOCKET_RATE_LIMITS['send-message'].max).toBe(15);
        expect(SOCKET_RATE_LIMITS['join-room']).toBeDefined();
        expect(SOCKET_RATE_LIMITS['toggle-reaction']).toBeDefined();
    });

    it('should have HTTP rate limits configured', () => {
        expect(HTTP_RATE_LIMITS.generalApi.max).toBeGreaterThan(0);
        expect(HTTP_RATE_LIMITS.socketHandshake.max).toBeGreaterThan(0);
    });
});

