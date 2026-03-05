import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Locator, Page } from 'playwright';
import { ensureDir } from '../utils/file.js';

const MAX_BROKEN_LINK_PREVIEWS_PER_PAGE = 50;

type BoundingBox = { x: number; y: number; width: number; height: number };
export type ScreenshotType = 'snippet' | 'fullpage' | 'none';

export type BrokenLinkScreenshot = {
  type: ScreenshotType;
  path: string | null;
  thumbnailPath: string | null;
  elementSelector?: string;
  bbox?: BoundingBox;
  crop?: BoundingBox;
  error?: string;
};

export type BrokenLinkPreviewTarget = {
  sourcePageUrl: string;
  brokenUrl: string;
  linkText: string;
  index: number;
  elementSelector?: string;
  locator?: Locator;
};

export function buildBrokenLinkFindingId(input: BrokenLinkPreviewTarget): string {
  const digest = createHash('sha1')
    .update(`${input.sourcePageUrl}\u0000${input.brokenUrl}\u0000${input.linkText}\u0000${input.index}`)
    .digest('hex');
  return digest.slice(0, 16);
}

export function computeBrokenLinkCrop(bbox: BoundingBox, imageWidth: number, imageHeight: number): BoundingBox {
  const marginX = Math.max(40, bbox.width * 0.5);
  const marginY = Math.max(40, bbox.height * 1);
  const x = Math.max(0, Math.floor(bbox.x - marginX));
  const y = Math.max(0, Math.floor(bbox.y - marginY));
  const maxWidth = Math.max(1, imageWidth - x);
  const maxHeight = Math.max(1, imageHeight - y);
  const width = Math.max(1, Math.min(maxWidth, Math.ceil(bbox.width + (marginX * 2))));
  const height = Math.max(1, Math.min(maxHeight, Math.ceil(bbox.height + (marginY * 2))));
  return { x, y, width, height };
}

function toRelative(targetFolder: string, filePath: string): string {
  return path.relative(targetFolder, filePath).replaceAll('\\', '/');
}

async function addOverlay(page: Page, bbox: BoundingBox): Promise<void> {
  await page.evaluate((rect) => {
    const existing = document.getElementById('__broken_link_preview_overlay__');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = '__broken_link_preview_overlay__';
    overlay.style.position = 'fixed';
    overlay.style.left = `${rect.x}px`;
    overlay.style.top = `${rect.y}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.style.border = '5px solid #ff0000';
    overlay.style.boxSizing = 'border-box';
    overlay.style.background = 'rgba(255,0,0,0.05)';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '2147483647';
    document.body.appendChild(overlay);
  }, bbox);
}

async function removeOverlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.getElementById('__broken_link_preview_overlay__')?.remove();
  });
}

export async function captureBrokenLinkPreview(page: Page, targetFolder: string, target: BrokenLinkPreviewTarget): Promise<BrokenLinkScreenshot> {
  const previewDir = path.join(targetFolder, 'broken-links', 'previews');
  ensureDir(previewDir);
  const findingId = buildBrokenLinkFindingId(target);
  const snippetPath = path.join(previewDir, `${findingId}.png`);
  const thumbPath = path.join(previewDir, `${findingId}_thumb.png`);

  let bbox = await target.locator?.boundingBox().catch(() => null);
  if ((!bbox || bbox.width <= 0 || bbox.height <= 0) && target.elementSelector) {
    bbox = await page.locator(target.elementSelector).first().boundingBox().catch(() => null);
  }

  if (bbox && bbox.width > 0 && bbox.height > 0) {
    try {
      await target.locator?.scrollIntoViewIfNeeded().catch(() => undefined);
      bbox = await target.locator?.boundingBox().catch(() => bbox) ?? bbox;
      if (!bbox) throw new Error('Bounding box missing after scroll.');
      const viewport = page.viewportSize() ?? { width: 1366, height: 768 };
      const bounded = {
        x: Math.max(0, bbox.x),
        y: Math.max(0, bbox.y),
        width: Math.max(1, Math.min(bbox.width, viewport.width)),
        height: Math.max(1, Math.min(bbox.height, viewport.height))
      };
      const crop = computeBrokenLinkCrop(bounded, viewport.width, viewport.height);
      await addOverlay(page, bounded);
      await page.screenshot({ path: snippetPath, type: 'png', clip: crop });
      await removeOverlay(page);
      await page.screenshot({ path: thumbPath, type: 'png', clip: crop });
      return {
        type: 'snippet',
        path: toRelative(targetFolder, snippetPath),
        thumbnailPath: toRelative(targetFolder, thumbPath),
        elementSelector: target.elementSelector,
        bbox: bounded,
        crop
      };
    } catch (error) {
      await removeOverlay(page).catch(() => undefined);
    return {
        type: 'fullpage',
        path: null,
        thumbnailPath: null,
        elementSelector: target.elementSelector,
        error: `Snippet preview failed (${error instanceof Error ? error.message : String(error)}); will use fallback.`
      };
    }
  }

  try {
    await page.screenshot({ path: snippetPath, type: 'png', fullPage: true });
    await page.screenshot({ path: thumbPath, type: 'png', fullPage: true });
    return {
      type: 'fullpage',
      path: toRelative(targetFolder, snippetPath),
      thumbnailPath: toRelative(targetFolder, thumbPath),
      elementSelector: target.elementSelector,
      error: 'Fell back to full-page preview because element bounding box was unavailable.'
    };
  } catch (error) {
    return {
      type: 'none',
      path: null,
      thumbnailPath: null,
      elementSelector: target.elementSelector,
      error: `Preview generation failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export function shouldSkipBrokenLinkPreview(brokenIndex: number): boolean {
  return brokenIndex >= MAX_BROKEN_LINK_PREVIEWS_PER_PAGE;
}
