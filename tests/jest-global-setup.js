"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = globalSetup;
const child_process_1 = require("child_process");
async function globalSetup() {
    console.log('\n--- Jest Global Setup: Starting Dev Environment ---');
    try {
        (0, child_process_1.execSync)('bash dev.sh start', { stdio: 'inherit' });
        // Wait for services to be ready
        await new Promise(resolve => setTimeout(resolve, 5000));
        console.log('--- Jest Global Setup: Dev Environment Ready ---\n');
    }
    catch (error) {
        console.error('--- Jest Global Setup: Failed to start dev environment ---', error);
        process.exit(1);
    }
}
//# sourceMappingURL=jest-global-setup.js.map