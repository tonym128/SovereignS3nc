import { SovereignS3nc } from '../../../src';
import { TodoModule } from './TodoModule';
import * as crypto from 'crypto';
import initSqlJs from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';

// --- Polyfills for Node environment ---
(global as any).initSqlJs = initSqlJs;
try {
    Object.defineProperty(global, 'crypto', {
        value: (crypto as any).webcrypto,
        writable: true,
        configurable: true
    });
} catch (e) {
    // If it's already defined and not configurable, skip
}
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;

async function runDemo() {
    console.log('--- SovereignS3nc Todo Module Demo ---');

    const config = {
        paths: { 
            appId: 'todo-demo-app', 
            userId: 'alice-' + Math.random().toString(36).substring(7), 
            storeId: 'personal' 
        },
        password: 'demo-password',
        debug: true
    };

    // Initialize SovereignS3nc in local-only mode
    const sov = new SovereignS3nc(config);
    await sov.init();

    // Initialize our custom module
    const todoModule = new TodoModule(sov);

    console.log('\n1. Adding todos...');
    await todoModule.addTodo('Buy groceries');
    await todoModule.addTodo('Finish documentation');
    await todoModule.addTodo('Write unit tests');

    let todos = await todoModule.getTodos();
    console.log('Current Todos:', todos.map(t => `[${t.completed ? 'X' : ' '}] ${t.task} (${t.id})`));

    console.log('\n2. Toggling status of first todo...');
    if (todos.length > 0) {
        await todoModule.toggleTodo(todos[0].id);
    }

    todos = await todoModule.getTodos();
    console.log('Updated Todos:', todos.map(t => `[${t.completed ? 'X' : ' '}] ${t.task} (${t.id})`));

    console.log('\n3. Deleting a todo...');
    if (todos.length > 1) {
        const toDelete = todos[1].id;
        console.log(`Deleting: ${todos[1].task}`);
        await todoModule.deleteTodo(toDelete);
    }

    todos = await todoModule.getTodos();
    console.log('Final Todos:', todos.map(t => `[${t.completed ? 'X' : ' '}] ${t.task} (${t.id})`));

    console.log('\nDemo completed successfully.');
    
    // Cleanup demo files
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    const baseDir = path.join(homeDir, '.sovereigns3nc', config.paths.appId, config.paths.userId);
    console.log(`\nDemo data saved to: ${baseDir}`);
}

runDemo().catch(console.error);
