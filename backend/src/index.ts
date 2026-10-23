import { app } from './app';
import { config } from './config';

// The only file that opens a network port.
// 0.0.0.0 lets a phone on the same Wi-Fi reach the server (not just localhost).
app.listen(config.port, '0.0.0.0', () => {
  console.log(`MiniLedger API listening on http://localhost:${config.port}`);
});
