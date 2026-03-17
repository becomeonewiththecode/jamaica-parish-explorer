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
      },
    },
  ],
};

