/**
 * Tests for POI reverse geocoding utilities
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseSearchBoxFeature,
  parseGeocodingV6Feature,
  buildAddressLine,
  reverseGeocode,
} from "./reverseGeocode.js";

describe("parseSearchBoxFeature", () => {
  it("extracts POI with name and secondary showing street + city context", () => {
    const feature = {
      properties: {
        feature_type: "poi",
        name: "Karachi Expo Centre",
        address: "Karachi Expo Centre, Shahrah-e-Faisal",
        full_address: "Karachi Expo Centre, Shahrah-e-Faisal, Karachi, Pakistan",
        context: {
          street: { name: "Shahrah-e-Faisal" },
          place: { name: "Karachi" },
          country: { name: "Pakistan" },
        },
      },
    };
    const result = parseSearchBoxFeature(feature);
    expect(result).toEqual({
      primary: "Karachi Expo Centre",
      secondary: "Shahrah-e-Faisal, Karachi",
      address: "Karachi Expo Centre, Shahrah-e-Faisal, Karachi, Pakistan",
      hierarchy: {
        street: "Shahrah-e-Faisal",
        neighborhood: null,
        locality: null,
        place: "Karachi",
        region: null,
        country: "Pakistan",
      },
    });
  });

  it("extracts address with neighborhood, city, region as secondary", () => {
    const feature = {
      properties: {
        feature_type: "address",
        address: "1201 S Main St",
        full_address: "1201 S Main St, Ann Arbor, Michigan 48104, United States",
        context: {
          street: { name: "S Main St" },
          neighborhood: { name: "South Main" },
          place: { name: "Ann Arbor" },
          region: { name: "Michigan" },
          country: { name: "United States" },
        },
      },
    };
    const result = parseSearchBoxFeature(feature);
    expect(result?.primary).toBe("1201 S Main St");
    expect(result?.secondary).toBe("South Main, Ann Arbor, Michigan");
    expect(result?.hierarchy.place).toBe("Ann Arbor");
    expect(result?.hierarchy.neighborhood).toBe("South Main");
  });

  it("extracts street feature with locality + city as secondary", () => {
    const feature = {
      properties: {
        feature_type: "street",
        name: "Main Street",
        context: {
          street: { name: "Main Street" },
          locality: { name: "Downtown" },
          place: { name: "Karachi" },
        },
      },
    };
    const result = parseSearchBoxFeature(feature);
    expect(result?.primary).toBe("Main Street");
    expect(result?.secondary).toBe("Downtown, Karachi");
  });

  it("extracts place when feature_type is place", () => {
    const feature = {
      properties: {
        feature_type: "place",
        name: "Karachi",
        context: {
          place: { name: "Karachi" },
          region: { name: "Sindh" },
          country: { name: "Pakistan" },
        },
      },
    };
    const result = parseSearchBoxFeature(feature);
    expect(result?.primary).toBe("Karachi");
    expect(result?.secondary).toBe("Sindh");
  });

  it("returns null for empty or invalid feature", () => {
    expect(parseSearchBoxFeature(null)).toBeNull();
    expect(parseSearchBoxFeature({})).toBeNull();
    expect(parseSearchBoxFeature({ properties: {} })).toBeNull();
  });
});

describe("parseGeocodingV6Feature", () => {
  it("extracts address and hierarchy from v6 response", () => {
    const feature = {
      properties: {
        name: "34170 Gannon Terrace",
        full_address: "34170 Gannon Terrace, Fremont, California 94555, United States",
        address_line1: "34170 Gannon Terrace",
        context: {
          address: { name: "Gannon Terrace", street_name: "gannon terrace" },
          street: { name: "gannon terrace" },
          neighborhood: { name: "Ardenwood" },
          place: { name: "Fremont" },
          region: { name: "California" },
          country: { name: "United States" },
        },
      },
    };
    const result = parseGeocodingV6Feature(feature);
    expect(result?.primary).toBe("34170 Gannon Terrace");
    expect(result?.hierarchy.place).toBe("Fremont");
    expect(result?.hierarchy.neighborhood).toBe("Ardenwood");
  });

  it("uses hierarchy fallback when name is missing", () => {
    const feature = {
      properties: {
        context: {
          place: { name: "Karachi" },
          region: { name: "Sindh" },
          country: { name: "Pakistan" },
        },
      },
    };
    const result = parseGeocodingV6Feature(feature);
    expect(result?.primary).toBe("Karachi");
    expect(result?.secondary).toBe("Sindh");
    expect(result?.hierarchy.region).toBe("Sindh");
  });

  it("returns null for empty feature", () => {
    expect(parseGeocodingV6Feature(null)).toBeNull();
    expect(parseGeocodingV6Feature({ properties: {} })).toBeNull();
  });
});

describe("buildAddressLine", () => {
  it("joins hierarchy parts in order", () => {
    const hierarchy = {
      street: "Main St",
      neighborhood: "Downtown",
      locality: "CBD",
      place: "Karachi",
      region: "Sindh",
      country: "Pakistan",
    };
    expect(buildAddressLine(hierarchy)).toBe(
      "Main St, Downtown, CBD, Karachi, Sindh, Pakistan"
    );
  });

  it("skips null/undefined parts", () => {
    const hierarchy = {
      street: "Main St",
      neighborhood: null,
      place: "Karachi",
      region: "Sindh",
      country: "Pakistan",
    };
    expect(buildAddressLine(hierarchy)).toBe("Main St, Karachi, Sindh, Pakistan");
  });

  it("returns null for empty or invalid input", () => {
    expect(buildAddressLine(null)).toBeNull();
    expect(buildAddressLine(undefined)).toBeNull();
    expect(buildAddressLine({})).toBeNull();
    expect(buildAddressLine("string")).toBeNull();
  });
});

describe("reverseGeocode", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns Search Box result when API returns POI with city context", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [{
            properties: {
              feature_type: "poi",
              name: "Jinnah International Airport",
              address: "Airport Rd",
              context: {
                street: { name: "Airport Road" },
                place: { name: "Karachi" },
                country: { name: "Pakistan" },
              },
            },
          }],
        }),
      });
    const result = await reverseGeocode(24.9056, 67.0822, {
      token: "test-token",
      fetchFn: mockFetch,
    });
    expect(result?.primary).toBe("Jinnah International Airport");
    expect(result?.secondary).toBe("Airport Road, Karachi");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain("searchbox/v1/reverse");
  });

  it("falls back to Geocoding v6 when Search Box returns empty", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ features: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [{
            properties: {
              feature_type: "street",
              name: "Multan Road",
              context: {
                street: { name: "Multan Road" },
                neighborhood: { name: "Ichhra" },
                place: { name: "Lahore" },
                region: { name: "Punjab" },
                country: { name: "Pakistan" },
              },
            },
          }],
        }),
      });
    const result = await reverseGeocode(24.86, 67.0, {
      token: "test-token",
      fetchFn: mockFetch,
    });
    expect(result?.primary).toBe("Multan Road");
    expect(result?.secondary).toBe("Ichhra, Lahore, Punjab");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toContain("geocode/v6/reverse");
  });

  it("uses v6 street-level result over Search Box neighborhood-only result", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [{
            properties: {
              feature_type: "neighborhood",
              name: "Model Town",
              context: {
                neighborhood: { name: "Model Town" },
                place: { name: "Lahore" },
                region: { name: "Punjab" },
                country: { name: "Pakistan" },
              },
            },
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [{
            properties: {
              feature_type: "address",
              name: "45-B Faisal Town",
              full_address: "45-B Faisal Town, Lahore, Punjab, Pakistan",
              context: {
                street: { name: "Faisal Town Main Blvd" },
                neighborhood: { name: "Faisal Town" },
                place: { name: "Lahore" },
                region: { name: "Punjab" },
                country: { name: "Pakistan" },
              },
            },
          }],
        }),
      });
    const result = await reverseGeocode(31.52, 74.35, {
      token: "test-token",
      fetchFn: mockFetch,
    });
    expect(result?.primary).toBe("45-B Faisal Town");
    expect(result?.hierarchy?.street).toBe("Faisal Town Main Blvd");
    expect(result?.hierarchy?.place).toBe("Lahore");
  });

  it("uses Tilequery road name when geocoding only returns city-level result", async () => {
    const mockFetch = vi.fn()
      // 1. Search Box — returns empty (no granular features for this area)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ features: [] }) })
      // 2. Geocoding v6 — only has place-level (Liaquatpur)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [{
            properties: {
              feature_type: "place",
              name: "Liaquatpur",
              context: {
                place: { name: "Liaquatpur" },
                region: { name: "Punjab" },
                country: { name: "Pakistan" },
              },
            },
          }],
        }),
      })
      // 3. Tilequery — finds the nearest road from map vector tiles
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [
            {
              type: "Feature",
              properties: { name: "Allabad Road", name_en: "Allabad Road", class: "secondary", tilequery_distance: 12 },
              geometry: { type: "LineString", coordinates: [[78.946, 28.932], [78.947, 28.933]] },
            },
          ],
        }),
      });
    const result = await reverseGeocode(28.9324, 78.9467, {
      token: "test-token",
      fetchFn: mockFetch,
    });
    expect(result?.primary).toBe("Allabad Road");
    expect(result?.secondary).toBe("Liaquatpur, Punjab");
    expect(result?.hierarchy?.street).toBe("Allabad Road");
    expect(result?.hierarchy?.place).toBe("Liaquatpur");
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[2][0]).toContain("tilequery");
  });

  it("returns null when no token provided", async () => {
    const result = await reverseGeocode(99.99, 99.99, { token: null, fetchFn: vi.fn() });
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
    const result = await reverseGeocode(88.88, 88.88, {
      token: "test-token",
      fetchFn: mockFetch,
    });
    expect(result).toBeNull();
  });

  it("caches results for same coordinates", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [{
          properties: {
            feature_type: "poi",
            name: "Cached POI",
            context: {},
          },
        }],
      }),
    });
    const result1 = await reverseGeocode(24.8607, 67.0011, {
      token: "test-token",
      fetchFn: mockFetch,
    });
    const result2 = await reverseGeocode(24.8607, 67.0011, {
      token: "test-token",
      fetchFn: mockFetch,
    });
    expect(result1?.primary).toBe("Cached POI");
    expect(result2?.primary).toBe("Cached POI");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
