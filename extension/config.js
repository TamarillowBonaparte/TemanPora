// Explicit allowlists. Use scripts/configure.mjs for deployment domains.
globalThis.ThesisSplitConfig = Object.freeze({
  websiteOrigins: ['http://127.0.0.1:3000', 'http://localhost:3000'],
  apiOrigins: ['http://127.0.0.1:8000', 'http://localhost:8000'],
  adapterFile: 'modules/automation-v212.js',
  siporaOrigin: 'https://sipora.polije.ac.id',
  // Authenticated deposit DOM has not been inspected. Never guess live selectors.
  verifiedProfiles: [],
});
