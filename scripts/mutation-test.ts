import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export interface CryptoMutant {
    id: string;
    description: string;
    original: string;
    replacement: string;
}

export const CRYPTO_MUTANTS: CryptoMutant[] = [
    {
        id: 'MUTANT-1',
        description: 'Tamper IV length in encrypt (12 bytes -> 16 bytes)',
        original: "const iv = crypto.randomBytes(12);",
        replacement: "const iv = crypto.randomBytes(16);"
    },
    {
        id: 'MUTANT-2',
        description: 'Corrupt encryption algorithm (aes-256-gcm -> aes-256-cbc)',
        original: "crypto.createCipheriv('aes-256-gcm', keyBuffer, iv)",
        replacement: "crypto.createCipheriv('aes-256-cbc', keyBuffer, iv)"
    },
    {
        id: 'MUTANT-3',
        description: 'Neutralize decryption authentication tag verification',
        original: "decipher.setAuthTag(tag);",
        replacement: "decipher.setAuthTag(Buffer.alloc(16));"
    },
    {
        id: 'MUTANT-4',
        description: 'Invert public key length validation in deriveSharedSecret',
        original: "if (theirPublicKey.length !== 32)",
        replacement: "if (theirPublicKey.length === 32)"
    },
    {
        id: 'MUTANT-5',
        description: 'Drop HKDF domain separation context info label',
        original: "Buffer.from(context, 'utf8'), // info / domain label",
        replacement: "Buffer.alloc(0), // info / domain label"
    },
    {
        id: 'MUTANT-6',
        description: 'Truncate derived AES key length in deriveSharedSecret (32 -> 16 bytes)',
        original: "32  // 32 bytes = 256-bit AES key",
        replacement: "16  // truncated to 16 bytes"
    },
    {
        id: 'MUTANT-7',
        description: 'Corrupt master PBKDF2 derived key length in KeyManager (32 -> 16 bytes)',
        original: "crypto.pbkdf2(password, saltBuffer, iterations, 32, 'sha256'",
        replacement: "crypto.pbkdf2(password, saltBuffer, iterations, 16, 'sha256'"
    },
    {
        id: 'MUTANT-8',
        description: 'Drop key salting in calculateHashedContent',
        original: "if (key) hasher.update(key); // Salt hash with key",
        replacement: "/* salting removed */"
    },
    {
        id: 'MUTANT-9',
        description: 'Truncate AES keyBuffer slice during encryption (32 -> 16 bytes)',
        original: "const keyBuffer = Buffer.from(key, 'hex').slice(0, 32);",
        replacement: "const keyBuffer = Buffer.from(key, 'hex').slice(0, 16);"
    },
    {
        id: 'MUTANT-10',
        description: 'Invert identity key initialization check',
        original: "if (!this.ctx.config.encryptionKey) throw new AuthError('Identity key not initialized');",
        replacement: "if (this.ctx.config.encryptionKey) throw new AuthError('Identity key not initialized');"
    }
];

export interface MutationResult {
    total: number;
    killed: number;
    survived: number;
    mutationScore: number;
    details: {
        id: string;
        description: string;
        status: 'KILLED' | 'SURVIVED';
    }[];
}

export function runMutationTests(rootDir: string = path.resolve(__dirname, '..')): MutationResult {
    const targetFile = path.join(rootDir, 'src/core/KeyManager.ts');
    const originalContent = fs.readFileSync(targetFile, 'utf8');

    const results: MutationResult['details'] = [];
    let killed = 0;
    let survived = 0;

    console.log('🧬 Starting Stryker-Style Crypto Mutation Testing...');
    console.log(`📁 Target: ${targetFile}`);
    console.log(`🎯 Mutants configured: ${CRYPTO_MUTANTS.length}\n`);

    try {
        for (const mutant of CRYPTO_MUTANTS) {
            process.stdout.write(`Testing [${mutant.id}]: ${mutant.description}... `);

            if (!originalContent.includes(mutant.original)) {
                console.error(`\n❌ Mutation pattern not found in source: "${mutant.original}"`);
                survived++;
                results.push({ id: mutant.id, description: mutant.description, status: 'SURVIVED' });
                continue;
            }

            const mutatedContent = originalContent.replace(mutant.original, mutant.replacement);
            fs.writeFileSync(targetFile, mutatedContent, 'utf8');

            let testFailed = false;
            try {
                execSync(
                    'NODE_OPTIONS=--experimental-vm-modules npx jest -c tests/jest.config.js tests/CryptoHardening.unit.test.ts tests/nodeCrypto.unit.test.ts tests/ProtocolDowngradeSecurity.unit.test.ts --silent',
                    { cwd: rootDir, stdio: 'pipe' }
                );
            } catch {
                testFailed = true;
            }

            if (testFailed) {
                killed++;
                results.push({ id: mutant.id, description: mutant.description, status: 'KILLED' });
                console.log('💥 KILLED');
            } else {
                survived++;
                results.push({ id: mutant.id, description: mutant.description, status: 'SURVIVED' });
                console.log('⚠️ SURVIVED');
            }
        }
    } finally {
        fs.writeFileSync(targetFile, originalContent, 'utf8');
        console.log('\n🔒 Restored original KeyManager.ts');
    }

    const total = CRYPTO_MUTANTS.length;
    const score = Math.round((killed / total) * 100);

    console.log('\n=========================================');
    console.log('📊 CRYPTO MUTATION TESTING REPORT');
    console.log('=========================================');
    console.log(`Total Mutants:   ${total}`);
    console.log(`Killed:          ${killed}`);
    console.log(`Survived:        ${survived}`);
    console.log(`Mutation Score:  ${score}%`);
    console.log('=========================================\n');

    return {
        total,
        killed,
        survived,
        mutationScore: score,
        details: results
    };
}

if (require.main === module) {
    const result = runMutationTests();
    if (result.mutationScore < 80) {
        console.error(`❌ Mutation score (${result.mutationScore}%) below threshold (80%).`);
        process.exit(1);
    } else {
        console.log(`✅ Mutation score (${result.mutationScore}%) passed threshold (80%).`);
        process.exit(0);
    }
}
