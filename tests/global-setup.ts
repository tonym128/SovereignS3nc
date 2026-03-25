import { execSync } from 'child_process';

async function globalSetup() {
  console.log('--- Global Setup (RustFS): Restarting Dev Environment ---');
  try {
    // We use bash to run the dev script which handles stopping and starting everything
    execSync('bash dev.sh dev', { stdio: 'inherit' });
    // Give it more time to be fully ready (Metadata/IAM init)
    await new Promise(resolve => setTimeout(resolve, 10000));
    console.log('--- Global Setup (RustFS): Dev Environment Ready ---');
  } catch (error) {
    console.error('--- Global Setup (RustFS): Failed to start dev environment ---', error);
    process.exit(1);
  }
}

export default globalSetup;
