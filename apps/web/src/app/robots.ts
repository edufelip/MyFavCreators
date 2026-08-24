import { webConfig } from "@creator-outdoor/config/web";
import type { MetadataRoute } from "next";

/**
 * What a crawler may index.
 *
 * Everything that identifies a person or holds a credential is disallowed: a
 * checkout carries a payment id, an unsubscribe link carries a token, and the
 * management page is somebody's session. `/out` is a redirect, not a page, and
 * indexing it would put the tracker in search results instead of the profile.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/out/", "/impulsionar/", "/gerenciar", "/descadastrar/"],
    },
    sitemap: new URL("/sitemap.xml", webConfig.webOrigin).toString(),
    host: webConfig.webOrigin,
  };
}
