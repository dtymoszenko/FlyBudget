// Forgot the password: removes it and signs everyone out. The next visit shows
// the "create a password" screen again, so open FlyBudget right after running this.
//   docker exec flybudget node reset-password.cjs
const Database = require('better-sqlite3');

const db = new Database(process.env.DB_PATH, { fileMustExist: true });
db.exec('DELETE FROM sessions; DELETE FROM auth_config;');
db.close();
console.log('Password removed. Open FlyBudget now and create a new one.');
