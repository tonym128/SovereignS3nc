# Reference "Todo List" Module Implementation

This directory contains a reference implementation of a Todo List module using the SovereignS3nc platform. It demonstrates how to create a custom module, define a SQLite-based schema, and implement CRUD operations that are automatically synchronized.

## Directory Structure

- `src/TodoModule.ts`: The core module class which implements the `ModuleDefinition` and CRUD logic.
- `src/demo.ts`: A reference script that demonstrates how to initialize the module and perform basic operations.

## How to Run

To run the reference demo script, use `ts-node` from the project root:

```bash
npx ts-node demo/todo-module/src/demo.ts
```

## Implementation Highlights

### 1. Module Definition

The module defines a simple `todos` table with migrations support.

```typescript
export const TODO_MODULE_DEFINITION: ModuleDefinition = {
    name: 'todo',
    tables: [
        {
            name: 'todos',
            schema: `
                id TEXT PRIMARY KEY,
                task TEXT,
                completed INTEGER DEFAULT 0,
                timestamp INTEGER
            `
        }
    ]
};
```

### 2. Namespaced Storage

The module uses the `SovereignS3nc` storage API to save its database in a private, namespaced path:

```typescript
const dbPath = `private/modules/todo/todos.db`;
```

### 3. Sync and Events

Whenever the database is modified, the module calls `onModuleUpdate`, which notifies the core engine to trigger a synchronization with the remote backend (if configured) and emit events to update the UI.

```typescript
this.sov.onModuleUpdate('todo', dbPath);
```
