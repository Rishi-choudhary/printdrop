/**
 * PM2 ecosystem config for PrintDrop Print Agent.
 *
 * Usage:
 *   npm install -g pm2
 *   cp .env.agent .env  # set AGENT_KEY, API_URL, PRINTER_NAME
 *   pm2 start ecosystem.config.js
 *   pm2 save             # persist across reboots
 *   pm2 startup          # generate OS startup script
 *
 * Monitor: pm2 monit
 * Logs:    pm2 logs print-agent
 */

module.exports = {
  apps: [
    {
      name: 'print-agent',
      script: './src/index.js',
      cwd: __dirname,

      // Restart policy
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '5s',        // Must be up for 5s to count as stable
      restart_delay: 3000,     // Wait 3s before restarting after crash

      // Environment — override with actual values in .env.agent or PM2 env
      env: {
        NODE_ENV: 'production',
        API_URL:  process.env.API_URL  || 'http://localhost:3001',
        AGENT_KEY: process.env.AGENT_KEY || '',
        POLL_INTERVAL: '5000',
        AUTO_READY: 'true',
        SIMULATE: 'false',
        // PRINTER_NAME: 'HP_LaserJet',  // set if not using default printer
        // DOWNLOAD_DIR: '/tmp/printdrop',
      },

      env_development: {
        NODE_ENV: 'development',
        SIMULATE: 'true',      // dry-run in dev
        POLL_INTERVAL: '5000',
      },

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/agent-error.log',
      out_file:   './logs/agent-out.log',
      merge_logs: true,
    },
  ],
};
