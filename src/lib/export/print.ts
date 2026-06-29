/**
 * Browser print-to-PDF helper. Renders a self-contained HTML document in a
 * hidden, same-origin iframe and invokes the browser's print dialog, where the
 * user can choose "Save as PDF". No new dependency and no server round trip —
 * this is intentionally a print-to-PDF, not a server-rendered PDF.
 *
 * A hidden iframe is preferred over `window.open` because popups are frequently
 * blocked and would also navigate away from / leave the current page. The iframe
 * is written via `srcdoc` (same-origin, no Blob URL to revoke), printed once its
 * content has loaded, then removed so no DOM nodes leak.
 */

import type { BacktestResult } from '$lib/types';
import { buildTearsheetHtml } from './tearsheet';

/**
 * Print an arbitrary HTML document via a hidden iframe so the user can Save as
 * PDF. Browser-only (no-op when there is no `window`). Cleans up the iframe
 * after printing and never navigates the current page.
 */
export function printHtml(html: string, title?: string): void {
	if (typeof window === 'undefined' || typeof document === 'undefined') return;

	const iframe = document.createElement('iframe');
	// Keep it out of layout and invisible without using display:none, which can
	// stop some browsers from rendering/printing the iframe contents.
	iframe.setAttribute('aria-hidden', 'true');
	iframe.style.position = 'fixed';
	iframe.style.right = '0';
	iframe.style.bottom = '0';
	iframe.style.width = '0';
	iframe.style.height = '0';
	iframe.style.border = '0';
	iframe.style.visibility = 'hidden';

	let cleanedUp = false;
	function cleanup() {
		if (cleanedUp) return;
		cleanedUp = true;
		iframe.remove();
	}

	iframe.addEventListener('load', () => {
		const win = iframe.contentWindow;
		if (!win) {
			cleanup();
			return;
		}
		if (title !== undefined) {
			try {
				if (iframe.contentDocument) iframe.contentDocument.title = title;
			} catch {
				// Ignore — title is cosmetic (suggested PDF filename only).
			}
		}
		// Remove the iframe once the print dialog has been dismissed.
		win.addEventListener('afterprint', cleanup);
		// A short delay lets inline styles/SVG paint before the dialog opens.
		window.setTimeout(() => {
			try {
				win.focus();
				win.print();
			} catch {
				cleanup();
				return;
			}
			// Fallback cleanup in browsers that never fire `afterprint`.
			window.setTimeout(cleanup, 60_000);
		}, 50);
	});

	// `srcdoc` keeps everything same-origin and avoids a Blob URL to revoke.
	iframe.srcdoc = html;
	document.body.appendChild(iframe);
}

/** Build the tearsheet HTML and open the browser print dialog (Save as PDF). */
export function printTearsheet(result: BacktestResult): void {
	printHtml(buildTearsheetHtml(result), result.spec.name);
}
