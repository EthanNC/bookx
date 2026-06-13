/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "bookx",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "cloudflare",
    };
  },
  async run() {
    const db = new sst.cloudflare.D1("MyDatabase");

    const kv = new sst.cloudflare.Kv("MyKv");

    new sst.cloudflare.ReactRouter("MyWeb", {
      link: [kv],
    });

    return {
      database: db.databaseId,
    };
  },
});
