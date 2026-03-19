import { execSync } from 'child_process';

export default async function globalTeardown() {
  console.log('\n--- Jest Global Teardown: Stopping Dev Environment ---');
  try {
    execSync('bash dev.sh stop', { stdio: 'inherit' });
    console.log('--- Jest Global Teardown: Dev Environment Stopped ---\n');
  } catch (error) {
    console.error('--- Jest Global Teardown: Failed to stop dev environment ---', error);
  }
}
