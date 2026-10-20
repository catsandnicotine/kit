// Refresh the museum records. Run with Node 20+ and network access.
// Cached responses make interrupted runs resumable without repeating requests.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cache = process.env.KIT_ART_CACHE ?? '/tmp/kit-jesus-catalogue';
await fs.mkdir(cache, { recursive: true });
await fs.mkdir(path.join(root, 'src/data'), { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function json(url, cacheOnly = false) {
  const filename = path.join(cache, crypto.createHash('sha256').update(url).digest('hex') + '.json');
  try { return JSON.parse(await fs.readFile(filename, 'utf8')); } catch { /* cache miss */ }
  if (cacheOnly) throw new Error('Not requested while museum API is blocking requests');
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error(`${response.status}: ${url}`);
      const data = await response.json();
      await fs.writeFile(filename, JSON.stringify(data));
      await pause(150);
      return data;
    } catch (error) {
      if (String(error).startsWith('Error: 403:') || String(error).startsWith('Error: 404:')) throw error;
      if (attempt === 3) throw error;
      await pause(1500 * (attempt + 1));
    }
  }
}
const plain = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
// Titles identify the represented subject, rather than references to Christ
// in an unrelated artist biography, exhibition history, or ownership record.
const subject = /\b(jesus|christ(?!ian|mas|opher)|madonna|virgin and child|virgin with (?:the )?child|holy family|nativity|adoration of (?:the )?(?:magi|kings|shepherds|child)|crucifi\w+|piet[aà]|resurrection|lamentation|entombment|deposition|man of sorrows|ecce homo|salvator mundi|last supper|emmaus|noli me tangere|flight into egypt|rest on (?:the )?flight|holy trinity|transfiguration|raising of lazarus|agony in the garden|gethsemane)\b/i;
const records = new Map();
const coverage = [];
function add(record) { records.set(record.id, record); }

// Chicago: enumerate all public-domain paintings, then match title or the
// museum's explicit Jesus/Christ subject tags. No top-N search cutoff.
let aicCount = 0;
// The search API limits deep pagination. Disjoint ID ranges keep every
// request within that window without truncating the collection.
for (let minId = 0; minId < 1000000; minId += 50000) {
for (let page = 1, totalPages = 1; page <= totalPages; page++) {
  const params = { query: { bool: { filter: [{ term: { is_public_domain: true } }, { term: { artwork_type_id: 1 } }, { range: { id: { gte: minId, lt: minId + 50000 } } }] } },
    limit: 100, page, fields: ['id','title','artwork_type_title','is_public_domain','image_id','date_display','date_start','artist_display','place_of_origin','provenance_text','credit_line','main_reference_number','subject_titles','medium_display'] };
  const data = await json('https://api.artic.edu/api/v1/artworks/search?params=' + encodeURIComponent(JSON.stringify(params)));
  if (!data.pagination || !data.data) throw new Error('Chicago catalogue did not return pagination');
  totalPages = data.pagination.total_pages;
  if (data.pagination.total > 1000) throw new Error('Chicago partition exceeds search pagination window');
  aicCount += data.data.length;
  for (const art of data.data) {
    if (!art.is_public_domain || !art.image_id || art.artwork_type_title !== 'Painting') continue;
    const explicitTag = (art.subject_titles ?? []).some(tag => /^(jesus(?: christ)?|christ(?: \(.*\))?)$/i.test(tag));
    if (!subject.test(art.title) && !explicitTag) continue;
    add({ id: `aic-${art.id}`, title: plain(art.title), artist: plain(art.artist_display) || 'Unknown artist',
      date: plain(art.date_display), year: art.date_start, origin: plain(art.place_of_origin), originKind: 'Place of origin',
      provenance: plain(art.provenance_text), museum: 'Art Institute of Chicago', city: 'Chicago, United States',
      accession: art.main_reference_number, medium: plain(art.medium_display),
      sourceUrl: `https://www.artic.edu/artworks/${art.id}`, metadataUrl: `https://api.artic.edu/api/v1/artworks/${art.id}`,
      imageUrl: `https://www.artic.edu/iiif/2/${art.image_id}/full/843,/0/default.jpg`,
      rights: 'CC0', rightsEvidence: 'is_public_domain = true', rightsUrl: 'https://www.artic.edu/open-access/open-access-images',
      subjectEvidence: explicitTag ? 'Museum subject tag' : 'Painting title' });
  }
  console.log(`Chicago page ${page}/${totalPages}, ${records.size} eligible`);
}
}
coverage.push({ museum: 'Art Institute of Chicago', method: 'All public-domain painting records, matched by title or explicit Jesus/Christ subject tag', examined: aicCount });

