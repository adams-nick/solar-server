/**
 * Combined Flux-DSM Visualizer for SolarScanner data-layers module
 *
 * This dedicated visualizer takes processed annual flux data and processed DSM data
 * and creates enhanced visualizations that blend both datasets.
 *
 * File: src/data-layers/visualizers/combined-flux-dsm-visualizer.js
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
      "00000a", // Original start - very dark purple
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
      "fffff6", // Original end - near white
    ];

    return ColorPalettes.createPalette(enhancedColors, 256);
  }

  /**
   * Create enhanced visualization blending annual flux and DSM data
   * @param {Object} fluxProcessedData - Processed annual flux data
   * @param {Object} dsmProcessedData - Processed DSM data
   * @param {Object} options - Visualization options
   * @param {string} [options.blendMode='additive'] - Blending mode (additive, multiply, overlay, elevation_highlight)
   * @param {number} [options.dsmInfluence=0.35] - How much DSM affects the result (0-1)
   * @param {boolean} [options.buildingFocus=true] - Whether to focus on building area
   * @param {Array<Object>} [options.palette] - Custom color palette
   * @param {string} [options.paletteName='IRON'] - Name of predefined palette
   * @returns {Promise<Object>} - Blended visualization URLs
   */
  async createBlendedVisualization(
    fluxProcessedData,
    dsmProcessedData,
    options = {}
  ) {
    try {
      console.log(
        "[CombinedFluxDsmVisualizer] Creating blended flux+DSM visualization"
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
        // We could resample here, but for simplicity, we'll throw an error
        throw new Error(`Dimension mismatch between flux and DSM data`);
      }

      // Set visualization options
      const blendMode = options.blendMode || "additive";
      const dsmInfluence = options.dsmInfluence || 0.35;
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
        `[CombinedFluxDsmVisualizer] Using flux range: ${fluxRange.min}-${fluxRange.max}, DSM range: ${dsmRange.min}-${dsmRange.max}`
      );

      // Create blended visualization
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

      console.log("[CombinedFluxDsmVisualizer] Blended visualization complete");

      return {
        buildingFocus: blendedDataUrl, // Enhanced with DSM blending
        fullImage: fluxOnlyDataUrl, // Standard flux visualization for comparison
        enhanced: true,
        metadata: {
          blendMode,
          dsmInfluence,
          hasDsmBlending: true,
          dimensions: { width, height },
          fluxRange,
          dsmRange,
        },
      };
    } catch (error) {
      console.error(
        `[CombinedFluxDsmVisualizer] Error creating blended visualization: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Create blended canvas combining flux and DSM data
   * @private
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
      // Create canvas using Node.js canvas (not VisualizationUtils.createCanvas)
      const { createCanvas } = require("canvas");
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");
      const imageData = ctx.createImageData(width, height);

      // Blending parameters
      const blendMode = options.blendMode || "additive";
      const dsmInfluence = options.dsmInfluence || 0.35;

      console.log(
        `[CombinedFluxDsmVisualizer] Using ${blendMode} blending with DSM influence: ${dsmInfluence}`
      );

      // Process each pixel
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const index = y * width + x;
          const pixelIndex = index * 4;

          const fluxValue = fluxRaster[index];
          const dsmValue = dsmRaster[index];

          // Check for no-data values
          const hasValidFlux =
            fluxValue !== config.processing.NO_DATA_VALUE &&
            !isNaN(fluxValue) &&
            fluxValue !== null &&
            fluxValue !== undefined;

          const hasValidDsm =
            dsmValue !== config.processing.NO_DATA_VALUE &&
            !isNaN(dsmValue) &&
            dsmValue !== null &&
            dsmValue !== undefined;

          if (!hasValidFlux) {
            // No flux data - make transparent
            imageData.data[pixelIndex] = 0;
            imageData.data[pixelIndex + 1] = 0;
            imageData.data[pixelIndex + 2] = 0;
            imageData.data[pixelIndex + 3] = options.useAlpha ? 0 : 255;
            continue;
          }

          // Normalize flux value to 0-1
          const normalizedFlux = Math.max(
            0,
            Math.min(
              1,
              (fluxValue - fluxRange.min) / (fluxRange.max - fluxRange.min)
            )
          );

          // Get base color from flux data
          const colorIndex = Math.floor(normalizedFlux * (palette.length - 1));
          const baseColor = palette[colorIndex];

          let finalColor = { ...baseColor };

          // Apply DSM blending if available
          if (hasValidDsm) {
            // Normalize DSM value to 0-1
            const normalizedDsm = Math.max(
              0,
              Math.min(
                1,
                (dsmValue - dsmRange.min) / (dsmRange.max - dsmRange.min)
              )
            );

            // Apply blending based on mode
            finalColor = this.applyBlending(
              baseColor,
              normalizedDsm,
              blendMode,
              dsmInfluence
            );
          }

          // Set pixel color
          imageData.data[pixelIndex] = finalColor.r;
          imageData.data[pixelIndex + 1] = finalColor.g;
          imageData.data[pixelIndex + 2] = finalColor.b;
          imageData.data[pixelIndex + 3] = 255; // Fully opaque
        }
      }

      // Put image data on canvas
      ctx.putImageData(imageData, 0, 0);

      return canvas;
    } catch (error) {
      console.error(
        `[CombinedFluxDsmVisualizer] Error creating blended canvas: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Apply blending between base color and DSM value
   * @private
   * @param {Object} baseColor - Base color from flux {r, g, b}
   * @param {number} normalizedDsm - Normalized DSM value (0-1)
   * @param {string} blendMode - Blending mode
   * @param {number} dsmInfluence - DSM influence (0-1)
   * @returns {Object} - Final blended color {r, g, b}
   */
  applyBlending(baseColor, normalizedDsm, blendMode, dsmInfluence) {
    switch (blendMode) {
      case "additive":
        // DSM adds brightness/intensity to flux colors
        const intensity = 1.0 + normalizedDsm * dsmInfluence;
        return {
          r: Math.min(255, Math.round(baseColor.r * intensity)),
          g: Math.min(255, Math.round(baseColor.g * intensity)),
          b: Math.min(255, Math.round(baseColor.b * intensity)),
        };

      case "multiply":
        // DSM modulates flux colors multiplicatively
        const dsmFactor = normalizedDsm * dsmInfluence + (1.0 - dsmInfluence);
        return {
          r: Math.round(baseColor.r * dsmFactor),
          g: Math.round(baseColor.g * dsmFactor),
          b: Math.round(baseColor.b * dsmFactor),
        };

      case "overlay":
        // Complex blending that preserves both flux and elevation info
        const overlayBlend = (base, overlay) => {
          base = base / 255;
          overlay = overlay / 255;
          const result =
            base < 0.5
              ? 2 * base * overlay
              : 1 - 2 * (1 - base) * (1 - overlay);
          return Math.round(result * 255);
        };

        const overlayValue = normalizedDsm * 255;
        return {
          r: overlayBlend(
            baseColor.r,
            overlayValue * dsmInfluence + baseColor.r * (1 - dsmInfluence)
          ),
          g: overlayBlend(
            baseColor.g,
            overlayValue * dsmInfluence + baseColor.g * (1 - dsmInfluence)
          ),
          b: overlayBlend(
            baseColor.b,
            overlayValue * dsmInfluence + baseColor.b * (1 - dsmInfluence)
          ),
        };

      case "elevation_highlight":
        // Highlight high elevation areas with warmer tones
        const elevationBoost = normalizedDsm * dsmInfluence;
        return {
          r: Math.min(255, Math.round(baseColor.r + elevationBoost * 100)),
          g: Math.round(baseColor.g + elevationBoost * 50),
          b: Math.max(0, Math.round(baseColor.b - elevationBoost * 30)),
        };

      default:
        // Default to additive
        return {
          r: Math.min(
            255,
            Math.round(baseColor.r * (1.0 + normalizedDsm * dsmInfluence))
          ),
          g: Math.min(
            255,
            Math.round(baseColor.g * (1.0 + normalizedDsm * dsmInfluence))
          ),
          b: Math.min(
            255,
            Math.round(baseColor.b * (1.0 + normalizedDsm * dsmInfluence))
          ),
        };
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
