const { query, closePool } = require('./pg-query');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Utility: check if a URL returns 200 ---
async function urlExists(url, timeout = 6000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    });
    clearTimeout(timer);
    return res.ok;
  } catch (e) {
    return false;
  }
}

// --- Utility: fetch a page and return body text ---
async function fetchPage(url, timeout = 8000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    return null;
  }
}

// --- Wikipedia description (Jamaica-prioritized) ---
async function fetchDescription(name) {
  const base = name.replace(/\s+/g, '_');
  const variants = [base + ',_Jamaica', base + '_(Jamaica)', base];

  for (const title of variants) {
    try {
      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        { headers: { 'User-Agent': 'JamaicaParishExplorer/1.0' } }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const desc = data.extract || null;
      if (!desc || desc.length < 20) continue;

      if (title === base) {
        const lower = desc.toLowerCase();
        const isJamaica = lower.includes('jamaica') || lower.includes('kingston') ||
          lower.includes('caribbean') || lower.includes('west indies') ||
          lower.includes('montego') || lower.includes('negril') ||
          lower.includes('ocho rios') || lower.includes('parish');
        if (!isJamaica) continue;
      }

      const sentences = desc.match(/[^.!?]+[.!?]+/g);
      if (sentences && sentences.length > 2) {
        return sentences.slice(0, 2).join('').trim();
      }
      return desc.trim();
    } catch (e) {}
  }
  return null;
}

// --- TripAdvisor search via their search URL ---
async function findTripAdvisor(name, category) {
  const catHint = (category === 'restaurant' || category === 'cafe') ? 'Restaurant' :
    (category === 'hotel' || category === 'resort' || category === 'guest_house') ? 'Hotel' : 'Attraction';
  const searchUrl = `https://www.tripadvisor.com/Search?q=${encodeURIComponent(name + ' Jamaica')}&searchSessionId=&searchNearby=false&geo=148762`;

  const html = await fetchPage(searchUrl);
  if (!html) return null;

  // Look for result links matching the place name
  const patterns = [
    /href="(\/(?:Hotel_Review|Restaurant_Review|Attraction_Review)-[^"]+)"/g,
    /href="(https:\/\/www\.tripadvisor\.com\/(?:Hotel_Review|Restaurant_Review|Attraction_Review)-[^"]+)"/g,
  ];

  const nameLower = name.toLowerCase();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const url = match[1].startsWith('/') ? 'https://www.tripadvisor.com' + match[1] : match[1];
      // Check if URL slug contains parts of the name
      const slug = url.toLowerCase().replace(/-/g, ' ').replace(/_/g, ' ');
      const nameWords = nameLower.split(/\s+/).filter(w => w.length > 3);
      const matchCount = nameWords.filter(w => slug.includes(w)).length;
      if (matchCount >= Math.ceil(nameWords.length * 0.5) || nameWords.length <= 1) {
        return url.split('#')[0].split('?')[0];
      }
    }
  }
  return null;
}

// --- Booking.com search ---
async function findBooking(name) {
  const searchUrl = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(name + ' Jamaica')}&dest_type=city&nflt=`;
  const html = await fetchPage(searchUrl);
  if (!html) return null;

  // Look for hotel page links
  const regex = /href="(https:\/\/www\.booking\.com\/hotel\/jm\/[^"?]+)/g;
  const nameLower = name.toLowerCase();
  let match;
  while ((match = regex.exec(html)) !== null) {
    const url = match[1];
    const slug = url.split('/').pop().replace(/-/g, ' ').replace(/\.html$/, '').toLowerCase();
    const nameWords = nameLower.split(/\s+/).filter(w => w.length > 3);
    const matchCount = nameWords.filter(w => slug.includes(w)).length;
    if (matchCount >= 1) return url;
  }

  // Fallback: return search URL
  return null;
}

// --- Instagram search (construct profile URL and verify) ---
async function findInstagram(name) {
  // Try common patterns for business Instagram handles
  const slug = name.toLowerCase()
    .replace(/['']/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 30);

  const slugUnderscore = name.toLowerCase()
    .replace(/['']/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30);

  const variants = [
    slug,
    slugUnderscore,
    slug + 'ja',
    slug + 'jamaica',
    slugUnderscore + '_ja',
    slugUnderscore + '_jamaica',
  ];

  for (const handle of variants) {
    if (handle.length < 3) continue;
    const url = `https://www.instagram.com/${handle}/`;
    if (await urlExists(url)) return url;
    await sleep(200);
  }
  return null;
}

