const { query, closePool } = require('./pg-query');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Wikipedia description (Jamaica-prioritized, 2-sentence max) ---
async function fetchDescription(name) {
  const base = name.replace(/\s+/g, '_');
  const variants = [base + ',_Jamaica', base + '_(Jamaica)', base];

  for (const title of variants) {
    try {
      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
      );
      if (!res.ok) continue;
      const data = await res.json();
      const desc = data.extract || null;
      if (!desc || desc.length < 20) continue;

      // Verify Jamaica relevance for generic variant
      if (title === base) {
        const lower = desc.toLowerCase();
        const isJamaica = lower.includes('jamaica') || lower.includes('kingston') ||
          lower.includes('caribbean') || lower.includes('west indies') ||
          lower.includes('montego') || lower.includes('negril') ||
          lower.includes('ocho rios') || lower.includes('parish');
        if (!isJamaica) continue;
      }

      // Truncate to 2 sentences
      const sentences = desc.match(/[^.!?]+[.!?]+/g);
      if (sentences && sentences.length > 2) {
        return sentences.slice(0, 2).join('').trim();
      }
      return desc.trim();
    } catch (e) {}
  }
  return null;
}

// --- Website lookup via DuckDuckGo ---
async function searchDDG(query) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
    });
    if (!res.ok) return [];
    const html = await res.text();
    const links = [];
    const regex = /uddg=([^&"]+)/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      try {
        const decoded = decodeURIComponent(match[1]);
        if (decoded.startsWith('http')) links.push(decoded);
      } catch (e) {}
    }
    return links;
  } catch (e) {
    return [];
  }
}

const GENERIC_DOMAINS = [
  'wikipedia.org', 'tripadvisor.com', 'booking.com', 'facebook.com',
  'yelp.com', 'google.com', 'youtube.com', 'tiktok.com', 'twitter.com',
  'instagram.com', 'linkedin.com', 'duckduckgo.com', 'expedia.com',
  'hotels.com', 'agoda.com', 'kayak.com',
];

async function findWebsite(name, category) {
  const catLabel = category.replace(/_/g, ' ');
  const links = await searchDDG(`${name} Jamaica ${catLabel} official website`);
  for (const link of links) {
    if (!GENERIC_DOMAINS.some(d => link.includes(d))) return link;
  }
  return null;
}

async function findTikTok(name) {
  const links = await searchDDG(`"${name}" Jamaica site:tiktok.com`);
  for (const link of links) {
    if (link.includes('tiktok.com') && !link.includes('/tag/')) return link;
  }
  return null;
}

async function findMenu(name) {
  const links = await searchDDG(`${name} Jamaica menu`);
  for (const link of links) {
    const lower = link.toLowerCase();
    if (lower.includes('menu') || lower.includes('zmenu') || lower.includes('grubhub') ||
        lower.includes('ubereats') || lower.includes('doordash')) {
      return link;
    }
  }
  // Fallback: direct Google search
  return `https://www.google.com/search?q=${encodeURIComponent(name + ' Jamaica menu')}`;
}

// --- Bing image search ---
async function tryBingImage(name, category) {
  const query = `${name} Jamaica ${category.replace(/_/g, ' ')}`;
  const url = 'https://www.bing.com/images/search?q=' + encodeURIComponent(query) + '&first=1';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/murl&quot;:&quot;(https?:\/\/[^&]+)/);
    return m ? m[1] : null;
  } catch (e) { return null; }
}

// --- og:image from website ---
async function tryWebsiteImage(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JamaicaParishExplorer/1.0)', 'Accept': 'text/html' },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const html = await res.text();
    const patterns = [
      /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        let imageUrl = match[1];
        if (imageUrl.startsWith('/')) {
          const parsed = new URL(url);
          imageUrl = `${parsed.protocol}//${parsed.host}${imageUrl}`;
        }
        return imageUrl;
      }
    }
  } catch (e) {}
  return null;
}

async function applyEnrichUpdates(placeId, updates) {
  await query(
    `
  UPDATE places SET
    description = COALESCE($1, description),
    website = COALESCE($2, website),
    image_url = COALESCE($3, image_url),
    menu_url = COALESCE($4, menu_url),
    tiktok_url = COALESCE($5, tiktok_url)
  WHERE id = $6
`,
    [
      updates.description ?? null,
      updates.website ?? null,
      updates.image_url ?? null,
      updates.menu_url ?? null,
      updates.tiktok_url ?? null,
      placeId,
    ]
  );
}

