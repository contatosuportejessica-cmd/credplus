// PM2 do backend do CredPlus — processo próprio, independente do
// ecosystem.config.js do ZHEUS (que continua intocado). Mesmo padrão para
// qualquer app full-stack futuro: sua própria pasta, seu próprio
// ecosystem.config.js, seu próprio `pm2 start` aqui dentro.
module.exports = {
  apps: [
    {
      name: 'zheus-app-credplus',
      script: 'src/server.js',
      cwd: __dirname,
      autorestart: true,
      restart_delay: 2000,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