// --- TikTok search (construct profile URL and verify) ---
async function findTikTok(name) {
  const slug = name.toLowerCase()
    .replace(/['']/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24);

  const slugUnderscore = name.toLowerCase()
    .replace(/['']/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 24);

  const slugDot = name.toLowerCase()
    .replace(/['']/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\.|\.$/g, '')
    .slice(0, 24);

  const variants = [slug, slugUnderscore, slugDot, slug + 'ja', slugUnderscore + '_ja'];

  for (const handle of variants) {
    if (handle.length < 3) continue;
    const url = `https://www.tiktok.com/@${handle}`;
    if (await urlExists(url)) return url;
    await sleep(200);
  }
  return null;
}

// --- Website from place's own data or Google search fallback ---
async function findWebsite(name, category) {
  // Try constructing common website patterns
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 30);
  const slugDash = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const domains = ['.com', '.com.jm', '.co', '.org'];

  for (const domain of domains) {
    const url = `https://www.${slugDash}${domain}`;
    if (await urlExists(url, 4000)) return url;
    await sleep(100);
  }

  // Try without www
  for (const domain of ['.com', '.com.jm']) {
    const url = `https://${slugDash}${domain}`;
    if (await urlExists(url, 4000)) return url;
    await sleep(100);
  }

  return null;
}

async function applyLinkUpdates(placeId, updates) {
  await query(
    `
  UPDATE places SET
    description = COALESCE($1, description),
    website = COALESCE($2, website),
    tiktok_url = COALESCE($3, tiktok_url),
    instagram_url = COALESCE($4, instagram_url),
    booking_url = COALESCE($5, booking_url),
    tripadvisor_url = COALESCE($6, tripadvisor_url)
  WHERE id = $7
`,
    [
      updates.description ?? null,
      updates.website ?? null,
      updates.tiktok_url ?? null,
      updates.instagram_url ?? null,
      updates.booking_url ?? null,
      updates.tripadvisor_url ?? null,
      placeId,
    ]
  );
}

async function enrichPlace(place) {
  const updates = {};

  // Description
  if (!place.description) {
    const desc = await fetchDescription(place.name);
    if (desc) updates.description = desc;
    await sleep(150);
  }

  // Website
  if (!place.website) {
    const site = await findWebsite(place.name, place.category);
    if (site) updates.website = site;
  }

  // TripAdvisor (hotels, resorts, guest houses, restaurants, attractions)
  const tripCats = ['hotel', 'resort', 'guest_house', 'restaurant', 'cafe', 'tourist_attraction', 'landmark', 'beach', 'nightlife'];
  if (!place.tripadvisor_url && tripCats.includes(place.category)) {
    const url = await findTripAdvisor(place.name, place.category);
    if (url) updates.tripadvisor_url = url;
    await sleep(500);
  }

  // Booking.com (accommodation only)
  const bookingCats = ['hotel', 'resort', 'guest_house'];
  if (!place.booking_url && bookingCats.includes(place.category)) {
    const url = await findBooking(place.name);
    if (url) updates.booking_url = url;
    await sleep(500);
  }

  // Instagram
  if (!place.instagram_url) {
    const url = await findInstagram(place.name);
    if (url) updates.instagram_url = url;
  }

  // TikTok
  if (!place.tiktok_url) {
    const url = await findTikTok(place.name);
    if (url) updates.tiktok_url = url;
  }

  return updates;
}

