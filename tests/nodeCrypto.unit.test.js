"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const nodeCrypto_1 = require("../src/utils/nodeCrypto");
describe('nodeCrypto', () => {
    it('should import the native crypto module', async () => {
        const crypto = await (0, nodeCrypto_1.nodeCrypto)();
        expect(crypto).toBeDefined();
        expect(crypto.createHash).toBeDefined();
        expect(crypto.randomBytes).toBeDefined();
        const hash = crypto.createHash('sha256').update('test').digest('hex');
        expect(hash).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
    });
});
//# sourceMappingURL=nodeCrypto.unit.test.js.map