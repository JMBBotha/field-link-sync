
/**
 * Generates an SVG string for a teardrop-shaped map marker.
 * @param color The fill color of the marker.
 * @param size The width of the marker (height is scaled proportionally).
 * @param label Optional text/icon to display inside the marker.
 * @returns A string containing the SVG markup.
 */
export const createTeardropSvg = (color: string, width: number = 40, height: number = 50): string => {
    return `
    <svg width="${width}" height="${height}" viewBox="0 0 24 32" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));">
      <path d="M12 0C5.37258 0 0 5.37258 0 12C0 20 12 32 12 32C12 32 24 20 24 12C24 5.37258 18.6274 0 12 0Z" fill="${color}" stroke="white" stroke-width="1.5"/>
      <circle cx="12" cy="12" r="6" fill="rgba(255,255,255,0.25)"/>
    </svg>
  `;
};

/**
 * Creates a DOM element containing the teardrop marker.
 * Useful for Mapbox GL JS 'element' property.
 */
export const createTeardropMarkerElement = (
    color: string,
    content?: string,
    width: number = 40,
    height: number = 50
): HTMLDivElement => {
    const el = document.createElement('div');
    el.className = 'custom-marker';
    el.style.width = '${width}px';
    el.style.height = '${height}px';
    el.style.display = 'flex';
    el.style.justifyContent = 'center';
    el.style.alignItems = 'flex-start'; // Align content to the top (bulb part)
    el.style.cursor = 'pointer';
    el.style.background = 'transparent'; // Important for SVG to show shape

    // Set inner HTML with the SVG
    el.innerHTML = createTeardropSvg(color, width, height);

    // Add content overlay if provided (e.g., "$", "A")
    if (content) {
        const contentEl = document.createElement('div');
        contentEl.style.position = 'absolute';
        contentEl.style.top = '${width * 0.2}px'; // Roughly center in the bulb
        contentEl.style.color = 'white';
        contentEl.style.fontWeight = 'bold';
        contentEl.style.fontSize = '${width * 0.35}px';
        contentEl.style.zIndex = '1';
        contentEl.innerHTML = content;
        el.appendChild(contentEl);
    }

    return el;
};
