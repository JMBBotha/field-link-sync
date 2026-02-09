import { vi } from "vitest";
import "fake-indexeddb/auto";
import "@testing-library/jest-dom";

// Mock matchMedia for jsdom
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Mock navigator.geolocation
Object.defineProperty(navigator, "geolocation", {
  value: {
    getCurrentPosition: vi.fn((cb) =>
      cb({ coords: { latitude: -26.2, longitude: 28.0, accuracy: 10 }, timestamp: Date.now() })
    ),
    watchPosition: vi.fn(() => 1),
    clearWatch: vi.fn(),
  },
});

// Mock IntersectionObserver
class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
Object.defineProperty(window, "IntersectionObserver", {
  value: MockIntersectionObserver,
});
