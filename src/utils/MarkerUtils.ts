
/**
 * Generates an SVG string for a teardrop-shaped map marker.
 * @param color The fill color of the marker.
 * @param width The width of the marker.
 * @param height The height of the marker.
 * @param iconType Optional icon to display inside the marker ('wrench' for field agents).
 * @returns A string containing the SVG markup.
 */
export const createTeardropSvg = (
    color: string,
    width: number = 40,
    height: number = 50,
    iconType?: 'wrench' | 'dollar'
): string => {
    let iconSvg = '';
    
    if (iconType === 'wrench') {
        // Wrench icon for field agents - centered in the bulb
        iconSvg = `
            <g transform="translate(12, 12)" fill="white">
                <path transform="translate(-6, -6) scale(0.5)" d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" stroke="white" stroke-width="2" fill="none"/>
            </g>
        `;
    } else if (iconType === 'dollar') {
        // Dollar sign for completed leads
        iconSvg = `
            <text x="12" y="16" text-anchor="middle" fill="white" font-size="12" font-weight="bold">$</text>
        `;
    }

    return `
    <svg width="${width}" height="${height}" viewBox="0 0 24 32" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));">
      <path d="M12 0C5.37258 0 0 5.37258 0 12C0 20 12 32 12 32C12 32 24 20 24 12C24 5.37258 18.6274 0 12 0Z" fill="${color}" stroke="white" stroke-width="1.5"/>
      ${iconType ? iconSvg : '<circle cx="12" cy="12" r="6" fill="rgba(255,255,255,0.25)"/>'}
    </svg>
  `;
};

/**
 * Creates a DOM element containing the teardrop marker.
 * Useful for Mapbox GL JS 'element' property.
 * @param color The fill color of the marker.
 * @param content Optional text content to display (e.g., "$" for completed leads).
 * @param width The width of the marker.
 * @param height The height of the marker.
 * @param iconType Optional icon type to display inside the marker.
 */
export const createTeardropMarkerElement = (
    color: string,
    content?: string,
    width: number = 40,
    height: number = 50,
    iconType?: 'wrench' | 'dollar'
): HTMLDivElement => {
    const el = document.createElement('div');
    el.className = 'custom-marker';
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    el.style.display = 'flex';
    el.style.justifyContent = 'center';
    el.style.alignItems = 'flex-start';
    el.style.cursor = 'pointer';
    el.style.background = 'transparent';

    // Determine icon type from content if not explicitly provided
    const effectiveIconType = iconType || (content === '$' ? 'dollar' : undefined);

    // Set inner HTML with the SVG (icon embedded in SVG)
    el.innerHTML = createTeardropSvg(color, width, height, effectiveIconType);

    // Add text content overlay if provided and not using an icon
    if (content && !effectiveIconType) {
        const contentEl = document.createElement('div');
        contentEl.style.position = 'absolute';
        contentEl.style.top = `${width * 0.2}px`;
        contentEl.style.color = 'white';
        contentEl.style.fontWeight = 'bold';
        contentEl.style.fontSize = `${width * 0.35}px`;
        contentEl.style.zIndex = '1';
        contentEl.innerHTML = content;
        el.appendChild(contentEl);
    }

    return el;
};