async function main() {
  // Priority order
  const pr = await query(`
    SELECT id, name, category, lat, lon, description, website, tiktok_url, instagram_url, booking_url, tripadvisor_url
    FROM places
    ORDER BY
      CASE category
        WHEN 'hotel' THEN 1 WHEN 'resort' THEN 2 WHEN 'guest_house' THEN 3
        WHEN 'beach' THEN 4 WHEN 'restaurant' THEN 5 WHEN 'cafe' THEN 6
        WHEN 'car_rental' THEN 7 WHEN 'nightlife' THEN 8
        WHEN 'tourist_attraction' THEN 9 WHEN 'landmark' THEN 10
        ELSE 20
      END,
      name
  `);
  const places = pr.rows;

  // Filter to those needing work
  const needsWork = places.filter(p =>
    !p.description || !p.website || !p.tiktok_url || !p.instagram_url ||
    !p.tripadvisor_url ||
    (!p.booking_url && ['hotel', 'resort', 'guest_house'].includes(p.category))
  );

  console.log(`Enriching ${needsWork.length} of ${places.length} total places...\n`);

  const stats = { description: 0, website: 0, tiktok_url: 0, instagram_url: 0, booking_url: 0, tripadvisor_url: 0, errors: 0 };

  for (let i = 0; i < needsWork.length; i++) {
    const place = needsWork[i];
    try {
      const updates = await enrichPlace(place);

      if (Object.keys(updates).length > 0) {
        await applyLinkUpdates(place.id, {
          description: updates.description || null,
          website: updates.website || null,
          tiktok_url: updates.tiktok_url || null,
          instagram_url: updates.instagram_url || null,
          booking_url: updates.booking_url || null,
          tripadvisor_url: updates.tripadvisor_url || null,
        });
        for (const key of Object.keys(updates)) {
          if (stats[key] !== undefined) stats[key]++;
        }
      }
    } catch (e) {
      stats.errors++;
    }

    if ((i + 1) % 10 === 0 || i === needsWork.length - 1) {
      const pct = Math.round(((i + 1) / needsWork.length) * 100);
      console.log(`  [${pct}%] ${i + 1}/${needsWork.length} | desc:${stats.description} web:${stats.website} trip:${stats.tripadvisor_url} book:${stats.booking_url} ig:${stats.instagram_url} tt:${stats.tiktok_url} err:${stats.errors}`);
    }
  }

  // Final summary
  const sumr = await query(`
    SELECT
      COUNT(*)::bigint AS total,
      SUM(CASE WHEN description IS NOT NULL AND description != '' THEN 1 ELSE 0 END)::bigint AS descs,
      SUM(CASE WHEN website IS NOT NULL AND website != '' THEN 1 ELSE 0 END)::bigint AS sites,
      SUM(CASE WHEN tiktok_url IS NOT NULL AND tiktok_url != '' THEN 1 ELSE 0 END)::bigint AS tiktoks,
      SUM(CASE WHEN instagram_url IS NOT NULL AND instagram_url != '' THEN 1 ELSE 0 END)::bigint AS instagrams,
      SUM(CASE WHEN booking_url IS NOT NULL AND booking_url != '' THEN 1 ELSE 0 END)::bigint AS bookings,
      SUM(CASE WHEN tripadvisor_url IS NOT NULL AND tripadvisor_url != '' THEN 1 ELSE 0 END)::bigint AS tripadvisors
    FROM places
  `);
  const summary = sumr.rows[0];

  console.log(`\nDone! Added: desc:${stats.description} web:${stats.website} trip:${stats.tripadvisor_url} book:${stats.booking_url} ig:${stats.instagram_url} tt:${stats.tiktok_url}`);
  console.log(`\nDatabase totals (${summary.total} places):`);
  console.log(`  Descriptions: ${summary.descs}`);
  console.log(`  Websites: ${summary.sites}`);
  console.log(`  TripAdvisor: ${summary.tripadvisors}`);
  console.log(`  Booking.com: ${summary.bookings}`);
  console.log(`  Instagram: ${summary.instagrams}`);
  console.log(`  TikTok: ${summary.tiktoks}`);

  await closePool();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
