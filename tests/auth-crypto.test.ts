import bcrypt from 'bcryptjs';
import crypto from 'crypto';

describe('Cryptographic & Authentication Utilities', () => {
    it('should securely hash and verify room passwords with bcrypt', () => {
        const password = 'VerySecureRoomPassword123!';
        const saltRounds = 10;
        const hash = bcrypt.hashSync(password, saltRounds);

        expect(hash).not.toBe(password);
        expect(bcrypt.compareSync(password, hash)).toBe(true);
        expect(bcrypt.compareSync('WrongPassword', hash)).toBe(false);
    });

    it('should generate cryptographically strong 64-character E2EE salt', () => {
        const salt1 = crypto.randomBytes(32).toString('hex');
        const salt2 = crypto.randomBytes(32).toString('hex');

        expect(salt1.length).toBe(64);
        expect(salt2.length).toBe(64);
        expect(salt1).not.toBe(salt2);
    });

    it('should generate secure admin tokens', () => {
        const token = crypto.randomBytes(32).toString('hex');
        expect(token.length).toBe(64);
        expect(/^[a-f0-9]{64}$/.test(token)).toBe(true);
    });
});

