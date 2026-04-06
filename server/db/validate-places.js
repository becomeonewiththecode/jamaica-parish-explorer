/**
 * validate-places.js
 *
 * Phase 1: Standardize phone numbers to +1-876-XXX-XXXX
 * Phase 2: Run web enrichment for missing fields (website, tiktok, menu)
 * Phase 3: Mark remaining empty required fields as "N/F"
 * Phase 4: Generate validation report
 *
 * Usage:
 *   node server/db/validate-places.js              # Full run (enrich + mark + report)
 *   node server/db/validate-places.js --skip-enrich # Skip web enrichment, just mark + report
 *   node server/db/validate-places.js --report-only # Only generate report from current data
 */

const { query, closePool } = require('./pg-query');
const path = require('path');
const fs = require('fs');

const SKIP_ENRICH = process.argv.includes('--skip-enrich');
const REPORT_ONLY = process.argv.includes('--report-only');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ============================================================
// PHASE 1: Standardize phone numbers
// ============================================================

function standardizePhone(raw) {
  if (!raw || raw === 'N/F') return raw;

  // Strip all non-digit characters
  let digits = raw.replace(/[^\d]/g, '');

  // Handle Jamaica numbers: country code 1, area code 876
  // Valid Jamaica formats after stripping:
  //   7 digits (local)        -> prepend 1876
  //   10 digits (1876XXXXXXX without leading 1) -> if starts with 876, prepend 1
  //   11 digits (1876XXXXXXX) -> valid as-is if starts with 1876
  //   Multiple numbers concatenated -> take first valid one

  // If it looks like multiple numbers concatenated (>11 digits), try first 10-11
  if (digits.length > 11) {
    // Try to extract a valid Jamaica number
    const match = digits.match(/(1?876\d{7})/);
    if (match) {
      digits = match[1];
    } else {
      // Take first 11 or 10 digits
      digits = digits.slice(0, 11);
    }
  }

  // Normalize to 11-digit format (1-876-XXX-XXXX)
  if (digits.length === 7) {
    // Local number, assume 876 area code
    digits = '1876' + digits;
  } else if (digits.length === 10 && digits.startsWith('876')) {
    digits = '1' + digits;
  } else if (digits.length === 10 && !digits.startsWith('876')) {
    // Non-Jamaica number (US/Canada) — still format with +1
    const area = digits.slice(0, 3);
    const mid = digits.slice(3, 6);
    const last = digits.slice(6);
    return `+1-${area}-${mid}-${last}`;
  } else if (digits.length === 11 && digits.startsWith('1876')) {
    // Already correct
  } else if (digits.length === 11 && digits.startsWith('1') && !digits.startsWith('1876')) {
    // US/Canada number
    const area = digits.slice(1, 4);
    const mid = digits.slice(4, 7);
    const last = digits.slice(7);
    return `+1-${area}-${mid}-${last}`;
  } else {
    // Can't parse — return original
    return raw;
  }

  // Format as +1-876-XXX-XXXX
  if (digits.length === 11 && digits.startsWith('1876')) {
    return `+1-876-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  return raw; // fallback
}

async function phase1_standardizePhones() {
  console.log('\n=== PHASE 1: Standardizing phone numbers ===');
  const { rows } = await query(
    "SELECT id, phone FROM places WHERE phone IS NOT NULL AND phone <> '' AND phone <> 'N/F'"
  );
  console.log(`  Found ${rows.length} phone numbers to standardize`);

  let changed = 0;

  for (const row of rows) {
    const standardized = standardizePhone(row.phone);
    if (standardized !== row.phone) {
      await query('UPDATE places SET phone = $1 WHERE id = $2', [standardized, row.id]);
      changed++;
    }
  }

  console.log(`  Standardized ${changed} phone numbers`);
  return changed;
}

// ============================================================
// PHASE 2: Web enrichment (DuckDuckGo searches)
// ============================================================

const GENERIC_DOMAINS = [
  'wikipedia.org', 'tripadvisor.com', 'booking.com', 'facebook.com',
  'yelp.com', 'google.com', 'youtube.com', 'twitter.com',
  'instagram.com', 'linkedin.com', 'duckduckgo.com', 'expedia.com',
  'hotels.com', 'agoda.com', 'kayak.com',
];

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
  const links = await searchDDG(`${name} Jamaica restaurant menu`);
  for (const link of links) {
    const lower = link.toLowerCase();
    if (lower.includes('menu') || lower.includes('zmenu') || lower.includes('grubhub') ||
        lower.includes('ubereats') || lower.includes('doordash') || lower.includes('menulog')) {
      return link;
    }
  }
  return null;
}

async function findOpeningHours(name, category) {
  // Try Google Knowledge Graph style query
  const links = await searchDDG(`${name} Jamaica ${category.replace(/_/g, ' ')} opening hours`);
  // We can't reliably extract hours from search results, so just return null
  // Hours need to be verified manually or via Google Places API
  return null;
}

async function phase2_enrich() {
  console.log('\n=== PHASE 2: Web enrichment ===');

  const pr = await query(`
    SELECT id, name, category, website, tiktok_url, menu_url, opening_hours, phone, address
    FROM places
    ORDER BY
      CASE category
        WHEN 'restaurant' THEN 1 WHEN 'cafe' THEN 2 WHEN 'hotel' THEN 3
        WHEN 'resort' THEN 4 WHEN 'guest_house' THEN 5
        WHEN 'tourist_attraction' THEN 6 WHEN 'beach' THEN 7
        WHEN 'nightlife' THEN 8 WHEN 'car_rental' THEN 9
        WHEN 'shopping' THEN 10 WHEN 'landmark' THEN 11
        ELSE 20
      END,
      name
  `);
  const places = pr.rows;

  // Only enrich items that are missing key web-findable fields
  const needsWork = places.filter(p =>
    (!p.website || p.website === 'N/F') ||
    (!p.tiktok_url || p.tiktok_url === 'N/F') ||
    ((!p.menu_url || p.menu_url === 'N/F') && (p.category === 'restaurant' || p.category === 'cafe'))
  );

  console.log(`  ${needsWork.length} places need enrichment out of ${places.length} total`);

  let stats = { website: 0, tiktok: 0, menu: 0, errors: 0 };
  let ddgCalls = 0;
  const MAX_DDG_CALLS = 600; // Rate limit safety (DuckDuckGo blocks after too many)

  for (let i = 0; i < needsWork.length; i++) {
    const place = needsWork[i];

    if (ddgCalls >= MAX_DDG_CALLS) {
      console.log(`  Reached DDG rate limit safety cap (${MAX_DDG_CALLS} calls). Stopping enrichment.`);
      break;
    }

    try {
      // Website
      if (!place.website || place.website === 'N/F') {
        const site = await findWebsite(place.name, place.category);
        ddgCalls++;
        if (site) {
          await query('UPDATE places SET website = $1 WHERE id = $2', [site, place.id]);
          stats.website++;
        }
        await sleep(350);
      }

      // TikTok
      if (!place.tiktok_url || place.tiktok_url === 'N/F') {
        const tiktok = await findTikTok(place.name);
        ddgCalls++;
        if (tiktok) {
          await query('UPDATE places SET tiktok_url = $1 WHERE id = $2', [tiktok, place.id]);
          stats.tiktok++;
        }
        await sleep(350);
      }

      // Menu (restaurants & cafes only)
      if ((!place.menu_url || place.menu_url === 'N/F') && (place.category === 'restaurant' || place.category === 'cafe')) {
        const menu = await findMenu(place.name);
        ddgCalls++;
        if (menu) {
          await query('UPDATE places SET menu_url = $1 WHERE id = $2', [menu, place.id]);
          stats.menu++;
        }
        await sleep(350);
      }
    } catch (e) {
      stats.errors++;
    }

    if ((i + 1) % 50 === 0 || i === needsWork.length - 1) {
      const pct = Math.round(((i + 1) / needsWork.length) * 100);
      console.log(`  [${pct}%] ${i + 1}/${needsWork.length} | +${stats.website} sites, +${stats.tiktok} tiktok, +${stats.menu} menus (${ddgCalls} DDG calls, ${stats.errors} errors)`);
    }
  }

  console.log(`  Enrichment complete: +${stats.website} websites, +${stats.tiktok} TikTok, +${stats.menu} menus`);
  return stats;
}

// ============================================================
// PHASE 3: Mark remaining empty fields as "N/F"
// ============================================================

async function phase3_markNF() {
  console.log('\n=== PHASE 3: Marking empty fields as N/F ===');

  const fields = [
    { col: 'address', label: 'Address' },
    { col: 'phone', label: 'Phone' },
    { col: 'website', label: 'Website' },
    { col: 'opening_hours', label: 'Opening Hours' },
    { col: 'tiktok_url', label: 'TikTok' },
    { col: 'menu_url', label: 'Menu URL' },
  ];

  const results = {};

  for (const field of fields) {
    const cr = await query(
      `SELECT COUNT(*)::bigint AS c FROM places WHERE ${field.col} IS NULL OR ${field.col} = ''`
    );
    const count = Number(cr.rows[0].c);
    if (count > 0) {
      await query(
        `UPDATE places SET ${field.col} = 'N/F' WHERE ${field.col} IS NULL OR ${field.col} = ''`
      );
    }
    results[field.col] = count;
    console.log(`  ${field.label}: marked ${count} entries as N/F`);
  }

  return results;
}

// ============================================================
// PHASE 4: Generate validation report
// ============================================================

async function phase4_report() {
  console.log('\n=== PHASE 4: Generating validation report ===');

  const REQUIRED_FIELDS = [
    { col: 'tiktok_url', label: 'TikTok Link' },
    { col: 'website', label: 'Website' },
    { col: 'menu_url', label: 'Menu URL' },
    { col: 'opening_hours', label: 'Operating Hours' },
    { col: 'phone', label: 'Phone Number' },
    { col: 'address', label: 'Physical Address' },
  ];

  const tc = await query('SELECT COUNT(*)::bigint AS c FROM places');
  const total = Number(tc.rows[0].c);

  // Summary by field
  const fieldSummary = {};
  for (const field of REQUIRED_FIELDS) {
    const nfr = await query(`SELECT COUNT(*)::bigint AS c FROM places WHERE ${field.col} = 'N/F'`);
    const nf = Number(nfr.rows[0].c);
    const found = total - nf;
    fieldSummary[field.col] = {
      label: field.label,
      found,
      notFound: nf,
      pct: ((found / total) * 100).toFixed(1),
    };
  }

  // Summary by category
  const catRows = await query('SELECT DISTINCT category FROM places ORDER BY category');
  const categories = catRows.rows.map((r) => r.category);
  const categorySummary = {};

  for (const cat of categories) {
    const ctr = await query('SELECT COUNT(*)::bigint AS c FROM places WHERE category = $1', [cat]);
    const catTotal = Number(ctr.rows[0].c);
    const catFields = {};
    for (const field of REQUIRED_FIELDS) {
      const nfr2 = await query(
        `SELECT COUNT(*)::bigint AS c FROM places WHERE category = $1 AND ${field.col} = 'N/F'`,
        [cat]
      );
      const nf = Number(nfr2.rows[0].c);
      catFields[field.col] = { found: catTotal - nf, notFound: nf };
    }
    categorySummary[cat] = { total: catTotal, fields: catFields };
  }

  // Individual N/F entries grouped by category for follow-up
  const nfEntries = [];
  const plr = await query(`
    SELECT id, name, category, lat, lon, address, phone, website, opening_hours, tiktok_url, menu_url,
           (SELECT p.name FROM parishes p WHERE p.id = places.parish_id) AS parish_name
    FROM places ORDER BY category, name
  `);
  const places = plr.rows;

  for (const place of places) {
    const missing = [];
    for (const field of REQUIRED_FIELDS) {
      if (place[field.col] === 'N/F') missing.push(field.label);
    }
    if (missing.length > 0) {
      nfEntries.push({
        id: place.id,
        name: place.name,
        category: place.category,
        parish: place.parish_name,
        missingFields: missing,
        missingCount: missing.length,
        existingData: {
          address: place.address !== 'N/F' ? place.address : null,
          phone: place.phone !== 'N/F' ? place.phone : null,
          website: place.website !== 'N/F' ? place.website : null,
          opening_hours: place.opening_hours !== 'N/F' ? place.opening_hours : null,
          tiktok_url: place.tiktok_url !== 'N/F' ? place.tiktok_url : null,
          menu_url: place.menu_url !== 'N/F' ? place.menu_url : null,
        },
      });
    }
  }

  // Write JSON report
  const jsonReport = {
    generated: new Date().toISOString(),
    totalPlaces: total,
    fieldSummary,
    categorySummary,
    nfEntriesCount: nfEntries.length,
    nfEntries,
  };

  const jsonPath = path.join(__dirname, '..', '..', 'reports', 'validation-report.json');
  const mdPath = path.join(__dirname, '..', '..', 'reports', 'validation-report.md');
  const reportsDir = path.dirname(jsonPath);
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2));
  console.log(`  JSON report: ${jsonPath}`);

  // Write Markdown report
  let md = `# Places Validation Report\n\n`;
  md += `**Generated:** ${new Date().toISOString()}\n`;
  md += `**Total Places:** ${total}\n`;
  md += `**Places with at least 1 N/F field:** ${nfEntries.length}\n\n`;

  md += `## Field Completeness Summary\n\n`;
  md += `| Field | Found | Not Found (N/F) | % Complete |\n`;
  md += `|-------|------:|:---------------:|:----------:|\n`;
  for (const field of REQUIRED_FIELDS) {
    const s = fieldSummary[field.col];
    md += `| ${s.label} | ${s.found} | ${s.notFound} | ${s.pct}% |\n`;
  }

  md += `\n## Completeness by Category\n\n`;
  md += `| Category | Total | Address | Phone | Website | Hours | TikTok | Menu |\n`;
  md += `|----------|------:|--------:|------:|--------:|------:|-------:|-----:|\n`;
  for (const cat of categories) {
    const cs = categorySummary[cat];
    const f = cs.fields;
    md += `| ${cat} | ${cs.total} | ${f.address.found} | ${f.phone.found} | ${f.website.found} | ${f.opening_hours.found} | ${f.tiktok_url.found} | ${f.menu_url.found} |\n`;
  }

  // Priority follow-up: items missing the most fields, grouped by category
  md += `\n## Priority Follow-Up (by category)\n\n`;
  md += `Items below are missing one or more required fields. Sorted by number of missing fields (most gaps first).\n\n`;

  const priorityOrder = [
    'restaurant', 'cafe', 'hotel', 'resort', 'guest_house',
    'tourist_attraction', 'beach', 'nightlife', 'car_rental',
    'shopping', 'landmark', 'park', 'stadium',
    'bank', 'gas_station', 'hospital', 'school', 'place_of_worship',
  ];

  const catGroups = {};
  for (const entry of nfEntries) {
    if (!catGroups[entry.category]) catGroups[entry.category] = [];
    catGroups[entry.category].push(entry);
  }

  for (const cat of priorityOrder) {
    if (!catGroups[cat]) continue;
    const entries = catGroups[cat].sort((a, b) => b.missingCount - a.missingCount);
    md += `### ${cat} (${entries.length} items with N/F)\n\n`;
    md += `| ID | Name | Parish | Missing Fields |\n`;
    md += `|----|------|--------|----------------|\n`;
    // Show first 50 per category to keep report manageable
    const shown = entries.slice(0, 50);
    for (const e of shown) {
      md += `| ${e.id} | ${e.name} | ${e.parish} | ${e.missingFields.join(', ')} |\n`;
    }
    if (entries.length > 50) {
      md += `| ... | *${entries.length - 50} more items* | | |\n`;
    }
    md += `\n`;
  }

  // Menu-specific section (restaurants/cafes only)
  md += `## Menu URL Follow-Up (Restaurants & Cafes)\n\n`;
  const menuMissing = nfEntries.filter(e =>
    (e.category === 'restaurant' || e.category === 'cafe') &&
    e.missingFields.includes('Menu URL')
  );
  md += `**${menuMissing.length}** restaurants/cafes missing menu links.\n\n`;
  md += `| ID | Name | Parish | Has Website? |\n`;
  md += `|----|------|--------|--------------|\n`;
  for (const e of menuMissing.slice(0, 100)) {
    md += `| ${e.id} | ${e.name} | ${e.parish} | ${e.existingData.website ? 'Yes' : 'No'} |\n`;
  }
  if (menuMissing.length > 100) {
    md += `| ... | *${menuMissing.length - 100} more* | | |\n`;
  }

  fs.writeFileSync(mdPath, md);
  console.log(`  Markdown report: ${mdPath}`);

  return { jsonPath, mdPath, nfCount: nfEntries.length };
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const tc0 = await query('SELECT COUNT(*)::bigint AS c FROM places');
  console.log('====================================');
  console.log('  Places Validation & Enrichment');
  console.log('====================================');
  console.log(`  Total places: ${tc0.rows[0].c}`);
  console.log(`  Mode: ${REPORT_ONLY ? 'report-only' : SKIP_ENRICH ? 'skip-enrich' : 'full'}`);

  if (!REPORT_ONLY) {
    await phase1_standardizePhones();

    if (!SKIP_ENRICH) {
      await phase2_enrich();
    }

    await phase3_markNF();
  }

  const report = await phase4_report();

  console.log('\n====================================');
  console.log('  DONE');
  console.log(`  ${report.nfCount} items have at least one N/F field`);
  console.log(`  Reports: ${report.mdPath}`);
  console.log('====================================');

  await closePool();
}

main().catch(async (err) => {
  console.error('Fatal error:', err);
  await closePool().catch(() => {});
  process.exit(1);
});
