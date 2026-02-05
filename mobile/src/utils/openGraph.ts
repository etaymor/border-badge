import { logger } from './logger';

/**
 * Fetches the Open Graph title or HTML title from a URL.
 * @param url The URL to fetch metadata from
 * @returns The title if found, or null
 */
export async function fetchOpenGraphTitle(url: string): Promise<string | null> {
  if (!url) return null;

  try {
    // Ensure URL has protocol
    const urlToFetch = url.startsWith('http') ? url : `https://${url}`;

    // Add a timeout to prevent hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(urlToFetch, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Atlasi/1.0; +https://atlasi.com)',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const html = await response.text();

    // Try to find og:title
    const ogTitleMatch = html.match(
      /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["'][^>]*>/i
    );
    if (ogTitleMatch && ogTitleMatch[1]) {
      return decodeHTMLEntities(ogTitleMatch[1].trim());
    }

    // Try to find <title> tag
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      return decodeHTMLEntities(titleMatch[1].trim());
    }

    return null;
  } catch (error) {
    logger.warn('Failed to fetch Open Graph title', { url, error });
    return null;
  }
}

function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}