// Cleveland: search is case-sensitive in the current API. Fetch every page
// of each lowercase subject query and filter painting type and CC0 locally.
const terms = ['christ','jesus','madonna','virgin and child','virgin with child','holy family','nativity','adoration','crucifixion','pieta','pietà','resurrection','lamentation','entombment','deposition','man of sorrows','ecce homo','salvator','last supper','emmaus','noli me tangere','flight into egypt','trinity','transfiguration','lazarus','gethsemane','agony in the garden'];
const cmaSeen = new Set();
for (const term of terms) {
  for (let skip = 0, total = 1; skip < total; skip += 1000) {
    const data = await json(`https://openaccess-api.clevelandart.org/api/artworks/?q=${encodeURIComponent(term)}&limit=1000&skip=${skip}`);
    if (!data.info || !data.data) throw new Error('Cleveland catalogue response was incomplete');
    total = data.info.total;
    for (const art of data.data) {
      cmaSeen.add(art.id);
      if (art.type !== 'Painting' || art.share_license_status !== 'CC0' || !art.images?.web?.url || !subject.test(art.title)) continue;
      add({ id: `cma-${art.id}`, title: plain(art.title),
        artist: (art.creators ?? []).map(creator => [
          plain(creator.qualifier), plain(creator.description), creator.include_extent ? plain(creator.extent) : '',
          creator.role && creator.role !== 'artist' ? `(${plain(creator.role)})` : '',
        ].filter(Boolean).join(' ')).filter(Boolean).join('; ') || 'Unknown artist',
        date: plain(art.creation_date), year: art.creation_date_earliest, origin: (art.culture ?? []).join('; '), originKind: 'Museum cultural attribution',
        provenance: (art.provenance ?? []).map(entry => [entry.date, plain(entry.description)].filter(Boolean).join(': ')).join('\n'),
        museum: 'Cleveland Museum of Art', city: 'Cleveland, United States', accession: art.accession_number, medium: plain(art.technique),
        sourceUrl: art.url || `https://www.clevelandart.org/art/${art.accession_number}`, metadataUrl: `https://openaccess-api.clevelandart.org/api/artworks/${art.id}`,
        imageUrl: art.images.web.url, rights: 'CC0', rightsEvidence: 'share_license_status = CC0', rightsUrl: 'https://www.clevelandart.org/open-access', subjectEvidence: 'Painting title' });
    }
  }
  console.log(`Cleveland '${term}', ${records.size} eligible in total`);
}
coverage.push({ museum: 'Cleveland Museum of Art', method: 'All pages of subject searches, filtered to CC0 paintings and matching titles', terms, examined: cmaSeen.size });

// Met: union subject-tag and title searches. Painting classification and
// individual image eligibility are checked again on every object record.
const metIds = new Set();
for (const term of ['Jesus', ...terms]) {
  for (let offset = 0, total = 1; offset < total; offset += 500) {
    const filter = term === 'Jesus' ? 'tags=true' : 'title=true';
    const url = `https://collectionapi.metmuseum.org/public/collection/v1.1/search?${filter}&q=${encodeURIComponent(term)}&medium=Paintings&hasImages=true&limit=500&offset=${offset}`;
    const data = await json(url);
    if (!Array.isArray(data.objectIDs) && data.total !== 0) throw new Error('Met catalogue response was incomplete');
    total = data.total;
    if (total > 10000) throw new Error('Met search exceeds pagination window');
    for (const id of data.objectIDs ?? []) metIds.add(id);
  }
}
let metDone = 0;
const unavailableMetIds = [];
let consecutiveMetBlocks = 0;
for (const id of metIds) {
  let art;
  try {
    art = await json(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`, consecutiveMetBlocks >= 3);
    if (consecutiveMetBlocks < 3) consecutiveMetBlocks = 0;
  } catch (error) {
    if (error.message.startsWith('403:')) consecutiveMetBlocks++;
    unavailableMetIds.push(id);
    if (unavailableMetIds.length % 20 === 1) console.warn(`Met records unavailable, latest ${id}: ${error.message}`);
    continue;
  }
  metDone++;
  const explicitTag = (art.tags ?? []).some(tag => tag.term === 'Jesus');
  if (art.isPublicDomain && art.primaryImage && /painting/i.test(art.classification + ' ' + art.objectName)
    && (subject.test(art.title) || explicitTag)) {
    const origin = [art.city, art.state, art.country, art.region].filter(Boolean).join(', ');
    add({ id: `met-${id}`, title: plain(art.title), artist: plain([art.artistPrefix, art.artistDisplayName, art.artistSuffix].filter(Boolean).join(' ')) || 'Unknown artist',
      artistContext: plain(art.artistDisplayBio || art.culture), date: plain(art.objectDate), year: art.objectBeginDate,
      origin, originKind: 'Geography in museum record', provenance: '', museum: 'The Metropolitan Museum of Art', city: 'New York, United States',
      accession: art.accessionNumber, medium: plain(art.medium), sourceUrl: art.objectURL, metadataUrl: `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`,
      imageUrl: art.primaryImageSmall || art.primaryImage, rights: 'CC0', rightsEvidence: 'isPublicDomain = true and primaryImage available',
      rightsUrl: 'https://www.metmuseum.org/policies/image-resources', subjectEvidence: explicitTag ? 'Museum Jesus subject tag' : 'Painting title' });
  }
  if (metDone % 20 === 0) console.log(`Met ${metDone}/${metIds.size}, ${records.size} eligible in total`);
}
coverage.push({ museum: 'The Metropolitan Museum of Art', method: 'All pages of Jesus subject-tag and subject-title painting searches, filtered to public-domain images', terms: ['Jesus subject tag', ...terms], matchedObjectCount: metIds.size, examined: metDone });
if (unavailableMetIds.length) coverage[coverage.length - 1].unavailableObjectIds = unavailableMetIds;
const paintings = [...records.values()].sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title));
const catalogue = { schemaVersion: 1, checkedOn: '2026-10-19',
  scope: 'Documented paintings depicting Jesus, including infancy and narrative scenes, with museum-designated CC0 images. Search-based coverage of three museum catalogues. This is not a worldwide census.',
  coverage, paintings };
await fs.writeFile(path.join(root, 'scripts/jesus-paintings/records.json'), JSON.stringify(catalogue, null, 2) + '\n');
console.log(`Saved ${paintings.length} paintings`);
