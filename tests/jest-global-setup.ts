import { execSync } from 'child_process';

export default async function globalSetup() {
  console.log('\n--- Jest Global Setup: Starting Dev Environment ---');
  try {
    execSync('bash dev.sh start', { stdio: 'inherit' });
    // Wait for services to be ready
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log('--- Jest Global Setup: Dev Environment Ready ---\n');
  } catch (error) {
    console.error('--- Jest Global Setup: Failed to start dev environment ---', error);
    process.exit(1);
  }
}
