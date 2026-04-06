const { query, closePool } = require('./pg-query');

const INSERT_PLACE = `
  INSERT INTO places (parish_id, osm_id, name, category, lat, lon, address, phone, website, opening_hours, cuisine, stars, description, image_url)
  VALUES ($1, $2, $3, 'car_rental', $4, $5, $6, $7, $8, $9, NULL, NULL, $10, $11)
  ON CONFLICT (osm_id) DO NOTHING
`;

const carRentals = [
  { name: 'Island Car Rentals - Kingston', lat: 17.9357, lon: -76.7872, parish: 'kingston', address: 'Norman Manley International Airport', phone: '+1 876-924-8075', website: 'https://www.islandcarrentals.com', hours: 'Mo-Su 07:00-22:00' },
  { name: 'Avis Rent A Car - Kingston Airport', lat: 17.936, lon: -76.7868, parish: 'kingston', address: 'Norman Manley International Airport', phone: '+1 876-924-8293', website: 'https://www.avis.com.jm', hours: 'Mo-Su 07:00-23:00' },
  { name: 'Budget Rent A Car - Kingston', lat: 17.9355, lon: -76.7878, parish: 'kingston', address: 'Norman Manley International Airport', phone: '+1 876-759-1793', website: 'https://www.budgetjamaica.com', hours: 'Mo-Su 07:00-22:00' },
  { name: 'Hertz - Kingston Airport', lat: 17.9352, lon: -76.7882, parish: 'kingston', address: 'Norman Manley International Airport', phone: '+1 876-924-8028', website: 'https://www.hertz.com', hours: 'Mo-Su 07:00-23:00' },
  { name: 'Caribbean Car Rentals - Kingston', lat: 17.968, lon: -76.7835, parish: 'kingston', address: '33 Trafalgar Road, Kingston 10', phone: '+1 876-906-0583', website: 'https://www.caribbeancarrentals.net', hours: 'Mo-Sa 08:00-17:00' },
  { name: 'Fiesta Car Rentals - Kingston', lat: 17.9691, lon: -76.7818, parish: 'kingston', address: '12 Waterloo Road, Kingston 10', phone: '+1 876-926-0133', website: 'https://www.fiestacarrentals.com', hours: 'Mo-Sa 08:00-18:00' },
  { name: 'Island Car Rentals - Montego Bay', lat: 18.5035, lon: -77.914, parish: 'st-james', address: 'Sangster International Airport', phone: '+1 876-952-5771', website: 'https://www.islandcarrentals.com', hours: 'Mo-Su 07:00-22:00' },
  { name: 'Avis Rent A Car - Montego Bay', lat: 18.5038, lon: -77.9135, parish: 'st-james', address: 'Sangster International Airport', phone: '+1 876-952-0762', website: 'https://www.avis.com.jm', hours: 'Mo-Su 07:00-23:00' },
  { name: 'Budget Rent A Car - Montego Bay', lat: 18.5032, lon: -77.9145, parish: 'st-james', address: 'Sangster International Airport', phone: '+1 876-952-3838', website: 'https://www.budgetjamaica.com', hours: 'Mo-Su 07:00-22:00' },
  { name: 'Hertz - Montego Bay Airport', lat: 18.503, lon: -77.9148, parish: 'st-james', address: 'Sangster International Airport', phone: '+1 876-979-0438', website: 'https://www.hertz.com', hours: 'Mo-Su 07:00-23:00' },
  { name: 'Sixt Rent A Car - Montego Bay', lat: 18.5028, lon: -77.915, parish: 'st-james', address: 'Sangster International Airport', phone: '+1 876-684-9802', website: 'https://www.sixt.com', hours: 'Mo-Su 08:00-22:00' },
  { name: 'Jamaica Car Rental - Hip Strip', lat: 18.475, lon: -77.9225, parish: 'st-james', address: 'Gloucester Avenue, Montego Bay', phone: '+1 876-952-5586', website: null, hours: 'Mo-Sa 08:00-18:00' },
  { name: 'Island Car Rentals - Ocho Rios', lat: 18.4076, lon: -77.1025, parish: 'st-ann', address: 'Main Street, Ocho Rios', phone: '+1 876-974-2506', website: 'https://www.islandcarrentals.com', hours: 'Mo-Sa 08:00-17:00' },
  { name: 'Bargain Rent A Car - Ocho Rios', lat: 18.4082, lon: -77.0988, parish: 'st-ann', address: 'DaCosta Drive, Ocho Rios', phone: '+1 876-974-8245', website: null, hours: 'Mo-Sa 08:00-17:00' },
  { name: "Juta Car Rentals - Negril", lat: 18.2678, lon: -78.3478, parish: 'westmoreland', address: 'Norman Manley Blvd, Negril', phone: '+1 876-957-9197', website: null, hours: 'Mo-Sa 08:00-18:00' },
  { name: "Vernon's Car Rentals - Negril", lat: 18.2585, lon: -78.3512, parish: 'westmoreland', address: 'West End Road, Negril', phone: '+1 876-957-0074', website: 'https://www.vernonscarrentals.com', hours: 'Mo-Sa 08:00-17:00' },
  { name: 'Eastern Car Rentals - Port Antonio', lat: 18.179, lon: -76.451, parish: 'portland', address: '16 West Street, Port Antonio', phone: '+1 876-993-3624', website: null, hours: 'Mo-Sa 08:00-17:00' },
  { name: 'Prospere Car Rentals - Mandeville', lat: 18.041, lon: -77.5035, parish: 'manchester', address: 'Ward Avenue, Mandeville', phone: '+1 876-962-2245', website: null, hours: 'Mo-Sa 08:00-17:00' },
  { name: 'CaribStar Car Rentals', lat: 18.0125, lon: -76.9555, parish: 'st-catherine', address: 'Spanish Town, St. Catherine', phone: '+1 876-984-2277', website: null, hours: 'Mo-Sa 08:00-17:00' },
  { name: 'Island Car Rentals - Boscobel', lat: 18.405, lon: -76.969, parish: 'st-mary', address: 'Ian Fleming International Airport', phone: '+1 876-975-5100', website: 'https://www.islandcarrentals.com', hours: 'Mo-Su 08:00-18:00' },
];

