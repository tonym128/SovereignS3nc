import { SovereignS3nc, ModuleDefinition } from '../../../src';
export interface BankAccount {
    id: string;
    name: string;
    image?: string;
    currency: string;
    createdAt: number;
    ownerId: string;
    groupId?: string;
    allowance?: {
        active: boolean;
        amount: number;
        interval: 'weekly' | 'monthly';
        nextRun: number;
    };
}
export interface Transaction {
    id: string;
    date: string;
    description: string;
    amount: number;
    category: string;
    timestamp: number;
    accountId: string;
    userId: string;
}
export interface Goal {
    id: string;
    name: string;
    targetAmount: number;
    currentAmount: number;
    accountId: string;
}
export declare const BANKY_MODULE_DEFINITION: ModuleDefinition;
export declare class BankyManager {
    private db;
    private sqliteInstance;
    private readonly MODULE_NAME;
    constructor(db: SovereignS3nc);
    private getDb;
    private saveDb;
    createAccount(name: string, currency?: string, image?: string): Promise<BankAccount>;
    addTransaction(accountId: string, description: string, amount: number, category: string, dateStr?: string, groupId?: string, sharedKey?: string): Promise<void>;
    renameAccount(accountId: string, newName: string): Promise<void>;
    updateAccountImage(accountId: string, image: string | null): Promise<void>;
    deleteAccount(accountId: string): Promise<void>;
    getAccounts(): Promise<BankAccount[]>;
    getTransactions(accountId: string, days?: number, groupId?: string): Promise<Transaction[]>;
    private queryTransactions;
    linkAccountToGroup(accountId: string, groupId: string): Promise<void>;
    /**
     * Copies all existing private transactions for an account into a shared group namespace.
     */
    publishTransactionsToGroup(accountId: string, groupId: string, sharedKey: string): Promise<void>;
    createGoal(accountId: string, name: string, targetAmount: number): Promise<Goal>;
    getGoals(accountId: string): Promise<Goal[]>;
    updateGoalAmount(goalId: string, amount: number): Promise<void>;
    deleteGoal(goalId: string): Promise<void>;
    updateAccountAllowance(accountId: string, active: boolean, amount: number, interval: string, nextRun: number): Promise<void>;
    checkAllowances(): Promise<void>;
    deleteTransaction(accountId: string, transactionId: string, dateStr: string, groupId?: string, sharedKey?: string): Promise<void>;
    importFromBanky(bankyExport: any): Promise<void>;
}
//# sourceMappingURL=Banky.d.ts.map