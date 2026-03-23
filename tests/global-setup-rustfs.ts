import { execSync } from 'child_process';

async function globalSetup() {
  console.log('--- Global Setup (RustFS): Restarting Dev Environment ---');
  try {
    // We use bash to run the devrustfs script which handles stopping and starting everything
    execSync('bash devrustfs.sh dev', { stdio: 'inherit' });
    // Give it a few seconds to be fully ready
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log('--- Global Setup (RustFS): Dev Environment Ready ---');
  } catch (error) {
    console.error('--- Global Setup (RustFS): Failed to start dev environment ---', error);
    process.exit(1);
  }
}

export default globalSetup;
