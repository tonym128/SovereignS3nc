import { execSync } from 'child_process';

async function globalSetup() {
  console.log('--- Global Setup: Restarting Dev Environment ---');
  try {
    // We use bash to run the dev script which handles stopping and starting everything
    execSync('bash dev.sh dev', { stdio: 'inherit' });
    // Give it a few seconds to be fully ready
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log('--- Global Setup: Dev Environment Ready ---');
  } catch (error) {
    console.error('--- Global Setup: Failed to start dev environment ---', error);
    process.exit(1);
  }
}

export default globalSetup;
