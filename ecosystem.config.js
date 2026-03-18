module.exports = {
  apps: [
    {
      name: 'jamaica-api',
      cwd: './server',
      script: 'index.js',
      node_args: [],
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'jamaica-status',
      cwd: './server',
      script: 'status-board.js',
      node_args: [],
      watch: false,
      env: {
        NODE_ENV: 'production',
        STATUS_HOST: '0.0.0.0',
        STATUS_PORT: '5555',
      },
    },
    {
      name: 'jamaica-admin',
      cwd: './server',
      script: 'admin.js',
      node_args: [],
      watch: false,
      env: {
        NODE_ENV: 'production',
        ADMIN_HOST: '0.0.0.0',
        ADMIN_PORT: '5556',
      },
    },
  ],
};

