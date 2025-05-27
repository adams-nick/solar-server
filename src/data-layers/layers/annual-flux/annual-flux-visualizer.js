/**
 * Annual flux layer visualizer for SolarScanner data-layers module
 */

const Visualizer = require("../../core/visualizer");
const ColorPalettes = require("../../utils/color-palettes");
const VisualizationUtils = require("../../utils/visualization-utils");
const config = require("../../config");

class AnnualFluxVisualizer extends Visualizer {
  /**
   * Create a new AnnualFluxVisualizer
   * @param {boolean} [useEnhancedPalette=true] - Whether to use enhanced color palette for building focus
   */
  constructor(useEnhancedPalette = true) {
    super();
    this.useEnhancedPalette = useEnhancedPalette;
    console.log(
      `[AnnualFluxVisualizer] Initialized with enhanced palette: ${this.useEnhancedPalette}`
    );
  }

  /**
   * Check if this visualizer can handle the given layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if this visualizer can handle the layer type
   */
  canHandle(layerType) {
    return layerType === "annualFlux";
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
      "080817", // Intermediate
      "100b23", // Intermediate
      "120d30", // Original
      "1a0f3c", // Intermediate
      "221148", // Intermediate
      "251356", // Original
      "2c1562", // Intermediate
      "32176e", // Intermediate
      "38197c", // Original
      "3f1b7a", // Intermediate
      "451e78", // Intermediate
      "4b2079", // Original
      "522377", // Intermediate
      "582677", // Intermediate
      "5e2876", // Original
      "652b74", // Intermediate
      "6c2e73", // Intermediate
      "713072", // Original
      "773270", // Intermediate
      "7d356f", // Intermediate
      "83376e", // Original
      "89396c", // Intermediate
      "8f3c6a", // Intermediate
      "96406a", // Original
      "9c4368", // Intermediate
      "a24666", // Intermediate
      "a84866", // Original
      "ae4b64", // Intermediate
      "b44e63", // Intermediate
      "bb5062", // Original
      "c15360", // Intermediate
      "c7565f", // Intermediate
      "cf595e", // Original
      "d35c5c", // Intermediate
      "d75e5a", // Intermediate
      "e2615a", // Original
      "e66652", // Intermediate
      "ee6a4f", // Intermediate
      "f66b4d", // Original
      "fa7445", // Intermediate
      "fe7d3e", // Intermediate
      "ff7e3c", // Original
      "ff8834", // Intermediate
      "ff912d", // Intermediate
      "ff932a", // Original
      "ff9c22", // Intermediate
      "ffa51a", // Intermediate
      "ffa813", // Original
      "ffb20e", // Intermediate
      "ffbb09", // Intermediate
      "ffbf00", // Original
      "ffc811", // Intermediate
      "ffd122", // Intermediate
      "ffd700", // Original
      "ffdc33", // Intermediate
      "ffe166", // Intermediate
      "fff0bf", // Original
      "fffadb", // Intermediate
      "fffff6", // Original end - near white
    ];