async function tryBingImage(name) {
  const q = `${name} Jamaica`;
  const url = 'https://www.bing.com/images/search?q=' + encodeURIComponent(q) + '&first=1';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/murl&quot;:&quot;(https?:\/\/[^&]+)/);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

async function main() {
  console.log('Seeding car rental places...\n');

  let inserted = 0;
  for (const cr of carRentals) {
    const pr = await query('SELECT id FROM parishes WHERE slug = $1', [cr.parish]);
    const parish = pr.rows[0];
    if (!parish) {
      console.log(`  Skipped ${cr.name}: parish ${cr.parish} not found`);
      continue;
    }

    const osmId = `car_rental_${cr.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

    console.log(`  ${cr.name}: fetching image...`);
    const image = await tryBingImage(cr.name);

    const r = await query(INSERT_PLACE, [
      parish.id,
      osmId,
      cr.name,
      cr.lat,
      cr.lon,
      cr.address,
      cr.phone,
      cr.website,
      cr.hours,
      '',
      image || '',
    ]);
    if (r.rowCount > 0) {
      inserted++;
      console.log(`  + ${cr.name} — ${image ? 'image found' : 'no image'}`);
    } else {
      console.log(`  ~ ${cr.name} — already exists`);
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  const count = await query("SELECT COUNT(*)::bigint AS c FROM places WHERE category = 'car_rental'");
  console.log(`\nDone! Inserted ${inserted}. Total car rentals in DB: ${count.rows[0].c}`);
  await closePool();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
