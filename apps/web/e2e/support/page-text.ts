import type { Page } from "@playwright/test";

/**
 * The visible text of a page, with everything a supporter or a creator wrote
 * removed. Their words are theirs; the rule is about what the platform says.
 */
export async function platformText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true);
    if (!(clone instanceof HTMLElement)) {
      return "";
    }
    const remove = [
      // A supporter's words and a creator's words are theirs. The copy rules
      // are about what the platform says.
      '[data-testid="supporter-wall"]',
      '[data-testid="creator-bio"]',
      // A detached clone has no layout, so `innerText` falls back to
      // `textContent` and would otherwise include the serialized RSC payload.
      "script",
      "style",
      "noscript",
      "template",
    ];
    for (const selector of remove) {
      for (const node of Array.from(clone.querySelectorAll(selector))) {
        node.remove();
      }
    }
    return (clone.textContent ?? "").replace(/\s+/g, " ");
  });
}
