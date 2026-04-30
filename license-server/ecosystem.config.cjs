module.exports = {
  apps: [{
    name: 'netclaw-license',
    cwd: __dirname,
    script: 'src/app.js',
    exec_mode: 'fork',
    instances: 1,
    max_memory_restart: '250M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      HOST: '127.0.0.1'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    merge_logs: true,
    time: true
  }]
};