async function enrichPlace(place) {
  const updates = {};

  // 1. Description (Wikipedia)
  if (!place.description) {
    const desc = await fetchDescription(place.name);
    if (desc) updates.description = desc;
    await sleep(200);
  }

  // 2. Website (DDG search)
  if (!place.website) {
    const site = await findWebsite(place.name, place.category);
    if (site) updates.website = site;
    await sleep(300);
  }

  // 3. Image
  if (!place.image_url) {
    // Try website og:image first
    const siteUrl = updates.website || place.website;
    if (siteUrl) {
      const img = await tryWebsiteImage(siteUrl);
      if (img) updates.image_url = img;
    }
    // Fallback to Bing
    if (!updates.image_url) {
      const img = await tryBingImage(place.name, place.category);
      if (img) updates.image_url = img;
    }
    await sleep(200);
  }

  // 4. Menu (restaurants & cafes only)
  if (!place.menu_url && (place.category === 'restaurant' || place.category === 'cafe')) {
    const menu = await findMenu(place.name);
    if (menu) updates.menu_url = menu;
    await sleep(300);
  }

  // 5. TikTok
  if (!place.tiktok_url) {
    const tiktok = await findTikTok(place.name);
    if (tiktok) updates.tiktok_url = tiktok;
    await sleep(300);
  }

  return updates;
}

async function main() {
  const mode = process.argv[2]; // 'all' or default (only missing)

  const pr = await query(`
    SELECT id, name, category, lat, lon, description, website, image_url, menu_url, tiktok_url
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
  const needsWork = mode === 'all' ? places : places.filter(p =>
    !p.description || !p.website || !p.tiktok_url ||
    (!p.menu_url && (p.category === 'restaurant' || p.category === 'cafe'))
  );

  console.log(`Enriching ${needsWork.length} of ${places.length} total places...\n`);

  let stats = { description: 0, website: 0, image_url: 0, menu_url: 0, tiktok_url: 0, errors: 0 };

  for (let i = 0; i < needsWork.length; i++) {
    const place = needsWork[i];
    try {
      const updates = await enrichPlace(place);

      if (Object.keys(updates).length > 0) {
        await applyEnrichUpdates(place.id, {
          description: updates.description || null,
          website: updates.website || null,
          image_url: updates.image_url || null,
          menu_url: updates.menu_url || null,
          tiktok_url: updates.tiktok_url || null,
        });
        for (const key of Object.keys(updates)) {
          if (stats[key] !== undefined) stats[key]++;
        }
      }
    } catch (e) {
      stats.errors++;
    }

    if ((i + 1) % 25 === 0 || i === needsWork.length - 1) {
      const pct = Math.round(((i + 1) / needsWork.length) * 100);
      console.log(`  [${pct}%] ${i + 1}/${needsWork.length} | +${stats.description} desc, +${stats.website} sites, +${stats.image_url} imgs, +${stats.menu_url} menus, +${stats.tiktok_url} tiktok (${stats.errors} errors)`);
    }
  }

  // Final summary
  const tc = await query('SELECT COUNT(*)::bigint AS c FROM places');
  const total = Number(tc.rows[0].c);
  const sumr = await query(`
    SELECT
      SUM(CASE WHEN description IS NOT NULL AND description != '' THEN 1 ELSE 0 END)::bigint AS descs,
      SUM(CASE WHEN website IS NOT NULL AND website != '' THEN 1 ELSE 0 END)::bigint AS sites,
      SUM(CASE WHEN image_url IS NOT NULL AND image_url != '' THEN 1 ELSE 0 END)::bigint AS imgs,
      SUM(CASE WHEN menu_url IS NOT NULL AND menu_url != '' THEN 1 ELSE 0 END)::bigint AS menus,
      SUM(CASE WHEN tiktok_url IS NOT NULL AND tiktok_url != '' THEN 1 ELSE 0 END)::bigint AS tiktoks
    FROM places
  `);
  const summary = sumr.rows[0];

  console.log(`\nDone! Added: +${stats.description} descriptions, +${stats.website} websites, +${stats.image_url} images, +${stats.menu_url} menus, +${stats.tiktok_url} TikTok links`);
  console.log(`\nDatabase totals (${total} places):`);
  console.log(`  Descriptions: ${summary.descs}`);
  console.log(`  Websites: ${summary.sites}`);
  console.log(`  Images: ${summary.imgs}`);
  console.log(`  Menus: ${summary.menus}`);
  console.log(`  TikTok: ${summary.tiktoks}`);

  await closePool();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
