module.exports = {
  apps: [
    {
      name: "notification-system",
      script: "index.js",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
  ],
};
