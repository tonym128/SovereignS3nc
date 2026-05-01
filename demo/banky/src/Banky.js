"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BankyManager = exports.BANKY_MODULE_DEFINITION = void 0;
const src_1 = require("../../../src");
exports.BANKY_MODULE_DEFINITION = {
    name: 'banky',
    tables: [
        {
            name: 'accounts',
            schema: `
                id TEXT PRIMARY KEY,
                name TEXT,
                image TEXT,
                currency TEXT,
                createdAt INTEGER,
                ownerId TEXT,
                groupId TEXT,
                allowanceActive INTEGER DEFAULT 0,
                allowanceAmount REAL DEFAULT 0,
                allowanceInterval TEXT,
                allowanceNextRun INTEGER
            `
        },
        {
            name: 'transactions',
            schema: `
                id TEXT PRIMARY KEY,
                date TEXT,
                description TEXT,
                amount REAL,
                category TEXT,
                timestamp INTEGER,
                accountId TEXT,
                userId TEXT
            `
        },
        {
            name: 'goals',
            schema: `
                id TEXT PRIMARY KEY,
                name TEXT,
                targetAmount REAL,
                currentAmount REAL,
                accountId TEXT
            `
        },
        {
            name: 'moderation',
            schema: `
                targetId TEXT PRIMARY KEY,
                action TEXT,
                timestamp INTEGER
            `
        }
    ],
    migrations: [
        {
            version: 1,
            sql: [
                "ALTER TABLE accounts ADD COLUMN groupId TEXT;"
            ]
        }
    ]
};
class BankyManager {
    constructor(db) {
        this.db = db;
        this.sqliteInstance = null;
        this.MODULE_NAME = 'banky';
        this.db.registerModule(exports.BANKY_MODULE_DEFINITION);
    }
    async getDb(date, type, groupId, sharedKey) {
        if (type === 'group' && groupId && sharedKey) {
            return this.db.getGroupStore(groupId, this.MODULE_NAME, date, sharedKey);
        }
        let dbPath;
        if (type === 'followed') {
            dbPath = this.db.getModulePath(this.MODULE_NAME, `${date}.db`, 'followed');
        }
        else if (type === 'meta') {
            dbPath = `private/modules/${this.MODULE_NAME}/meta.db`;
        }
        else {
            dbPath = this.db.getModulePath(this.MODULE_NAME, `${date}.db`, type);
        }
        let data = await this.db.getStorage().getFile(dbPath);
        const initSqlJs = globalThis.initSqlJs;
        if (!initSqlJs) {
            throw new Error('sql.js not found. Ensure it is loaded in the environment.');
        }
        if (!this.sqliteInstance) {
            this.sqliteInstance = await initSqlJs(globalThis.SQL_CONFIG || {});
        }
        const db = new this.sqliteInstance.Database(data || undefined);
        // Use Core Schema Management
        this.db.applyModuleSchema(db, this.MODULE_NAME);
        return db;
    }
    async saveDb(db, date, type, groupId, sharedKey) {
        const binary = db.export();
        let dbPath;
        let finalData = binary;
        if (type === 'group' && groupId && sharedKey) {
            dbPath = `public/groups/${groupId}/${date}.db`;
            finalData = await this.db.encrypt(binary, sharedKey);
        }
        else if (type === 'meta') {
            dbPath = `private/modules/${this.MODULE_NAME}/meta.db`;
        }
        else {
            dbPath = this.db.getModulePath(this.MODULE_NAME, `${date}.db`, type);
        }
        await this.db.getStorage().saveFile(dbPath, finalData);
        db.close();
        if (type === 'group') {
            this.db.emit(`group:${groupId}:update`, { path: dbPath });
        }
        else if (type === 'meta') {
            this.db.emit(`${this.MODULE_NAME}:meta_update`, { path: dbPath });
        }
        else {
            this.db.onModuleUpdate(this.MODULE_NAME, dbPath);
        }
    }
    async createAccount(name, currency = 'USD', image) {
        const db = await this.getDb('', 'meta');
        const account = {
            id: Math.random().toString(36).substring(7),
            name,
            currency,
            image,
            createdAt: Date.now(),
            ownerId: this.db.getConfig().paths.userId
        };
        db.run(`INSERT INTO accounts (id, name, currency, image, createdAt, ownerId) VALUES (?, ?, ?, ?, ?, ?)`, [account.id, account.name, account.currency, account.image || null, account.createdAt, account.ownerId]);
        await this.saveDb(db, '', 'meta');
        return account;
    }
    async addTransaction(accountId, description, amount, category, dateStr, groupId, sharedKey) {
        const date = new Date().toISOString().split('T')[0];
        const syncDate = dateStr || date;
        const type = groupId ? 'group' : 'private';
        const db = await this.getDb(syncDate, type, groupId, sharedKey);
        const tx = {
            id: Math.random().toString(36).substring(7),
            date: syncDate,
            description,
            amount,
            category,
            timestamp: Date.now(),
            accountId,
            userId: this.db.getConfig().paths.userId
        };
        db.run(`INSERT INTO transactions (id, date, description, amount, category, timestamp, accountId, userId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [tx.id, tx.date, tx.description, tx.amount, tx.category, tx.timestamp, tx.accountId, tx.userId]);
        await this.saveDb(db, syncDate, type, groupId, sharedKey);
    }
    async renameAccount(accountId, newName) {
        const db = await this.getDb('', 'meta');
        db.run('UPDATE accounts SET name = ? WHERE id = ?', [newName, accountId]);
        await this.saveDb(db, '', 'meta');
    }
    async updateAccountImage(accountId, image) {
        const db = await this.getDb('', 'meta');
        db.run('UPDATE accounts SET image = ? WHERE id = ?', [image, accountId]);
        await this.saveDb(db, '', 'meta');
    }
    async deleteAccount(accountId) {
        const db = await this.getDb('', 'meta');
        db.run('DELETE FROM accounts WHERE id = ?', [accountId]);
        db.run('DELETE FROM goals WHERE accountId = ?', [accountId]);
        // Note: Transaction files are not deleted as they might contain other accounts' data
        await this.saveDb(db, '', 'meta');
    }
    async getAccounts() {
        const db = await this.getDb('', 'meta');
        const res = db.exec('SELECT * FROM accounts');
        const accounts = [];
        if (res.length > 0) {
            const cols = res[0].columns;
            res[0].values.forEach((row) => {
                const acc = {};
                cols.forEach((c, i) => acc[c] = row[i]);
                accounts.push(acc);
            });
        }
        db.close();
        return accounts;
    }
    async getTransactions(accountId, days = 365, groupId) {
        const transactions = [];
        const dates = [];
        // Dynamic lookback: if days is high, we check many files. 
        // For Banky, 365 is reasonable to see a year of history.
        for (let i = 0; i < days; i++) {
            const d = new Date();
            d.setUTCDate(d.getUTCDate() - i);
            dates.push(d.toISOString().split('T')[0]);
        }
        const availableDates = new Set();
        const groups = await this.db.getGroups();
        const group = groupId ? groups.find(g => g.id === groupId) : null;
        if (groupId && group) {
            // 1. Check my own contributions
            const myFiles = await this.db.getStorage().listFiles(`public/groups/${groupId}/`);
            myFiles.forEach(f => {
                if (f.endsWith('.db'))
                    availableDates.add(f.split('/').pop().replace('.db', ''));
            });
            // 2. Check other members' contributions
            for (const member of group.members) {
                if (member.userId === this.db.getConfig().paths.userId)
                    continue;
                const memberFiles = await this.db.getStorage().listFiles(`followed/${member.userId}/groups/${groupId}/`);
                memberFiles.forEach(f => {
                    if (f.endsWith('.db'))
                        availableDates.add(f.split('/').pop().replace('.db', ''));
                });
            }
        }
        else {
            // Private transactions
            const privateFiles = await this.db.getStorage().listFiles(this.db.getModulePath(this.MODULE_NAME, '', 'private'));
            privateFiles.forEach(f => {
                if (f.endsWith('.db'))
                    availableDates.add(f.split('/').pop().replace('.db', ''));
            });
        }
        const initSqlJs = globalThis.initSqlJs;
        if (!this.sqliteInstance) {
            this.sqliteInstance = await initSqlJs(globalThis.SQL_CONFIG || {});
        }
        for (const date of dates) {
            if (!availableDates.has(date))
                continue; // Skip if no file for this date
            if (groupId && group) {
                // Multi-writer Group transactions
                const myDb = await this.getDb(date, 'group', groupId, group.sharedKey);
                transactions.push(...this.queryTransactions(myDb, accountId));
                myDb.close();
                // Others contributions
                for (const member of group.members) {
                    if (member.userId === this.db.getConfig().paths.userId)
                        continue;
                    if (member.status !== 'joined')
                        continue;
                    const path = `followed/${member.userId}/groups/${groupId}/${date}.db`;
                    let data = await this.db.getStorage().getFile(path);
                    if (data) {
                        try {
                            // Shared DBs are encrypted with group sharedKey
                            try {
                                data = await this.db.decrypt(data, group.sharedKey);
                            }
                            catch (de) {
                                console.error(`[Banky] Decryption failed for ${path}: ${de.message}`);
                                continue;
                            }
                            const db = new this.sqliteInstance.Database(data);
                            transactions.push(...this.queryTransactions(db, groupId)); // Note: using groupId as accountId for shared DBs
                            db.close();
                        }
                        catch (e) {
                            console.error(`[Banky] DB init failed for member data ${path}: ${e.message}`);
                        }
                    }
                }
            }
            else {
                // Private transactions
                const db = await this.getDb(date, 'private');
                transactions.push(...this.queryTransactions(db, accountId));
                db.close();
            }
        }
        return transactions.sort((a, b) => b.timestamp - a.timestamp);
    }
    queryTransactions(db, accountId) {
        try {
            const res = db.exec('SELECT * FROM transactions WHERE accountId = ? ORDER BY timestamp DESC', [accountId]);
            if (res.length === 0)
                return [];
            const cols = res[0].columns;
            return res[0].values.map((row) => {
                const tx = {};
                cols.forEach((c, i) => tx[c] = row[i]);
                return tx;
            });
        }
        catch (e) {
            console.error('[Banky] queryTransactions failed:', e.message);
            return [];
        }
    }
    async linkAccountToGroup(accountId, groupId) {
        const db = await this.getDb('', 'meta');
        db.run('UPDATE accounts SET groupId = ? WHERE id = ?', [groupId, accountId]);
        await this.saveDb(db, '', 'meta');
    }
    /**
     * Copies all existing private transactions for an account into a shared group namespace.
     */
    async publishTransactionsToGroup(accountId, groupId, sharedKey) {
        // 1. Find all dates that have transactions for this user
        const prefix = this.db.getModulePath(this.MODULE_NAME, '', 'private');
        const files = await this.db.getStorage().listFiles(prefix);
        const dates = files.map(f => f.split('/').pop().replace('.db', ''));
        for (const date of dates) {
            const privateDb = await this.getDb(date, 'private');
            const txs = this.queryTransactions(privateDb, accountId);
            privateDb.close();
            if (txs.length > 0) {
                // Open (or create) the group DB for this date
                const groupDb = await this.getDb(date, 'group', groupId, sharedKey);
                src_1.Logger.info(`[Banky] Publishing ${txs.length} transactions from account ${accountId} to group ${groupId}`);
                for (const tx of txs) {
                    // Important: Use groupId as the accountId in the shared DB
                    groupDb.run(`INSERT OR REPLACE INTO transactions (id, date, description, amount, category, timestamp, accountId, userId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [tx.id, tx.date, tx.description, tx.amount, tx.category, tx.timestamp, groupId, tx.userId]);
                }
                // Encrypt and Save to public/groups/ prefix
                await this.saveDb(groupDb, date, 'group', groupId, sharedKey);
            }
        }
    }
    async createGoal(accountId, name, targetAmount) {
        const db = await this.getDb('', 'meta');
        const goal = {
            id: Math.random().toString(36).substring(7),
            name,
            targetAmount,
            currentAmount: 0,
            accountId
        };
        db.run(`INSERT INTO goals (id, name, targetAmount, currentAmount, accountId) VALUES (?, ?, ?, ?, ?)`, [goal.id, goal.name, goal.targetAmount, goal.currentAmount, goal.accountId]);
        await this.saveDb(db, '', 'meta');
        return goal;
    }
    async getGoals(accountId) {
        const db = await this.getDb('', 'meta');
        const res = db.exec('SELECT * FROM goals WHERE accountId = ?', [accountId]);
        const goals = [];
        if (res.length > 0) {
            const cols = res[0].columns;
            res[0].values.forEach((row) => {
                const goal = {};
                cols.forEach((c, i) => goal[c] = row[i]);
                goals.push(goal);
            });
        }
        db.close();
        return goals;
    }
    async updateGoalAmount(goalId, amount) {
        const db = await this.getDb('', 'meta');
        db.run('UPDATE goals SET currentAmount = currentAmount + ? WHERE id = ?', [amount, goalId]);
        await this.saveDb(db, '', 'meta');
    }
    async deleteGoal(goalId) {
        const db = await this.getDb('', 'meta');
        db.run('DELETE FROM goals WHERE id = ?', [goalId]);
        await this.saveDb(db, '', 'meta');
    }
    async updateAccountAllowance(accountId, active, amount, interval, nextRun) {
        const db = await this.getDb('', 'meta');
        db.run(`UPDATE accounts SET allowanceActive = ?, allowanceAmount = ?, allowanceInterval = ?, allowanceNextRun = ? WHERE id = ?`, [active ? 1 : 0, amount, interval, nextRun, accountId]);
        await this.saveDb(db, '', 'meta');
    }
    async checkAllowances() {
        const accounts = await this.getAccounts();
        const now = Date.now();
        const WEEK = 7 * 24 * 60 * 60 * 1000;
        const MONTH = 30 * 24 * 60 * 60 * 1000;
        for (const account of accounts) {
            if (account.allowanceActive && account.allowanceAmount > 0) {
                let nextRun = account.allowanceNextRun || now;
                if (now >= nextRun) {
                    const intervalStr = account.allowanceInterval;
                    const interval = intervalStr === 'monthly' ? MONTH : WEEK;
                    await this.addTransaction(account.id, 'Allowance', account.allowanceAmount, 'allowance');
                    const newNextRun = now + interval;
                    await this.updateAccountAllowance(account.id, true, account.allowanceAmount, intervalStr, newNextRun);
                }
            }
        }
    }
    async deleteTransaction(accountId, transactionId, dateStr, groupId, sharedKey) {
        // Delete in the specific dated database
        const type = groupId ? 'group' : 'private';
        const db = await this.getDb(dateStr, type, groupId, sharedKey);
        db.run('DELETE FROM transactions WHERE id = ?', [transactionId]);
        await this.saveDb(db, dateStr, type, groupId, sharedKey);
    }
    async importFromBanky(bankyExport) {
        const today = new Date().toISOString().split('T')[0];
        for (const id in bankyExport.accounts) {
            const bAcc = bankyExport.accounts[id];
            const acc = await this.createAccount(bAcc.name, 'USD', bAcc.image);
            const byDate = {};
            bAcc.transactions.forEach((tx) => {
                const d = tx.date || today;
                if (!byDate[d])
                    byDate[d] = [];
                byDate[d].push(tx);
            });
            for (const date in byDate) {
                const db = await this.getDb(date, 'private');
                for (const bTx of byDate[date]) {
                    db.run(`INSERT INTO transactions (id, date, description, amount, category, timestamp, accountId, userId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [bTx.id || Math.random().toString(36).substring(7), date, bTx.description, bTx.amount, bTx.category || 'other', bTx.timestamp || Date.now(), acc.id, this.db.getConfig().paths.userId]);
                }
                await this.saveDb(db, date, 'private');
            }
        }
    }
}
exports.BankyManager = BankyManager;
//# sourceMappingURL=Banky.js.map