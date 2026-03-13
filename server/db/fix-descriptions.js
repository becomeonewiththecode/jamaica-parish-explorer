const db = require('./connection');

const rows = db.prepare("SELECT id, name, description FROM places WHERE description != '' AND description IS NOT NULL").all();
let fixed = 0;
const update = db.prepare('UPDATE places SET description = ? WHERE id = ?');

for (const r of rows) {
  const lower = r.description.toLowerCase();
  const mentionsJamaica = lower.includes('jamaica') || lower.includes('kingston, jamaica') || lower.includes('caribbean') || lower.includes('west indies');
  const mentionsOther = lower.includes('united states') || lower.includes('georgia') || lower.includes('england') || lower.includes('australia') || lower.includes('canada') || lower.includes('india') || lower.includes('refer to:') || lower.includes('may refer to') || lower.includes('savannah');

  if (!mentionsJamaica && mentionsOther) {
    update.run('', r.id);
    console.log('Cleared bad description: ' + r.name);
    fixed++;
  }
}

console.log('\nFixed ' + fixed + ' bad descriptions');
db.close();
