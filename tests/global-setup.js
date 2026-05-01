"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
async function globalSetup() {
    console.log('--- Global Setup (RustFS): Restarting Dev Environment ---');
    try {
        // We use bash to run the dev script which handles stopping and starting everything
        (0, child_process_1.execSync)('bash dev.sh start', { stdio: 'inherit' });
        // Give it more time to be fully ready (Metadata/IAM init)
        await new Promise(resolve => setTimeout(resolve, 10000));
        console.log('--- Global Setup (RustFS): Dev Environment Ready ---');
    }
    catch (error) {
        console.error('--- Global Setup (RustFS): Failed to start dev environment ---', error);
        process.exit(1);
    }
}
exports.default = globalSetup;
//# sourceMappingURL=global-setup.js.map