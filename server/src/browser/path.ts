// In-browser demo stand-in for Node's `path`: only restore's safety copy of the database file
// uses it (backupService.ts), which the demo skips. Anything else reaching it is a bug.
const notInDemo = (): never => {
  throw new Error("Node's path module isn't available in the in-browser demo");
};

export const join = notInDemo;
export const dirname = notInDemo;
export const basename = notInDemo;
export default { join, dirname, basename };
