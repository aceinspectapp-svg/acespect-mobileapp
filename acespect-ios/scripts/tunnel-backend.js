// Dev-only: exposes the local backend (port 4000) over a public ngrok URL so a
// phone running Expo Go in tunnel mode can reach it. Prints the URL and stays up.
const ngrok = require('@expo/ngrok');

(async () => {
  try {
    const url = await ngrok.connect({ proto: 'http', addr: 4000, region: 'eu' });
    console.log('BACKEND_TUNNEL_URL=' + url);
  } catch (err) {
    console.error('TUNNEL_FAILED: ' + (err && err.message ? err.message : err));
    process.exit(1);
  }
})();

process.stdin.resume();
