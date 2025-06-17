/**
 * Combined Flux-DSM Visualizer for SolarScanner data-layers module
 * Simplified version with only hue_shift and additive blending modes
 * Enhanced hue_shift with exponential elevation-based darkening and local normalization
 *
 * Key Features:
 * - Exponential decay darkening: High elevations get significant darkening, low elevations minimal
 * - Local normalization: Better consistency across roof faces with different orientations
 * - Hue shifting: Cool colors for high elevation, warm for low elevation
 * - Preserves flux intensity information while enhancing 3D structure
 *
 * File: src/data-layers/combined-visualizers/combined-flux-dsm-visualizer.js
 */

const ColorPalettes = require("../utils/color-palettes");
const VisualizationUtils = require("../utils/visualization-utils");
const config = require("../config");

class CombinedFluxDsmVisualizer {
  /**
   * Create a new CombinedFluxDsmVisualizer
   * @param {Object} options - Visualizer options
   * @param {boolean} [options.useEnhancedPalette=true] - Whether to use enhanced color palette
   */
  constructor(options = {}) {
    this.useEnhancedPalette = options.useEnhancedPalette !== false;
    console.log(
      `[CombinedFluxDsmVisualizer] Initialized with enhanced palette: ${this.useEnhancedPalette}`
    );
  }

  /**
   * Get enhanced color palette with more granular shades for subtle flux differences
   * @private
   * @returns {Array<Object>} - Enhanced color palette
   */
  getEnhancedFluxPalette() {
    // Extended IRON palette with more granular shades for subtle flux detection
    const enhancedColors = [
      "00000a",
      "080817",
      "100b23",
      "120d30",
      "1a0f3c",
      "221148",
      "251356",
      "2c1562",
      "32176e",
      "38197c",
      "3f1b7a",
      "451e78",
      "4b2079",
      "522377",
      "582677",
      "5e2876",
      "652b74",
      "6c2e73",
      "713072",
      "773270",
      "7d356f",
      "83376e",
      "89396c",
      "8f3c6a",
      "96406a",
      "9c4368",
      "a24666",
      "a84866",
      "ae4b64",
      "b44e63",
      "bb5062",
      "c15360",
      "c7565f",
      "cf595e",
      "d35c5c",
      "d75e5a",
      "e2615a",
      "e66652",
      "ee6a4f",
      "f66b4d",
      "fa7445",
      "fe7d3e",
      "ff7e3c",
      "ff8834",
      "ff912d",
      "ff932a",
      "ff9c22",
      "ffa51a",
      "ffa813",
      "ffb20e",
      "ffbb09",
      "ffbf00",
      "ffc811",
      "ffd122",
      "ffd700",
      "ffdc33",
      "ffe166",
      "fff0bf",
      "fffadb",
      "fffff6",
    ];

    return ColorPalettes.createPalette(enhancedColors, 256);
  }

