'use strict';

const ngrok = require('@ngrok/ngrok');
require('dotenv').config();

/**
 * Opens an ngrok tunnel to expose the local server publicly.
 * Requires NGROK_AUTHTOKEN env var for authenticated sessions.
 * @param {number} port - Local port to tunnel.
 * @returns {Promise<import('@ngrok/ngrok').Listener>}
 */
async function openTunnel(port) {
  const opts = {
    addr:      port,
    authtoken: process.env.NGROK_AUTHTOKEN,
  };

  if (process.env.TUNNEL_SUBDOMAIN && process.env.NGROK_AUTHTOKEN) {
    opts.domain = process.env.TUNNEL_SUBDOMAIN;
  }

  const listener = await ngrok.forward(opts);
  const url      = listener.url();
  console.log(`[tunnel] Public URL: ${url}`);
  return listener;
}

module.exports = { openTunnel };
