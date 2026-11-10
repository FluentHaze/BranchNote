import type { APIRoute } from "astro";
import { languagePath, locales, withBase } from "../i18n";

export const GET: APIRoute = ({ site }) => {
  if (!site) throw new Error("Sitemap generation requires the public site URL");

  const escapeXml = (value: string) => value.replace(/[<>&"']/g, character => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]!);
  const homepages = locales.map(locale => ({
    locale,
    url: escapeXml(new URL(languagePath(locale), site).href),
  }));
  const alternatives = [
    ...homepages.map(({ locale, url }) => `<xhtml:link rel="alternate" hreflang="${locale}" href="${url}" />`),
    `<xhtml:link rel="alternate" hreflang="x-default" href="${homepages[0].url}" />`,
  ].join("");
  const entries = homepages.map(({ url }) => `<url><loc>${url}</loc>${alternatives}</url>`);
  entries.push(`<url><loc>${escapeXml(new URL(withBase("workflow/"), site).href)}</loc></url>`);

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${entries.join("")}</urlset>\n`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
};
