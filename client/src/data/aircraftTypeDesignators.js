/**
 * Aircraft type designators for map icon display.
 * References:
 * - ICAO type codes (e.g. from ADS-B: B738, A320, GLF6)
 * - Transport Canada Standard 421.40 - Aircraft Type Designators for Individual Type Ratings (TCCA)
 *   https://tc.canada.ca/en/aviation/licensing-pilots-personnel/flight-crew-licences-permits-ratings/aircraft-type-designation/standard-42140-aircraft-type-designators-individual-type-ratings-transport-canada-tcca
 * Effective date: April 1, 2026 (TCCA).
 *
 * Icon categories: helicopter | cargo | business | small | widebody | narrow
 */

const TCCA_SOURCE = 'https://tc.canada.ca/en/aviation/licensing-pilots-personnel/flight-crew-licences-permits-ratings/aircraft-type-designation/standard-42140-aircraft-type-designators-individual-type-ratings-transport-canada-tcca';

// --- Full designator → category (exact match; ICAO + TCCA) ---
// Cargo/freighter (TCCA + ICAO)
const CARGO = new Set([
  // ICAO
  'B74F', 'B744', 'B748', 'B77F', 'B77L', 'B78F', 'B762', 'B763', 'B752', 'B753',
  'A124', 'A30B', 'A30F', 'M11', 'MD11', 'L10', 'L100', 'AN2', 'C130', 'C17', 'B742',
  // TCCA / common
  'DC10', 'L382', 'B97',
]);

// Helicopters: TCCA designators (Bell, Sikorsky, Airbus Helicopters, Leonardo, etc.)
const HELICOPTER = new Set([
  'EC20', 'EC25', 'EC30', 'EC35', 'EC45', 'AH145', 'AH160', 'EC55', 'MBK7', 'MBH5',
  'S313', 'S315', 'S316', 'S318', 'S319', 'S330', 'S332', 'S32L2', 'S342', 'S350', 'S355', 'S360', 'S365',
  'BH04', 'BH06', 'BH06T', 'BH12', 'BH214', 'BHST', 'BH22', 'BH23', 'BH41', 'BH47', 'BH47T', 'BH407', 'BH427', 'B429', 'BH430', 'BH505',
  'SK51', 'SK55', 'SK55T', 'SK58', 'SK58T', 'SK61', 'SK62', 'SK64', 'SK70', 'SK76', 'SK76D', 'SK92',
  'A109', 'AW109', 'A119', 'A139', 'A169', 'A189',
  'RH22', 'RH44', 'R66', 'HU30', 'HU50', 'HU52', 'HU60', 'EXPL',
  'BV44', 'HB42', 'HB43', 'HL11', 'HL12', 'HL2T', 'HL36', 'HGCG2', 'HK12', 'KA32', 'DM52', 'EH28', 'EH48', 'MOZY', 'M500',
]);

// Business / executive jets (TCCA + ICAO)
const BUSINESS = new Set([
  // Gulfstream (TCCA: GLF5, GLF6, GLF7, GLF8, G100, G150, G280, G3, G4, GALX)
  'GLF5', 'GLF6', 'GLF7', 'GLF8', 'G100', 'G150', 'G280', 'G3', 'G4', 'GALX', 'G159', 'G2',
  // Citation (TCCA: C500, C510, C525, C25A, C25B, C25C, C550, C560, C56XL, C650, C680, C750, etc.)
  'C500', 'C510', 'C525', 'C25A', 'C25B', 'C25C', 'C550', 'C560', 'C56XL', 'C650', 'C680', 'C750', 'C501', 'C510S', 'C525S', 'C551', 'C25AS', 'C25BS', 'C25CS',
  // Falcon (TCCA: FA10, FA20, FA50, FA90, FA90X, FA6X, FA7X, F2TH, F2THE)
  'FA10', 'FA20', 'FA50', 'FA90', 'FA90X', 'FA6X', 'FA7X', 'F2TH', 'F2THE',
  // Challenger / Global (TCCA: BD700, CL30, CL60, CL64, G7500)
  'BD700', 'CL30', 'CL60', 'CL64', 'G7500',
  // Learjet (TCCA: LR23–LR60, LR45, etc.)
  'LR18', 'LR23', 'LR24', 'LR25', 'LR28', 'L29', 'LR31', 'LR35', 'LR36', 'LR45', 'LR55', 'LR60',
  // Hawker (TCCA: HS25, HS251)
  'HS25', 'HS251',
  // Other bizjet
  'PRM1', 'BE40', 'HA420', 'MU3', 'E550', 'E50P', 'E55P', 'SF50', 'TBM', 'P180', 'PC24', 'AJ25', 'JC21', 'WW23', 'WW24', 'L329', 'N265', 'HF20', 'MS76',
]);

// Regional / small jets and turboprops (TCCA + ICAO)
const SMALL = new Set([
  // TCCA: E170 (ERJ family), BD500 (A220), CL65 (CRJ), AT42, AT72, DH8, DH7, DH4, DH5
  'E170', 'E110', 'E120', 'BD500', 'CL65', 'AT42', 'AT72', 'DH8', 'DH7', 'DH4', 'DH5',
  'SF34', 'FK10', 'FK28', 'FK50', 'FK70', 'J328', 'BA31', 'BA32', 'BA41', 'BA46', 'ARJ46',
  'ND26', 'CS12', 'CV58', 'CV64', 'D228', 'D328', 'SW5', 'BE02', 'BE30', 'BE99', 'C425', 'C501', 'PA42', 'PA466',
  'VC8', 'VC9', 'HP7', 'BR31', 'BR70', 'YS11', 'N265', 'ST27', 'SH33', 'SH36',
]);

