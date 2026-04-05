const fs = require('fs');
const path = require('path');

function applySchema(db) {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
}

// Seed data — all 14 parishes
const parishes = [
  {
    slug: "hanover", name: "Hanover", county: "County of Cornwall",
    population: "69,533", capital: "Lucea", area: "450 km²",
    fill_color: "#2e7d32",
    svg_path: "M80,145 L110,120 L150,108 L185,105 L205,115 L210,140 L205,165 L195,185 L175,195 L145,198 L115,190 L90,175 Z",
    description: "<p>Hanover is Jamaica's smallest parish by area, nestled in the island's far northwest. Despite its size, it boasts some of Jamaica's most stunning coastline and is home to the famous Negril Beach, which it shares with Westmoreland.</p><p>The parish is largely agricultural, with sugar cane, bananas, and pimento being key crops. Dolphin Head Mountain, rising to about 550 metres, is an important ecological site with many endemic species found nowhere else on Earth.</p>",
    features: ["Lucea Harbour", "Dolphin Head Mountain", "Green Island", "Tryall Golf Club", "Fort Charlotte"]
  },
  {
    slug: "westmoreland", name: "Westmoreland", county: "County of Cornwall",
    population: "145,025", capital: "Savanna-la-Mar", area: "807 km²",
    fill_color: "#388e3c",
    svg_path: "M80,145 L90,175 L115,190 L145,198 L175,195 L195,185 L205,165 L210,185 L200,220 L175,255 L140,275 L100,280 L65,265 L45,240 L40,210 L50,175 Z",
    description: "<p>Westmoreland is located on Jamaica's western tip and is famous for the world-renowned Seven Mile Beach in Negril. The parish has a mix of coastal plains and hilly interior, making it both a tourist destination and an agricultural heartland.</p><p>Sugar cane has historically been the dominant crop, and the Frome Sugar Estate remains one of Jamaica's largest. The Negril Great Morass, a vast wetland, is an important ecological area teeming with wildlife.</p>",
    features: ["Negril Seven Mile Beach", "Negril Lighthouse", "Frome Sugar Estate", "Roaring River", "Negril Great Morass"]
  },
  {
    slug: "st-james", name: "St. James", county: "County of Cornwall",
    population: "186,726", capital: "Montego Bay", area: "595 km²",
    fill_color: "#43a047",
    svg_path: "M185,105 L230,92 L275,85 L305,90 L310,110 L305,140 L290,160 L265,170 L240,170 L215,165 L210,140 L205,115 Z",
    description: "<p>St. James is one of Jamaica's most vibrant parishes and home to Montego Bay, the island's second-largest city and a major tourism hub. Known as the 'Complete Resort,' Montego Bay draws millions of visitors each year to its beaches, duty-free shopping, and lively nightlife.</p><p>The parish played a significant role in Jamaican history — the Christmas Rebellion of 1831, led by Samuel Sharpe, began in St. James and was a pivotal event leading to the abolition of slavery. Sam Sharpe Square in the city centre honours this legacy.</p>",
    features: ["Montego Bay", "Doctor's Cave Beach", "Rose Hall Great House", "Sam Sharpe Square", "Hip Strip"]
  },
  {
    slug: "trelawny", name: "Trelawny", county: "County of Cornwall",
    population: "75,614", capital: "Falmouth", area: "875 km²",
    fill_color: "#4caf50",
    svg_path: "M305,90 L350,78 L400,70 L445,72 L460,85 L455,115 L440,145 L415,160 L380,165 L345,162 L320,155 L305,140 L310,110 Z",
    description: "<p>Trelawny is rich in history and natural beauty. Its capital, Falmouth, is considered one of the best-preserved Georgian towns in the Caribbean, with architecture dating back to the 18th century. The town was one of the first in the Western Hemisphere to have running water.</p><p>The parish is also the birthplace of the fastest man alive, Usain Bolt, born in the small town of Sherwood Content. Trelawny's Cockpit Country is a rugged limestone landscape steeped in Maroon history and biodiversity.</p>",
    features: ["Falmouth Georgian Town", "Cockpit Country", "Glistening Waters (Luminous Lagoon)", "Martha Brae River", "Birthplace of Usain Bolt"]
  },
  {
    slug: "st-ann", name: "St. Ann", county: "County of Middlesex",
    population: "174,045", capital: "St. Ann's Bay", area: "1,213 km²",
    fill_color: "#66bb6a",
    svg_path: "M445,72 L500,62 L555,58 L600,60 L630,70 L640,95 L635,125 L615,150 L580,165 L540,170 L500,168 L465,158 L440,145 L455,115 L460,85 Z",
    description: "<p>St. Ann is known as the 'Garden Parish' for its lush vegetation and natural beauty. It is the largest parish in Jamaica by area and the birthplace of two of Jamaica's most iconic figures: Marcus Garvey and Bob Marley.</p><p>The parish was also the first part of Jamaica sighted by Christopher Columbus in 1494. Ocho Rios, one of Jamaica's top resort towns, sits on its coast. The interior features the famous Fern Gully, a three-mile stretch of road canopied by towering ferns.</p>",
    features: ["Ocho Rios", "Dunn's River Falls", "Bob Marley Birthplace (Nine Mile)", "Fern Gully", "Green Grotto Caves"]
  },
  {
    slug: "st-elizabeth", name: "St. Elizabeth", county: "County of Cornwall",
    population: "150,561", capital: "Black River", area: "1,212 km²",
    fill_color: "#2e7d32",
    svg_path: "M205,165 L215,165 L240,170 L265,170 L290,160 L305,140 L320,155 L345,162 L380,165 L385,190 L375,225 L350,260 L310,280 L265,290 L225,280 L200,260 L200,220 L210,185 Z",
    description: "<p>St. Elizabeth is called the 'Breadbasket of Jamaica' because of its significant agricultural output. The parish produces a wide variety of crops including fruits, vegetables, and ground provisions that supply markets across the island.</p><p>Black River, the capital, sits at the mouth of Jamaica's longest navigable river, which is famous for its crocodile population and boat safari tours through mangrove wetlands. The YS Falls and Appleton Estate rum distillery are among the parish's most popular attractions.</p>",
    features: ["Black River Safari", "YS Falls", "Appleton Estate", "Treasure Beach", "Lover's Leap"]
  },
  {
    slug: "manchester", name: "Manchester", county: "County of Middlesex",
    population: "192,266", capital: "Mandeville", area: "830 km²",
    fill_color: "#388e3c",
    svg_path: "M380,165 L415,160 L440,145 L465,158 L480,175 L485,205 L475,235 L455,260 L425,275 L390,278 L360,268 L350,260 L375,225 L385,190 Z",
    description: "<p>Manchester is Jamaica's hilliest parish, with Mandeville sitting at approximately 600 metres above sea level, giving it a noticeably cooler climate. Founded in 1816, it was the last parish to be created and was named after the Duke of Manchester, then Governor of Jamaica.</p><p>Bauxite mining has been a major industry in Manchester since the 1950s, shaping the local economy and landscape. The parish is also known for its citrus orchards, coffee farms, and the annual Jamaican International Invitational athletics meet held in Mandeville.</p>",
    features: ["Mandeville (highest capital)", "Marshall's Pen", "Bauxite Mining", "Cecil Charlton Park", "Williamsfield"]
  },
  {
    slug: "clarendon", name: "Clarendon", county: "County of Middlesex",
    population: "246,322", capital: "May Pen", area: "1,196 km²",
    fill_color: "#43a047",
    svg_path: "M465,158 L500,168 L540,170 L560,180 L575,200 L580,225 L575,255 L555,278 L525,290 L490,292 L460,285 L425,275 L455,260 L475,235 L485,205 L480,175 Z",
    description: "<p>Clarendon is one of Jamaica's largest and most populous parishes. Its capital, May Pen, serves as a major commercial and transportation hub linking the eastern and western halves of the island along the main highway.</p><p>Agriculture is the backbone of Clarendon's economy, with sugar cane, citrus fruits, and coffee among the primary crops. The parish has a diverse landscape ranging from coastal plains to mountainous interior, and it includes parts of the Bull Head and Main Ridge mountains.</p>",
    features: ["May Pen", "Halse Hall Great House", "Milk River Bath", "Portland Point (southernmost tip)", "Jackson Bay"]
  },
  {
    slug: "st-mary", name: "St. Mary", county: "County of Middlesex",
    population: "114,227", capital: "Port Maria", area: "611 km²",
    fill_color: "#4caf50",
    svg_path: "M630,70 L680,62 L725,58 L760,62 L775,78 L770,105 L750,130 L720,150 L685,158 L650,160 L615,150 L635,125 L640,95 Z",
    description: "<p>St. Mary lies on Jamaica's lush northern coast and is known for its stunning natural scenery and rich cultural heritage. The parish has a dramatic coastline with cliffs, coves, and beautiful beaches, including the famous James Bond Beach.</p><p>Ian Fleming wrote all fourteen James Bond novels at his estate, Goldeneye, in Oracabessa, St. Mary. The parish also features Firefly, the hilltop home of playwright Noël Coward, now preserved as a museum with panoramic views of the coast.</p>",
    features: ["James Bond Beach", "Firefly (Noël Coward's home)", "Port Maria", "Brimmer Hall Estate", "Pagee Beach"]
  },
  {
    slug: "st-catherine", name: "St. Catherine", county: "County of Middlesex",
    population: "516,218", capital: "Spanish Town", area: "1,192 km²",
    fill_color: "#66bb6a",
    svg_path: "M560,180 L580,165 L615,150 L650,160 L685,158 L700,170 L710,195 L705,225 L690,252 L665,270 L635,280 L600,285 L575,278 L555,278 L575,255 L580,225 L575,200 Z",
    description: "<p>St. Catherine is Jamaica's most populous parish and home to Spanish Town, which served as Jamaica's capital under both Spanish and British rule until 1872. The historic Spanish Town Square features some of the finest examples of Georgian architecture in the Americas.</p><p>The parish has experienced rapid urbanization due to its proximity to Kingston. Portmore, a large planned community, is effectively a satellite city of Kingston. St. Catherine also has a strong industrial base and is home to several factories and free-zone operations.</p>",
    features: ["Spanish Town Square", "Old King's House", "Bog Walk Gorge", "Portmore", "Caymanas Park"]
  },
  {
    slug: "st-andrew", name: "St. Andrew", county: "County of Surrey",
    population: "573,369", capital: "Half Way Tree", area: "453 km²",
    fill_color: "#2e7d32",
    svg_path: "M700,170 L720,150 L750,130 L770,125 L790,130 L810,145 L820,168 L825,195 L818,218 L800,238 L778,250 L755,255 L740,248 L730,260 L710,265 L690,252 L705,225 L710,195 Z",
    description: "<p>St. Andrew surrounds Kingston and together they form the Kingston Metropolitan Area, Jamaica's economic and cultural heart. Half Way Tree, the parish capital, is a bustling commercial centre named after a giant cotton tree that once stood at a crossroads.</p><p>The parish extends into the Blue Mountains, which rise to over 2,200 metres and produce the world-famous Blue Mountain Coffee. The University of the West Indies' main campus, the Bob Marley Museum, and Devon House are all located in St. Andrew.</p>",
    features: ["Blue Mountains", "Bob Marley Museum", "Devon House", "Hope Botanical Gardens", "University of the West Indies"]
  },
  {
    slug: "kingston", name: "Kingston", county: "County of Surrey",
    population: "89,057", capital: "Kingston (National Capital)", area: "25 km²",
    fill_color: "#1b5e20",
    svg_path: "M730,260 L740,248 L755,255 L765,262 L760,275 L745,280 L732,275 Z",
    description: "<p>Kingston is Jamaica's capital city and the smallest parish by far. It is the island's political, economic, and cultural centre, housing Parliament, the Supreme Court, and the headquarters of most major businesses and financial institutions.</p><p>The downtown waterfront area has undergone significant redevelopment, and the Kingston Harbour — the seventh-largest natural harbour in the world — remains vital for trade. Kingston's vibrant music scene gave rise to ska, rocksteady, and reggae, shaping popular music worldwide.</p>",
    features: ["Kingston Harbour", "National Gallery of Jamaica", "Ward Theatre", "Emancipation Park", "Port Royal"]
  },
  {
    slug: "st-thomas", name: "St. Thomas", county: "County of Surrey",
    population: "93,902", capital: "Morant Bay", area: "743 km²",
    fill_color: "#388e3c",
    svg_path: "M810,145 L845,132 L880,125 L915,128 L940,140 L955,162 L950,190 L935,215 L910,235 L880,248 L850,255 L825,252 L808,242 L800,238 L818,218 L825,195 L820,168 Z",
    description: "<p>St. Thomas is Jamaica's easternmost parish, known for its rugged beauty and historical significance. The Morant Bay Rebellion of 1865, led by National Hero Paul Bogle, began here and was a turning point in Jamaica's journey toward self-governance.</p><p>The parish is home to Bath Fountain, one of the Caribbean's natural mineral hot springs, which has been used for therapeutic bathing since the 1690s. St. Thomas also boasts pristine beaches and is the gateway to the eastern Blue and John Crow Mountains.</p>",
    features: ["Morant Bay Courthouse", "Bath Fountain", "Morant Point Lighthouse", "Yallahs Pond", "Blue & John Crow Mountains"]
  },
  {
    slug: "portland", name: "Portland", county: "County of Surrey",
    population: "82,183", capital: "Port Antonio", area: "814 km²",
    fill_color: "#43a047",
    svg_path: "M775,78 L810,70 L850,65 L890,68 L920,78 L945,95 L955,120 L955,162 L940,140 L915,128 L880,125 L845,132 L810,145 L790,130 L770,105 Z",
    description: "<p>Portland is considered by many to be Jamaica's most beautiful parish. Its capital, Port Antonio, was the island's first major tourist destination, attracting Hollywood stars like Errol Flynn in the mid-20th century. The lush Rio Grande valley and the towering Blue Mountains create breathtaking scenery.</p><p>The Blue Lagoon, made famous by the 1980 film, is one of Portland's iconic attractions — a stunning deep-blue mineral spring where freshwater meets the sea. The parish is also the home of jerk cooking, with Boston Bay being the legendary birthplace of this world-famous culinary tradition.</p>",
    features: ["Blue Lagoon", "Port Antonio", "Reach Falls", "Boston Bay (home of jerk)", "Rio Grande Rafting"]
  }
];

function seedParishes(db) {
  const insertParish = db.prepare(`
  INSERT OR IGNORE INTO parishes (slug, name, county, population, capital, area, description, fill_color, svg_path)
  VALUES (@slug, @name, @county, @population, @capital, @area, @description, @fill_color, @svg_path)
`);

  const insertFeature = db.prepare(`
  INSERT INTO features (parish_id, name) VALUES (?, ?)
`);

  const getParishId = db.prepare(`SELECT id FROM parishes WHERE slug = ?`);

  const seedAll = db.transaction(() => {
    for (const parish of parishes) {
      const { features, ...parishRow } = parish;
      insertParish.run(parishRow);
      const row = getParishId.get(parish.slug);
      if (row) {
        const existingCount = db.prepare('SELECT COUNT(*) as c FROM features WHERE parish_id = ?').get(row.id).c;
        if (existingCount === 0) {
          for (const feature of features) {
            insertFeature.run(row.id, feature);
          }
        }
      }
    }
  });

  seedAll();
}

module.exports = { applySchema, seedParishes };

if (require.main === module) {
  const db = require('./connection');
  applySchema(db);
  seedParishes(db);
  console.log('Database initialized and seeded successfully.');
  db.close();
}
