import {
    securityHeadersMiddleware,
    validateNickname,
    validateRoomKey,
    validateAuthKey,
    validateMessageContent,
    maskSecret,
    INPUT_LIMITS
} from '../server/src/config/security';

describe('Security Layer & Validators (SECURITY_RULES.md)', () => {
    describe('HTTP Security Headers Middleware', () => {
        it('should attach essential security headers to response', () => {
            const req = {} as any;
            const headers: Record<string, string> = {};
            const res = {
                setHeader: (key: string, val: string) => {
                    headers[key] = val;
                }
            } as any;
            const next = jest.fn();

            securityHeadersMiddleware(req, res, next);

            expect(headers['X-Content-Type-Options']).toBe('nosniff');
            expect(headers['X-Frame-Options']).toBe('DENY');
            expect(headers['X-XSS-Protection']).toBe('1; mode=block');
            expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
            expect(headers['Content-Security-Policy']).toContain("default-src 'self'");
            expect(next).toHaveBeenCalledTimes(1);
        });
    });

    describe('Nickname Validation & Sanitization', () => {
        it('should accept valid nicknames', () => {
            const res = validateNickname('Alice_99');
            expect(res.valid).toBe(true);
            expect(res.value).toBe('Alice_99');
        });

        it('should strip invisible/control characters', () => {
            const res = validateNickname('Bob\u0000\u001F');
            expect(res.valid).toBe(true);
            expect(res.value).toBe('Bob');
        });

        it('should reject empty or whitespace-only nicknames', () => {
            expect(validateNickname('').valid).toBe(false);
            expect(validateNickname('   ').valid).toBe(false);
            expect(validateNickname(null).valid).toBe(false);
        });

        it('should reject overly long nicknames', () => {
            const longNick = 'a'.repeat(INPUT_LIMITS.MAX_NICKNAME_LENGTH + 1);
            const res = validateNickname(longNick);
            expect(res.valid).toBe(false);
            expect(res.error).toBeDefined();
        });
    });

    describe('Room Key Validation', () => {
        it('should accept alphanumeric room keys with dashes and underscores', () => {
            const res = validateRoomKey('room-alpha_2026');
            expect(res.valid).toBe(true);
            expect(res.value).toBe('room-alpha_2026');
        });

        it('should reject malicious injection or special characters in roomKey', () => {
            expect(validateRoomKey('<script>').valid).toBe(false);
            expect(validateRoomKey('room; DROP TABLE rooms;--').valid).toBe(false);
            expect(validateRoomKey('room name with spaces').valid).toBe(false);
            expect(validateRoomKey('../secret').valid).toBe(false);
        });

        it('should enforce room key length boundaries', () => {
            expect(validateRoomKey('a').valid).toBe(false); // Too short
            const longRoom = 'r'.repeat(INPUT_LIMITS.MAX_ROOM_KEY_LENGTH + 1);
            expect(validateRoomKey(longRoom).valid).toBe(false); // Too long
        });
    });

    describe('Auth Key (Password) Validation', () => {
        it('should accept valid passwords', () => {
            expect(validateAuthKey('MySecurePass123!').valid).toBe(true);
        });

        it('should reject empty or overly long passwords', () => {
            expect(validateAuthKey('').valid).toBe(false);
            expect(validateAuthKey('p'.repeat(129)).valid).toBe(false);
        });
    });

    describe('Message Content Validation', () => {
        it('should accept standard message contents', () => {
            const res = validateMessageContent('Merhaba dünya!');
            expect(res.valid).toBe(true);
            expect(res.value).toBe('Merhaba dünya!');
        });

        it('should reject empty or blank messages', () => {
            expect(validateMessageContent('').valid).toBe(false);
            expect(validateMessageContent('   ').valid).toBe(false);
            expect(validateMessageContent(12345).valid).toBe(false);
        });

        it('should reject messages exceeding length limit', () => {
            const longMessage = 'x'.repeat(INPUT_LIMITS.MAX_MESSAGE_LENGTH + 10);
            const res = validateMessageContent(longMessage);
            expect(res.valid).toBe(false);
            expect(res.error).toContain('karakteri aşamaz');
        });
    });

    describe('Secret Masking Utility', () => {
        it('should mask long secrets properly', () => {
            expect(maskSecret('secret_token_12345')).toBe('sec***45');
        });

        it('should mask short secrets completely', () => {
            expect(maskSecret('1234')).toBe('***');
            expect(maskSecret(null)).toBe('***');
            expect(maskSecret(undefined)).toBe('***');
        });
    });
});

