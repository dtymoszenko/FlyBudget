import { seedDefaultCategories } from './defaultCategories.js';

const created = seedDefaultCategories();
console.log(
  created > 0
    ? `Seeded ${created} default categories.`
    : 'Database already has categories or transactions, skipping.',
);