// Widebody (TCCA + ICAO)
const WIDEBODY = new Set([
  'B747', 'B7474', 'B777', 'B787', 'EA34', 'EA30', 'EA31', 'L101', 'DC8', 'MD11', 'DC10',
  'A34', 'A35', 'A38', 'B74', 'B77', 'B78',
]);

// Narrow-body (TCCA: B73A, B73B, B73C, EA32, EA33, B707, B727, B757, B767, DC9, MD80)
const NARROW = new Set([
  'B73A', 'B73B', 'B73C', 'EA32', 'EA33', 'B707', 'B727', 'B757', 'B767', 'DC9', 'MD80',
  'BA11',
]);

// --- 3-char prefix → category (for ICAO-style B738, A320, etc.) ---
const PREFIX_HELICOPTER = new Set(['H', 'EC2', 'EC3', 'EC4', 'EC5', 'AH1', 'S31', 'S32', 'S33', 'S34', 'S35', 'S36', 'BH0', 'BH1', 'BH2', 'BH4', 'BH5', 'B42', 'SK5', 'SK6', 'SK7', 'SK9', 'A10', 'A11', 'A13', 'A16', 'A18', 'RH2', 'R66', 'HU3', 'HU5', 'HU6', 'EXP', 'BV4', 'HB4', 'HL1', 'HL2', 'HL3', 'HGC', 'HK1', 'KA3', 'DM5', 'EH2', 'EH4', 'MOZ', 'M50']);
const PREFIX_BUSINESS = new Set(['G65', 'G55', 'G45', 'G35', 'G28', 'G15', 'G10', 'GLF', 'GLE', 'GLB', 'C25', 'C50', 'C51', 'C52', 'C55', 'C56', 'C68', 'C72', 'C75', 'CL3', 'CL6', 'CL35', 'F2T', 'FA1', 'FA5', 'FA6', 'FA7', 'FA8', 'FA9', 'F90', 'E55', 'E50', 'H25', 'H85', 'HS25', 'PRM', 'LJ3', 'LJ4', 'LJ5', 'LJ6', 'LJ7', 'LR2', 'LR3', 'LR4', 'LR5', 'LR6', 'BD70', 'G75', 'BE40', 'HA42', 'MU3', 'SF50', 'TBM', 'P18', 'PC24']);
const PREFIX_SMALL = new Set(['E17', 'E18', 'E19', 'E75', 'E90', 'E11', 'E12', 'BD50', 'CRJ', 'CL65', 'AT4', 'AT7', 'DH8', 'DH4', 'DH5', 'DH7', 'SF34', 'FK10', 'FK28', 'FK50', 'FK70', 'J32', 'BA31', 'BA32', 'BA41', 'BA46', 'ARJ']);
const PREFIX_WIDEBODY = new Set(['B74', 'B77', 'B78', 'A34', 'A35', 'A38', 'EA34', 'EA30', 'EA31', 'L101', 'DC8', 'DC10', 'M11', 'MD11']);
const PREFIX_NARROW = new Set(['B73', 'B70', 'B72', 'B75', 'B76', 'EA32', 'EA33', 'DC9', 'MD80', 'BA11']);

/**
 * Resolve a typecode (ICAO or TCCA) to icon category.
 * @param {string} typecode - e.g. "B738", "GLF6", "EA32", "B73C"
 * @returns {'helicopter'|'cargo'|'business'|'small'|'widebody'|'narrow'}
 */
export function getIconCategory(typecode) {
  if (!typecode || typeof typecode !== 'string') return 'narrow';
  const t = typecode.toUpperCase().trim();

  // Cargo (exact + F-suffix freighters)
  if (CARGO.has(t) || (t.length >= 4 && t.endsWith('F') && /^[AB][0-9]{2}F$/.test(t))) return 'cargo';

  // Exact match
  if (HELICOPTER.has(t)) return 'helicopter';
  if (BUSINESS.has(t)) return 'business';
  if (SMALL.has(t)) return 'small';
  if (WIDEBODY.has(t)) return 'widebody';
  if (NARROW.has(t)) return 'narrow';

  // Prefix match (3 or 4 chars)
  const p3 = t.slice(0, 3);
  const p4 = t.slice(0, 4);
  if (PREFIX_HELICOPTER.has(p3) || PREFIX_HELICOPTER.has(p4)) return 'helicopter';
  if (PREFIX_BUSINESS.has(p3) || PREFIX_BUSINESS.has(p4)) return 'business';
  if (PREFIX_SMALL.has(p3) || PREFIX_SMALL.has(p4)) return 'small';
  if (PREFIX_WIDEBODY.has(p3) || PREFIX_WIDEBODY.has(p4)) return 'widebody';
  if (PREFIX_NARROW.has(p3) || PREFIX_NARROW.has(p4)) return 'narrow';

  // Generic H = helicopter
  if (t.startsWith('H')) return 'helicopter';

  return 'narrow';
}

export { TCCA_SOURCE, CARGO, HELICOPTER, BUSINESS, SMALL, WIDEBODY, NARROW };
