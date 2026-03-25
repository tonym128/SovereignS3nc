const initSqlJs = require('sql.js');
const fs = require('fs');

async function checkDb(path) {
    const SQL = await initSqlJs();
    const data = fs.readFileSync(path);
    const db = new SQL.Database(data);
    
    console.log(`Checking ${path}:`);
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table';");
    console.log("Tables:", JSON.stringify(tables, null, 2));

    try {
        const posts = db.exec("SELECT * FROM posts;");
        console.log("Posts:", JSON.stringify(posts, null, 2));
    } catch (e) {
        console.log("Posts table failed or empty:", e.message);
    }

    try {
        const messages = db.exec("SELECT * FROM messages;");
        console.log("Messages:", JSON.stringify(messages, null, 2));
    } catch (e) {
        console.log("Messages table failed or empty:", e.message);
    }
}

const dbPath = process.argv[2];
if (dbPath) {
    checkDb(dbPath);
} else {
    console.log("Usage: node check_db.js <path>");
}