    return ColorPalettes.createPalette(enhancedColors, 256);
  }

  /**
   * Get the appropriate palette based on settings and options
   * @private
   * @param {Object} options - Visualization options
   * @param {boolean} isForBuildingFocus - Whether this palette is for building focus visualization
   * @returns {Array<Object>} - Color palette
   */
  getPaletteForVisualization(options, isForBuildingFocus = false) {
    // If user provided a custom palette, always use it
    if (options.palette) {
      return options.palette;
    }

    // For building focus and enhanced palette is enabled
    if (isForBuildingFocus && this.useEnhancedPalette) {
      console.log(
        "[AnnualFluxVisualizer] Using enhanced palette for building focus"
      );
      return this.getEnhancedFluxPalette();
    }

    // Default palette (IRON or user-specified)
    const paletteName = options.paletteName || "IRON";
    console.log(`[AnnualFluxVisualizer] Using ${paletteName} palette`);
    return ColorPalettes.getPalette(paletteName);
  }

  /**
   * Create visualization from processed annual flux data
   * @param {Object} processedData - The processed annual flux data
   * @param {Object} options - Visualization options
   * @returns {Promise<string|Object>} - URL or object with visualization data URLs
   */
  async visualize(processedData, options = {}) {
    try {
      return await this.timeOperation("visualize", async () => {
        console.log(
          "[AnnualFluxVisualizer] Creating visualization from annual flux data"
        );

        // Check if we should create synthetic visualization
        if (options.synthetic || !processedData) {
          console.log(
            "[AnnualFluxVisualizer] Creating synthetic visualization"
          );
          const syntheticUrl = this.createSyntheticVisualization(options);
          return {
            buildingFocus: syntheticUrl,
            fullImage: syntheticUrl,
          };
        }

        // Validate processed data
        this.validateProcessedData(processedData, [
          "raster",
          "fullOriginalRaster",
          "metadata",
        ]);

        // Get data from processed result
        const {
          raster, // Masked and cropped to building
          metadata,
          fullOriginalRaster, // Complete original data (not cropped)
          fullWidth,
          fullHeight,
        } = processedData;

        // Get dimensions from metadata for cropped version
        const croppedWidth = metadata.dimensions.width;
        const croppedHeight = metadata.dimensions.height;

        console.log(
          `[AnnualFluxVisualizer] Processing building-focused data with dimensions: ${croppedWidth}x${croppedHeight}`
        );

        // Get data range for normalization
        const min = 0; // Always start from 0
        const max = metadata.dataRange?.max || 1800; // Use default range if not available

        console.log(
          `[AnnualFluxVisualizer] Using data range: min=${min}, max=${max}`
        );

        // 1. Create maskedFlux visualization (building focus) - with potential enhanced palette
        const buildingFocusPalette = this.getPaletteForVisualization(
          options,
          true
        );

        const maskedFluxCanvas = VisualizationUtils.createCanvas(
          raster, // Already masked and cropped to building
          croppedWidth,
          croppedHeight,
          buildingFocusPalette,
          {
            min,
            max,
            useAlpha: true,
            noDataValue: config.processing.NO_DATA_VALUE,
          }
        );

        const maskedFluxUrl =
          VisualizationUtils.canvasToDataURL(maskedFluxCanvas);

        // 2. Create rawFlux visualization (full UNCROPPED image) - always use original palette approach
        console.log(
          `[AnnualFluxVisualizer] Processing full image data with dimensions: ${fullWidth}x${fullHeight}`
        );

        const fullImagePalette = this.getPaletteForVisualization(
          options,
          false
        );

        const rawFluxCanvas = VisualizationUtils.createCanvas(
          fullOriginalRaster, // Use the FULL UNCROPPED original data
          fullWidth, // Use full width
          fullHeight, // Use full height
          fullImagePalette,
          {
            min,
            max,
            useAlpha: false, // No transparency for raw flux
            noDataValue: config.processing.NO_DATA_VALUE,
          }
        );

        const rawFluxUrl = VisualizationUtils.canvasToDataURL(rawFluxCanvas);

        // Return simple structure with just the URLs as requested
        console.log(
          "[AnnualFluxVisualizer] Annual flux visualization complete"
        );

        return {
          buildingFocus: maskedFluxUrl, // masked & cropped for building focus (potentially enhanced palette)
          fullImage: rawFluxUrl, // full uncropped image for full view (original palette)
        };
      });
    } catch (error) {
      console.error(
        `[AnnualFluxVisualizer] Visualization error: ${error.message}`
      );

      // Create synthetic visualization as fallback
      const syntheticUrl = this.createSyntheticVisualization({
        width: options.width || 400,
        height: options.height || 300,
        location: options.location,
      });

      return {
        buildingFocus: syntheticUrl,
        fullImage: syntheticUrl,
        error: error.message,
      };
    }
  }

  /**
   * Create a synthetic visualization for when real data is unavailable
   * @param {Object} options - Options for the synthetic visualization
   * @returns {string} - Data URL of the synthetic visualization
   */
  createSyntheticVisualization(options = {}) {
    const width = options.width || 400;
    const height = options.height || 300;
    const location = options.location || { latitude: 0, longitude: 0 };

    // Use enhanced palette for synthetic if enabled, otherwise use default
    const palette = this.useEnhancedPalette
      ? this.getEnhancedFluxPalette()
      : options.palette ||
        ColorPalettes.getPalette(options.paletteName || "IRON");

    return VisualizationUtils.createSyntheticVisualization(
      width,
      height,
      0, // month (not relevant for annual flux)
      location,
      palette
    );
  }
}

module.exports = AnnualFluxVisualizer;
