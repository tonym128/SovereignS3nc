"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = globalTeardown;
const child_process_1 = require("child_process");
async function globalTeardown() {
    console.log('\n--- Jest Global Teardown: Stopping Dev Environment ---');
    try {
        (0, child_process_1.execSync)('bash dev.sh stop', { stdio: 'inherit' });
        console.log('--- Jest Global Teardown: Dev Environment Stopped ---\n');
    }
    catch (error) {
        console.error('--- Jest Global Teardown: Failed to stop dev environment ---', error);
    }
}
//# sourceMappingURL=jest-global-teardown.js.map