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

    new sst.cloudflare.ReactRouter("MyWeb", {
      link: [db],
      domain: "bookx.ethannc.dev",
    });

    return {};
  },
});
