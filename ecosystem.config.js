module.exports = {
  apps: [
    {
      name: 'naforo-backend',
      script: './dist/server.js',
      // Cluster mode: alloue automatiquement un worker par cœur CPU disponible
      instances: 'max',
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      // Protection anti-fuite de mémoire : redémarrage automatique si > 1 Go
      max_memory_restart: '1G',
      // Allocation mémoire Node.js V8 max (2 Go)
      node_args: '--max-old-space-size=2048',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // Arrêt propre (Graceful Shutdown)
      kill_timeout: 5000,
      listen_timeout: 10000,
      wait_ready: false,
      // Fichiers de logs
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
