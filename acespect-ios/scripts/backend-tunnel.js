// Dev helper: expose the local backend (:4000) over an ngrok tunnel so the
// Expo Go app can reach it from any network when running Metro in --tunnel mode.
// Writes the public URL to backend-tunnel-url.txt and stays alive.
const fs = require('fs');
const path = require('path');
const ngrok = require('@expo/ngrok');

const OUT = path.join(__dirname, 'backend-tunnel-url.txt');

(async () => {
  try {
    const url = await ngrok.connect({ addr: 4000, proto: 'http' });
    fs.writeFileSync(OUT, url);
    console.log('TUNNEL_URL=' + url);
  } catch (e) {
    console.error('TUNNEL_ERR ' + (e && (e.message || JSON.stringify(e))));
    process.exit(1);
  }
})();

// Keep the process (and tunnel) alive.
setInterval(() => {}, 1 << 30);