  /**
   * Create blended canvas with simplified blending modes
   * @param {Array} fluxRaster - Annual flux raster data
   * @param {Array} dsmRaster - DSM raster data
   * @param {number} width - Image width
   * @param {number} height - Image height
   * @param {Object} fluxRange - Flux data range {min, max}
   * @param {Object} dsmRange - DSM data range {min, max}
   * @param {Array} palette - Base color palette
   * @param {Object} options - Blending options
   * @returns {HTMLCanvasElement} - Canvas with blended visualization
   */
  createBlendedCanvas(
    fluxRaster,
    dsmRaster,
    width,
    height,
    fluxRange,
    dsmRange,
    palette,
    options = {}
  ) {
    try {
      const blendMode = options.blendMode || "hue_shift"; // Default to hue_shift

      console.log(
        `[CombinedFluxDsmVisualizer] Using ${blendMode} blending with DSM influence: ${
          options.dsmInfluence || 0.4
        }`
      );

      // Route to appropriate blending method
      switch (blendMode) {
        case "hue_shift":
          return this.createEnhancedHueShiftCanvas(
            fluxRaster,
            dsmRaster,
            width,
            height,
            fluxRange,
            dsmRange,
            palette,
            options
          );

        case "additive":
          return this.createAdditiveCanvas(
            fluxRaster,
            dsmRaster,
            width,
            height,
            fluxRange,
            dsmRange,
            palette,
            options
          );

        default:
          // Default to enhanced hue shift
          return this.createEnhancedHueShiftCanvas(
            fluxRaster,
            dsmRaster,
            width,
            height,
            fluxRange,
            dsmRange,
            palette,
            options
          );
      }
    } catch (error) {
      console.error(
        `[CombinedFluxDsmVisualizer] Error creating blended canvas: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * ENHANCED HUE SHIFT WITH EXPONENTIAL ELEVATION-BASED DARKENING
   * Shifts hue based on elevation and darkens higher elevation areas with exponential decay
   * Low elevation = warm (red/orange), High elevation = cool (blue/cyan) + darker
   */
  createEnhancedHueShiftCanvas(
    fluxRaster,
    dsmRaster,
    width,
    height,
    fluxRange,
    dsmRange,
    palette,
    options = {}
  ) {
    const { createCanvas } = require("canvas");
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(width, height);

    const dsmInfluence = options.dsmInfluence || 0.4;
    const darkeningStrength = options.darkeningStrength || 0.4; // How much to darken high elevations
    const exponentialFactor = options.exponentialFactor || 2.5; // Controls exponential decay (higher = more aggressive decay)
    const normalizationMode = options.normalizationMode || "local"; // "global" or "local"

    // Helper function to convert RGB to HSL
    function rgbToHsl(r, g, b) {
      r /= 255;
      g /= 255;
      b /= 255;
      const max = Math.max(r, g, b),
        min = Math.min(r, g, b);
      let h,
        s,
        l = (max + min) / 2;

      if (max === min) {
        h = s = 0;
      } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r:
            h = (g - b) / d + (g < b ? 6 : 0);
            break;
          case g:
            h = (b - r) / d + 2;
            break;
          case b:
            h = (r - g) / d + 4;
            break;
        }
        h /= 6;
      }
      return [h, s, l];
    }

    // Helper function to convert HSL to RGB
    function hslToRgb(h, s, l) {
      let r, g, b;
      if (s === 0) {
        r = g = b = l;
      } else {
        const hue2rgb = (p, q, t) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
      }
      return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }

    // Calculate local DSM statistics for better normalization if requested
    let localDsmStats = null;
    if (normalizationMode === "local") {
      // Calculate statistics more efficiently to avoid stack overflow
      let localMin = Infinity;
      let localMax = -Infinity;
      let validCount = 0;
      let sum = 0;

      // Single pass through the data to calculate statistics
      for (let i = 0; i < dsmRaster.length; i++) {
        const value = dsmRaster[i];
        if (
          value !== config.processing.NO_DATA_VALUE &&
          !isNaN(value) &&
          value !== null &&
          value !== undefined
        ) {
          localMin = Math.min(localMin, value);
          localMax = Math.max(localMax, value);
          sum += value;
          validCount++;
        }
      }

      if (validCount > 0 && localMax > localMin) {
        const localRange = localMax - localMin;

        localDsmStats = {
          min: localMin,
          max: localMax,
          range: localRange,
          mean: sum / validCount,
        };

        console.log(
          `[CombinedFluxDsmVisualizer] Local DSM stats: min=${localMin.toFixed(
            2
          )}, max=${localMax.toFixed(2)}, range=${localRange.toFixed(
            2
          )}, validPixels=${validCount}`
        );
      } else {
        console.log(
          `[CombinedFluxDsmVisualizer] Warning: Local DSM normalization failed, falling back to global. ValidCount=${validCount}, range=${
            localMax - localMin
          }`
        );
      }
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        const pixelIndex = index * 4;

        const fluxValue = fluxRaster[index];
        const dsmValue = dsmRaster[index];

        if (
          fluxValue === config.processing.NO_DATA_VALUE ||
          isNaN(fluxValue) ||
          fluxValue === null ||
          fluxValue === undefined
        ) {
          imageData.data[pixelIndex] = 0;
          imageData.data[pixelIndex + 1] = 0;
          imageData.data[pixelIndex + 2] = 0;
          imageData.data[pixelIndex + 3] = options.useAlpha ? 0 : 255;
          continue;
        }

        const normalizedFlux = Math.max(
          0,
          Math.min(
            1,
            (fluxValue - fluxRange.min) / (fluxRange.max - fluxRange.min)
          )
        );
        const colorIndex = Math.floor(normalizedFlux * (palette.length - 1));
        const baseColor = palette[colorIndex];

        let finalColor = { ...baseColor };

        if (
          dsmValue !== config.processing.NO_DATA_VALUE &&
          !isNaN(dsmValue) &&
          dsmValue !== null &&
          dsmValue !== undefined
        ) {
          // Normalize DSM value using local or global range
          let normalizedDsm = 0;

          if (localDsmStats && localDsmStats.range > 0.01) {
            // Minimum range threshold
            // Use local normalization for better consistency across roof faces
            normalizedDsm = Math.max(
              0,
              Math.min(1, (dsmValue - localDsmStats.min) / localDsmStats.range)
            );
          } else {
            // Fallback to global normalization
            const globalRange = dsmRange.max - dsmRange.min;
            if (globalRange > 0.01) {
              normalizedDsm = Math.max(
                0,
                Math.min(1, (dsmValue - dsmRange.min) / globalRange)
              );
            } else {
              // If both ranges are too small, use a default moderate value
              normalizedDsm = 0.5;
            }
          }

          // Convert to HSL
          const [h, s, l] = rgbToHsl(baseColor.r, baseColor.g, baseColor.b);

          // Shift hue based on elevation (more subtle for local normalization)
          const hueShiftAmount = normalizationMode === "local" ? 0.25 : 0.4;
          const hueShift = normalizedDsm * dsmInfluence * hueShiftAmount;
          const newHue = (h + hueShift) % 1;

          // EXPONENTIAL DECAY DARKENING: High elevation gets significant darkening,
          // but as elevation drops, the darkening effect diminishes exponentially
          const exponentialDarkening = Math.pow(
            normalizedDsm,
            exponentialFactor
          );
          const darkeningFactor = Math.max(
            0.1,
            1 - exponentialDarkening * darkeningStrength
          ); // Prevent over-darkening

          // Apply adaptive lightness adjustment based on the original lightness
          // This helps maintain contrast across different flux intensities
          const adaptiveLightness = Math.max(
            0,
            Math.min(1, l * darkeningFactor)
          );

          // Optional: Add slight saturation boost for higher elevations to enhance the effect
          const saturationBoost =
            normalizationMode === "local" ? 1 + normalizedDsm * 0.1 : 1;
          const newSaturation = Math.min(1, Math.max(0, s * saturationBoost));

          // Convert back to RGB with modified hue, saturation, and lightness
          const [newR, newG, newB] = hslToRgb(
            newHue,
            newSaturation,
            adaptiveLightness
          );
          finalColor = {
            r: Math.max(0, Math.min(255, newR)),
            g: Math.max(0, Math.min(255, newG)),
            b: Math.max(0, Math.min(255, newB)),
          };
        }

        imageData.data[pixelIndex] = finalColor.r;
        imageData.data[pixelIndex + 1] = finalColor.g;
        imageData.data[pixelIndex + 2] = finalColor.b;
        imageData.data[pixelIndex + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  /**
   * ADDITIVE BLENDING
   * Simple additive blending for compatibility
   */
  createAdditiveCanvas(
    fluxRaster,
    dsmRaster,
    width,
    height,
    fluxRange,
    dsmRange,
    palette,
    options = {}
  ) {
    const { createCanvas } = require("canvas");
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(width, height);

    const dsmInfluence = options.dsmInfluence || 0.35;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        const pixelIndex = index * 4;

        const fluxValue = fluxRaster[index];
        const dsmValue = dsmRaster[index];

        if (
          fluxValue === config.processing.NO_DATA_VALUE ||
          isNaN(fluxValue) ||
          fluxValue === null ||
          fluxValue === undefined
        ) {
          imageData.data[pixelIndex] = 0;
          imageData.data[pixelIndex + 1] = 0;
          imageData.data[pixelIndex + 2] = 0;
          imageData.data[pixelIndex + 3] = options.useAlpha ? 0 : 255;
          continue;
        }

        const normalizedFlux = Math.max(
          0,
          Math.min(
            1,
            (fluxValue - fluxRange.min) / (fluxRange.max - fluxRange.min)
          )
        );
        const colorIndex = Math.floor(normalizedFlux * (palette.length - 1));
        const baseColor = palette[colorIndex];

        let finalColor = { ...baseColor };

        if (
          dsmValue !== config.processing.NO_DATA_VALUE &&
          !isNaN(dsmValue) &&
          dsmValue !== null &&
          dsmValue !== undefined
        ) {
          const normalizedDsm = Math.max(
            0,
            Math.min(
              1,
              (dsmValue - dsmRange.min) / (dsmRange.max - dsmRange.min)
            )
          );

          // Additive blending - brighten based on elevation
          const intensity = 1.0 + normalizedDsm * dsmInfluence;
          finalColor = {
            r: Math.min(255, Math.round(baseColor.r * intensity)),
            g: Math.min(255, Math.round(baseColor.g * intensity)),
            b: Math.min(255, Math.round(baseColor.b * intensity)),
          };
        }

        imageData.data[pixelIndex] = finalColor.r;
        imageData.data[pixelIndex + 1] = finalColor.g;
        imageData.data[pixelIndex + 2] = finalColor.b;
        imageData.data[pixelIndex + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  /**
   * Create enhanced visualization blending annual flux and DSM data
   * @param {Object} fluxProcessedData - Processed annual flux data
   * @param {Object} dsmProcessedData - Processed DSM data
   * @param {Object} options - Visualization options
   * @returns {Promise<Object>} - Blended visualization URLs
   */
  async createBlendedVisualization(
    fluxProcessedData,
    dsmProcessedData,
    options = {}
  ) {
    try {
      console.log(
        "[CombinedFluxDsmVisualizer] Creating enhanced hue-shift blended flux+DSM visualization"
      );

      // Validate input data
      if (!fluxProcessedData || !fluxProcessedData.raster) {
        throw new Error("Valid flux processed data is required");
      }

      if (!dsmProcessedData || !dsmProcessedData.raster) {
        throw new Error("Valid DSM processed data is required");
      }

      // Extract data from processed results
      const fluxRaster = fluxProcessedData.raster;
      const dsmRaster = dsmProcessedData.raster;
      const fluxMetadata = fluxProcessedData.metadata;
      const dsmMetadata = dsmProcessedData.metadata;

      // Get dimensions (they should match after processing)
      const width = fluxMetadata.width || fluxMetadata.dimensions?.width;
      const height = fluxMetadata.height || fluxMetadata.dimensions?.height;

      console.log(
        `[CombinedFluxDsmVisualizer] Processing ${width}x${height} image`
      );

      // Validate dimensions match
      const dsmWidth = dsmMetadata.width || dsmMetadata.dimensions?.width;
      const dsmHeight = dsmMetadata.height || dsmMetadata.dimensions?.height;

      if (width !== dsmWidth || height !== dsmHeight) {
        console.warn(
          `[CombinedFluxDsmVisualizer] Dimension mismatch: flux(${width}x${height}) vs dsm(${dsmWidth}x${dsmHeight})`
        );
        throw new Error(`Dimension mismatch between flux and DSM data`);
      }

      // Set visualization options - Default to hue_shift with exponential darkening
      const blendMode = options.blendMode || "hue_shift";
      const dsmInfluence = options.dsmInfluence || 0.4;
      const darkeningStrength = options.darkeningStrength || 0.4;
      const exponentialFactor = options.exponentialFactor || 2.5; // Higher = more aggressive decay
      const normalizationMode = options.normalizationMode || "local"; // "local" or "global"
      const buildingFocus = options.buildingFocus !== false;

      // Get color palette
      let palette;
      if (options.palette) {
        palette = options.palette;
      } else if (this.useEnhancedPalette) {
        palette = this.getEnhancedFluxPalette();
      } else {
        const paletteName = options.paletteName || "IRON";
        palette = ColorPalettes.getPalette(paletteName);
      }

      // Get data ranges for normalization
      const fluxRange = {
        min: 0, // Always start from 0 for flux
        max:
          fluxProcessedData.statistics?.max ||
          fluxProcessedData.metadata?.dataRange?.max ||
          1800,
      };

      const dsmRange = {
        min:
          dsmProcessedData.statistics?.min ||
          dsmProcessedData.metadata?.dataRange?.min ||
          0,
        max:
          dsmProcessedData.statistics?.max ||
          dsmProcessedData.metadata?.dataRange?.max ||
          100,
      };

      console.log(
        `[CombinedFluxDsmVisualizer] Using ${blendMode} blending: flux(${fluxRange.min}-${fluxRange.max}), DSM(${dsmRange.min}-${dsmRange.max}), darkening: ${darkeningStrength}, exponential: ${exponentialFactor}, normalization: ${normalizationMode}`
      );

      // Create enhanced blended visualization
      const blendedCanvas = this.createBlendedCanvas(
        fluxRaster,
        dsmRaster,
        width,
        height,
        fluxRange,
        dsmRange,
        palette,
        {
          blendMode,
          dsmInfluence,
          darkeningStrength,
          exponentialFactor,
          normalizationMode,
          useAlpha: buildingFocus,
        }
      );

      // Convert to data URL
      const blendedDataUrl = VisualizationUtils.canvasToDataURL(blendedCanvas, {
        mimeType: "image/png",
        quality: options.quality || config.visualization.PNG_QUALITY,
      });

      // Also create standard flux visualization for comparison
      const fluxOnlyCanvas = VisualizationUtils.createCanvas(
        fluxRaster,
        width,
        height,
        palette,
        {
          min: fluxRange.min,
          max: fluxRange.max,
          useAlpha: buildingFocus,
          noDataValue: config.processing.NO_DATA_VALUE,
        }
      );

      const fluxOnlyDataUrl = VisualizationUtils.canvasToDataURL(
        fluxOnlyCanvas,
        {
          mimeType: "image/png",
          quality: options.quality || config.visualization.PNG_QUALITY,
        }
      );

      console.log(
        "[CombinedFluxDsmVisualizer] Enhanced hue-shift blended visualization complete"
      );

      return {
        buildingFocus: blendedDataUrl, // Enhanced with hue shift and elevation darkening
        fullImage: fluxOnlyDataUrl, // Standard flux visualization for comparison
        enhanced: true,
        metadata: {
          blendMode,
          dsmInfluence,
          darkeningStrength,
          exponentialFactor,
          normalizationMode,
          hasDsmBlending: true,
          usesHueShift: blendMode === "hue_shift",
          elevationDarkening: blendMode === "hue_shift",
          exponentialDecay: true,
          localNormalization: normalizationMode === "local",
          dimensions: { width, height },
          fluxRange,
          dsmRange,
        },
      };
    } catch (error) {
      console.error(
        `[CombinedFluxDsmVisualizer] Error creating enhanced visualization: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Create a synthetic visualization when real data is unavailable
   * @param {Object} options - Options for synthetic visualization
   * @returns {Object} - Synthetic visualization URLs
   */
  createSyntheticVisualization(options = {}) {
    try {
      const width = options.width || 400;
      const height = options.height || 300;
      const location = options.location || { latitude: 0, longitude: 0 };

      const palette = this.useEnhancedPalette
        ? this.getEnhancedFluxPalette()
        : ColorPalettes.getPalette("IRON");

      const syntheticUrl = VisualizationUtils.createSyntheticVisualization(
        width,
        height,
        0, // month (not relevant for annual flux)
        location,
        palette
      );

      return {
        buildingFocus: syntheticUrl,
        fullImage: syntheticUrl,
        enhanced: false,
        synthetic: true,
      };
    } catch (error) {
      console.error(
        `[CombinedFluxDsmVisualizer] Error creating synthetic visualization: ${error.message}`
      );

      // Return minimal fallback
      return {
        buildingFocus: "",
        fullImage: "",
        enhanced: false,
        synthetic: true,
        error: error.message,
      };
    }
  }
}

module.exports = CombinedFluxDsmVisualizer;
