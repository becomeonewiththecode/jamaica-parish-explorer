const { query, closePool } = require('./pg-query');

async function main() {
  const { rows } = await query(
    "SELECT id, name, description FROM places WHERE description != '' AND description IS NOT NULL"
  );
  let fixed = 0;

  for (const r of rows) {
    const lower = r.description.toLowerCase();
    const mentionsJamaica =
      lower.includes('jamaica') ||
      lower.includes('kingston, jamaica') ||
      lower.includes('caribbean') ||
      lower.includes('west indies');
    const mentionsOther =
      lower.includes('united states') ||
      lower.includes('georgia') ||
      lower.includes('england') ||
      lower.includes('australia') ||
      lower.includes('canada') ||
      lower.includes('india') ||
      lower.includes('refer to:') ||
      lower.includes('may refer to') ||
      lower.includes('savannah');

    if (!mentionsJamaica && mentionsOther) {
      await query('UPDATE places SET description = $1 WHERE id = $2', ['', r.id]);
      console.log('Cleared bad description: ' + r.name);
      fixed++;
    }
  }

  console.log('\nFixed ' + fixed + ' bad descriptions');
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
