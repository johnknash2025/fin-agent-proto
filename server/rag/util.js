function tokenize(text) {
  const stop = new Set(['the','and','a','an','of','to','in','on','for','by','with','at','as','is','are','was','were','be','been','it','this','that','from','or','but','we','you','they','he','she','i','our','their']);
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t && !stop.has(t) && t.length > 1);
}

function tfVector(tokens) {
  const tf = Object.create(null);
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  let norm = 0;
  for (const k in tf) norm += tf[k] * tf[k];
  norm = Math.sqrt(norm) || 1;
  return { tf, norm };
}

function cosineSim(a, b) {
  // a, b: { tf, norm }
  let dot = 0;
  const tfA = a.tf, tfB = b.tf;
  // iterate smaller map
  const keys = Object.keys(tfA).length < Object.keys(tfB).length ? Object.keys(tfA) : Object.keys(tfB);
  for (const k of keys) {
    if (tfA[k] && tfB[k]) dot += tfA[k] * tfB[k];
  }
  return dot / (a.norm * b.norm);
}

function hash(text) {
  // djb2
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h) + text.charCodeAt(i);
  return (h >>> 0).toString(16);
}

module.exports = { tokenize, tfVector, cosineSim, hash };

